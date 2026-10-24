import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Mic, Undo2, CloudOff, AlertCircle, Lock, Check } from 'lucide-react';
import { captureQuick, undoQuickNote, getQuickNotes, moveQuickNote } from '../lib/api';
import { speak, unlockSpeech, stopSpeaking } from '../lib/speech';
import {
  enqueue, buildCaptureForm, isRetryable, queueCount, onQueueChange, flushQueue,
} from '../lib/quickQueue';
import { useVoiceRecorder, isRecordingSupported } from '../hooks/useVoiceRecorder';
import { useNativeRecorder } from '../hooks/useNativeRecorder';
import { isNative } from '../lib/platform';
import { QuickRecorder } from '../native/quickRecorder';
import { syncFeedbackPref } from '../native/nativeSession';
import { primeAudio, feedbackSuccess, feedbackWarning } from '../lib/feedback';
import { useQuickSetting } from '../lib/quickSettings';
import QuickTabs from '../components/quick/QuickTabs';
import { undoPhoneAction } from '../lib/phoneActions';
import { useLayout } from '../lib/layout';
import QuickToast from '../components/quick/QuickToast';
import QuickSettings from '../components/quick/QuickSettings';
import { QUICK_TYPES, describeWhen, confirmationFor, errandPlaceName, errandProgress } from '../components/quick/quickMeta';
import { syncErrands } from '../native/errands';
import AskPrompt from '../components/quick/AskPrompt';
import CaptureStage from '../components/quick/CaptureStage';
import { useAppearance } from '../context/appearanceStore';
import TargetPicker from '../components/quick/TargetPicker';

const UNDO_WINDOW_MS = 30000;
const TAP_TO_RECORD  = 'Tap to record';

function newClientId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function vibrate(ms) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

