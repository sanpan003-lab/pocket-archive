import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mic, Square, Loader2, Undo2, CloudOff, AlertCircle, Lock } from 'lucide-react';
import { captureQuick, undoQuickNote, getQuickNotes } from '../lib/api';
import { speak, unlockSpeech, stopSpeaking } from '../lib/speech';
import {
  enqueue, buildCaptureForm, isRetryable, queueCount, onQueueChange, flushQueue,
} from '../lib/quickQueue';
import { useVoiceRecorder, isRecordingSupported } from '../hooks/useVoiceRecorder';
import QuickTabs from '../components/quick/QuickTabs';
import { QUICK_TYPES, describeWhen } from '../components/quick/quickMeta';

const UNDO_WINDOW_MS = 30000;

function newClientId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// Short tone so you know recording started/stopped without looking
function beep(freq) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
    osc.onended = () => ctx.close().catch(() => {});
  } catch {
    // ignore — audio cue is optional
  }
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Keep the screen on while this page is open (driving)
function useWakeLock() {
  useEffect(() => {
    let lock = null;
    let cancelled = false;
    async function acquire() {
      try {
        if (document.visibilityState === 'visible' && navigator.wakeLock) {
          lock = await navigator.wakeLock.request('screen');
          if (cancelled) lock.release().catch(() => {});
        }
      } catch {
        // not supported or denied — fine
      }
    }
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      lock?.release().catch(() => {});
    };
  }, []);
}

