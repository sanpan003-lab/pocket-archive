import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Inbox, Pencil, Eye, Undo2, AlertCircle, Link2, Sparkles, ChevronDown, CheckCircle2, RotateCcw,
  FolderKanban, Merge, Split, CheckSquare, Square, Combine, Trash2, X, FolderInput,
} from 'lucide-react';
import {
  getQuickNotes, undoQuickNote, summarizeQuickNote, quickAudioUrl, setErrandDone,
  mergeQuickNote, unmergeQuickNote, moveQuickNote, splitQuickNote, addNotesToProject, removeNoteFromProject, getProjects,
} from '../lib/api';
import AskPrompt from '../components/quick/AskPrompt';
import UpdatesTimeline from '../components/quick/UpdatesTimeline';
import TargetPicker from '../components/quick/TargetPicker';
import CombineDialog from '../components/quick/CombineDialog';
import QuickToast from '../components/quick/QuickToast';
import QuickTabs from '../components/quick/QuickTabs';
import QuickNoteEditor from '../components/quick/QuickNoteEditor';
import QuickSummary, { TranscriptToggle } from '../components/quick/QuickSummary';
import QuickAudio from '../components/quick/QuickAudio';
import ErrandPanel from '../components/quick/ErrandPanel';
import { ArrivalBanner } from '../native/arrival';
import { syncErrands, useArrivalPermission } from '../native/errands';
import {
  QUICK_TYPES, REVIEW_ACCENT, describeWhen, summaryPreview, dayHeader, dayKey, cardTime,
} from '../components/quick/quickMeta';
import { useSummaryPolling } from '../hooks/useSummaryPolling';

const FILTERS = [
  { key: 'all',      label: 'All',          test: n => !n.undone },
  { key: 'review',   label: 'Needs review', test: n => !n.undone && n.status === 'needs_review' },
  { key: 'event',    label: 'Events',       test: n => !n.undone && n.type === 'event' },
  { key: 'reminder', label: 'Reminders',    test: n => !n.undone && n.type === 'reminder' },
  { key: 'errand',   label: 'Errands',      test: n => !n.undone && n.type === 'errand' },
  { key: 'projects', label: 'Projects',     test: n => !n.undone && !!n.projectId },
  { key: 'notes',    label: 'Notes',        test: n => !n.undone && (n.type === 'note' || n.type === 'note_link') },
  { key: 'undone',   label: 'Undone',       test: n => n.undone },
];

const capturedAt = n => n.capturedAt || n.createdAt;

