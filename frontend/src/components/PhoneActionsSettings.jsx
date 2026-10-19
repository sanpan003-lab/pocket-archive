import { useCallback, useEffect, useState } from 'react';
import { AlarmClock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { getActionSettings, saveActionSettings } from '../lib/api';
import { isNative } from '../lib/platform';
import { QuickRecorder } from '../native/quickRecorder';

const KINDS = [
  { key: 'alarm', label: 'Alarms', hint: '“Wake me at 5:30”, “alarm every weekday at 6” — set in the Clock app (Samsung Clock syncs them to your Galaxy Watch)' },
  { key: 'timer', label: 'Timers', hint: '“Set a timer for 10 minutes for the pasta”' },
  { key: 'navigate', label: 'Directions', hint: '“Directions to Publix”, “navigate home” — opens Google Maps' },
  { key: 'message', label: 'Messages', hint: '“Text Minal I’m on my way” — opens Messages filled in; you press Send' },
  { key: 'call', label: 'Calls', hint: '“Call Mom” — opens the dialer with the number; you press Call' },
  { key: 'openApp', label: 'Open apps', hint: '“Open Spotify”' },
  { key: 'dnd', label: 'Do Not Disturb', hint: '“Do not disturb for an hour” — turns itself back off' },
  { key: 'flashlight', label: 'Flashlight', hint: '“Flashlight on”' },
];
const KEEP = [[7, '7 days'], [30, '30 days'], [0, 'Never delete']];

function Row({ ok, title, text, action, onAction }) {
  return (
    <li className="flex items-start gap-2.5 py-2">
      {ok ? <CheckCircle2 size={17} className="text-emerald-500 shrink-0 mt-0.5" /> : <AlertTriangle size={17} className="text-amber-500 shrink-0 mt-0.5" />}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-navy-900 dark:text-white">{title}</span>
        <span className="block text-xs text-navy-500 dark:text-white/50">{text}</span>
      </span>
      {!ok && onAction && <button className="btn-white text-xs py-1.5 px-3 shrink-0" onClick={onAction}>{action}</button>}
    </li>
  );
}

/**
 * Settings → Alarms & phone actions: which voice commands do something on the phone,
 * how long the Actions list keeps them, and what the phone needs (fix-it buttons).
 */
export default function PhoneActionsSettings() {
  const [s, setS] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  const loadStatus = useCallback(() => {
    if (isNative) QuickRecorder.getActionStatus().then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    getActionSettings().then(setS).catch(() => setError('Couldn’t load these settings'));
    loadStatus();
    const onVisible = () => { if (document.visibilityState === 'visible') loadStatus(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadStatus]);

  async function save(patch) {
    const next = { ...s, ...patch, enabled: { ...s.enabled, ...(patch.enabled || {}) } };
    setS(next);
    try { setS(await saveActionSettings(next)); } catch (err) { setError(err.response?.data?.error || 'Couldn’t save'); }
  }
  const fix = target => QuickRecorder.openActionSetup({ target }).catch(() => {}).finally(() => setTimeout(loadStatus, 800));

  return (
    <div id="alarms" className="glass-panel p-5 sm:p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <AlarmClock size={18} className="text-gold-500" />
        <h2 className="font-bold text-navy-900 dark:text-white">Alarms &amp; phone actions</h2>
      </div>
      <p className="text-sm text-navy-600 dark:text-white/60 mb-3">
        Say a command in a quick note and your phone does it. Commands are kept in Quick Capture → Actions, not your Inbox; a note that also has real content is saved as a note with a small chip.
      </p>
      {!s && !error && <div className="h-40 rounded-xl bg-black/5 dark:bg-white/5 animate-pulse" />}
      {s && (
        <>
          <ul className="divide-y divide-navy-100 dark:divide-white/10 mb-3">
            {KINDS.map(k => (
              <li key={k.key}>
                <label className="flex items-start gap-3 py-2.5 cursor-pointer">
                  <input type="checkbox" className="accent-amber-500 w-4 h-4 mt-0.5" checked={!!s.enabled[k.key]} onChange={e => save({ enabled: { [k.key]: e.target.checked } })} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-navy-900 dark:text-white">{k.label}</span>
                    <span className="block text-xs text-navy-500 dark:text-white/50">{k.hint}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="text-sm font-semibold text-navy-900 dark:text-white mb-1.5">Keep actions for</p>
          <div className="tab-bar w-max mb-4" role="radiogroup" aria-label="Keep actions for">
            {KEEP.map(([v, l]) => (
              <button key={v} role="radio" aria-checked={s.keepDays === v} className={`tab-item ${s.keepDays === v ? 'active' : ''}`} onClick={() => save({ keepDays: v })}>{l}</button>
            ))}
          </div>
        </>
      )}
      {isNative && status && (
        <>
          <p className="text-sm font-semibold text-navy-900 dark:text-white">On this phone</p>
          <ul className="divide-y divide-navy-100 dark:divide-white/10">
            <Row ok={status.clock} title="Clock app" text={status.clock ? 'Alarms and timers go to your Clock app.' : 'No Clock app that accepts alarms was found.'} />
            <Row ok={status.background} title="Run actions while the app is closed"
              text={status.background ? 'Alarms and timers are set even with the screen off or from your watch.' : 'Android only lets an app open Clock or Maps from the background with “Display over other apps”. Without it you get a notification to tap.'}
              action="Allow" onAction={() => fix('overlay')} />
            {s?.enabled.message || s?.enabled.call ? (
              <Row ok={status.contacts === 'granted'} title="Contacts" text={status.contacts === 'granted' ? 'Messages and calls find people by name.' : 'Asked the first time you message or call someone by name.'} action="Allow" onAction={() => fix('contacts')} />
            ) : null}
            {s?.enabled.dnd && (
              <Row ok={status.dnd} title="Do Not Disturb access" text={status.dnd ? 'Allowed.' : 'Needed to turn Do Not Disturb on and off.'} action="Allow" onAction={() => fix('dnd')} />
            )}
          </ul>
        </>
      )}
      {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
    </div>
  );
}
