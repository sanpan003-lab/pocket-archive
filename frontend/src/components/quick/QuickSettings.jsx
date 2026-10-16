import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings, Volume2, Vibrate } from 'lucide-react';
import { isNative } from '../../lib/platform';

function Toggle({ icon: Icon, label, hint, checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="w-full flex items-center gap-3 py-2.5 text-left"
      onClick={() => onChange(!checked)}
    >
      <Icon size={18} className="shrink-0 text-navy-500 dark:text-white/60" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-navy-900 dark:text-white">{label}</span>
        {hint && <span className="block text-xs text-navy-500 dark:text-white/50">{hint}</span>}
      </span>
      <span
        className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${checked ? 'bg-gold-500' : 'bg-navy-200 dark:bg-white/20'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}
        />
      </span>
    </button>
  );
}

/** Gear button + panel with Quick Capture preferences */
export default function QuickSettings({ readAloud, onReadAloud, feedback, onFeedback }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey  = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="w-10 h-10 rounded-xl flex items-center justify-center text-navy-500 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        onClick={() => setOpen(o => !o)}
        aria-label="Quick Capture settings"
        aria-expanded={open}
      >
        <Settings size={20} />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-[160] w-72 max-w-[calc(100vw-2rem)] p-4 rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-xl animate-fade-in">
          <p className="text-xs font-bold uppercase tracking-wider text-navy-400 dark:text-white/40 mb-1">Confirmation</p>
          <Toggle
            icon={Volume2}
            label="Read confirmation aloud"
            hint="Speak what was saved"
            checked={readAloud}
            onChange={onReadAloud}
          />
          <div className="divider my-1" />
          <Toggle
            icon={Vibrate}
            label="Sound & vibration"
            hint="Chime and buzz when a note is saved"
            checked={feedback}
            onChange={onFeedback}
          />
          {isNative && (
            <Link to="/settings#recording" className="mt-3 flex items-center justify-between rounded-xl bg-gold-500/10 px-3 py-2 text-sm font-semibold text-gold-700 dark:text-gold-300">
              Volume keys, auto-stop &amp; shortcuts <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
