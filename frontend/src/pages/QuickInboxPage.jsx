import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Inbox, AlertCircle, CheckSquare, Combine, Trash2, X, FolderInput, Pin, FolderKanban } from 'lucide-react';
import {
  getQuickNotes, getQuickNote, undoQuickNote, restoreQuickNote, summarizeQuickNote, retryQuickNote, setErrandDone,
  setQuickMeta, mergeQuickNote, unmergeQuickNote, moveQuickNote, splitQuickNote, addNotesToProject,
  removeNoteFromProject, getProjects, getSharedWithMe,
} from '../lib/api';
import ShareSheet from '../components/quick/ShareSheet';
import SharedNoteEditor from '../components/quick/SharedNoteEditor';
import { NOTE_UPDATED } from '../lib/opsQueue';
import { isSharedNote } from '../lib/sharing';
import { useLayout } from '../lib/layout';
import TargetPicker from '../components/quick/TargetPicker';
import CombineDialog from '../components/quick/CombineDialog';
import QuickToast from '../components/quick/QuickToast';
import QuickTabs from '../components/quick/QuickTabs';
import QuickNoteEditor from '../components/quick/QuickNoteEditor';
import NoteCard from '../components/quick/NoteCard';
import NoteView from '../components/quick/NoteView';
import { resolveOpenStyle } from '../components/quick/noteHelpers';
import { ArrivalBanner } from '../native/arrival';
import { syncErrands, useArrivalPermission } from '../native/errands';
import { QUICK_TYPES, dayHeader, dayKey } from '../components/quick/quickMeta';
import { useSummaryPolling } from '../hooks/useSummaryPolling';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAppearance } from '../context/appearanceStore';
import { setFabHidden, onQuickChanged } from '../lib/uiBus';
import { shareNote } from '../lib/shareNote';

const FILTERS = [
  { key: 'all',      label: 'All',          test: n => !n.undone },
  { key: 'shared',   label: 'Shared',       test: n => !n.undone && isSharedNote(n) },
  { key: 'review',   label: 'Needs review', test: n => !n.undone && n.status === 'needs_review' },
  { key: 'event',    label: 'Events',       test: n => !n.undone && n.type === 'event' },
  { key: 'reminder', label: 'Reminders',    test: n => !n.undone && n.type === 'reminder' },
  { key: 'errand',   label: 'Errands',      test: n => !n.undone && n.type === 'errand' },
  { key: 'projects', label: 'Projects',     test: n => !n.undone && !!n.projectId },
  { key: 'notes',    label: 'Notes',        test: n => !n.undone && (n.type === 'note' || n.type === 'note_link') },
  { key: 'undone',   label: 'Deleted',      test: n => n.undone },
];

// The Lists page: errands and checklists (yours and shared with you)
const LISTS = { key: 'lists', label: 'Lists', test: n => !n.undone && (n.type === 'errand' || n.format === 'list') };

const capturedAt = n => n.capturedAt || n.createdAt;
const stamp = () => Date.now(); // toast ids
const TYPE_ORDER = ['event', 'reminder', 'errand', 'note_link', 'note'];

