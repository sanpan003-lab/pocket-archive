import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Mic, ChevronDown, ExternalLink, Plus, CheckCircle2, Circle, Keyboard, Watch, BatteryCharging,
  LayoutGrid, SquareStack, AppWindow, Smartphone, Workflow, Bot, ShieldAlert, Power, Zap,
} from 'lucide-react';
import { QuickRecorder } from '../native/quickRecorder';
import { isNative } from '../lib/platform';
import RecordingStartsLog from './RecordingStartsLog';

// ── Small controls ────────────────────────────────────────────────────────────
function Segmented({ label, hint, value, options, onChange, id }) {
  return (
    <div className="py-2.5">
      <p id={id} className="text-sm font-semibold text-navy-900 dark:text-white">{label}</p>
      {hint && <p className="text-xs text-navy-500 dark:text-white/50 mb-1">{hint}</p>}
      <div className="flex flex-wrap gap-1.5 mt-1.5" role="radiogroup" aria-labelledby={id}>
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${value === v
              ? 'bg-gold-500/15 border-gold-400 text-gold-700 dark:text-gold-300'
              : 'border-navy-200 dark:border-white/15 text-navy-600 dark:text-white/65'}`}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Switch({ label, hint, checked, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="w-full flex items-center gap-3 py-2.5 text-left disabled:opacity-50">
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-navy-900 dark:text-white">{label}</span>
        {hint && <span className="block text-xs text-navy-500 dark:text-white/50">{hint}</span>}
      </span>
      <span className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${checked ? 'bg-gold-500' : 'bg-navy-200 dark:bg-white/20'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}

function Status({ ok, okText, offText }) {
  return ok
    ? <span className="badge badge-green whitespace-nowrap"><CheckCircle2 size={11} /> {okText}</span>
    : <span className="badge badge-slate whitespace-nowrap"><Circle size={11} /> {offText}</span>;
}

const OPTIONS = {
  volumeUp: [['stop', 'Stop & save'], ['ignore', 'Ignore']],
  volumeDown: [['stop', 'Stop & save'], ['discard', 'Discard'], ['ignore', 'Ignore']],
  reopen: [['stop', 'Stop & save'], ['ignore', 'Ignore'], ['new', 'Start a new note']],
  silence: [[0, 'Off'], [3, '3 s'], [4, '4 s'], [6, '6 s'], [10, '10 s']],
  max: [[1, '1 min'], [2, '2 min'], [5, '5 min'], [10, '10 min']],
  feedback: [['both', 'Vibrate + chime'], ['vibrate', 'Vibrate only'], ['chime', 'Chime only'], ['none', 'None']],
  guard: [[2, '2 s'], [3, '3 s'], [4, '4 s'], [5, '5 s']],
  noSpeech: [[3, '3 s'], [4, '4 s'], [6, '6 s']],
};

const PRESETS = [
  { key: 'upStartStop', title: 'Volume up starts and stops', text: 'Your routine starts it; volume up (or down) stops and saves.', recommended: true },
  { key: 'upStartDownStop', title: 'Volume up starts, volume down stops', text: 'Volume up does nothing while recording.' },
  { key: 'custom', title: 'Custom', text: 'Pick each key below.' },
];

/** Every way to start a recording, with status + setup help */
function startMethods(status, act) {
  const samsung = status?.samsung;
  return [
    {
      key: 'routines', icon: Workflow, title: 'Samsung Modes & Routines (e.g. a volume key)',
      ok: status?.routinesInstalled, okText: 'Available', offText: 'Not on this phone', hidden: !samsung,
      steps: [
        'Open Modes & Routines → Routines → +.',
        'If: pick your trigger (for example pressing volume up, or a time / place).',
        'Then: Apps → Open an app → “Quick Record”. Save.',
        'While recording, the app catches the next volume-up press and stops. The routine firing on that same press is ignored, so it never starts a second recording.',
      ],
      actions: [{ label: 'Open Modes & Routines', onClick: () => act('open', 'routines') }],
    },
    {
      key: 'sideKey', icon: Power, title: 'Samsung side key', ok: null, hidden: !samsung,
      tip: 'Recommended: double press. Press-and-hold goes off easily in a pocket or bag.',
      steps: [
        'Settings → Advanced features → Side button → Double press → Open app → “Quick Record”.',
        'Using press and hold now? Set Press and hold back to “Wake Bixby” or “Power off menu”, then use Double press as above.',
        'Double-press again while recording to stop (see “Opening Quick Record while recording”).',
        'Or choose “Stop Recording” for a key that only stops.',
      ],
      actions: [{ label: 'Open side button settings', onClick: () => act('open', 'sideKey') }],
    },
    {
      key: 'widget', icon: LayoutGrid, title: 'Home-screen widget',
      ok: status?.widgets > 0, okText: `On home screen${status?.widgets > 1 ? ` (${status.widgets})` : ''}`, offText: 'Not added',
      steps: ['Long-press the home screen → Widgets → Pocket Archive → Quick Capture.', 'Tap the mic to start, tap again to stop. Make it bigger to see recent notes.'],
      actions: status?.canPinWidget ? [{ label: 'Add widget', icon: Plus, onClick: () => act('add', 'widget') }] : [],
    },
    {
      key: 'tile', icon: SquareStack, title: 'Quick Settings tile', ok: null,
      steps: ['Swipe down twice → ✎ (edit) → drag “Quick Capture” into your tiles.', 'Works from the lock screen too.'],
      actions: status?.canAddTile ? [{ label: 'Add tile', icon: Plus, onClick: () => act('add', 'tile') }] : [],
    },
    {
      key: 'quickRecord', icon: AppWindow, title: 'Quick Record app shortcut',
      ok: status?.shortcutPinned, okText: 'On home screen', offText: 'Not pinned',
      steps: ['“Quick Record” is its own app icon: opening it starts recording at once.', 'Or long-press the Pocket Archive icon → Quick Capture.'],
      actions: status?.canPinShortcut ? [{ label: 'Add to home screen', icon: Plus, onClick: () => act('add', 'quickRecord') }] : [],
    },
    {
      key: 'assistant', icon: Bot, title: '“Hey Google, open Quick Record”', ok: null,
      steps: ['Say “Hey Google, open Quick Record” — Google Assistant opens it like any app and recording starts.', 'Works on the lock screen when “Lock screen personal results” is allowed in Assistant settings.'],
      actions: [{ label: 'Try it', onClick: () => act('open', 'assistant') }],
    },
    {
      key: 'watchKey', icon: Watch, title: 'Galaxy Watch key', ok: status?.watchKnown, okText: 'Watch app seen', offText: 'No watch yet',
      steps: ['On the watch: Settings → Advanced features → Customize keys → Double press → “Quick Record”.', 'Press it again while recording to stop (set in “Galaxy Watch” below).'],
      actions: status?.wearableInstalled ? [{ label: 'Open Galaxy Wearable', onClick: () => act('open', 'wearable') }] : [],
    },
    {
      key: 'watchTile', icon: Watch, title: 'Watch tile & complication', ok: null,
      steps: ['Watch: long-press the watch face → Tiles → + → Pocket Archive.', 'Complication: long-press the watch face → Customize → a complication slot → Pocket Archive.'],
      actions: [],
    },
  ].filter(m => !m.hidden);
}

function MethodRow({ m }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-2xl border border-navy-100 dark:border-white/10">
      <button type="button" className="w-full flex items-center gap-3 px-3 py-2.5 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <m.icon size={18} className="shrink-0 text-gold-600 dark:text-gold-400" />
        <span className="flex-1 min-w-0 text-sm font-semibold text-navy-900 dark:text-white">{m.title}</span>
        {m.ok !== null && m.ok !== undefined && <Status ok={m.ok} okText={m.okText} offText={m.offText} />}
        <ChevronDown size={16} className={`shrink-0 text-navy-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 -mt-1">
          {m.tip && <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1.5">{m.tip}</p>}
          <p className="text-[11px] font-bold uppercase tracking-wider text-navy-400 dark:text-white/40 mb-1">How to set up</p>
          <ol className="list-decimal pl-5 space-y-1 text-sm text-navy-700 dark:text-white/75">
            {m.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          {m.actions.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2.5">
              {m.actions.map(a => (
                <button key={a.label} type="button" className="btn-white text-xs py-1.5 px-3" onClick={a.onClick}>
                  {a.icon ? <a.icon size={13} /> : <ExternalLink size={13} />} {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** "Test": press a key while this is open → which key and what it would do */
function KeyTest({ settings }) {
  const [on, setOn] = useState(false);
  const [log, setLog] = useState([]);
  useEffect(() => {
    if (!on) return undefined;
    let handle;
    QuickRecorder.setKeyTest({ enabled: true }).catch(() => {});
    QuickRecorder.addListener('keyTest', e => setLog(l => [e, ...l].slice(0, 5))).then(h => { handle = h; });
    return () => { QuickRecorder.setKeyTest({ enabled: false }).catch(() => {}); handle?.remove(); };
  }, [on]);

  const describe = e => {
    const name = e.key === 'volumeUp' ? 'Volume up' : 'Volume down';
    const s = settings;
    const what = action => ({ stop: 'Stop & save', discard: 'Discard (Undo for 10 s)', ignore: 'Ignore (volume as usual)' }[action]);
    if (e.long && e.key === 'volumeDown') {
      return { name: `${name} (long press)`, recording: s.longPressDownDiscard ? 'Discard (Undo for 10 s)' : what(s.volumeDown), idle: 'Nothing (volume as usual)' };
    }
    const action = e.key === 'volumeUp' ? s.volumeUp : s.volumeDown;
    const doubleHint = e.key === 'volumeUp' ? (s.doublePressUpStart ? ' · double-press starts recording (screen on)' : '') : '';
    return {
      name: `${name}${e.long ? ' (long press)' : ''}`,
      recording: what(action),
      idle: e.key === 'volumeUp'
        ? `Volume as usual — a Samsung routine on this key can start Quick Record${doubleHint}`
        : `Volume as usual${s.doublePressDownStop ? ' · double-press stops a recording' : ''}`,
    };
  };

  return (
    <div className="rounded-2xl bg-navy-50 dark:bg-white/5 p-3">
      <div className="flex items-center gap-2">
        <Keyboard size={17} className="text-gold-600 dark:text-gold-400" />
        <p className="flex-1 text-sm font-semibold text-navy-900 dark:text-white">Test a key</p>
        <button type="button" className={on ? 'btn-ghost text-xs' : 'btn-gold text-xs py-1.5 px-3'} onClick={() => { setOn(o => !o); setLog([]); }}>
          {on ? 'Stop test' : 'Start test'}
        </button>
      </div>
      {on && (
        <div className="mt-2" aria-live="polite">
          {log.length === 0 ? (
            <p className="text-sm text-navy-500 dark:text-white/55">Press volume up or down (or hold one). The volume won’t change while the test is on.</p>
          ) : (
            <ul className="space-y-1.5">
              {log.map(e => {
                const d = describe(e);
                return (
                  <li key={e.at} className="text-sm">
                    <span className="font-semibold text-navy-900 dark:text-white">{d.name}</span>
                    <span className="block text-xs text-navy-600 dark:text-white/65">While recording: <b>{d.recording}</b></span>
                    <span className="block text-xs text-navy-500 dark:text-white/50">Not recording: {d.idle}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Explanation shown before turning on the accessibility-based double-press shortcuts */
function ShortcutExplainer({ onContinue, onCancel }) {
  return (
    <div className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="dp-title">
      <div className="absolute inset-0 note-scrim-fade" onClick={onCancel} aria-hidden="true" />
      <div className="relative note-surface w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <ShieldAlert size={24} className="text-gold-500 mb-2" />
        <h3 id="dp-title" className="font-bold text-navy-900 dark:text-white">Double-press volume shortcuts</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-navy-700 dark:text-white/75 list-disc pl-5">
          <li>Uses an Android <b>Accessibility</b> service that only watches the volume keys. It never reads the screen or what you type.</li>
          <li>Works only while the screen is <b>on and unlocked</b>. With the screen off, use a Samsung routine or the side key.</li>
          <li>Single presses always change the volume as usual. Only a quick double-press is used (and its extra volume step is undone).</li>
          <li>Android asks you to turn it on in Accessibility settings: tap <b>Installed apps → Pocket Archive volume shortcuts → On</b>.</li>
          <li>Turn it off any time here (“Turn off”).</li>
        </ul>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost" onClick={onCancel}>Not now</button>
          <button className="btn-gold" onClick={onContinue}>Open Accessibility settings</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Settings → Recording & shortcuts (Android app only). Stored on this phone
 * (and the watch's own settings on the watch) — not shared with the web.
 */
/**
 * part: 'phone' (Settings › Recording & shortcuts — rarely used options under Advanced) | 'watch' (Settings › Watch)
 */
export default function RecordingSettings({ part = 'phone' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [explain, setExplain] = useState(null);   // 'doublePressUpStart' | 'doublePressDownStop'
  const [note, setNote] = useState(null);
  const pendingSwitch = useRef(null);

  const load = useCallback(() => {
    QuickRecorder.getRecorderSettings().then(setData).catch(err => setError(err.message || 'Could not read the settings'));
  }, []);
  useEffect(() => {
    if (!isNative) return undefined;
    load();
    // Back from Android settings (side key, Accessibility…): refresh the status
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  if (!isNative) return null;
  if (error) return <div id="recording" className="glass-panel p-5 mb-4 text-sm text-red-600">{error}</div>;
  if (!data) return <div id="recording" className="glass-panel p-5 mb-4 h-40 animate-pulse" />;

  const s = data.settings;
  const w = data.watch;
  const status = data.status;
  const save = patch => QuickRecorder.setRecorderSettings({ settings: patch }).then(setData).catch(err => setError(err.message));
  const saveWatch = patch => QuickRecorder.setRecorderSettings({ watch: patch }).then(setData).catch(err => setError(err.message));
  const set = key => value => save({ [key]: value });

  async function act(kind, target) {
    setNote(null);
    try {
      if (kind === 'open') {
        const r = await QuickRecorder.openShortcutSetup({ target });
        if (r.opened === 'fallback') setNote('Opened Settings — the exact screen isn’t available on this phone; follow the steps.');
        if (r.opened === 'none') setNote('This phone doesn’t have that screen — follow the steps.');
      } else {
        const r = await QuickRecorder.addShortcut({ kind: target });
        if (r.result === 'added') setNote('Tile added.');
        else if (r.result === 'already') setNote('The tile is already there.');
        else if (r.requested === false) setNote('Your launcher can’t add it from here — follow the steps.');
        setTimeout(load, 1500);
      }
    } catch (err) { setNote(err.message); }
  }

  function toggleDouble(key, on) {
    if (!on) { save({ [key]: false }); return; }
    if (status.doublePressService) { save({ [key]: true }); return; }
    pendingSwitch.current = key;
    setExplain(key);
  }

  const methods = startMethods(status, act);
  const reopenHint = 'Quick Record icon, side key, a routine or “Hey Google”';

  if (part === 'watch') return (
    <div id="watch" className="glass-panel p-5 sm:p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <Watch size={18} className="text-gold-500" />
        <h2 className="font-bold text-navy-900 dark:text-white">Galaxy Watch</h2>
      </div>
      <p className="text-xs text-navy-500 dark:text-white/50">The watch’s own settings — also editable on the watch (swipe to the last page). Setup: watch Settings → Advanced features → Customize keys → Double press → Quick Record.</p>
      <h3 className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/45 mt-4 mb-1">While recording</h3>
      <Segmented id="rw-reopen" label="Quick Record / tile while recording" value={w.quickRecordWhileRecording} options={OPTIONS.reopen} onChange={v => saveWatch({ quickRecordWhileRecording: v })} />
      <Segmented id="rw-silence" label="Auto-stop after silence" value={w.silenceSec} options={OPTIONS.silence} onChange={v => saveWatch({ silenceSec: v })} />
      <Segmented id="rw-max" label="Maximum length" value={w.maxMinutes} options={OPTIONS.max} onChange={v => saveWatch({ maxMinutes: v })} />
      <Switch label="Start/stop vibration" checked={w.feedback !== 'none'} onChange={on => saveWatch({ feedback: on ? 'vibrate' : 'none' })} />
      <Switch label="Countdown before recording starts" checked={!!w.countdown} onChange={on => saveWatch({ countdown: on })} />
      <h3 className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/45 mt-4 mb-1">Accidental recordings</h3>
      <Switch label="Discard if no speech at the start" hint="Kept for 30 seconds with Restore on the watch" checked={w.noSpeechDiscard !== false} onChange={on => saveWatch({ noSpeechDiscard: on })} />
      {w.noSpeechDiscard !== false && <Segmented id="rw-nospeech" label="No speech within" value={w.noSpeechSec || 4} options={OPTIONS.noSpeech} onChange={v => saveWatch({ noSpeechSec: v })} />}
      <Switch label="Discard recordings shorter than 2 seconds" checked={w.minLengthDiscard !== false} onChange={on => saveWatch({ minLengthDiscard: on })} />
      <p className="text-[11px] text-navy-400 dark:text-white/40 mt-1"><Smartphone size={11} className="inline" /> Changes reach the watch the next time it’s connected.</p>
    </div>
  );

  return (
    <div id="recording" className="glass-panel p-5 sm:p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <Mic size={18} className="text-gold-500" />
        <h2 className="font-bold text-navy-900 dark:text-white">Recording &amp; shortcuts</h2>
      </div>
      <p className="text-sm text-navy-500 dark:text-white/50 mb-4">Saved on this phone only (the watch keeps its own).</p>

      {/* Presets */}
      <div className="grid gap-2 sm:grid-cols-3 mb-4" role="radiogroup" aria-label="Preset">
        {PRESETS.map(p => (
          <button key={p.key} type="button" role="radio" aria-checked={s.preset === p.key} onClick={() => save({ preset: p.key })}
            className={`text-left rounded-2xl border p-3 transition-colors ${s.preset === p.key ? 'border-gold-400 bg-gold-500/10' : 'border-navy-200 dark:border-white/15'}`}>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-navy-900 dark:text-white">
              {s.preset === p.key ? <CheckCircle2 size={15} className="text-gold-500" /> : <Circle size={15} className="text-navy-300" />}
              {p.title}
            </span>
            <span className="block text-xs text-navy-500 dark:text-white/55 mt-1">{p.text}</span>
            {p.recommended && <span className="badge badge-gold !text-[10px] mt-1.5">Default</span>}
          </button>
        ))}
      </div>

      {note && <p className="mb-3 text-sm rounded-xl bg-gold-500/10 text-navy-800 dark:text-white/85 px-3 py-2" role="status">{note}</p>}

      {/* Start methods */}
      <h3 className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/45 mb-2">Ways to start recording</h3>
      <ul className="space-y-2 mb-3">{methods.map(m => <MethodRow key={m.key} m={m} />)}</ul>
      <div className="flex items-center gap-3 rounded-2xl border border-navy-100 dark:border-white/10 px-3 py-2.5 mb-4">
        <BatteryCharging size={18} className="shrink-0 text-gold-600 dark:text-gold-400" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-navy-900 dark:text-white">Battery: Unrestricted</span>
          <span className="block text-xs text-navy-500 dark:text-white/50">Keeps recording reliable with the screen off (Apps → Pocket Archive → Battery).</span>
        </span>
        <Status ok={status.batteryUnrestricted} okText="Set" offText="Not set" />
        <button type="button" className="btn-white text-xs py-1.5 px-3" onClick={() => act('open', 'battery')}><ExternalLink size={13} /> Open</button>
      </div>

      <KeyTest settings={s} />

      {/* While recording */}
      <h3 className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/45 mt-5 mb-1">While recording</h3>
      <Segmented id="rs-up" label="Volume up" value={s.volumeUp} options={OPTIONS.volumeUp} onChange={set('volumeUp')} />
      <Segmented id="rs-down" label="Volume down" value={s.volumeDown} options={OPTIONS.volumeDown} onChange={set('volumeDown')}
        hint="Discard asks nothing: a short “Discarded” notification offers Undo for 10 seconds." />
      <Switch label="Long-press volume down discards" hint="Hold to throw the recording away (Undo for 10 s). A short press then acts after a moment." checked={s.longPressDownDiscard} onChange={set('longPressDownDiscard')} />
      <Segmented id="rs-reopen" label="Opening Quick Record while recording" hint={reopenHint} value={s.quickRecordWhileRecording} options={OPTIONS.reopen} onChange={set('quickRecordWhileRecording')} />
      <Segmented id="rs-silence" label="Auto-stop after silence" value={s.silenceSec} options={OPTIONS.silence} onChange={set('silenceSec')} />
      <Segmented id="rs-max" label="Maximum length" value={s.maxMinutes} options={OPTIONS.max} onChange={set('maxMinutes')} />
      <Segmented id="rs-feedback" label="Start/stop feedback" value={s.feedback} options={OPTIONS.feedback} onChange={set('feedback')} />
      <Switch label="Countdown beep before recording starts" hint="Three short beeps, then it records." checked={s.countdown} onChange={set('countdown')} />

      <h3 id="accidental" className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/45 mt-5 mb-1 scroll-mt-20">Accidental recordings</h3>
      <p className="text-xs text-navy-500 dark:text-white/50">
        For starts you didn’t mean (a side key pressed in a pocket). Anything ignored is kept for 30 seconds with a
        “Restore” notification, so real speech is never lost.
        {status.accidentalWeek > 0 && <b className="block mt-1 text-navy-700 dark:text-white/75">{status.accidentalWeek} accidental recording{status.accidentalWeek === 1 ? '' : 's'} ignored this week</b>}
      </p>
      {/* The strongest fix, one tap away */}
      <div className={`mt-2 rounded-2xl border px-3 ${s.confirmStart ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-gold-400/60 bg-gold-500/10'}`}>
        <Switch label={s.confirmStart ? 'Press again to confirm — on' : 'Getting notes you didn’t mean? Turn on “Press again to confirm”'}
          hint="After a start from a key, widget or routine: a 3-second prompt and a buzz — press volume up or tap the notification to record, otherwise nothing happens. Starts from inside the app never ask."
          checked={s.confirmStart} onChange={set('confirmStart')} />
      </div>
      <Switch label="Side key & volume keys: only when unlocked (strict)" hint="Quick Record from the side key, shortcuts and volume keys only starts when the phone is already unlocked and in use — not when the press wakes or is on the lock screen. Widget, tile and the app aren’t affected." checked={!!s.unlockedOnly} onChange={set('unlockedOnly')} />
      <Switch label="Pocket detection" hint="Screen off and something right on the sensor (pocket, bag): don’t record — just one short buzz." checked={s.pocketDetection} onChange={set('pocketDetection')} />
      <Switch label="Discard if no speech at the start" hint="Listens for a real voice — syllables with a moving pitch — so steady road noise, a fan or music don’t count." checked={s.noSpeechDiscard} onChange={set('noSpeechDiscard')} />
      {s.noSpeechDiscard && <Segmented id="rs-nospeech" label="No speech within" value={s.noSpeechSec} options={OPTIONS.noSpeech} onChange={set('noSpeechSec')} />}
      <Switch label="Discard recordings shorter than 2 seconds" checked={s.minLengthDiscard} onChange={set('minLengthDiscard')} />
      <p className="text-xs text-navy-500 dark:text-white/50 mt-1">After anything is ignored, new start presses are ignored for 3 seconds.</p>

      <details className="settings-advanced mt-5" data-advanced="">
        <summary className="cursor-pointer select-none text-sm font-semibold text-navy-700 dark:text-white/80 min-h-[44px] flex items-center">Advanced</summary>
      <RecordingStartsLog />

      <h3 className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/45 mt-5 mb-1">Prevent double actions</h3>
      <p className="text-xs text-navy-500 dark:text-white/50">
        One press can reach both the app and a Samsung routine. Starts right after a stop are the same press and are ignored;
        stop keys in the first 1.5 s of a recording are the press that started it.
      </p>
      <Segmented id="rs-guard" label="Ignore start requests after a stop for" value={s.guardSec} options={OPTIONS.guard} onChange={set('guardSec')} />

      {/* Built-in double-press shortcuts */}
      <h3 className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/45 mt-5 mb-1 flex items-center gap-1.5">
        <Zap size={12} /> Built-in key shortcuts (no Routines needed)
      </h3>
      <Switch label="Double-press volume up to start recording" hint="Screen on and unlocked only" checked={s.doublePressUpStart} onChange={on => toggleDouble('doublePressUpStart', on)} />
      <Switch label="Double-press volume down to stop" checked={s.doublePressDownStop} onChange={on => toggleDouble('doublePressDownStop', on)} />
      <div className="flex flex-wrap items-center gap-2 mt-1">
        <Status ok={status.doublePressService} okText="Accessibility service on" offText="Accessibility service off" />
        {status.doublePressService && (
          <button type="button" className="btn-ghost text-xs text-red-600 dark:text-red-400" onClick={() => QuickRecorder.turnOffVolumeShortcuts().then(setData)}>
            <Power size={13} /> Turn off
          </button>
        )}
        {(s.doublePressUpStart || s.doublePressDownStop) && !status.doublePressService && (
          <button type="button" className="btn-white text-xs py-1.5 px-3" onClick={() => act('open', 'accessibility')}><ExternalLink size={13} /> Turn it on in Accessibility</button>
        )}
      </div>

      </details>

      {explain && (
        <ShortcutExplainer
          onCancel={() => setExplain(null)}
          onContinue={async () => {
            const key = pendingSwitch.current;
            setExplain(null);
            await save({ [key]: true });
            act('open', 'accessibility');
          }}
        />
      )}
    </div>
  );
}
