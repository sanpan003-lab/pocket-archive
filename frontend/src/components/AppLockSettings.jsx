import { useCallback, useEffect, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { isNative } from '../lib/platform';
import { QuickRecorder } from '../native/quickRecorder';

const TIMEOUTS = [[0, 'Every open'], [1, 'After 1 min'], [5, 'After 5 min'], [15, 'After 15 min']];

function Switch({ label, hint, checked, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="w-full flex items-center gap-3 py-2 text-left disabled:opacity-50">
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

/**
 * Settings → Security → "Lock app with fingerprint" (Android app, this phone only). The app's sign-in key is
 * kept behind the fingerprint (or the phone's PIN); recording, scanning and the watch keep working while locked.
 */
export default function AppLockBlock() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = useCallback(() => { QuickRecorder.getAppLock().then(setS).catch(() => setS({ available: false })); }, []);
  useEffect(() => { if (isNative) load(); }, [load]);
  if (!isNative || !s) return null;

  async function save(patch, ok) {
    setBusy(true);
    setMsg(null);
    try { setS(await QuickRecorder.setAppLock(patch)); if (ok) setMsg({ ok }); }
    catch (err) { if (!/cancel/i.test(err?.message || '')) setMsg({ error: err?.message || 'That didn’t work' }); }
    finally { setBusy(false); }
  }

  const unavailable = s.biometrics !== 'ok';
  return (
    <div className="space-y-1" id="app-lock">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/40"><Fingerprint size={12} /> App lock (this phone)</h3>
      <Switch
        label="Lock app with fingerprint"
        hint={unavailable
          ? (s.biometrics === 'none-enrolled' ? 'Set up a fingerprint or a screen lock in Android Settings first' : 'This phone has no fingerprint or screen lock')
          : 'Opening Pocket Archive asks for your fingerprint (or your phone’s PIN). Recording, scanning, the widget and the watch keep working while it’s locked.'}
        checked={!!s.enabled} disabled={busy || (unavailable && !s.enabled)}
        onChange={on => save({ enabled: on }, on ? 'App lock is on' : 'App lock is off')}
      />
      {s.enabled && (
        <>
          <div className="py-1.5">
            <p className="text-sm font-semibold text-navy-900 dark:text-white" id="lock-timing">Lock</p>
            <div className="flex flex-wrap gap-1.5 mt-1.5" role="radiogroup" aria-labelledby="lock-timing">
              {TIMEOUTS.map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={s.timeoutMin === v} disabled={busy} onClick={() => save({ timeoutMin: v })}
                  className={`px-3 py-1.5 rounded-xl text-sm font-medium border ${s.timeoutMin === v ? 'bg-gold-500/15 border-gold-400 text-gold-700 dark:text-gold-300' : 'border-navy-200 dark:border-white/15 text-navy-600 dark:text-white/65'}`}>{l}</button>
              ))}
            </div>
          </div>
          <Switch label="Hide content in recent apps and screenshots" hint="Recommended with the app lock" checked={!!s.secure} disabled={busy} onChange={on => save({ secure: on })} />
          <p className="text-xs text-navy-500 dark:text-white/50">While it’s locked, notifications only say “Saved” and the widget doesn’t show your notes. Adding a new fingerprint asks for your account password once.</p>
        </>
      )}
      {msg && <p className={`text-xs ${msg.error ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`} role="status">{msg.error || msg.ok}</p>}
    </div>
  );
}
