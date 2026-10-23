import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { updateQuickNote } from '../../lib/api';

/**
 * Editing someone else's note (shared with "Can edit"): title and text only.
 * Checklist items are edited in place; type, dates, place and project stay with the owner.
 */
export default function SharedNoteEditor({ note, onClose, onChanged }) {
  const [title, setTitle] = useState(note.title || '');
  const [content, setContent] = useState(note.content || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hasText = !!note.content || !(note.items || []).length;
  const hasImages = !!note.media || (note.attachments || []).some(a => a.kind === 'image' || a.pageList?.length);
  const [position, setPosition] = useState(note.bodyPosition === 'above' ? 'above' : 'below');

  async function save(e) {
    e.preventDefault();
    if (!title.trim()) { setError('Give it a title'); return; }
    setBusy(true);
    setError('');
    try {
      const patch = { title: title.trim() };
      if (hasText) patch.content = content;
      if (hasImages) patch.bodyPosition = position;
      onChanged?.(await updateQuickNote(note.id, patch));
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save');
      setBusy(false);
    }
  }

  const field = 'w-full rounded-xl px-3 text-sm bg-white/70 dark:bg-white/5 border border-navy-200 dark:border-white/10 text-navy-900 dark:text-white';
  return (
    <div className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={onClose} role="dialog" aria-modal="true" aria-label="Edit note">
      <form className="glass-panel w-full sm:max-w-lg max-h-[90vh] overflow-y-auto p-5 rounded-b-none sm:rounded-b-2xl animate-slide-up pb-[max(1.25rem,env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()} onSubmit={save}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-navy-900 dark:text-white flex items-center gap-2"><Pencil size={17} className="text-gold-500" /> Edit</h2>
          <button type="button" className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10" onClick={onClose} aria-label="Close">
            <X size={18} className="text-navy-600 dark:text-white/60" />
          </button>
        </div>
        <label className="block text-xs font-semibold text-navy-600 dark:text-white/60 mb-1" htmlFor="shared-title">Title</label>
        <input id="shared-title" className={`${field} h-11 mb-3`} value={title} onChange={e => setTitle(e.target.value)} />
        {hasText && (
          <>
            <label className="block text-xs font-semibold text-navy-600 dark:text-white/60 mb-1" htmlFor="shared-content">Text</label>
            <textarea id="shared-content" className={`${field} py-2.5 min-h-[10rem] mb-3`} value={content} onChange={e => setContent(e.target.value)} />
          </>
        )}
        {hasImages && hasText && (
          <div className="flex flex-wrap items-center gap-2 mb-3" role="radiogroup" aria-label="Text position">
            <span className="text-xs font-semibold text-navy-600 dark:text-white/60">Text position</span>
            {[['above', 'Above the images'], ['below', 'Below the images']].map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={position === v} onClick={() => setPosition(v)}
                className={`px-2.5 py-1 rounded-lg text-xs border ${position === v ? 'border-gold-400 bg-gold-500/10 text-gold-700 dark:text-gold-300' : 'border-navy-200 dark:border-white/15 text-navy-700 dark:text-white/75'}`}>{l}</button>
            ))}
          </div>
        )}
        <p className="text-xs text-navy-500 dark:text-white/50 mb-4">
          {note.sharedFrom?.name || 'The owner'} sees your changes right away. Dates, place and project stay as they set them.
        </p>
        {error && <p className="text-sm text-red-500 dark:text-red-400 mb-3">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" className="btn-gold flex-1 justify-center" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
