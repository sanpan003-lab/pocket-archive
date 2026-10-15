import { useEffect, useState } from 'react';
import { X, Combine, Sparkles } from 'lucide-react';
import { combineQuickNotes, suggestCombinedTitle } from '../../lib/api';
import { QUICK_TYPES, cardTime } from './quickMeta';

/**
 * Combine selected notes: pick the main note (default: the oldest) and a
 * title (pre-filled by AI). The others become dated updates inside it.
 */
export default function CombineDialog({ notes, onDone, onClose }) {
  const byAge = [...notes].sort((a, b) => (a.capturedAt || a.createdAt || '').localeCompare(b.capturedAt || b.createdAt || ''));
  const [mainId, setMainId] = useState(byAge[0]?.id);
  const [title, setTitle] = useState(byAge[0]?.title || '');
  const [suggesting, setSuggesting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    suggestCombinedTitle(notes.map(n => n.id))
      .then(r => { if (!cancelled && r.title) setTitle(r.title); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSuggesting(false); });
    return () => { cancelled = true; };
  }, [notes]);

  async function combine() {
    setBusy(true);
    setError('');
    try {
      const r = await combineQuickNotes(mainId, notes.map(n => n.id), title.trim());
      onDone(r);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not combine the notes');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={onClose} role="dialog" aria-modal="true" aria-label="Combine notes">
      <div className="glass-panel w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 rounded-b-none sm:rounded-b-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-navy-900 dark:text-white flex items-center gap-2"><Combine size={18} className="text-gold-500" /> Combine {notes.length} notes</h2>
          <button className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10" onClick={onClose} aria-label="Close"><X size={18} className="text-navy-600 dark:text-white/60" /></button>
        </div>

        <label className="block text-xs font-semibold text-navy-600 dark:text-white/60 mb-1" htmlFor="combine-title">
          Title {suggesting && <span className="inline-flex items-center gap-1 text-gold-600 dark:text-gold-400"><Sparkles size={11} className="animate-pulse" /> suggesting…</span>}
        </label>
        <input id="combine-title" className="w-full h-11 rounded-xl px-3 text-sm bg-white/70 dark:bg-white/5 border border-navy-200 dark:border-white/10 text-navy-900 dark:text-white mb-4" value={title} onChange={e => setTitle(e.target.value)} />

        <p className="text-xs font-semibold text-navy-600 dark:text-white/60 mb-1.5">Keep as the main note</p>
        <div className="space-y-1.5 mb-3" role="radiogroup">
          {byAge.map(n => {
            const meta = QUICK_TYPES[n.type] || QUICK_TYPES.note;
            return (
              <label key={n.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer ${mainId === n.id ? 'border-gold-400 bg-gold-500/10' : 'border-navy-100 dark:border-white/10'}`}>
                <input type="radio" name="main" checked={mainId === n.id} onChange={() => setMainId(n.id)} className="accent-amber-500" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-navy-900 dark:text-white truncate">{n.title}</span>
                  <span className="block text-xs text-navy-500 dark:text-white/50">{meta.label} · {cardTime(n.capturedAt || n.createdAt)}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-navy-500 dark:text-white/50 mb-4">
          The others become dated updates inside it, with their audio and transcripts. Lists merge without duplicates; linked recordings and calendar events carry over. You can split them back later.
        </p>
        {error && <p className="text-sm text-red-500 dark:text-red-400 mb-3">{error}</p>}
        <div className="flex gap-2">
          <button className="btn-gold flex-1 justify-center" onClick={combine} disabled={busy || !title.trim()}>
            <Combine size={15} /> {busy ? 'Combining…' : 'Combine'}
          </button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