/** Collapsed: what it is + a 3-line preview. Expanded: summary │ transcript + audio │ actions. */
function QuickNoteCard({
  note, expanded, highlighted, onToggle, onEdit, onUndo, undoing, onChanged, arrivalReady,
  projectName, selectMode, selected, onSelect, onLongPress, onAction, onReload,
}) {
  const meta = QUICK_TYPES[note.type] || QUICK_TYPES.note;
  const review = note.status === 'needs_review' && !note.undone;
  const errand = note.type === 'errand';
  const when = describeWhen(note);
  const preview = note.summaryStatus === 'done' ? summaryPreview(note) : '';
  const bodyId = `qn-body-${note.id}`;
  const [regenerating, setRegenerating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const pressTimer = useRef(null);
  const longPressed = useRef(false);
  const pending = note.status === 'pending_decision' && note.pending;

  // Long-press (touch) enters select mode with this note selected
  const startPress = e => {
    if (selectMode || e.pointerType === 'mouse') return;
    longPressed.current = false;
    pressTimer.current = setTimeout(() => { longPressed.current = true; onLongPress(note); navigator.vibrate?.(20); }, 500);
  };
  const cancelPress = () => clearTimeout(pressTimer.current);

  async function toggleDone() {
    setFinishing(true);
    try {
      onChanged(await setErrandDone(note.id, !note.errandDone));
      syncErrands(); // a finished errand stops arrival reminders
    } catch { /* stays as is */ }
    finally { setFinishing(false); }
  }

  async function regenerate() {
    setRegenerating(true);
    try { onChanged(await summarizeQuickNote(note.id)); }
    catch { /* QuickSummary shows the failed state on the next refresh */ }
    finally { setRegenerating(false); }
  }

  return (
    <article
      id={`qn-${note.id}`}
      className={`quick-card animate-fade-in min-w-0 scroll-mt-24 ${highlighted ? 'quick-card-highlight' : ''} ${note.undone ? 'opacity-60' : ''} ${errand && note.errandDone && !note.undone ? 'opacity-80' : ''} ${selected ? 'quick-card-highlight' : ''}`}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={e => { if (longPressed.current) e.preventDefault(); }}
    >
      <span className="quick-card-accent" style={{ background: review ? REVIEW_ACCENT : meta.color }} aria-hidden="true" />

      {/* Header: tap anywhere to expand / collapse */}
      <button
        type="button"
        className="w-full text-left pl-5 pr-4 pt-4 pb-3 sm:pl-6 sm:pr-5"
        onClick={() => {
          if (longPressed.current) { longPressed.current = false; return; }
          if (selectMode) onSelect(note); else onToggle();
        }}
        aria-expanded={selectMode ? undefined : expanded}
        aria-controls={selectMode ? undefined : bodyId}
        aria-pressed={selectMode ? selected : undefined}
        aria-label={selectMode ? `${selected ? 'Deselect' : 'Select'} ${note.title}` : undefined}
      >
        <div className="flex items-start gap-2">
          {selectMode && (
            selected
              ? <CheckSquare size={22} className="shrink-0 text-gold-500 -ml-1 mt-0.5" aria-hidden="true" />
              : <Square size={22} className="shrink-0 text-navy-300 dark:text-white/30 -ml-1 mt-0.5" aria-hidden="true" />
          )}
          <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
            <span className={`badge ${meta.badge}`}><meta.icon size={11} /> {meta.label}</span>
            {review && <span className="badge badge-orange">Needs review</span>}
            {pending && <span className="badge badge-gold">Waiting for your answer</span>}
            {note.undone && <span className="badge badge-slate">Undone</span>}
            {projectName && <span className="badge badge-gold"><FolderKanban size={11} /> {projectName}</span>}
            {(note.updates || []).length > 0 && <span className="badge badge-slate">Updated {note.updates.length}×</span>}
            {note.actions?.length > 0 && !note.undone && (
              <span className="text-xs text-navy-400 dark:text-white/45 truncate min-w-0 max-w-full">
                {note.actions.join(' · ')}
              </span>
            )}
          </div>
          <span className="shrink-0 flex items-center gap-1 text-xs text-navy-400 dark:text-white/45 pt-1">
            {cardTime(capturedAt(note))}
            <ChevronDown size={16} className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
          </span>
        </div>

        <p className="mt-2 font-semibold text-base text-navy-900 dark:text-white break-words">{note.title}</p>
        {when && !errand && (
          <p className="text-sm text-navy-600 dark:text-white/60 mt-0.5">{when}{note.location ? ` · ${note.location}` : ''}</p>
        )}

        {!expanded && !errand && (
          note.summaryStatus === 'pending' ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-gold-600 dark:text-gold-400">
              <Sparkles size={12} className="animate-pulse" /> Summarizing…
            </p>
          ) : preview ? (
            <p className="mt-2 text-sm leading-relaxed text-navy-700 dark:text-white/70 line-clamp-3 break-words">{preview}</p>
          ) : note.transcript ? (
            <p className="mt-2 text-sm italic leading-relaxed text-navy-500 dark:text-white/50 line-clamp-3 break-words">“{note.transcript}”</p>
          ) : null
        )}
      </button>

      {pending && !selectMode && (
        <div className="pl-5 pr-4 pb-3 sm:pl-6 sm:pr-5"><AskPrompt note={note} compact onResolved={() => onReload()} /></div>
      )}
      {note.possibleMatch && !note.undone && !selectMode && (
        <div className="pl-5 pr-4 pb-3 sm:pl-6 sm:pr-5 flex flex-wrap items-center gap-2">
          <span className="badge badge-gold">Possible match: {note.possibleMatch.title}</span>
          <button className="btn-ghost text-xs" onClick={() => onAction('mergePossible', note)}><Merge size={13} /> Merge</button>
        </div>
      )}

      {/* Errand: place, chips and the checklist are always visible */}
      {errand && <ErrandPanel note={note} onChanged={onChanged} arrivalReady={arrivalReady} />}

      {expanded && (
        <div id={bodyId} className="pl-5 pr-4 pb-2 sm:pl-6 sm:pr-5 animate-fade-in">
          {/* Summary */}
          {note.summaryStatus && note.summaryStatus !== 'none' && (
            <section className={`pb-3 ${errand ? 'quick-card-divider pt-1' : ''}`}>
              <QuickSummary note={note} onChanged={onChanged} />
            </section>
          )}

          {(note.updates || []).length > 0 && (
            <section className="quick-card-divider py-3"><UpdatesTimeline note={note} defaultOpen /></section>
          )}

          {/* Transcript + audio */}
          {(note.transcript || note.error || note.linkedRecordingId || note.audioFile) && (
            <section className="quick-card-divider py-3">
              <TranscriptToggle transcript={note.transcript} />
              {!note.transcript && note.error && (
                <p className="text-xs text-amber-700 dark:text-amber-300 break-words">{note.error}</p>
              )}
              {note.linkedRecordingId && (
                <Link
                  to={`/recordings/${note.linkedRecordingId}`}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-300"
                >
                  <Link2 size={12} /> Open linked recording
                </Link>
              )}
              {note.audioFile && <QuickAudio src={quickAudioUrl(note.id)} durationSec={note.durationSec} />}
            </section>
          )}

          {/* Actions */}
          <section className="quick-card-divider pt-2">
            <div className="flex">
              <button type="button" className="quick-card-action flex-1" onClick={() => onEdit(note)}>
                {note.undone ? <Eye size={18} /> : <Pencil size={18} />}
                {note.undone ? 'View' : 'Edit'}
              </button>
              {errand && !note.undone && (
                <button type="button" className="quick-card-action flex-1" onClick={toggleDone} disabled={finishing}>
                  {note.errandDone ? <RotateCcw size={18} /> : <CheckCircle2 size={18} />}
                  {note.errandDone ? 'Reopen' : 'Mark done'}
                </button>
              )}
              {!note.undone && note.transcript && (
                <button
                  type="button"
                  className="quick-card-action flex-1"
                  title="Regenerate the AI summary"
                  onClick={regenerate}
                  disabled={regenerating || note.summaryStatus === 'pending'}
                >
                  <Sparkles size={18} className={regenerating ? 'animate-pulse' : ''} />
                  {regenerating ? 'Working…' : 'Summarize'}
                </button>
              )}
              {!note.undone && (
                <button type="button" className="quick-card-action danger flex-1" onClick={() => onUndo(note)} disabled={undoing}>
                  <Undo2 size={18} />
                  {undoing ? 'Undoing…' : 'Undo'}
                </button>
              )}
            </div>
            {!note.undone && (
              <div className="flex">
                <button type="button" className="quick-card-action flex-1" onClick={() => onAction('mergeInto', note)}>
                  <Merge size={18} /> Merge into…
                </button>
                <button type="button" className="quick-card-action flex-1" onClick={() => onAction('addToProject', note)}>
                  <FolderInput size={18} /> {note.projectId ? 'Move project…' : 'Add to project…'}
                </button>
                {(note.combinedGroups || []).length > 0 && (
                  <button type="button" className="quick-card-action flex-1" onClick={() => onAction('split', note)}>
                    <Split size={18} /> Split back
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </article>
  );
}

export default function QuickInboxPage() {
  const [notes, setNotes]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [filter, setFilter]   = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [undoingId, setUndoingId] = useState(null);
  const [expanded, setExpanded]   = useState(() => new Set());
  const [highlightId, setHighlightId] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get('note');
  // ?move=<captureId> (widget / notification "Move"): pick where that capture should go instead
  const moveId = searchParams.get('move');
  const reloadedFor = useRef(null);
  const arrival = useArrivalPermission();
  const [projectNames, setProjectNames] = useState({});
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [picker, setPicker] = useState(null);       // { mode: 'merge'|'project', ids }
  const [combining, setCombining] = useState(false);
  const [toast, setToast] = useState(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const load = useCallback(() => {
    getProjects().then(list => setProjectNames(Object.fromEntries(list.map(p => [p.id, p.name])))).catch(() => {});
    return getQuickNotes()
      .then(list => { setNotes(list); setError(null); })
      .catch(err => setError(err.message || 'Failed to load quick notes'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useSummaryPolling(notes, load);

  // Deep link (?note=<id>, e.g. from the Android widget): expand, scroll to and highlight that note.
  // Expanding happens while rendering (React's "adjust state on prop change" pattern)…
  const focusNote = focusId && !loading ? notes.find(n => n.id === focusId) : null;
  const [focusedId, setFocusedId] = useState(null);
  if (focusNote && focusedId !== focusId) {
    setFocusedId(focusId);
    setFilter(focusNote.undone ? 'undone' : 'all');
    setExpanded(prev => new Set(prev).add(focusNote.id));
    setHighlightId(focusNote.id);
  } else if (!focusId && focusedId) {
    setFocusedId(null);
  }

  // …then scroll once the card is on screen, and drop ?note= from the URL
  useEffect(() => {
    if (!focusId || loading) return;
    if (focusedId === focusId) {
      requestAnimationFrame(() => {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        document.getElementById(`qn-${focusId}`)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      });
      setSearchParams({}, { replace: true });
    } else if (!notes.some(n => n.id === focusId)) {
      // Captured after this list was loaded? Reload once, then give up quietly
      if (reloadedFor.current !== focusId) {
        reloadedFor.current = focusId;
        load();
      } else {
        setSearchParams({}, { replace: true });
      }
    }
  }, [focusId, focusedId, loading, notes, load, setSearchParams]);

  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 2500);
    return () => clearTimeout(t);
  }, [highlightId]);

  // The editor always shows the latest copy (summaries update while it's open)
  const editing = editingId ? notes.find(n => n.id === editingId) : null;

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map(f => [f.key, notes.filter(f.test).length])),
    [notes],
  );
  const visible = useMemo(() => notes.filter(FILTERS.find(f => f.key === filter).test), [notes, filter]);

  // "Today", "Yesterday", then dates. Sorted by when it was recorded: a note
  // queued offline can reach the server days after it was captured.
  const groups = useMemo(() => {
    const out = [];
    const sorted = [...visible].sort((a, b) => new Date(capturedAt(b)) - new Date(capturedAt(a)));
    for (const note of sorted) {
      const key = dayKey(capturedAt(note));
      if (out.at(-1)?.key !== key) out.push({ key, label: dayHeader(capturedAt(note)), notes: [] });
      out.at(-1).notes.push(note);
    }
    return out;
  }, [visible]);

  // ── Select mode, Merge into…, Add to project…, Combine ───────────────────
  const undoToast = (icon, text, undo) => setToast({
    id: Date.now(), icon, text, tone: 'success', duration: 30000,
    actions: [{ label: 'Undo', onClick: async () => { try { await undo(); } finally { load(); } } }],
  });
  const fail = err => setError(err.response?.data?.error || err.message || 'Something went wrong');

  function enterSelect(note) {
    setSelectMode(true);
    setSelected(new Set(note ? [note.id] : []));
  }
  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }
  function toggleSelected(note) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(note.id)) next.delete(note.id); else next.add(note.id);
      return next;
    });
  }

  async function onAction(kind, note) {
    try {
      if (kind === 'mergeInto') setPicker({ mode: 'merge', ids: [note.id] });
      else if (kind === 'addToProject') setPicker({ mode: 'project', ids: [note.id] });
      else if (kind === 'mergePossible') {
        const m = note.possibleMatch;
        if (m.type === 'project') {
          await addNotesToProject(m.id, [note.id]);
          undoToast('📁', `Added to ${m.title}`, () => removeNoteFromProject(m.id, note.id));
        } else {
          await mergeQuickNote(note.id, { targetType: m.type, targetId: m.id });
          undoToast('🔗', `Merged into ${m.title}`, () => unmergeQuickNote(note.id));
        }
        load();
      } else if (kind === 'split') {
        await splitQuickNote(note.id);
        setToast({ id: Date.now(), icon: '✂️', text: 'Split back into separate notes', tone: 'success' });
        load();
      }
    } catch (err) { fail(err); }
  }

  async function picked(dest) {
    const { mode, ids } = picker;
    setPicker(null);
    try {
      if (mode === 'project') {
        const before = Object.fromEntries(ids.map(id => [id, notes.find(n => n.id === id)?.projectId || null]));
        await addNotesToProject(dest.targetId, ids);
        undoToast('📁', `Added ${ids.length === 1 ? '1 note' : `${ids.length} notes`} to ${dest.title}`, async () => {
          for (const id of ids) {
            await removeNoteFromProject(dest.targetId, id);
            if (before[id]) await addNotesToProject(before[id], [id]);
          }
        });
      } else {
        await mergeQuickNote(ids[0], { targetType: dest.targetType, targetId: dest.targetId });
        undoToast('🔗', `Merged into ${dest.title}`, () => unmergeQuickNote(ids[0]));
      }
      exitSelect();
      load();
    } catch (err) { fail(err); }
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (!window.confirm(`Undo ${ids.length} capture${ids.length === 1 ? '' : 's'}? Calendar events they created are removed.`)) return;
    try {
      for (const id of ids) await undoQuickNote(id);
      setToast({ id: Date.now(), icon: '🗑️', text: `Removed ${ids.length} note${ids.length === 1 ? '' : 's'}`, detail: 'Find them under “Undone”', tone: 'queued' });
      exitSelect();
      load();
    } catch (err) { fail(err); }
  }

  function combined(result) {
    setCombining(false);
    exitSelect();
    undoToast('🔗', `Combined ${result.combined} notes`, () => splitQuickNote(result.note.id, result.groupId));
    setExpanded(prev => new Set(prev).add(result.note.id));
    load();
  }

  async function moved(dest) {
    const id = moveId;
    setSearchParams({}, { replace: true });
    try {
      const r = await moveQuickNote(id, dest.new ? { new: true } : { targetType: dest.targetType, targetId: dest.targetId });
      setToast({ id: Date.now(), icon: r.confirmation?.icon || '↪️', text: r.confirmation?.text || 'Moved', tone: 'success' });
      load();
    } catch (err) { fail(err); }
  }

  const selectedNotes = notes.filter(n => selected.has(n.id));

  function replace(updated) {
    setNotes(list => list.map(n => (n.id === updated.id ? updated : n)));
  }

  function toggle(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    <div className={`p-4 sm:p-6 max-w-3xl mx-auto ${selectMode ? 'pb-32' : ''}`}>
      <QuickToast toast={toast} onDismiss={dismissToast} />
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

      <div className="flex justify-end -mt-2 mb-3">
        {selectMode ? (
          <button className="btn-ghost text-sm" onClick={exitSelect}><X size={15} /> Done selecting</button>
        ) : (
          <button className="btn-ghost text-sm" onClick={() => enterSelect(null)}><CheckSquare size={15} /> Select</button>
        )}
      </div>

      <ArrivalBanner />

      {error && (
        <div className="glass-card p-4 mb-4 flex items-center gap-3">
          <AlertCircle size={18} className="text-red-500 shrink-0" />
          <p className="text-sm text-navy-700 dark:text-white/80">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map(i => <div key={i} className="quick-card h-28 animate-pulse" />)}
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
        <div className="flex flex-col gap-6">
          {groups.map(group => (
            <section key={group.key} aria-label={group.label}>
              <h2 className="mb-2.5 px-1 text-xs font-semibold uppercase tracking-wider text-navy-400 dark:text-white/40">
                {group.label}
              </h2>
              <div className="flex flex-col gap-4">
                {group.notes.map(note => (
                  <QuickNoteCard
                    key={note.id}
                    note={note}
                    expanded={expanded.has(note.id)}
                    highlighted={highlightId === note.id}
                    onToggle={() => toggle(note.id)}
                    onEdit={n => setEditingId(n.id)}
                    onUndo={handleUndo}
                    undoing={undoingId === note.id}
                    onChanged={replace}
                    arrivalReady={arrival.ready}
                    projectName={note.projectId ? projectNames[note.projectId] : null}
                    selectMode={selectMode}
                    selected={selected.has(note.id)}
                    onSelect={toggleSelected}
                    onLongPress={enterSelect}
                    onAction={onAction}
                    onReload={load}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Selection bar */}
      {selectMode && (
        <div className="fixed inset-x-0 bottom-0 z-[140] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 pointer-events-none">
          <div className="pointer-events-auto max-w-3xl mx-auto rounded-2xl border border-navy-200 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-xl p-2" role="toolbar" aria-label={`${selected.size} selected`}>
            <p className="text-xs font-semibold text-navy-500 dark:text-white/50 px-2 pb-1">{selected.size} selected</p>
            <div className="grid grid-cols-4 gap-1">
              <button className="quick-card-action" onClick={() => setCombining(true)} disabled={selected.size < 2}>
                <Combine size={18} /> Combine{selected.size >= 2 ? ` (${selected.size})` : ''}
              </button>
              <button className="quick-card-action" onClick={() => setPicker({ mode: 'project', ids: [...selected] })} disabled={!selected.size}>
                <FolderInput size={18} /> Add to project…
              </button>
              <button className="quick-card-action danger" onClick={deleteSelected} disabled={!selected.size}>
                <Trash2 size={18} /> Delete
              </button>
              <button className="quick-card-action" onClick={exitSelect}>
                <X size={18} /> Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {picker && (
        <TargetPicker
          title={picker.mode === 'project' ? 'Add to project…' : 'Merge into…'}
          types={picker.mode === 'project' ? ['project'] : ['note', 'errand', 'event', 'reminder']}
          exclude={picker.ids[0]}
          allowNewProject={picker.mode === 'project'}
          onClose={() => setPicker(null)}
          onPick={picked}
        />
      )}
      {moveId && (
        <TargetPicker title="Move it to…" allowNewNote onClose={() => setSearchParams({}, { replace: true })} onPick={moved} />
      )}
      {combining && <CombineDialog notes={selectedNotes} onClose={() => setCombining(false)} onDone={combined} />}

      {editing && (
        <QuickNoteEditor
          note={editing}
          onClose={() => setEditingId(null)}
          onChanged={replace}
        />
      )}
    </div>
  );
}
