import { useCallback, useEffect, useRef, useState } from 'react';

// Preferred formats, best first. Safari records mp4/AAC, Firefox ogg/opus,
// Chrome webm/opus — the server and Gemini accept all of them.
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/webm',
];

export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
}

export function isRecordingSupported() {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

// Short tone so you know recording started/stopped without looking. Uses the
// recorder's own (already running) AudioContext, so it also works when
// recording was started automatically rather than by a tap.
function playTone(ctx, freq) {
  if (!ctx || ctx.state !== 'running') return;
  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  } catch {
    // audio cue is optional
  }
}

const START_TONE = 880;
const STOP_TONE  = 440;
// Ignore the first moments so the start tone itself never counts as speech
const VOICE_GRACE_MS = 350;

/**
 * One-tap voice recorder with silence detection.
 * onStop({ blob, mimeType, durationMs, heardVoice, reason }) fires once per recording.
 */
export function useVoiceRecorder({ onStop, silenceMs = 4000, maxMs = 120000 }) {
  const [recording, setRecording] = useState(false);
  const [level, setLevel]         = useState(0);       // 0..1 mic level for visuals
  const [elapsedMs, setElapsedMs] = useState(0);

  const ref      = useRef({});
  const unmounted = useRef(false);
  const onStopRef = useRef(onStop);
  useEffect(() => { onStopRef.current = onStop; }, [onStop]);

  const cleanup = useCallback(() => {
    const r = ref.current;
    clearInterval(r.timer);
    r.stream?.getTracks().forEach(t => t.stop());
    const ctx = r.audioCtx;
    if (ctx) setTimeout(() => ctx.close().catch(() => {}), 300); // let the stop tone finish
    ref.current = {};
    setLevel(0);
  }, []);

  const stop = useCallback((reason = 'tap') => {
    const r = ref.current;
    if (!r.recorder || r.stopping) return;
    r.stopping = true;
    r.reason = reason;
    clearInterval(r.timer);
    try { r.recorder.stop(); } catch { cleanup(); setRecording(false); }
  }, [cleanup]);

  /**
   * Start recording. With requireRunningAudio (auto-start, no tap), throws an
   * error named "AutostartBlocked" — after releasing the mic — if the browser
   * won't run audio without a gesture, so the caller can fall back to a tap.
   * tones: play the start/stop beeps (off when "Sound & vibration" is off).
   */
  const start = useCallback(async ({ requireRunningAudio = false, tones = true } = {}) => {
    if (ref.current.recorder || ref.current.starting) return;
    ref.current.starting = true;
    // Create the AudioContext inside the tap so iOS allows it
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = AudioCtx ? new AudioCtx() : null;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      audioCtx?.close().catch(() => {});
      ref.current = {};
      throw err;
    }

    // resume() can stay pending forever when a gesture is required — don't wait on it
    if (audioCtx) {
      await Promise.race([audioCtx.resume().catch(() => {}), new Promise(r => setTimeout(r, 400))]);
    }
    const release = () => {
      stream.getTracks().forEach(t => t.stop());
      audioCtx?.close().catch(() => {});
      ref.current = {};
    };
    if (unmounted.current) { release(); return; } // page closed while starting
    if (requireRunningAudio && audioCtx?.state !== 'running') {
      release();
      const err = new Error('Recording needs a tap to start');
      err.name = 'AutostartBlocked';
      throw err;
    }

    const mimeType = pickMimeType();
    let recorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (err) {
      release();
      throw err;
    }
    const chunks   = [];
    const startedAt = Date.now();

    const r = { recorder, stream, audioCtx, chunks, startedAt, lastVoiceAt: startedAt, heardVoice: false, noiseFloor: 0.01, tones };
    ref.current = r;

    recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || 'audio/webm';
      const result = {
        blob:       new Blob(chunks, { type }),
        mimeType:   type,
        durationMs: Date.now() - startedAt,
        heardVoice: r.heardVoice,
        reason:     r.reason || 'tap',
      };
      if (r.tones) playTone(r.audioCtx, STOP_TONE);
      cleanup();
      setRecording(false);
      onStopRef.current?.(result);
    };

    // Silence detection from the mic level (RMS), with an adaptive noise floor
    let analyser, samples;
    if (audioCtx) {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      samples = new Uint8Array(analyser.fftSize);
      audioCtx.createMediaStreamSource(stream).connect(analyser);
    }

    r.timer = setInterval(() => {
      const now = Date.now();
      setElapsedMs(now - startedAt);
      if (analyser) {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) { const x = (v - 128) / 128; sum += x * x; }
        const rms = Math.sqrt(sum / samples.length);
        const threshold = Math.max(0.02, r.noiseFloor * 2.5);
        if (rms > threshold && now - startedAt > VOICE_GRACE_MS) {
          r.lastVoiceAt = now;
          r.heardVoice  = true;
        } else {
          r.noiseFloor = r.noiseFloor * 0.95 + rms * 0.05;
        }
        setLevel(Math.min(1, rms / 0.25));
      } else {
        r.heardVoice = true; // can't measure — assume speech, rely on tap / max length
      }
      if (now - startedAt >= maxMs)                 stop('max');
      else if (analyser && now - r.lastVoiceAt >= silenceMs) stop('silence');
    }, 100);

    recorder.start(1000);
    if (tones) playTone(audioCtx, START_TONE);
    setElapsedMs(0);
    setRecording(true);
  }, [cleanup, maxMs, silenceMs, stop]);

  // Release the mic if the page unmounts mid-recording
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      const r = ref.current;
      if (r.recorder) {
        r.recorder.onstop = null;
        try { r.recorder.stop(); } catch { /* ignore */ }
      }
      cleanup();
    };
  }, [cleanup]);

  return { recording, level, elapsedMs, start, stop };
}
