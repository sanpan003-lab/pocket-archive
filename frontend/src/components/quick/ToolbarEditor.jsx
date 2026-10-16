import { useRef, useState } from 'react';
import { GripVertical, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { useAppearance } from '../../context/appearanceStore';
import { TOOLBAR_ACTIONS, DEFAULT_ORDER, actionById, resolve, toolbarLayout } from './toolbarActions';

/**
 * "Note toolbar": drag to reorder, show/hide each action, Reset.
 * Hidden actions stay in "⋯ More" (so Delete is always reachable).
 */
export default function ToolbarEditor() {
  const { settings, update } = useAppearance();
  const { order, hidden } = toolbarLayout(settings.toolbar);
  const [dragId, setDragId] = useState(null);
  const rows = useRef(new Map());

  const save = (nextOrder, nextHidden) => {
    update('toolbar', 'order', nextOrder.join(','));
    update('toolbar', 'hidden', [...nextHidden].join(','));
  };

  function move(e) {
    if (!dragId) return;
    let target = null;
    for (const [id, el] of rows.current) {
      const r = el?.getBoundingClientRect();
      if (r && e.clientY >= r.top && e.clientY <= r.bottom) { target = id; break; }
    }
    if (!target || target === dragId) return;
    const next = order.filter(id => id !== dragId);
    next.splice(order.indexOf(target), 0, dragId);
    save(next, hidden);
  }

  return (
    <div>
      <ul className="space-y-1" onPointerMove={move} onPointerUp={() => setDragId(null)} onPointerCancel={() => setDragId(null)}>
        {order.map(id => {
          const a = actionById(id);
          const Icon = resolve(a.icon, null);
          const off = hidden.has(id);
          return (
            <li key={id} ref={el => { if (el) rows.current.set(id, el); else rows.current.delete(id); }}
              className={`flex items-center gap-2 rounded-xl px-1.5 py-1 ${dragId === id ? 'bg-gold-500/10 shadow-sm' : ''}`}>
              <button type="button" className="w-8 h-9 flex items-center justify-center text-navy-300 dark:text-white/30 cursor-grab touch-none"
                onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); setDragId(id); }}
                aria-label={`Drag to reorder ${resolve(a.label, null)}`}>
                <GripVertical size={16} />
              </button>
              <Icon size={17} className={off ? 'text-navy-300 dark:text-white/30' : a.danger ? 'text-red-500' : 'text-navy-600 dark:text-white/70'} />
              <span className={`flex-1 text-sm ${off ? 'text-navy-400 dark:text-white/35 line-through' : 'text-navy-900 dark:text-white'}`}>
                {resolve(a.label, null)}{a.when ? <span className="text-xs text-navy-400 dark:text-white/40"> · when it applies</span> : null}
              </span>
              <button type="button" className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => { const h = new Set(hidden); if (off) h.delete(id); else h.add(id); save(order, h); }}
                aria-pressed={!off} aria-label={off ? `Show ${resolve(a.label, null)}` : `Hide ${resolve(a.label, null)}`}>
                {off ? <EyeOff size={16} className="text-navy-400" /> : <Eye size={16} className="text-gold-600 dark:text-gold-400" />}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-navy-500 dark:text-white/50">Hidden actions stay in “⋯ More”.</p>
        <button type="button" className="btn-ghost text-xs" onClick={() => save(DEFAULT_ORDER, new Set())}><RotateCcw size={13} /> Reset</button>
      </div>
      {TOOLBAR_ACTIONS.length === 0 && null}
    </div>
  );
}
