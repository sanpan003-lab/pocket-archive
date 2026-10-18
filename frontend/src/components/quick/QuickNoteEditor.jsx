import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, CheckCircle, Undo2, RotateCcw, ExternalLink } from 'lucide-react';
import {
  updateQuickNote, undoQuickNote, retryQuickNote, quickAudioUrl, getRecordings,
} from '../../lib/api';
import { useLayout } from '../../lib/layout';
import { QUICK_TYPES, TYPE_OPTIONS, toInputValue, describeWhen, timeAgo } from './quickMeta';
import QuickSummary, { TranscriptToggle } from './QuickSummary';
import QuickAudio from './QuickAudio';

const INPUT = 'w-full text-sm text-navy-900 dark:text-white bg-black/5 dark:bg-white/5 border border-navy-200 dark:border-white/20 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-gold-400/50';
const LABEL = 'block text-xs font-semibold text-navy-600 dark:text-white/60 mb-1';

function fromInput(value, allDay) {
  if (!value) return null;
  return allDay ? value.slice(0, 10) : `${value}:00`;
}

/** Modal to view, edit, change type, retry or undo a quick capture */
export default function QuickNoteEditor({ note, onClose, onChanged }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => ({
    type:     note.type,
    title:    note.title || '',
    content:  note.content || '',
    allDay:   !!note.allDay,
    start:    toInputValue(note.start, note.allDay),
    end:      toInputValue(note.end, note.allDay),
    dueDate:  toInputValue(note.dueDate, note.allDay),
    location: note.location || '',
    linkedRecordingId: note.linkedRecordingId || '',
    placeQuery: note.place?.query || note.placeSpec?.query || '',
    trigger:    note.trigger || 'time',
    itemsText:  (note.items || []).map(i => i.text).join('\n'),
  }));
  const [recordings, setRecordings] = useState([]);
  const [busy, setBusy]   = useState(null);   // 'save' | 'undo' | 'retry'
  const [error, setError] = useState(null);
  const [regenSummary, setRegenSummary] = useState(true);
  const contentChanged = draft.content.trim() !== (note.content || '').trim();

  const { archive } = useLayout();
  useEffect(() => {
    if (archive) getRecordings().then(setRecordings).catch(() => {}); // Hey Pocket recordings: the admin only
  }, [archive]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (key, value) => setDraft(d => ({ ...d, [key]: value }));

  function toggleAllDay(allDay) {
    setDraft(d => ({
      ...d,
      allDay,
      start:   d.start   ? (allDay ? d.start.slice(0, 10)   : `${d.start.slice(0, 10)}T09:00`)   : '',
      end:     d.end     ? (allDay ? d.end.slice(0, 10)     : `${d.end.slice(0, 10)}T10:00`)     : '',
      dueDate: d.dueDate ? (allDay ? d.dueDate.slice(0, 10) : `${d.dueDate.slice(0, 10)}T09:00`) : '',
    }));
  }

  async function run(kind, fn) {
    setBusy(kind);
    setError(null);
    try {
      const updated = await fn();
      onChanged?.(updated.note || updated);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  function save() {
    if (draft.type === 'event' && !draft.start)  return setError('Events need a start date');
    if (draft.type === 'note_link' && !draft.linkedRecordingId) return setError('Choose a recording to link to');
    if (draft.type === 'errand' && draft.trigger !== 'arrival' && !draft.start) return setError('Pick a day, or choose “On arrival” only');
    if (draft.type === 'errand' && draft.trigger !== 'time' && !draft.placeQuery.trim()) return setError('Arrival reminders need a place');
    const errand = draft.type === 'errand';
    run('save', () => updateQuickNote(note.id, {
      type:     draft.type,
      title:    draft.title,
      content:  draft.content,
      allDay:   draft.allDay,
      start:    draft.type === 'event' || (errand && draft.trigger !== 'arrival') ? fromInput(draft.start, draft.allDay) : null,
      end:      draft.type === 'event' ? fromInput(draft.end, draft.allDay) : null,
      dueDate:  draft.type === 'reminder' ? fromInput(draft.dueDate, draft.allDay) : null,
      location: draft.location || null,
      linkedRecordingId: draft.type === 'note_link' ? draft.linkedRecordingId : null,
      ...(errand ? {
        trigger:    draft.trigger,
        placeQuery: draft.placeQuery.trim() || null,
        items:      draft.itemsText.split('\n').map(t => t.trim()).filter(Boolean),
      } : {}),
      regenerateSummary: contentChanged && regenSummary && !!note.transcript,
    }));
  }

  const meta = QUICK_TYPES[note.type] || QUICK_TYPES.note;
  const readOnly = note.undone;
  const dateType = draft.allDay ? 'date' : 'datetime-local';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="glass-panel w-full sm:max-w-lg max-h-[92vh] overflow-y-auto p-5 sm:p-6 animate-slide-up rounded-b-none sm:rounded-b-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <span className={`badge ${meta.badge}`}><meta.icon size={11} /> {meta.label}</span>
              {note.status === 'needs_review' && <span className="badge badge-gold">Needs review</span>}
              {note.undone && <span className="badge badge-slate">Undone</span>}
            </div>
            <p className="text-xs text-navy-400 dark:text-white/40">
              Captured {timeAgo(note.capturedAt || note.createdAt)}
              {describeWhen(note) ? ` · ${describeWhen(note)}` : ''}
            </p>
          </div>
          <button
            className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} className="text-navy-600 dark:text-white/60" />
          </button>
        </div>

        {/* Title → AI summary → transcript → audio */}
        <p className="font-semibold text-navy-900 dark:text-white break-words">{note.title}</p>
        <QuickSummary note={note} onChanged={onChanged} />
        <TranscriptToggle transcript={note.transcript} />
        {note.audioFile && <QuickAudio src={quickAudioUrl(note.id)} durationSec={note.durationSec} />}
        {note.error && note.status === 'needs_review' && (
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-3 break-words">{note.error}</p>
        )}
        <div className="divider my-4" />

        {/* Fields */}
        <fieldset disabled={readOnly || !!busy} className="flex flex-col gap-3">
          <div>
            <label className={LABEL}>Type</label>
            <select className={INPUT} value={draft.type} onChange={e => set('type', e.target.value)}>
              {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <label className={LABEL}>Title</label>
            <input className={INPUT} value={draft.title} onChange={e => set('title', e.target.value)} />
          </div>

          {(draft.type === 'event' || draft.type === 'reminder' || (draft.type === 'errand' && draft.trigger !== 'arrival')) && (
            <label className="flex items-center gap-2 text-sm text-navy-700 dark:text-white/80">
              <input type="checkbox" checked={draft.allDay} onChange={e => toggleAllDay(e.target.checked)} />
              {draft.type === 'event' ? 'All day' : 'No specific time'}
            </label>
          )}

          {draft.type === 'errand' && (
            <>
              <div>
                <label className={LABEL}>Remind me</label>
                <select className={INPUT} value={draft.trigger} onChange={e => set('trigger', e.target.value)}>
                  <option value="time">On the day (calendar)</option>
                  <option value="arrival">When I arrive (Android app)</option>
                  <option value="both">Both</option>
                </select>
              </div>
              {draft.trigger !== 'arrival' && (
                <div>
                  <label className={LABEL}>Day</label>
                  <input type={dateType} className={INPUT} value={draft.start} onChange={e => set('start', e.target.value)} />
                </div>
              )}
              <div>
                <label className={LABEL}>Store or place</label>
                <input className={INPUT} value={draft.placeQuery} placeholder="e.g. Publix" onChange={e => set('placeQuery', e.target.value)} />
              </div>
              <div>
                <label className={LABEL}>Items (one per line)</label>
                <textarea className={`${INPUT} min-h-[120px] resize-y`} value={draft.itemsText} onChange={e => set('itemsText', e.target.value)} />
              </div>
            </>
          )}

          {draft.type === 'event' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Start</label>
                  <input type={dateType} className={INPUT} value={draft.start} onChange={e => set('start', e.target.value)} />
                </div>
                <div>
                  <label className={LABEL}>End (optional)</label>
                  <input type={dateType} className={INPUT} value={draft.end} onChange={e => set('end', e.target.value)} />
                </div>
              </div>
              <div>
                <label className={LABEL}>Location</label>
                <input className={INPUT} value={draft.location} onChange={e => set('location', e.target.value)} />
              </div>
            </>
          )}

          {draft.type === 'reminder' && (
            <div>
              <label className={LABEL}>Due</label>
              <input type={dateType} className={INPUT} value={draft.dueDate} onChange={e => set('dueDate', e.target.value)} />
            </div>
          )}

          {draft.type === 'note_link' && (
            <div>
              <label className={LABEL}>Linked recording</label>
              <select className={INPUT} value={draft.linkedRecordingId} onChange={e => set('linkedRecordingId', e.target.value)}>
                <option value="">Choose a recording…</option>
                {recordings.map(r => <option key={r.id} value={r.id}>{r.date} · {r.title}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className={LABEL}>Note</label>
            <textarea className={`${INPUT} min-h-[96px] resize-y`} value={draft.content} onChange={e => set('content', e.target.value)} />
            {contentChanged && note.transcript && (
              <label className="flex items-center gap-2 mt-2 text-sm text-navy-700 dark:text-white/80">
                <input type="checkbox" checked={regenSummary} onChange={e => setRegenSummary(e.target.checked)} />
                Regenerate AI summary with these changes
              </label>
            )}
          </div>
        </fieldset>

        {/* Status */}
        {(note.actions?.length > 0) && (
          <p className="text-xs text-navy-400 dark:text-white/40 mt-3">{note.actions.join(' · ')}</p>
        )}
        {note.linkedRecordingId && (
          <button
            className="mt-2 text-xs font-medium text-indigo-600 dark:text-indigo-300 flex items-center gap-1"
            onClick={() => { onClose(); navigate(`/recordings/${note.linkedRecordingId}`); }}
          >
            <ExternalLink size={12} /> Open linked recording
          </button>
        )}
        {error && <p className="text-sm text-red-500 dark:text-red-400 mt-3">{error}</p>}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 mt-5">
          {!readOnly && (
            <button className="btn-gold text-sm flex items-center gap-1.5" onClick={save} disabled={!!busy}>
              <CheckCircle size={15} className={busy === 'save' ? 'animate-pulse' : ''} />
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
          )}
          {!readOnly && note.status === 'needs_review' && note.audioFile && (
            <button className="btn-ghost text-sm" onClick={() => run('retry', () => retryQuickNote(note.id))} disabled={!!busy}>
              <RotateCcw size={15} className={busy === 'retry' ? 'animate-spin' : ''} />
              {busy === 'retry' ? 'Processing…' : 'Try again'}
            </button>
          )}
          <button className="btn-ghost text-sm" onClick={onClose} disabled={!!busy}>Cancel</button>
          {!readOnly && (
            <button
              className="btn-ghost text-sm ml-auto text-red-500 dark:text-red-400"
              onClick={() => run('undo', () => undoQuickNote(note.id))}
              disabled={!!busy}
            >
              <Undo2 size={15} />
              {busy === 'undo' ? 'Undoing…' : 'Undo capture'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
