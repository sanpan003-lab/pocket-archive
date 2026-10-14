import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Pencil, Undo2, AlertCircle, Link2 } from 'lucide-react';
import { getQuickNotes, undoQuickNote, quickAudioUrl } from '../lib/api';
import QuickTabs from '../components/quick/QuickTabs';
import QuickNoteEditor from '../components/quick/QuickNoteEditor';
import { QUICK_TYPES, describeWhen, timeAgo } from '../components/quick/quickMeta';

const FILTERS = [
  { key: 'all',      label: 'All',          test: n => !n.undone },
  { key: 'review',   label: 'Needs review', test: n => !n.undone && n.status === 'needs_review' },
  { key: 'event',    label: 'Events',       test: n => !n.undone && n.type === 'event' },
  { key: 'reminder', label: 'Reminders',    test: n => !n.undone && n.type === 'reminder' },
  { key: 'notes',    label: 'Notes',        test: n => !n.undone && (n.type === 'note' || n.type === 'note_link') },
  { key: 'undone',   label: 'Undone',       test: n => n.undone },
];

function QuickNoteCard({ note, onEdit, onUndo, undoing }) {
  const meta = QUICK_TYPES[note.type] || QUICK_TYPES.note;
  const when = describeWhen(note);
  return (
    <div className={`glass-card p-4 sm:p-5 animate-fade-in ${note.undone ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className={`badge ${meta.badge}`}><meta.icon size={11} /> {meta.label}</span>
        {note.status === 'needs_review' && !note.undone && <span className="badge badge-gold">Needs review</span>}
        {note.undone && <span className="badge badge-slate">Undone</span>}
        <span className="ml-auto text-xs text-navy-400 dark:text-white/40">{timeAgo(note.capturedAt || note.createdAt)}</span>
      </div>

      <p className="font-semibold text-navy-900 dark:text-white break-words">{note.title}</p>
      {when && <p className="text-sm text-navy-600 dark:text-white/60 mt-0.5">{when}{note.location ? ` · ${note.location}` : ''}</p>}

      {note.transcript && (
        <p className="text-sm italic text-navy-600 dark:text-white/60 mt-2 line-clamp-3 break-words">“{note.transcript}”</p>
      )}
      {!note.transcript && note.error && (
        <p className="text-xs text-amber-700 dark:text-amber-300 mt-2 break-words">{note.error}</p>
      )}

      {note.linkedRecordingId && (
        <Link
          to={`/recordings/${note.linkedRecordingId}`}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-300"
        >
          <Link2 size={12} /> Open linked recording
        </Link>
      )}

      {note.actions?.length > 0 && (
        <p className="text-xs text-navy-400 dark:text-white/40 mt-2">{note.actions.join(' · ')}</p>
      )}

      {note.audioFile && (
        <audio controls preload="none" src={quickAudioUrl(note.id)} className="w-full mt-3 h-10" />
      )}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button className="btn-ghost text-xs" onClick={() => onEdit(note)}>
          <Pencil size={13} /> {note.undone ? 'View' : 'Edit'}
        </button>
        {!note.undone && (
          <button className="btn-ghost text-xs text-red-500 dark:text-red-400" onClick={() => onUndo(note)} disabled={undoing}>
            <Undo2 size={13} /> {undoing ? 'Undoing…' : 'Undo'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function QuickInboxPage() {
  const [notes, setNotes]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [filter, setFilter]   = useState('all');
  const [editing, setEditing] = useState(null);
  const [undoingId, setUndoingId] = useState(null);

  const load = useCallback(() => {
    return getQuickNotes()
      .then(list => { setNotes(list); setError(null); })
      .catch(err => setError(err.message || 'Failed to load quick notes'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map(f => [f.key, notes.filter(f.test).length])),
    [notes],
  );
  const visible = useMemo(() => notes.filter(FILTERS.find(f => f.key === filter).test), [notes, filter]);

  function replace(updated) {
    setNotes(list => list.map(n => (n.id === updated.id ? updated : n)));
  }

  async function handleUndo(note) {
    setUndoingId(note.id);
    try {
      replace(await undoQuickNote(note.id));
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Undo failed');
    } finally {
      setUndoingId(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Quick Capture</h1>
        <QuickTabs reviewCount={counts.review} />
      </div>

      <div className="overflow-x-auto -mx-1 px-1 mb-4">
        <div className="tab-bar w-max">
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`tab-item shrink-0 ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {counts[f.key] > 0 && f.key !== 'all' && (
                <span className={`ml-1.5 text-[10px] font-bold ${f.key === 'review' ? 'text-gold-600 dark:text-gold-400' : 'opacity-60'}`}>
                  {counts[f.key]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="glass-card p-4 mb-4 flex items-center gap-3">
          <AlertCircle size={18} className="text-red-500 shrink-0" />
          <p className="text-sm text-navy-700 dark:text-white/80">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map(i => <div key={i} className="glass-card h-32 animate-pulse" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <Inbox size={30} className="mx-auto mb-2 text-navy-200 dark:text-white/20" />
          <p className="text-sm text-navy-600 dark:text-white/50">
            {filter === 'review' ? 'Nothing needs review.' : 'No captures here yet.'}
          </p>
          <Link to="/quick" className="inline-block mt-3 text-sm font-semibold text-gold-600 dark:text-gold-400">
            Record a quick note →
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map(note => (
            <QuickNoteCard
              key={note.id}
              note={note}
              onEdit={setEditing}
              onUndo={handleUndo}
              undoing={undoingId === note.id}
            />
          ))}
        </div>
      )}

      {editing && (
        <QuickNoteEditor
          note={editing}
          onClose={() => setEditing(null)}
          onChanged={replace}
        />
      )}
    </div>
  );
}
