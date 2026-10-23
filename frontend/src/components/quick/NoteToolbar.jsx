import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Eye, RotateCcw, MoreHorizontal, SlidersHorizontal, X } from 'lucide-react';
import { NOTE_COLORS } from '../../lib/appearance';
import { useAppearance } from '../../context/appearanceStore';
import { actionById, resolve, toolbarLayout, ACTION_KIND, allowedFor } from './toolbarActions';
import ToolbarEditor from './ToolbarEditor';
import AttachSheet from './AttachSheet';
import PagesEditor from './PagesEditor';

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

const HINT_KEY = 'pa_toolbarHinted';

/**
 * Edit · Pin · Color · Add to project · Merge · Share · … · ⋯ More
 * Order and visibility from Settings → Appearance & layout → Note toolbar
 * (or long-press here → Edit toolbar). Gestures that start here never swipe
 * to another note (data-no-swipe). onAction(kind, note, arg)
 */
export default function NoteToolbar({ note, onAction, busy, onChanged }) {
  const { settings, motion } = useAppearance();
  const [colorsOpen, setColorsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [pages, setPages] = useState(false);
  const [editing, setEditing] = useState(false);
  const [edges, setEdges] = useState({ left: false, right: false });
  const ref = useRef(null);
  const scroller = useRef(null);
  const press = useRef(null);

  const { order, hidden } = toolbarLayout(settings.toolbar);
  const applies = id => {
    const a = actionById(id);
    if (id === 'color' && !settings.look.noteColors) return false;
    if (!allowedFor(a, note)) return false;
    return !a.when || a.when(note);
  };
  const visible = order.filter(id => applies(id) && !hidden.has(id));
  const all = order.filter(applies);

  // Fades on the side(s) with more icons
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useLayoutEffect(() => { measure(); }, [measure, visible.length, note.id]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // First time it can scroll: a small bounce to show there's more
  useEffect(() => {
    const el = scroller.current;
    if (!el || motion !== 'full' || el.scrollWidth <= el.clientWidth + 4) return undefined;
    let seen = false;
    try { seen = localStorage.getItem(HINT_KEY) === '1'; } catch { /* ignore */ }
    if (seen) return undefined;
    const t1 = setTimeout(() => el.scrollTo({ left: 56, behavior: 'smooth' }), 600);
    const t2 = setTimeout(() => el.scrollTo({ left: 0, behavior: 'smooth' }), 1150);
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* ignore */ }
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [motion, note.id]);

  useEffect(() => {
    if (!colorsOpen && !moreOpen) return undefined;
    const close = e => { if (!ref.current?.contains(e.target)) { setColorsOpen(false); setMoreOpen(false); } };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [colorsOpen, moreOpen]);

  function run(id) {
    setMoreOpen(false);
    if (id === 'color') { setColorsOpen(o => !o); return; }
    if (id === 'attach') { setAttaching(true); return; }
    if (id === 'pages') { setPages(true); return; }
    onAction(ACTION_KIND[id] || id, note);
  }

  // Long-press the toolbar → Edit toolbar
  const startPress = e => {
    if (e.pointerType === 'mouse') return;
    press.current = setTimeout(() => { setEditing(true); navigator.vibrate?.(15); }, 650);
  };
  const cancelPress = () => clearTimeout(press.current);

  if (note.undone) {
    return (
      <div className="flex overflow-x-auto -mx-1 px-1" data-no-swipe>
        <Tool icon={Eye} label="Details" onClick={() => onAction('edit', note)} />
        <Tool icon={RotateCcw} label={busy === 'restore' ? 'Restoring…' : 'Restore'} onClick={() => onAction('restore', note)} disabled={!!busy} />
      </div>
    );
  }

  const tool = id => {
    const a = actionById(id);
    return (
      <Tool
        key={id}
        icon={resolve(a.icon, note)}
        label={busy === (ACTION_KIND[id] || id) ? 'Working…' : resolve(a.label, note)}
        danger={a.danger}
        active={id === 'pin' && note.pinned}
        disabled={busy === (ACTION_KIND[id] || id) || (id === 'summarize' && note.summaryStatus === 'pending')}
        onClick={() => run(id)}
        aria-expanded={id === 'color' ? colorsOpen : undefined}
      />
    );
  };

  return (
    <div ref={ref} className="relative" data-no-swipe>
      <div className="flex items-stretch">
        <div className="relative flex-1 min-w-0">
          <div
            ref={scroller}
            className={`flex overflow-x-auto -mx-1 px-1 scrollbar-none overscroll-x-contain ${edges.left ? 'toolbar-fade-left' : ''} ${edges.right ? 'toolbar-fade-right' : ''}`}
            role="toolbar"
            aria-label="Note actions"
            onScroll={() => { measure(); cancelPress(); }}
            onPointerDown={startPress}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onPointerCancel={cancelPress}
            onTouchStart={e => e.stopPropagation()}
            onTouchMove={e => e.stopPropagation()}
            onTouchEnd={e => e.stopPropagation()}
            onContextMenu={e => e.preventDefault()}
          >
            {visible.map(tool)}
          </div>
        </div>
        <Tool icon={MoreHorizontal} label="More" onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen} aria-haspopup="menu" />
      </div>

      {colorsOpen && (
        <div className="absolute bottom-full left-0 mb-2 z-10 p-3 rounded-2xl bg-white dark:bg-neutral-900 border border-navy-100 dark:border-white/10 shadow-xl animate-fade-in">
          <ColorPicker value={note.color} onPick={c => { setColorsOpen(false); onAction('color', note, c); }} />
        </div>
      )}

      {moreOpen && (
        <div className="absolute bottom-full right-0 mb-2 z-10 w-56 py-1.5 rounded-2xl bg-white dark:bg-neutral-900 border border-navy-100 dark:border-white/10 shadow-xl animate-fade-in" role="menu" aria-label="More actions">
          {all.map(id => {
            const a = actionById(id);
            const Icon = resolve(a.icon, note);
            return (
              <button key={id} type="button" role="menuitem" onClick={() => run(id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2 text-sm text-left hover:bg-black/5 dark:hover:bg-white/10 ${a.danger ? 'text-red-600 dark:text-red-400' : 'text-navy-800 dark:text-white/85'}`}>
                <Icon size={16} /> {resolve(a.label, note)}
              </button>
            );
          })}
          <div className="my-1 border-t border-navy-100 dark:border-white/10" />
          <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setEditing(true); }}
            className="w-full flex items-center gap-3 px-3.5 py-2 text-sm text-left text-navy-600 dark:text-white/65 hover:bg-black/5 dark:hover:bg-white/10">
            <SlidersHorizontal size={16} /> Edit toolbar
          </button>
        </div>
      )}

      {attaching && <AttachSheet note={note} onClose={() => setAttaching(false)} onChanged={onChanged} />}
      {pages && <PagesEditor note={note} onClose={() => setPages(false)} onChanged={onChanged} />}

      {editing && (
        <div className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label="Edit toolbar">
          <div className="absolute inset-0 note-scrim-fade" onClick={() => setEditing(false)} aria-hidden="true" />
          <div className="relative note-surface w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center mb-3">
              <h3 className="flex-1 font-bold text-navy-900 dark:text-white">Edit toolbar</h3>
              <button className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10" onClick={() => setEditing(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <ToolbarEditor />
          </div>
        </div>
      )}
    </div>
  );
}