function sortNotes(list, sort) {
  const by = {
    newest:  (a, b) => new Date(capturedAt(b)) - new Date(capturedAt(a)),
    oldest:  (a, b) => new Date(capturedAt(a)) - new Date(capturedAt(b)),
    updated: (a, b) => new Date(b.updatedAt || capturedAt(b)) - new Date(a.updatedAt || capturedAt(a)),
    type:    (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || new Date(capturedAt(b)) - new Date(capturedAt(a)),
  };
  return [...list].sort(by[sort] || by.newest);
}

/** Pinned first (optional), then Today / Yesterday / dates — or by type */
function buildSections(list, s) {
  const sorted = sortNotes(list, s.sort);
  const sections = [];
  const pinned = s.pinnedSection ? sorted.filter(n => n.pinned && !n.undone) : [];
  const rest = s.pinnedSection ? sorted.filter(n => !(n.pinned && !n.undone)) : sorted;
  if (pinned.length) sections.push({ key: 'pinned', label: 'Pinned', notes: pinned });
  if (s.sort === 'type') {
    for (const t of TYPE_ORDER) {
      const group = rest.filter(n => n.type === t);
      if (group.length) sections.push({ key: `t-${t}`, label: QUICK_TYPES[t].label + (t === 'note' ? 's' : 's'), notes: group });
    }
  } else if (s.groupByDay) {
    const at = n => (s.sort === 'updated' ? n.updatedAt || capturedAt(n) : capturedAt(n));
    for (const n of rest) {
      const key = dayKey(at(n));
      if (sections.at(-1)?.key !== key) sections.push({ key, label: dayHeader(at(n)), notes: [] });
      sections.at(-1).notes.push(n);
    }
  } else if (rest.length) {
    sections.push({ key: 'all', label: pinned.length ? 'Others' : null, notes: rest });
  }
  return sections;
}

/**
 * sharedOnly: the "Shared with me" page (notes and projects other people shared with you)
 * listsOnly: the Lists page (errands + checklists)
 */
export default function QuickInboxPage({ sharedOnly = false, listsOnly = false }) {
  const { lite } = useLayout();
  const single = sharedOnly || listsOnly; // one fixed view: no filter tabs, no selecting
  const { settings } = useAppearance();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeId } = useParams();               // /quick/:id opens one note
  const [notes, setNotes]     = useState([]);
  const [extra, setExtra]     = useState(null);       // opened note that isn't in the list (hidden / brand new)
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [filter, setFilter]   = useState(() => (sharedOnly ? 'all' : FILTERS.some(f => f.key === settings.behavior.defaultTab) ? settings.behavior.defaultTab : 'all'));
  const [sharing, setSharing] = useState(null);       // note whose share sheet is open
  const [sharedProjects, setSharedProjects] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [expanded, setExpanded]   = useState(() => new Set());
  const [highlightId, setHighlightId] = useState(null);
  const [busy, setBusy] = useState(null);             // { id, kind }
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get('note');           // legacy deep link (?note=) — widget, watch, old calendar links
  const moveId = searchParams.get('move');            // widget / notification "Move"
  const reloadedFor = useRef(null);
  const arrival = useArrivalPermission();
  const [projectNames, setProjectNames] = useState({});
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [picker, setPicker] = useState(null);         // { mode: 'merge'|'project', ids }
  const [combining, setCombining] = useState(false);
  const [toast, setToast] = useState(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const s = settings.inbox;
  const inline = settings.opening.style === 'inline';
  const openMode = resolveOpenStyle(settings.opening.style, isMobile);
  const layout = s.layout;

  const load = useCallback(() => {
    getProjects().then(list => setProjectNames(Object.fromEntries(list.map(p => [p.id, p.name])))).catch(() => {});
    // Your notes + notes other people shared with you (marked with sharedFrom)
    return Promise.all([
      sharedOnly ? Promise.resolve([]) : getQuickNotes(),
      getSharedWithMe().catch(() => ({ notes: [], projects: [] })),
    ])
      .then(([own, shared]) => {
        const ids = new Set(own.map(n => n.id));
        setNotes([...own, ...shared.notes.filter(n => !ids.has(n.id))]);
        setSharedProjects(shared.projects || []);
        setError(null);
      })
      .catch(err => setError(err.message || 'Failed to load quick notes'))
      .finally(() => setLoading(false));
  }, [sharedOnly]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onQuickChanged(() => load()), [load]);
  // Checklist changes saved by the server (lib/opsQueue)
  useEffect(() => {
    const onUpdated = e => { if (e.detail?.id) replace(e.detail); };
    window.addEventListener(NOTE_UPDATED, onUpdated);
    return () => window.removeEventListener(NOTE_UPDATED, onUpdated);
  }, []);
  useSummaryPolling(notes, load);
  useEffect(() => { setFabHidden(selectMode); return () => setFabHidden(false); }, [selectMode]);

  // ── Opening notes ────────────────────────────────────────────────────────
  // Legacy ?note=<id>: open it (or, with "Expand in place", expand + scroll to it)
  const focusNote = focusId && inline && !loading ? notes.find(n => n.id === focusId) : null;
  const [focusedId, setFocusedId] = useState(null);
  if (focusNote && focusedId !== focusId) {
    setFocusedId(focusId);
    setFilter(focusNote.undone ? 'undone' : 'all');
    setExpanded(prev => new Set(prev).add(focusNote.id));
    setHighlightId(focusNote.id);
  } else if (!focusId && focusedId) {
    setFocusedId(null);
  }

  useEffect(() => {
    if (!focusId) return;
    if (!inline) { navigate(`/quick/${focusId}`, { replace: true }); return; }
    if (loading) return;
    if (focusedId === focusId) {
      requestAnimationFrame(() => {
        document.getElementById(`qn-${focusId}`)?.scrollIntoView({ block: 'center' });
      });
      setSearchParams({}, { replace: true });
    } else if (!notes.some(n => n.id === focusId)) {
      if (reloadedFor.current !== focusId) { reloadedFor.current = focusId; load(); }
      else setSearchParams({}, { replace: true });
    }
  }, [focusId, focusedId, inline, loading, notes, load, navigate, setSearchParams]);

  // /quick/:id with "Expand in place" → expand it in the list instead
  useEffect(() => {
    if (routeId && inline) navigate(`/quick/inbox?note=${routeId}`, { replace: true });
  }, [routeId, inline, navigate]);

  const listNote = routeId ? notes.find(n => n.id === routeId) : null;
  const openNote = routeId && !inline ? (listNote || (extra?.id === routeId ? extra : null)) : null;

  // Not in the list (a voice update living inside another note, or just created): fetch it
  useEffect(() => {
    if (!routeId || inline || loading || listNote) return;
    let cancelled = false;
    getQuickNote(routeId)
      .then(n => {
        if (cancelled) return;
        if (n.hidden && n.appliedTo?.id && n.appliedTo.type !== 'project' && n.appliedTo.type !== 'recording') {
          navigate(`/quick/${n.appliedTo.id}`, { replace: true, state: location.state });
        } else setExtra(n);
      })
      .catch(() => { if (!cancelled) { setError('That note could not be found'); navigate('/quick/inbox', { replace: true }); } });
    return () => { cancelled = true; };
  }, [routeId, inline, loading, listNote, navigate, location.state]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map(f => [f.key, notes.filter(f.test).length])),
    [notes],
  );
  const visible = useMemo(() => notes.filter((listsOnly ? LISTS : FILTERS.find(f => f.key === filter)).test), [notes, filter, listsOnly]);
  const sections = useMemo(() => buildSections(visible, s), [visible, s]);
  const order = useMemo(() => sections.flatMap(sec => sec.notes.map(n => n.id)), [sections]);

  function open(note, rect) {
    if (inline) { toggle(note.id); return; }
    const origin = rect ? {
      x: Math.round((rect.left + rect.width / 2 - window.innerWidth / 2) * 0.35),
      y: Math.round((rect.top + rect.height / 2 - window.innerHeight / 2) * 0.35),
    } : null;
    navigate(`/quick/${note.id}`, { state: { fromList: true, origin } });
  }

  const closeNote = useCallback(() => {
    const id = routeId;
    if (location.state?.fromList) navigate(-1);
    else navigate('/quick/inbox', { replace: true });
    setHighlightId(id);
    requestAnimationFrame(() => document.getElementById(`qn-${id}`)?.scrollIntoView({ block: 'nearest' }));
  }, [routeId, location.state, navigate]);

  const idx = routeId ? order.indexOf(routeId) : -1;
  const goTo = useCallback(i => {
    const id = order[i];
    if (id) navigate(`/quick/${id}`, { replace: true, state: { ...(location.state || {}), origin: null } });
  }, [order, navigate, location.state]);
  const onPrev = idx > 0 ? () => goTo(idx - 1) : null;
  const onNext = idx >= 0 && idx < order.length - 1 ? () => goTo(idx + 1) : null;

  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 2500);
    return () => clearTimeout(t);
  }, [highlightId]);

  const editing = editingId ? notes.find(n => n.id === editingId) || (extra?.id === editingId ? extra : null) : null;

  // ── Actions ──────────────────────────────────────────────────────────────
  const undoToast = (icon, text, undo) => setToast({
    id: stamp(), icon, text, tone: 'success', duration: 30000,
    actions: [{ label: 'Undo', onClick: async () => { try { await undo(); } finally { load(); } } }],
  });
  const fail = err => setError(err.response?.data?.error || err.message || 'Something went wrong');

  function replace(updated) {
    setNotes(list => (list.some(n => n.id === updated.id) ? list.map(n => (n.id === updated.id ? updated : n)) : list));
    setExtra(x => (x?.id === updated.id ? updated : x));
  }

  function toggle(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Other people's notes can't be combined, moved or deleted, so they aren't selectable
  function enterSelect(note) { setSelectMode(true); setSelected(new Set(note && !note.sharedFrom ? [note.id] : [])); }
  function exitSelect() { setSelectMode(false); setSelected(new Set()); }
  function toggleSelected(note) {
    if (note.sharedFrom) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(note.id)) next.delete(note.id); else next.add(note.id);
      return next;
    });
  }

  async function run(note, kind, fn) {
    setBusy({ id: note.id, kind });
    try { await fn(); } catch (err) { fail(err); } finally { setBusy(null); }
  }

  async function onAction(kind, note, arg) {
    switch (kind) {
      case 'edit': setEditingId(note.id); return;
      case 'people': setSharing(note); return;
      case 'mergeInto': setPicker({ mode: 'merge', ids: [note.id] }); return;
      case 'addToProject': setPicker({ mode: 'project', ids: [note.id] }); return;
      case 'pin':
        return run(note, kind, async () => replace(await setQuickMeta(note.id, { pinned: !note.pinned })));
      case 'color':
        return run(note, kind, async () => replace(await setQuickMeta(note.id, { color: arg })));
      case 'share':
        return run(note, kind, async () => {
          const r = await shareNote(note);
          if (r === 'copied') setToast({ id: stamp(), icon: '📋', text: 'Copied to the clipboard', tone: 'success' });
        });
      case 'delete':
        if (!window.confirm(`Delete “${note.title}”? Calendar events it created are removed. You can restore it from “Deleted”.`)) return;
        return run(note, kind, async () => {
          replace(await undoQuickNote(note.id));
          setToast({
            id: stamp(), icon: '🗑️', text: 'Note deleted', tone: 'queued', duration: 30000,
            actions: [{ label: 'Undo', onClick: async () => { try { replace(await restoreQuickNote(note.id)); } catch (err) { fail(err); } } }],
          });
        });
      case 'restore':
        return run(note, kind, async () => { replace(await restoreQuickNote(note.id)); setToast({ id: stamp(), icon: '↩️', text: 'Restored', tone: 'success' }); });
      case 'summarize':
        return run(note, kind, async () => replace(await summarizeQuickNote(note.id)));
      case 'retry':
        return run(note, kind, async () => { const r = await retryQuickNote(note.id); replace(r.note || r); load(); });
      case 'done':
        return run(note, kind, async () => { replace(await setErrandDone(note.id, !note.errandDone)); syncErrands(); });
      case 'split':
        return run(note, kind, async () => {
          await splitQuickNote(note.id);
          setToast({ id: stamp(), icon: '✂️', text: 'Split back into separate notes', tone: 'success' });
          load();
        });
      case 'mergePossible':
        return run(note, kind, async () => {
          const m = note.possibleMatch;
          if (m.type === 'project') {
            await addNotesToProject(m.id, [note.id]);
            undoToast('📁', `Added to ${m.title}`, () => removeNoteFromProject(m.id, note.id));
          } else {
            await mergeQuickNote(note.id, { targetType: m.type, targetId: m.id });
            undoToast('🔗', `Merged into ${m.title}`, () => unmergeQuickNote(note.id));
          }
          load();
        });
      default:
    }
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
        if (routeId === ids[0]) navigate(`/quick/${dest.targetId}`, { replace: true, state: location.state });
      }
      exitSelect();
      load();
    } catch (err) { fail(err); }
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (!window.confirm(`Delete ${ids.length} note${ids.length === 1 ? '' : 's'}? Calendar events they created are removed.`)) return;
    try {
      for (const id of ids) await undoQuickNote(id);
      setToast({
        id: stamp(), icon: '🗑️', text: `Deleted ${ids.length} note${ids.length === 1 ? '' : 's'}`, tone: 'queued', duration: 30000,
        actions: [{ label: 'Undo', onClick: async () => { try { for (const id of ids) await restoreQuickNote(id); } finally { load(); } } }],
      });
      exitSelect();
      load();
    } catch (err) { fail(err); }
  }

  function combined(result) {
    setCombining(false);
    exitSelect();
    undoToast('🔗', `Combined ${result.combined} notes`, () => splitQuickNote(result.note.id, result.groupId));
    if (inline) setExpanded(prev => new Set(prev).add(result.note.id));
    load();
  }

  async function moved(dest) {
    const id = moveId;
    setSearchParams({}, { replace: true });
    try {
      const r = await moveQuickNote(id, dest.new ? { new: true } : { targetType: dest.targetType, targetId: dest.targetId });
      setToast({ id: stamp(), icon: r.confirmation?.icon || '↪️', text: r.confirmation?.text || 'Moved', tone: 'success' });
      load();
    } catch (err) { fail(err); }
  }

  const selectedNotes = notes.filter(n => selected.has(n.id));
  const side = openNote && openMode === 'side';
  const width = side ? 'max-w-7xl' : layout === 'grid' ? 'max-w-6xl' : 'max-w-3xl';

  const cardProps = note => ({
    note, layout, inline,
    expanded: expanded.has(note.id),
    highlighted: highlightId === note.id || (side && note.id === routeId),
    projectName: note.projectId ? projectNames[note.projectId] : null,
    selectMode, selected: selected.has(note.id),
    onOpen: open, onSelect: toggleSelected, onLongPress: enterSelect, onAction,
    onChanged: replace, onReload: load, arrivalReady: arrival.ready,
    busy: busy?.id === note.id ? busy.kind : null,
  });

  const list = loading ? (
    <div className={layout === 'grid' ? 'note-masonry' : 'flex flex-col gap-4'}>
      {[0, 1, 2].map(i => <div key={i} className="quick-card h-28 animate-pulse" />)}
    </div>
  ) : visible.length === 0 ? (
    <div className="glass-card p-10 text-center">
      <Inbox size={30} className="mx-auto mb-2 text-navy-200 dark:text-white/20" />
      <p className="text-sm text-navy-600 dark:text-white/50">
        {sharedOnly ? 'Nothing is shared with you yet.'
          : listsOnly ? 'No lists yet. Say “I need milk and eggs from Publix”, or tap + → List.'
          : filter === 'shared' ? 'Nothing shared yet. Open a list or note and tap “Share with…”.'
            : filter === 'review' ? 'Nothing needs review.' : filter === 'undone' ? 'Nothing deleted.' : 'No notes here yet.'}
      </p>
      {!single && filter !== 'shared' && (
        <Link to="/quick" className="inline-block mt-3 text-sm font-semibold text-gold-600 dark:text-gold-400">
          Record a quick note →
        </Link>
      )}
    </div>
  ) : (
    <div className="flex flex-col gap-6">
      {sections.map(sec => (
        <section key={sec.key} aria-label={sec.label || 'Notes'}>
          {sec.label && (
            <h2 className="mb-2.5 px-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-navy-400 dark:text-white/40">
              {sec.key === 'pinned' && <Pin size={12} className="fill-current" />}{sec.label}
            </h2>
          )}
          {layout === 'grid' && !inline ? (
            <div className="note-masonry" style={side ? { columns: 2 } : undefined}>
              {sec.notes.map(note => <NoteCard key={note.id} {...cardProps(note)} />)}
            </div>
          ) : (
            <div className={`flex flex-col ${layout === 'compact' && !inline ? 'gap-1.5' : settings.theme.density === 'compact' ? 'gap-2.5' : 'gap-4'}`}>
              {sec.notes.map(note => <NoteCard key={note.id} {...cardProps(note)} />)}
            </div>
          )}
        </section>
      ))}
    </div>
  );

  const viewProps = openNote && {
    note: openNote,
    projectName: openNote.projectId ? projectNames[openNote.projectId] : null,
    style: settings.opening.style,
    onClose: closeNote, onPrev, onNext, onAction, onChanged: replace, onReload: load,
    busy: busy?.id === openNote.id ? busy.kind : null,
    arrivalReady: arrival.ready,
    origin: location.state?.origin || null,
  };

  return (
    <div className={`p-4 sm:p-6 ${width} mx-auto ${selectMode ? 'pb-32' : 'pb-28'}`}>
      <QuickToast toast={toast} onDismiss={dismissToast} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">{sharedOnly ? 'Shared with me' : listsOnly ? 'Lists' : lite ? 'Inbox' : 'Quick Capture'}</h1>
        {!single && <QuickTabs reviewCount={counts.review} />}
      </div>

      {sharedOnly && (
        <>
          <p className="text-sm text-navy-500 dark:text-white/50 -mt-2 mb-4">
            Lists, notes and projects other people shared with you. Changes show up for everyone right away.
          </p>
          {sharedProjects.length > 0 && (
            <section aria-label="Shared projects" className="mb-6">
              <h2 className="mb-2.5 px-1 text-xs font-semibold uppercase tracking-wider text-navy-400 dark:text-white/40">Projects</h2>
              <div className="flex flex-col gap-2">
                {sharedProjects.map(p => (
                  <Link key={p.id} to={`/projects/${p.id}`} className="quick-card flex items-center gap-3 px-4 py-3">
                    <FolderKanban size={18} className="text-gold-500 shrink-0" />
                    <span className="flex-1 min-w-0 truncate font-semibold text-navy-900 dark:text-white">{p.name}</span>
                    {p.sharedFrom && <span className="text-xs text-navy-500 dark:text-white/50 shrink-0">{p.sharedFrom.name}’s{p.sharedFrom.role === 'view' ? ' · view' : ''}</span>}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {!single && <div className="overflow-x-auto -mx-1 px-1 mb-4">
        <div className="tab-bar w-max">
          {FILTERS.map(f => (
            <button key={f.key} className={`tab-item shrink-0 ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
              {counts[f.key] > 0 && f.key !== 'all' && (
                <span className={`ml-1.5 text-[10px] font-bold ${f.key === 'review' ? 'text-gold-600 dark:text-gold-400' : 'opacity-60'}`}>{counts[f.key]}</span>
              )}
            </button>
          ))}
        </div>
      </div>}

      {!single && (
        <div className="flex justify-end -mt-2 mb-3">
          {selectMode ? (
            <button className="btn-ghost text-sm" onClick={exitSelect}><X size={15} /> Done selecting</button>
          ) : (
            <button className="btn-ghost text-sm" onClick={() => enterSelect(null)}><CheckSquare size={15} /> Select</button>
          )}
        </div>
      )}

      <ArrivalBanner />

      {error && (
        <div className="glass-card p-4 mb-4 flex items-center gap-3">
          <AlertCircle size={18} className="text-red-500 shrink-0" />
          <p className="text-sm text-navy-700 dark:text-white/80">{error}</p>
        </div>
      )}

      {side ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6 items-start">
          <div className="min-w-0">{list}</div>
          <NoteView {...viewProps} />
        </div>
      ) : list}

      {openNote && !side && <NoteView {...viewProps} />}

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

      {editing && (editing.sharedFrom
        ? <SharedNoteEditor note={editing} onClose={() => setEditingId(null)} onChanged={replace} />
        : <QuickNoteEditor note={editing} onClose={() => setEditingId(null)} onChanged={replace} />)}

      {sharing && (
        <ShareSheet
          kind="note"
          id={sharing.id}
          title={sharing.title}
          onClose={() => setSharing(null)}
          onChanged={load}
          onLeft={() => { if (routeId === sharing.id) navigate('/quick/inbox', { replace: true }); load(); }}
        />
      )}
    </div>
  );
}
