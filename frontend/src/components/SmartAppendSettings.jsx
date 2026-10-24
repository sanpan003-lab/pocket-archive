import { useEffect, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { getQuickSettings, updateQuickSettings } from '../lib/api';

function Switch({ label, hint, checked, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} className="w-full flex items-center gap-3 py-2 text-left" onClick={() => onChange(!checked)}>
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

/** Settings → Smart append: when a voice note may change an existing note on its own. */
export default function SmartAppendSettings() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getQuickSettings().then(setS).catch(err => setError(err.response?.data?.error || 'Could not load'));
  }, []);

  async function save(patch) {
    setS(prev => ({ ...prev, ...patch }));
    try { setS(await updateQuickSettings(patch)); setError(''); }
    catch (err) { setError(err.response?.data?.error || 'Could not save'); }
  }

  const pct = v => `${Math.round(v * 100)}%`;

  return (
    <div id="smart-append" className="glass-panel p-6 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <Wand2 size={18} className="text-gold-500" />
        <h2 className="font-bold text-navy-900 dark:text-white">Smart append</h2>
      </div>
      <p className="text-sm text-navy-600 dark:text-white/60 mb-4">
        New voice notes can add to a list, note or project, or change an event. Undo and Move are always one tap away.
      </p>
      {error && <p className="text-sm text-red-500 dark:text-red-400 mb-3">{error}</p>}
      {!s ? (
        <div className="h-24 rounded-xl bg-navy-100 dark:bg-white/10 animate-pulse" />
      ) : (
        <>
          <label className="block mb-4">
            <span className="flex justify-between text-sm font-semibold text-navy-900 dark:text-white">
              Apply automatically when at least <span className="tabular-nums text-gold-600 dark:text-gold-400">{pct(s.autoApply)}</span> sure
            </span>
            <input type="range" min="0.6" max="1" step="0.05" value={s.autoApply} className="w-full accent-amber-500 mt-2"
              onChange={e => setS({ ...s, autoApply: Number(e.target.value), ask: Math.min(s.ask, Number(e.target.value)) })}
              onPointerUp={e => save({ autoApply: Number(e.target.value), ask: Math.min(s.ask, Number(e.target.value)) })}
              onKeyUp={e => save({ autoApply: Number(e.target.value) })}
              aria-label="Auto-apply threshold" />
          </label>
          <label className="block mb-3">
            <span className="flex justify-between text-sm font-semibold text-navy-900 dark:text-white">
              Ask first from <span className="tabular-nums text-gold-600 dark:text-gold-400">{pct(s.ask)}</span>; below that, save as a new note
            </span>
            <input type="range" min="0.3" max={s.autoApply} step="0.05" value={s.ask} className="w-full accent-amber-500 mt-2"
              onChange={e => setS({ ...s, ask: Number(e.target.value) })}
              onPointerUp={e => save({ ask: Number(e.target.value) })}
              onKeyUp={e => save({ ask: Number(e.target.value) })}
              aria-label="Ask threshold" />
          </label>
          <Switch label="Always ask before cancelling" hint="“Cancel the dentist” waits for your OK" checked={s.alwaysAskCancel} onChange={v => save({ alwaysAskCancel: v })} />
          <Switch label="Always ask before changing events" hint="Moving or renaming events and reminders waits for your OK" checked={s.alwaysAskEventChanges} onChange={v => save({ alwaysAskEventChanges: v })} />
        </>
      )}
    </div>
  );
}
