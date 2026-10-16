import { useEffect, useRef } from 'react';
import { X, Sparkles, Pin, Loader2 } from 'lucide-react';
import { useAppearance } from '../../context/appearanceStore';
import { ColorPicker } from '../quick/NoteToolbar';
import { noteColorStyle } from '../quick/noteHelpers';

/** "✨ Let AI organize" switch (on: same pipeline as voice; off: saved exactly as typed) */
export function AiToggle({ value, onChange, hint }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className="flex items-center gap-3 text-left w-full sm:w-auto"
    >
      <Sparkles size={17} className={value ? 'text-gold-500' : 'text-navy-400 dark:text-white/40'} />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-navy-900 dark:text-white">Let AI organize</span>
        <span className="block text-xs text-navy-500 dark:text-white/50">
          {hint || (value ? 'Lists, reminders, events, adding to existing notes, summary' : 'Saved exactly as typed')}
        </span>
      </span>
      <span className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${value ? 'bg-gold-500' : 'bg-navy-200 dark:bg-white/20'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}

/**
 * Modal for the create editors: bottom sheet on phones, dialog on wider
 * screens. Header: ✕ · title · Save. Footer: color / pin / AI switch.
 */
export default function ComposerShell({
  title, onClose, onSave, saving, savingLabel = 'Saving…', canSave = true, children, footer,
  color, onColor, pinned, onPin, error,
}) {
  const { settings, darkMode } = useAppearance();
  const ref = useRef(null);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canSave && !saving) { e.preventDefault(); onSave(); }
    };
    window.addEventListener('keydown', onKey);
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); html.style.overflow = prev; };
  }, [onClose, onSave, canSave, saving]);

  return (
    <div className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center sm:p-6" role="presentation">
      <div className="absolute inset-0 note-scrim-blur note-anim-fade" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full sm:max-w-xl max-h-[94vh] sm:max-h-[88vh] note-surface rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col note-anim-up"
        style={color ? noteColorStyle({ color }, darkMode, settings.look.noteColors) : undefined}
      >
        <div className="flex items-center gap-2 px-3 sm:px-4 h-14 border-b border-navy-100 dark:border-white/10 shrink-0">
          <button type="button" className="w-10 h-10 rounded-xl flex items-center justify-center text-navy-600 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/10" onClick={onClose} aria-label="Cancel">
            <X size={20} />
          </button>
          <p className="flex-1 font-semibold text-navy-900 dark:text-white">{title}</p>
          {onPin && (
            <button type="button" className={`w-10 h-10 rounded-xl flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 ${pinned ? 'text-gold-500' : 'text-navy-500 dark:text-white/60'}`} onClick={() => onPin(!pinned)} aria-pressed={pinned} aria-label={pinned ? 'Unpin' : 'Pin'}>
              <Pin size={18} className={pinned ? 'fill-current' : ''} />
            </button>
          )}
          <button type="button" className="btn-gold py-2 px-4" onClick={onSave} disabled={!canSave || saving}>
            {saving && <Loader2 size={15} className="animate-spin" />}
            {saving ? savingLabel : 'Save'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4">{children}</div>

        <div className="border-t border-navy-100 dark:border-white/10 px-4 sm:px-5 py-3 space-y-3 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
          {onColor && settings.look.noteColors && <ColorPicker value={color} onPick={onColor} />}
          {footer}
        </div>
      </div>
    </div>
  );
}
