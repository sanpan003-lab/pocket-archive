import { useCallback, useEffect, useRef, useState } from 'react';
import { QuickRecorder } from '../native/quickRecorder';

/**
 * Android app recorder: same shape as useVoiceRecorder ({ recording, level,
 * elapsedMs, start, stop }) but backed by the native foreground service,
 * which records, uploads and retries on its own. Results arrive as events:
 *   onStart, onStop, onResult({ note, spokenConfirmation, confirmation, fromQueue }),
 *   onQueued({ reason }), onEmpty(), onError({ message }), onPending(count)
 * Disabled (no listeners) in the browser.
 */
export function useNativeRecorder({ enabled, ...callbacks }) {
  const [recording, setRecording] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [level, setLevel]         = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const cb = useRef(callbacks);
  useEffect(() => { cb.current = callbacks; });
  const wasRecording = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const handles = [];
    const on = (event, fn) =>
      QuickRecorder.addListener(event, fn).then(h => (cancelled ? h.remove() : handles.push(h)));

    const applyState = s => {
      const isRec = !!s.recording;
      setRecording(isRec);
      setStartedAt(s.startedAt || 0);
      if (!isRec) setLevel(0);
      if (isRec && !wasRecording.current) cb.current.onStart?.();
      if (!isRec && wasRecording.current) cb.current.onStop?.();
      wasRecording.current = isRec;
      if (typeof s.pendingUploads === 'number') cb.current.onPending?.(s.pendingUploads);
    };

    on('state', applyState);
    on('level', ({ level: l }) => setLevel(l || 0));
    on('result', r => cb.current.onResult?.(r));
    on('queued', r => cb.current.onQueued?.(r));
    on('empty', () => cb.current.onEmpty?.());
    on('error', r => cb.current.onError?.(r));
    on('pending', ({ count }) => cb.current.onPending?.(count));
    QuickRecorder.getState().then(s => { if (!cancelled) applyState(s); }).catch(() => {});

    return () => {
      cancelled = true;
      handles.forEach(h => h.remove());
    };
  }, [enabled]);

  // Elapsed time while recording
  useEffect(() => {
    if (!recording || !startedAt) return;
    const t = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    return () => clearInterval(t);
  }, [recording, startedAt]);

  const start = useCallback(async () => {
    await QuickRecorder.start(); // rejects with code MIC_DENIED / NO_TOKEN
  }, []);

  const stop = useCallback(() => { QuickRecorder.stop().catch(() => {}); }, []);

  return { recording, level, elapsedMs: recording ? elapsedMs : 0, start, stop };
}