export default function QuickCapturePage() {
  const [phase, setPhase]       = useState('idle'); // idle | recording | processing | done | queued | error
  const [message, setMessage]   = useState(null);
  const [result, setResult]     = useState(null);
  const [undoUntil, setUndoUntil] = useState(0);
  const [undoLeft, setUndoLeft] = useState(0);
  const [undoing, setUndoing]   = useState(false);
  const [queued, setQueued]     = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const secure    = window.isSecureContext;
  const supported = secure && isRecordingSupported();

  useWakeLock();

  const refreshReviewCount = useCallback(() => {
    getQuickNotes({ status: 'needs_review' })
      .then(list => setReviewCount(list.filter(n => !n.undone).length))
      .catch(() => {});
  }, []);

  const showResult = useCallback((note, spoken) => {
    setResult(note);
    setMessage(spoken);
    setPhase('done');
    setUndoUntil(Date.now() + UNDO_WINDOW_MS);
    speak(spoken);
    refreshReviewCount();
  }, [refreshReviewCount]);

  // Offline queue status + announce captures sent from the queue
  useEffect(() => {
    queueCount().then(setQueued);
    refreshReviewCount();
    return onQueueChange(detail => {
      setQueued(detail.count ?? 0);
      if (detail.sent && phaseRef.current !== 'recording' && phaseRef.current !== 'processing') {
        showResult(detail.sent.note, `Sent from queue. ${detail.sent.spokenConfirmation}`);
      }
    });
  }, [refreshReviewCount, showResult]);

  // Undo countdown
  useEffect(() => {
    if (!undoUntil) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((undoUntil - Date.now()) / 1000));
      setUndoLeft(left);
      if (!left) setUndoUntil(0);
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [undoUntil]);

  async function handleStop({ blob, mimeType, heardVoice }) {
    beep(440);
    if (!heardVoice || blob.size < 1000) {
      setPhase('idle');
      setMessage("Didn't hear anything — tap to try again");
      speak("I didn't hear anything.");
      return;
    }

    const item = { clientId: newClientId(), blob, mimeType, capturedAt: new Date().toISOString() };

    async function queueIt(reason) {
      try {
        await enqueue(item);
        setPhase('queued');
        setMessage(reason === 'signed_out'
          ? 'Signed out — queued until you sign in again'
          : 'Queued — will send when online');
        speak("No signal. I'll send it when you're back online.");
      } catch {
        setPhase('error');
        setMessage('Could not save the recording on this device');
        speak("Sorry, I couldn't save that.");
      }
    }

    if (!navigator.onLine) return queueIt('offline');

    setPhase('processing');
    setMessage(null);
    try {
      const r = await captureQuick(buildCaptureForm(item));
      showResult(r.note, r.spokenConfirmation);
      flushQueue(); // we have signal — send anything waiting
    } catch (err) {
      if (isRetryable(err)) return queueIt(err.response?.status === 401 ? 'signed_out' : 'offline');
      setPhase('error');
      setMessage(err.response?.data?.error || err.message || 'Upload failed');
      speak("Sorry, that didn't work.");
    }
  }

  const recorder = useVoiceRecorder({ onStop: handleStop });

  async function handleTap() {
    if (phase === 'processing') return;
    if (recorder.recording) { recorder.stop('tap'); return; }

    unlockSpeech();
    stopSpeaking();
    setResult(null);
    setUndoUntil(0);
    setMessage(null);
    try {
      await recorder.start();
      beep(880);
      setPhase('recording');
    } catch (err) {
      setPhase('error');
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      setMessage(denied ? 'Microphone access is blocked — allow it in your browser settings' : (err?.message || 'Could not start recording'));
      speak(denied ? 'Microphone access is blocked.' : "Sorry, I couldn't start recording.");
    }
  }

  async function handleUndo() {
    if (!result) return;
    setUndoing(true);
    try {
      await undoQuickNote(result.id);
      setUndoUntil(0);
      setResult(null);
      setPhase('idle');
      setMessage('Undone');
      speak('Undone.');
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not undo — check your connection';
      setMessage(msg);
      speak("Sorry, I couldn't undo that.");
    } finally {
      setUndoing(false);
    }
  }

  const recording  = recorder.recording;
  const processing = phase === 'processing';
  const meta = result ? (QUICK_TYPES[result.type] || QUICK_TYPES.note) : null;

  const statusText = recording
    ? `Listening… ${formatElapsed(recorder.elapsedMs)}`
    : processing
      ? 'Working on it…'
      : message || 'Tap to speak';

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto flex flex-col min-h-[calc(100dvh-3.5rem)] md:min-h-screen">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Quick Capture</h1>
        <QuickTabs reviewCount={reviewCount} />
      </div>

      {queued > 0 && (
        <div className="flex items-center gap-2 mb-3 px-4 py-2.5 rounded-xl text-sm font-medium bg-amber-50 dark:bg-yellow-900/20 text-amber-800 dark:text-amber-200 border border-gold-300/50 dark:border-yellow-500/30">
          <CloudOff size={16} className="shrink-0" />
          {queued} capture{queued !== 1 ? 's' : ''} queued — will send when online
        </div>
      )}

      {!supported ? (
        <div className="glass-card p-6 my-auto flex items-start gap-4">
          {secure ? <AlertCircle size={24} className="text-red-500 shrink-0" /> : <Lock size={24} className="text-gold-500 shrink-0" />}
          <div>
            <p className="font-semibold text-navy-900 dark:text-white">
              {secure ? 'Recording is not supported in this browser' : 'Quick Capture needs a secure (HTTPS) connection'}
            </p>
            <p className="text-sm text-navy-600 dark:text-white/60 mt-1">
              {secure
                ? 'Try the latest Chrome, Safari, Edge or Firefox.'
                : 'Browsers only allow microphone access over HTTPS. Open Pocket Archive through its https:// address to record voice notes.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 py-4">
          {/* Big mic button */}
          <div className="relative flex items-center justify-center" style={{ width: 'min(78vw, 52vh, 420px)', height: 'min(78vw, 52vh, 420px)' }}>
            {recording && (
              <>
                <span className="absolute inset-0 rounded-full animate-ping" style={{ background: 'rgba(245,158,11,0.25)' }} />
                <span
                  className="absolute inset-0 rounded-full transition-transform duration-100"
                  style={{ background: 'rgba(245,158,11,0.22)', transform: `scale(${1.04 + recorder.level * 0.22})` }}
                />
              </>
            )}
            <button
              className="relative w-full h-full rounded-full flex items-center justify-center text-white transition-all active:scale-95 disabled:opacity-80 focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-400/60"
              style={{
                background: recording
                  ? 'linear-gradient(135deg,#F59E0B 0%,#EA580C 100%)'
                  : 'linear-gradient(135deg,#F59E0B 0%,#D97706 100%)',
                boxShadow: '0 12px 40px rgba(245,158,11,0.40), inset 0 2px 0 rgba(255,255,255,0.25)',
              }}
              onClick={handleTap}
              disabled={processing}
              aria-label={recording ? 'Stop recording' : 'Start recording'}
            >
              {processing
                ? <Loader2 className="w-[30%] h-[30%] animate-spin" />
                : recording
                  ? <Square className="w-[26%] h-[26%]" fill="currentColor" />
                  : <Mic className="w-[34%] h-[34%]" />}
            </button>
          </div>

          {/* Status */}
          <p
            className={`text-center text-lg sm:text-xl font-semibold px-2 break-words max-w-md ${
              phase === 'error' ? 'text-red-500 dark:text-red-400' : 'text-navy-900 dark:text-white'
            }`}
            aria-live="polite"
          >
            {statusText}
          </p>
          {recording && (
            <p className="-mt-4 text-sm text-navy-400 dark:text-white/40">Stops after 4 seconds of silence</p>
          )}

          {/* Result */}
          {result && phase === 'done' && (
            <div className="glass-card w-full max-w-md p-4 animate-slide-up">
              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                <span className={`badge ${meta.badge}`}><meta.icon size={11} /> {meta.label}</span>
                {result.status === 'needs_review' && <span className="badge badge-gold">Needs review</span>}
              </div>
              <p className="font-semibold text-navy-900 dark:text-white break-words">{result.title}</p>
              {describeWhen(result) && <p className="text-sm text-navy-600 dark:text-white/60 mt-0.5">{describeWhen(result)}</p>}
              <Link to="/quick/inbox" className="inline-block mt-2 text-xs font-medium text-gold-600 dark:text-gold-400">
                Open inbox →
              </Link>
            </div>
          )}

          {/* Undo */}
          {result && undoLeft > 0 && (
            <button
              className="w-full max-w-md h-16 rounded-2xl text-lg font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] bg-white dark:bg-white/10 text-navy-900 dark:text-white border-2 border-navy-200 dark:border-white/20 shadow-glass"
              onClick={handleUndo}
              disabled={undoing}
            >
              <Undo2 size={22} />
              {undoing ? 'Undoing…' : `Undo (${undoLeft}s)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