// Auto-start only when the mic is already allowed — never trigger a
// permission prompt without a tap
async function micAlreadyGranted() {
  if (isNative) {
    try { return (await QuickRecorder.checkPermissions()).microphone === 'granted'; } catch { return false; }
  }
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status.state === 'granted';
  } catch {
    return false; // Permissions API unavailable — wait for a tap
  }
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Keep the screen on while `active` (recording/processing); release after
function useWakeLock(active) {
  useEffect(() => {
    if (!active) return;
    let lock = null;
    let cancelled = false;
    async function acquire() {
      try {
        if (document.visibilityState === 'visible' && navigator.wakeLock && !lock) {
          const l = await navigator.wakeLock.request('screen');
          if (cancelled) l.release().catch(() => {});
          else { lock = l; l.addEventListener?.('release', () => { lock = null; }); }
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
  }, [active]);
}

export default function QuickCapturePage() {
  const { lite } = useLayout();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [phase, setPhase]       = useState('idle'); // idle | recording | processing | done | queued | error
  const [message, setMessage]   = useState(null);
  const [result, setResult]     = useState(null);
  const [undoUntil, setUndoUntil] = useState(0);
  const [undoLeft, setUndoLeft] = useState(0);
  const [undoing, setUndoing]   = useState(false);
  const [queued, setQueued]     = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [toast, setToast]       = useState(null);
  const { settings: appearance } = useAppearance();
  const [readAloud, setReadAloud] = useQuickSetting('readAloud');
  const [feedback, setFeedback]   = useQuickSetting('feedback');
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  const autostartTried = useRef(false);
  const prefs = useRef({ readAloud, feedback });
  useEffect(() => { prefs.current = { readAloud, feedback }; }, [readAloud, feedback]);
  const dismissToast = useCallback(() => setToast(null), []);

  // Speak only when "Read confirmation aloud" is on
  const say = useCallback(text => { if (prefs.current.readAloud) speak(text); }, []);

  // Toast + (optional) chime/vibration + (optional) voice
  const notify = useCallback((conf, spoken) => {
    setToast({ ...conf, id: Date.now() });
    const cue = conf.cue || (conf.tone === 'success' ? 'success' : 'warning');
    if (prefs.current.feedback) (cue === 'success' ? feedbackSuccess : feedbackWarning)();
    say(spoken || conf.text);
  }, [say]);

  // Something went wrong: status text on screen, long buzz + low tone
  const warn = useCallback(text => {
    if (prefs.current.feedback) feedbackWarning();
    say(text);
  }, [say]);

  const secure    = window.isSecureContext;
  // Android app records natively; browsers need HTTPS + MediaRecorder
  const supported = isNative || (secure && isRecordingSupported());

  useWakeLock(phase === 'recording' || phase === 'processing');

  const refreshReviewCount = useCallback(() => {
    getQuickNotes({ status: 'needs_review' })
      .then(list => setReviewCount(list.filter(n => !n.undone).length))
      .catch(() => {});
  }, []);

  const [moving, setMoving] = useState(false);
  const undoRef = useRef(null);
  const showResult = useCallback((note, spoken, { fromQueue = false, override = null } = {}) => {
    setResult(note);
    setMessage(null);
    setPhase('done');
    // "Add to …?" waits for an answer instead of the Undo countdown
    setUndoUntil(note?.status === 'pending_decision' ? 0 : Date.now() + UNDO_WINDOW_MS);
    // A phone action: what happened on the phone (or, in a browser, that it runs there)
    const conf = override || confirmationFor(note);
    // Smart append: Undo / Move right on the toast for 30 s; a phone action: Undo the action
    const actions = conf.actionUndo ? [
      { label: 'Undo', onClick: async () => { const r = await undoPhoneAction(conf.actionUndo); notify({ icon: '↩️', text: r?.text || 'Undone', detail: r?.detail, tone: 'queued', duration: 8000 }); } },
    ] : conf.undoable && note?.appliedTo ? [
      { label: 'Undo', onClick: () => undoRef.current?.() },
      ...(conf.movable ? [{ label: 'Move', onClick: () => setMoving(true) }] : []),
    ] : undefined;
    notify(fromQueue ? { ...conf, detail: conf.detail || 'Sent from queue', actions, duration: actions ? 30000 : undefined }
      : { ...conf, actions, duration: actions ? 30000 : undefined },
    fromQueue ? `Sent from queue. ${spoken}` : spoken);
    refreshReviewCount();
    if (note?.type === 'errand') syncErrands();
  }, [refreshReviewCount, notify]);

  // Offline queue status + announce captures sent from the queue
  useEffect(() => {
    queueCount().then(setQueued);
    refreshReviewCount();
    return onQueueChange(detail => {
      setQueued(detail.count ?? 0);
      if (detail.sent && phaseRef.current !== 'recording' && phaseRef.current !== 'processing') {
        showResult(detail.sent.note, detail.sent.spokenConfirmation, { fromQueue: true });
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
    if (!heardVoice || blob.size < 1000) {
      setPhase('idle');
      setMessage("Didn't hear anything — tap to try again");
      warn("I didn't hear anything.");
      return;
    }

    const item = { clientId: newClientId(), blob, mimeType, capturedAt: new Date().toISOString() };

    async function queueIt(reason) {
      try {
        await enqueue(item);
        setPhase('queued');
        const signedOut = reason === 'signed_out';
        setMessage(signedOut ? 'Signed out — queued until you sign in again' : 'Queued — will send when online');
        notify(
          { icon: '🕓', text: 'Queued — will send when online', detail: signedOut ? 'Sign in again to send it' : null, tone: 'queued' },
          "No signal. I'll send it when you're back online.",
        );
      } catch {
        setPhase('error');
        setMessage('Could not save the recording on this device');
        warn("Sorry, I couldn't save that.");
      }
    }

    if (!navigator.onLine) return queueIt('offline');

    setPhase('processing');
    setMessage(null);
    try {
      const r = await captureQuick(buildCaptureForm(item));
      showResult(r.note, r.spokenConfirmation, r.phoneAction ? { override: { ...r.confirmation, detail: 'Runs on your phone — open Pocket Archive there (Quick Capture → Actions)' } } : {});
      flushQueue(); // we have signal — send anything waiting
    } catch (err) {
      if (isRetryable(err)) return queueIt(err.response?.status === 401 ? 'signed_out' : 'offline');
      setPhase('error');
      setMessage(err.response?.data?.error || err.message || 'Upload failed');
      warn("Sorry, that didn't work.");
    }
  }

  const webRecorder = useVoiceRecorder({ onStop: handleStop });

  // Android app: native foreground-service recorder. It records (also from the
  // widget / Quick Settings tile), uploads and retries by itself; this page
  // just mirrors its state and shows the result.
  const nativeRecorder = useNativeRecorder({
    enabled: isNative,
    onStart: () => {
      setResult(null); setUndoUntil(0); setMessage(null); setToast(null);
      setPhase('recording');
    },
    onStop: () => setPhase(p => (p === 'recording' ? 'processing' : p)),
    onResult: r => {
      const busy = phaseRef.current === 'recording';
      if (r.fromQueue && busy) return; // don't interrupt a new recording
      showResult(r.note, r.spokenConfirmation, { fromQueue: !!r.fromQueue, override: r.actionOutcome ? r.confirmation : null });
    },
    onQueued: () => {
      setPhase('queued');
      setMessage('Queued — will send when online');
      notify({ icon: '🕓', text: 'Queued — will send when online', tone: 'queued' },
        "No signal. I'll send it when you're back online.");
    },
    onEmpty: () => {
      setPhase('idle');
      setMessage("Didn't hear anything — tap to try again");
      warn("I didn't hear anything.");
      // Set aside for 30 s (accidental-recording protection): Restore keeps it as a normal capture
      setToast({ id: Date.now(), icon: '🎙️', text: 'No speech — set aside for 30 s', detail: 'Restore it here or in Settings › Accidental recordings', tone: 'review', duration: 30000,
        actions: [{ label: 'Restore', onClick: async () => { const r = await QuickRecorder.restoreIgnored().catch(() => null); setToast({ id: Date.now(), icon: r?.restored ? '↩️' : '⚠️', text: r?.restored ? 'Restored — sending it now' : 'Nothing left to restore', tone: r?.restored ? 'success' : 'review' }); } }] });
    },
    onError: ({ message: m } = {}) => {
      setPhase('error');
      setMessage(m || 'Could not save the recording');
      warn("Sorry, that didn't work.");
    },
    onPending: count => setQueued(count),
  });

  const recorder = isNative ? nativeRecorder : webRecorder;

  // auto: started without a tap (launch / ?autostart=1) — must not prompt or error
  async function startRecording({ auto = false } = {}) {
    if (isNative) {
      // Native service plays its own start cue; phase follows its state events
      stopSpeaking();
      setToast(null);
      await recorder.start();
      return;
    }
    if (!auto && prefs.current.readAloud) unlockSpeech();
    primeAudio(); // unlock the confirmation chime while we have a tap / mic capture
    stopSpeaking();
    setResult(null);
    setUndoUntil(0);
    setMessage(null);
    setToast(null);
    const cues = prefs.current.feedback; // "Sound & vibration" setting
    await recorder.start({ requireRunningAudio: auto, tones: cues });
    if (cues) vibrate(150);
    setPhase('recording');
  }

  async function handleTap() {
    if (phase === 'processing') return;
    if (recorder.recording) { recorder.stop('tap'); return; }
    try {
      await startRecording();
    } catch (err) {
      setPhase('error');
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError' || err?.code === 'MIC_DENIED';
      const where = isNative ? 'Android settings' : 'your browser settings';
      setMessage(denied ? `Microphone access is blocked — allow it in ${where}` : (err?.message || 'Could not start recording'));
      warn(denied ? 'Microphone access is blocked.' : "Sorry, I couldn't start recording.");
    }
  }

  // /quick?autostart=1 (home-screen launch or shortcut): start recording right away
  useEffect(() => {
    if (searchParams.get('autostart') !== '1' || autostartTried.current) return;
    autostartTried.current = true;
    // Drop the flags so a refresh or "back" doesn't start another recording
    setSearchParams({}, { replace: true });
    if (!supported) return;

    (async () => {
      if (!(await micAlreadyGranted())) { setMessage(TAP_TO_RECORD); return; }
      try {
        await startRecording({ auto: true });
      } catch {
        // Blocked without a gesture (or mic unavailable) — quietly wait for a tap
        setPhase('idle');
        setMessage(TAP_TO_RECORD);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per launch
  }, [searchParams]);

  // "+" menu → Voice: ?voice=1 (from another page) or an event (already here) — a tap, so prompting is fine
  const tapRef = useRef(null);
  useEffect(() => { tapRef.current = handleTap; });
  useEffect(() => {
    const start = () => { if (!recorder.recording && phaseRef.current !== 'processing') tapRef.current?.(); };
    window.addEventListener('pa:start-voice', start);
    return () => window.removeEventListener('pa:start-voice', start);
  }, [recorder.recording]);
  useEffect(() => {
    if (searchParams.get('voice') !== '1') return;
    setSearchParams({}, { replace: true });
    if (supported) tapRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per ?voice=1
  }, [searchParams]);

  // "Done": close the result → back to the Capture screen (or the Inbox, per Settings → Capture screen)
  function finishResult() {
    stopSpeaking();
    setToast(null);
    setMoving(false);
    setUndoUntil(0);
    setResult(null);
    setMessage(null);
    setPhase('idle');
    if (appearance.capture.afterDone === 'inbox') navigate('/quick/inbox');
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
      notify({ icon: '↩️', text: 'Undone', tone: 'queued', cue: 'success' }, 'Undone.');
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not undo — check your connection';
      setMessage(msg);
      warn("Sorry, I couldn't undo that.");
    } finally {
      setUndoing(false);
    }
  }

  useEffect(() => { undoRef.current = handleUndo; });

  async function handleMove(dest) {
    setMoving(false);
    if (!result) return;
    try {
      const r = await moveQuickNote(result.id, dest.new ? { new: true } : { targetType: dest.targetType, targetId: dest.targetId });
      showResult(r.note, r.confirmation?.text);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Could not move it');
    }
  }

  const recording  = recorder.recording;
  const processing = phase === 'processing';
  const finished   = phase === 'done' || phase === 'queued';
  const meta = result ? (QUICK_TYPES[result.type] || QUICK_TYPES.note) : null;

  const statusText = recording
    ? `Listening… ${formatElapsed(recorder.elapsedMs)}`
    : processing
      ? 'Working on it…'
      : message || 'Tap to speak';

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto flex flex-col min-h-[calc(100dvh-3.5rem)] md:min-h-screen">
      <QuickToast toast={toast} onDismiss={dismissToast} />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">{lite ? 'Capture' : 'Quick Capture'}</h1>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
          <QuickTabs reviewCount={reviewCount} />
          <QuickSettings
            readAloud={readAloud}
            onReadAloud={on => {
              setReadAloud(on);
              if (on) speak('Confirmations will be read aloud.'); // also unlocks speech on iOS
              else stopSpeaking();
            }}
            feedback={feedback}
            onFeedback={on => {
              setFeedback(on);
              syncFeedbackPref(on); // native recorder cues + notifications
              if (on) { primeAudio(); feedbackSuccess(); } // preview the chime
            }}
          />
        </div>
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
          {/* Idle: greeting + breathing mic + hints · Recording: timer + live waveform + Stop · Processing: the wave collapses */}
          {!finished && (
            <CaptureStage
              recording={recording}
              processing={processing}
              level={recorder.level}
              elapsedMs={recorder.elapsedMs}
              onTap={handleTap}
              statusText={recording ? 'Listening…' : statusText}
              error={phase === 'error'}
            />
          )}

          {/* Result */}
          {result && phase === 'done' && result.status === 'pending_decision' && (
            <div className="w-full max-w-md animate-slide-up">
              <AskPrompt note={result} onResolved={r => showResult(r.note, r.confirmation?.text)} />
            </div>
          )}
          {result && phase === 'done' && result.appliedTo && result.status !== 'pending_decision' && (
            <div className="glass-card w-full max-w-md p-4 animate-slide-up">
              <p className="font-semibold text-navy-900 dark:text-white break-words">
                {result.appendConfirmation?.icon} {result.appendConfirmation?.text || `Added to ${result.appliedTo.title}`}
              </p>
              {result.appendConfirmation?.detail && <p className="text-sm text-navy-600 dark:text-white/60 mt-0.5">{result.appendConfirmation.detail}</p>}
              <div className="flex flex-wrap gap-3 mt-2">
                <Link
                  to={result.appliedTo.type === 'project' ? `/projects/${result.appliedTo.id}` : `/quick/${result.appliedTo.id}`}
                  className="text-xs font-medium text-gold-600 dark:text-gold-400"
                >
                  Open {result.appliedTo.title} →
                </Link>
                {result.appendConfirmation?.movable && (
                  <button className="text-xs font-medium text-navy-600 dark:text-white/60 underline" onClick={() => setMoving(true)}>Move…</button>
                )}
              </div>
            </div>
          )}
          {moving && result && (
            <TargetPicker title="Move it to…" exclude={result.appliedTo?.id} allowNewNote onClose={() => setMoving(false)} onPick={handleMove} />
          )}
          {result && phase === 'done' && !result.appliedTo && result.status !== 'pending_decision' && (
            <div className="glass-card w-full max-w-md p-4 animate-slide-up">
              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                <span className={`badge ${meta.badge}`}><meta.icon size={11} /> {meta.label}</span>
                {result.status === 'needs_review' && <span className="badge badge-gold">Needs review</span>}
              </div>
              <p className="font-semibold text-navy-900 dark:text-white break-words">{result.title}</p>
              {describeWhen(result) && <p className="text-sm text-navy-600 dark:text-white/60 mt-0.5">{describeWhen(result)}</p>}
              {result.type === 'errand' && (
                <p className="text-sm text-navy-600 dark:text-white/60 mt-0.5 break-words">
                  {[errandPlaceName(result), `${errandProgress(result).total} items`].filter(Boolean).join(' · ')}
                  {result.items?.length > 0 && `: ${result.items.map(i => i.text).join(', ')}`}
                </p>
              )}
              <Link to={`/quick/${result.id}`} className="inline-block mt-2 text-xs font-medium text-gold-600 dark:text-gold-400">
                Open note →
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

          {/* Next: record another, or done → Inbox */}
          {finished && (
            <div className="grid grid-cols-2 gap-3 w-full max-w-md">
              <button
                className="h-20 rounded-2xl text-lg font-bold text-white flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg,#F59E0B 0%,#D97706 100%)', boxShadow: '0 8px 24px rgba(245,158,11,0.35)' }}
                onClick={handleTap}
              >
                <Mic size={24} className="shrink-0" />
                <span className="leading-tight">Record another</span>
              </button>
              <button
                className="h-20 rounded-2xl text-lg font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] bg-white dark:bg-white/10 text-navy-900 dark:text-white border-2 border-navy-200 dark:border-white/20 shadow-glass"
                onClick={finishResult}
              >
                <Check size={24} className="shrink-0" />
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
