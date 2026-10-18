import { useEffect, useState } from 'react';
import { Users, Moon, MapPin } from 'lucide-react';
import { getNotifySettings, saveNotifySettings } from '../lib/api';
import { isNative } from '../lib/platform';

const MODES = [
  { key: 'every', label: 'Every change', hint: '“Jane added Eggs to Publix list”' },
  { key: 'summary', label: 'Summary', hint: 'One notification: “3 changes on shared lists”' },
  { key: 'off', label: 'Off', hint: 'Changes still show up in the lists' },
];

/**
 * Settings → Shared lists: notifications about other people's changes (phone, every 15 minutes in the
 * background, also on the watch; live while the app is open), quiet hours, and the opt-in
 * "let people on shared lists know when I'm at the store".
 */
export default function SharingSettings() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => { getNotifySettings().then(setS).catch(() => setError('Could not load these settings')); }, []);

  async function save(patch) {
    const next = { ...s, ...patch };
    setS(next);
    setError('');
    try {
      setS(await saveNotifySettings(next));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save');
    }
  }

  const quiet = !!(s?.quietStart && s?.quietEnd);
  const time = 'h-10 rounded-xl px-2 text-sm bg-white/70 dark:bg-white/5 border border-navy-200 dark:border-white/10 text-navy-900 dark:text-white';

  return (
    <div id="sharing" className="glass-panel p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <Users size={18} className="text-gold-500" />
        <h2 className="font-bold text-navy-900 dark:text-white">Shared lists</h2>
        {saved && <span className="ml-auto text-xs font-semibold text-emerald-600 dark:text-emerald-400">Saved</span>}
      </div>
      <p className="text-sm text-navy-600 dark:text-white/60 mb-4">
        When someone changes a list or note you share, it updates right away while the app is open.
        {isNative ? ' In the background your phone checks every 15 minutes and notifies you (and your watch).' : ' The Android app also notifies you in the background.'}
      </p>

      {!s && !error && <div className="h-28 rounded-xl bg-black/5 dark:bg-white/5 animate-pulse" />}

      {s && (
        <>
          <p className="text-xs font-semibold text-navy-600 dark:text-white/60 mb-1.5">Notify me about other people’s changes</p>
          <div className="space-y-1.5 mb-4" role="radiogroup" aria-label="Notifications about changes">
            {MODES.map(m => (
              <label key={m.key} className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border cursor-pointer ${s.mode === m.key ? 'border-gold-400 bg-gold-500/10' : 'border-navy-100 dark:border-white/10'}`}>
                <input type="radio" name="notify-mode" className="accent-amber-500 mt-1" checked={s.mode === m.key} onChange={() => save({ mode: m.key })} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-navy-900 dark:text-white">{m.label}</span>
                  <span className="block text-xs text-navy-500 dark:text-white/50">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <label className="flex items-center gap-3 mb-2 cursor-pointer">
            <input type="checkbox" className="accent-amber-500 w-4 h-4" checked={quiet} disabled={s.mode === 'off'}
              onChange={e => save(e.target.checked ? { quietStart: '22:00', quietEnd: '07:00' } : { quietStart: null, quietEnd: null })} />
            <Moon size={15} className="text-navy-500 dark:text-white/50" />
            <span className="text-sm font-semibold text-navy-900 dark:text-white">Quiet hours</span>
          </label>
          {quiet && s.mode !== 'off' && (
            <div className="flex flex-wrap items-center gap-2 pl-7 mb-2 text-sm text-navy-700 dark:text-white/70">
              <span>From</span>
              <input type="time" className={time} value={s.quietStart} aria-label="Quiet hours start" onChange={e => e.target.value && save({ quietStart: e.target.value })} />
              <span>to</span>
              <input type="time" className={time} value={s.quietEnd} aria-label="Quiet hours end" onChange={e => e.target.value && save({ quietEnd: e.target.value })} />
            </div>
          )}
          <p className="text-xs text-navy-500 dark:text-white/50 pl-7 mb-4">No sound or pop-ups then; you get one summary afterwards.</p>

          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="accent-amber-500 w-4 h-4 mt-0.5" checked={!!s.shareLocation} onChange={e => save({ shareLocation: e.target.checked })} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-navy-900 dark:text-white"><MapPin size={14} /> Let people on shared lists know when I’m at the store</span>
              <span className="block text-xs text-navy-500 dark:text-white/50">
                When a shared errand’s arrival reminder goes off on your phone, they see that you’re at that store (e.g. “Jane is at Publix”). Only that — never your location.
              </span>
            </span>
          </label>
        </>
      )}
      {error && <p className="text-sm text-red-500 dark:text-red-400 mt-3">{error}</p>}
    </div>
  );
}
