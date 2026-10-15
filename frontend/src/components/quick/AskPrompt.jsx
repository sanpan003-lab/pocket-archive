import { useState } from 'react';
import { HelpCircle, Check, FilePlus2, MoreHorizontal } from 'lucide-react';
import { decideQuickNote } from '../../lib/api';
import TargetPicker from './TargetPicker';

/**
 * "Add to <target>?" for a capture the classifier wasn't sure about.
 * Yes / New note / Other… (searchable). No answer within 2 minutes → the
 * server keeps it as a new note with a "Possible match" chip.
 */
export default function AskPrompt({ note, onResolved, compact = false }) {
  const [busy, setBusy] = useState(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const pending = note.pending;
  if (!pending) return null;

  const question = pending.action === 'cancel' ? `Cancel ${pending.targetTitle}?`
    : pending.action === 'update' ? `Change ${pending.targetTitle}?`
      : `Add to ${pending.targetTitle}?`;

  async function answer(choice, dest) {
    setBusy(choice);
    setError('');
    try {
      onResolved?.(await decideQuickNote(note.id, choice, dest));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save your answer');
    } finally {
      setBusy(null);
      setPicking(false);
    }
  }

  const btn = 'flex-1 min-w-0 h-11 rounded-xl px-3 text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50';
  return (
    <div className={`rounded-2xl border border-gold-400/50 bg-gold-500/10 ${compact ? 'p-3' : 'p-4'}`} role="group" aria-label={question}>
      <p className="flex items-center gap-2 font-semibold text-navy-900 dark:text-white mb-2.5">
        <HelpCircle size={18} className="text-gold-600 dark:text-gold-400 shrink-0" />
        <span className="break-words">{question}</span>
      </p>
      <div className="flex gap-2">
        <button className={`${btn} text-white`} style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }} onClick={() => answer('yes')} disabled={!!busy}>
          <Check size={16} /> {busy === 'yes' ? 'Saving…' : 'Yes'}
        </button>
        <button className={`${btn} bg-white dark:bg-white/10 text-navy-900 dark:text-white border border-navy-200 dark:border-white/15`} onClick={() => answer('new')} disabled={!!busy}>
          <FilePlus2 size={16} /> New note
        </button>
        <button className={`${btn} bg-white dark:bg-white/10 text-navy-900 dark:text-white border border-navy-200 dark:border-white/15`} onClick={() => setPicking(true)} disabled={!!busy}>
          <MoreHorizontal size={16} /> Other…
        </button>
      </div>
      {error && <p className="text-xs text-red-500 dark:text-red-400 mt-2">{error}</p>}
      {picking && (
        <TargetPicker
          title="Add it to…"
          exclude={note.id}
          onClose={() => setPicking(false)}
          onPick={dest => answer(dest.new ? 'new' : 'other', dest.new ? {} : { targetType: dest.targetType, targetId: dest.targetId })}
        />
      )}
    </div>
  );
}
