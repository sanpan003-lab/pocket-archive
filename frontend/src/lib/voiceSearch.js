import { useCallback, useEffect, useRef, useState } from 'react';
import { voiceSearch } from './api';

const MAX_MS = 7000;

/**
 * Mic button in the search bar: records a few seconds in the browser / app WebView, the NAS turns it into words
 * (nothing is saved). state: idle | listening | working; onText(words).
 */
export function useVoiceSearch(onText) {
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const rec = useRef(null);
  const stopTimer = useRef(null);
  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder === 'function';

  const cleanup = useCallback(() => {
    clearTimeout(stopTimer.current);
    rec.current?.stream?.getTracks().forEach(t => t.stop());
    rec.current = null;
  }, []);
  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    if (rec.current?.recorder?.state === 'recording') rec.current.recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (state !== 'idle') { stop(); return; }
    setError('');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Allow the microphone to search by voice');
      return;
    }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find(t => window.MediaRecorder.isTypeSupported?.(t)) || '';
    const recorder = new window.MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
      cleanup();
      if (blob.size < 1500) { setState('idle'); setError('Didn’t catch that — try again'); return; }
      setState('working');
      try {
        const { text } = await voiceSearch(blob);
        if (text) onText(text); else setError('Didn’t catch that — try again');
      } catch (err) {
        setError(err.response?.data?.error || 'Voice search isn’t available right now');
      } finally {
        setState('idle');
      }
    };
    rec.current = { recorder, stream };
    recorder.start();
    setState('listening');
    stopTimer.current = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, MAX_MS);
  }, [state, stop, cleanup, onText]);

  return { supported, state, error, start, stop, clearError: () => setError('') };
}
