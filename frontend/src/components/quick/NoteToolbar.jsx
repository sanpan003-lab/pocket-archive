import { useEffect, useRef, useState } from 'react';
import {
  Pencil, Pin, PinOff, Palette, FolderInput, Merge, Share2, Trash2, RotateCcw, Sparkles,
  CheckCircle2, Split, Check, Eye, RefreshCw,
} from 'lucide-react';
import { NOTE_COLORS } from '../../lib/appearance';
import { useAppearance } from '../../context/appearanceStore';

/** Keep-style color dots */
export function ColorPicker({ value, onPick }) {
  const { darkMode } = useAppearance();
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Note color">
      {NOTE_COLORS.map(c => {
        const selected = (value || 'default') === c.key;
        return (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c.label}
            title={c.label}
            onClick={() => onPick(c.key)}
            className={`w-8 h-8 rounded-full border flex items-center justify-center ${selected ? 'ring-2 ring-gold-500 ring-offset-2 ring-offset-white dark:ring-offset-neutral-900' : ''} ${c.key === 'default' ? 'border-navy-300 dark:border-white/30' : 'border-black/10 dark:border-white/15'}`}
            style={{ background: c.key === 'default' ? 'transparent' : (darkMode ? c.dark : c.light) }}
          >
            {selected && <Check size={14} className="text-navy-700 dark:text-white/80" />}
            {c.key === 'default' && !selected && <span className="w-4 h-px bg-navy-400 rotate-45" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

function Tool({ icon: Icon, label, onClick, danger, disabled, active, ...rest }) {
  return (
    <button
      type="button"
      className={`quick-card-action shrink-0 min-w-[4.25rem] px-2 ${danger ? 'danger' : ''} ${active ? 'text-gold-600 dark:text-gold-400' : ''}`}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      <Icon size={18} className={active ? 'fill-current' : ''} />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

/**
 * Edit · Pin · Color · Add to project · Merge · Share · Delete (Restore when deleted)
 * plus Summarize / Mark done / Split back when they apply.
 * onAction(kind, note, arg)
 */
export default function NoteToolbar({ note, onAction, busy }) {
  const { settings } = useAppearance();
  const [colorsOpen, setColorsOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!colorsOpen) return undefined;
    const close = e => { if (!ref.current?.contains(e.target)) setColorsOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [colorsOpen]);

  if (note.undone) {
    return (
      <div className="flex overflow-x-auto -mx-1 px-1">
        <Tool icon={Eye} label="Details" onClick={() => onAction('edit', note)} />
        <Tool icon={RotateCcw} label={busy === 'restore' ? 'Restoring…' : 'Restore'} onClick={() => onAction('restore', note)} disabled={!!busy} />
      </div>
    );
  }

  const errand = note.type === 'errand';
  const canSummarize = note.transcript || note.content || note.mediaText || (note.items || []).length;

  return (
    <div ref={ref} className="relative">
      <div className="flex overflow-x-auto -mx-1 px-1" role="toolbar" aria-label="Note actions">
        <Tool icon={Pencil} label="Edit" onClick={() => onAction('edit', note)} />
        <Tool icon={note.pinned ? PinOff : Pin} label={note.pinned ? 'Unpin' : 'Pin'} active={note.pinned} onClick={() => onAction('pin', note)} />
        {settings.look.noteColors && (
          <Tool icon={Palette} label="Color" onClick={() => setColorsOpen(o => !o)} aria-expanded={colorsOpen} />
        )}
        <Tool icon={FolderInput} label={note.projectId ? 'Project…' : 'Add to project'} onClick={() => onAction('addToProject', note)} />
        <Tool icon={Merge} label="Merge" onClick={() => onAction('mergeInto', note)} />
        <Tool icon={Share2} label="Share" onClick={() => onAction('share', note)} />
        {errand && (
          <Tool icon={note.errandDone ? RotateCcw : CheckCircle2} label={note.errandDone ? 'Reopen' : 'Mark done'} onClick={() => onAction('done', note)} disabled={busy === 'done'} />
        )}
        {canSummarize && (
          <Tool icon={Sparkles} label={busy === 'summarize' ? 'Working…' : 'Summarize'} onClick={() => onAction('summarize', note)} disabled={busy === 'summarize' || note.summaryStatus === 'pending'} />
        )}
        {(note.combinedGroups || []).length > 0 && <Tool icon={Split} label="Split back" onClick={() => onAction('split', note)} />}
        {note.status === 'needs_review' && <Tool icon={RefreshCw} label="Retry AI" onClick={() => onAction('retry', note)} disabled={busy === 'retry'} />}
        <Tool icon={Trash2} label="Delete" danger onClick={() => onAction('delete', note)} disabled={busy === 'delete'} />
      </div>
      {colorsOpen && (
        <div className="absolute bottom-full left-0 mb-2 z-10 p-3 rounded-2xl bg-white dark:bg-neutral-900 border border-navy-100 dark:border-white/10 shadow-xl animate-fade-in">
          <ColorPicker value={note.color} onPick={c => { setColorsOpen(false); onAction('color', note, c); }} />
        </div>
      )}
    </div>
  );
}
