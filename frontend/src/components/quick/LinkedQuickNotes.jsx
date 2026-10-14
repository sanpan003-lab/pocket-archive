import { useCallback, useEffect, useState } from 'react';
import { Zap, Unlink } from 'lucide-react';
import { getQuickNotes, updateQuickNote, quickAudioUrl } from '../../lib/api';
import QuickSummary, { TranscriptToggle } from './QuickSummary';
import QuickAudio from './QuickAudio';
import { useSummaryPolling } from '../../hooks/useSummaryPolling';

function formatStamp(iso) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** Quick Capture notes linked to a recording (stored in 07_Quick_Notes, not the recording files) */
export default function LinkedQuickNotes({ recordingId }) {
  const [notes, setNotes]     = useState([]);
  const [busyId, setBusyId]   = useState(null);
  const [error, setError]     = useState(null);

  const load = useCallback(() => (
    getQuickNotes({ recordingId })
      .then(list => setNotes(list.filter(n => !n.undone)))
      .catch(() => {})
  ), [recordingId]);

  useEffect(() => { load(); }, [load]);
  useSummaryPolling(notes, load);

  function replace(updated) {
    setNotes(list => list.map(n => (n.id === updated.id ? updated : n)));
  }

  async function unlink(note) {
    setBusyId(note.id);
    setError(null);
    try {
      await updateQuickNote(note.id, { type: 'note', linkedRecordingId: null });
      setNotes(list => list.filter(n => n.id !== note.id));
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Unlink failed');
    } finally {
      setBusyId(null);
    }
  }

  if (!notes.length) return null;

  return (
    <div className="glass-panel p-4 sm:p-6 mt-4">
      <div className="flex items-center gap-2 mb-4">
        <Zap size={16} className="text-gold-500" />
        <h2 className="font-semibold text-navy-900 dark:text-white">Quick notes</h2>
        <span className="badge badge-slate">{notes.length}</span>
      </div>

      {error && <p className="text-xs text-red-500 dark:text-red-400 mb-3">{error}</p>}

      <div className="flex flex-col gap-3">
        {notes.map(note => (
          <div key={note.id} className="rounded-xl p-3.5 bg-black/[0.03] dark:bg-white/5 border border-black/5 dark:border-white/10 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-navy-400 dark:text-white/40">
                  {formatStamp(note.capturedAt || note.createdAt)}
                </p>
                <p className="text-sm font-semibold text-navy-900 dark:text-white mt-0.5 break-words">{note.title}</p>
              </div>
              <button
                className="btn-ghost text-xs -mt-1 -mr-1 shrink-0"
                onClick={() => unlink(note)}
                disabled={busyId === note.id}
                title="Unlink from this recording (the quick note is kept)"
              >
                <Unlink size={12} /> {busyId === note.id ? 'Unlinking…' : 'Unlink'}
              </button>
            </div>

            <QuickSummary note={note} clamp onChanged={replace} />
            {note.summaryStatus !== 'done' && note.summaryStatus !== 'pending' && !note.transcript && note.content && (
              <p className="text-sm text-navy-800 dark:text-white/85 mt-1 leading-relaxed break-words whitespace-pre-wrap">{note.content}</p>
            )}
            <TranscriptToggle transcript={note.transcript} />
            {note.audioFile && <QuickAudio src={quickAudioUrl(note.id)} durationSec={note.durationSec} />}
          </div>
        ))}
      </div>
    </div>
  );
}
