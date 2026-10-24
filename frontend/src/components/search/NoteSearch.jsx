import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, X, SlidersHorizontal, Mic, Loader2, History, ListChecks, FolderKanban, Image as ImageIcon, Mic2, Zap, Users,
  Paperclip, CheckCircle2, ChevronDown,
} from 'lucide-react';
import { findNotes, getProjects } from '../../lib/api';
import { useLayout } from '../../lib/layout';
import { DOC_TYPES } from '../../lib/documents';
import { getRecent, addRecent, removeRecent, clearRecent } from '../../lib/recentSearches';
import { useVoiceSearch } from '../../lib/voiceSearch';
import { QUICK_TYPES, timeAgo } from '../quick/quickMeta';
import Highlight from '../Highlight';

const GROUPS = [
  ['notes', 'Notes'], ['lists', 'Lists'], ['documents', 'Documents'], ['projects', 'Projects'], ['actions', 'Actions'], ['recordings', 'Recordings'],
];
const RANGES = [['any', 'Any time'], ['today', 'Today'], ['week', 'Last 7 days'], ['month', 'Last 30 days'], ['year', 'This year'], ['custom', 'Pick dates']];
const CATEGORIES = [...new Set(Object.values(DOC_TYPES).map(t => t.category))];
const EMPTY = { types: [], range: 'any', from: '', to: '', project: '', scope: 'all', attach: false, category: '', status: '' };
const day = d => d.toLocaleDateString('en-CA');

function rangeDates(f) {
  const now = new Date();
  if (f.range === 'today') return { from: day(now) };
  if (f.range === 'week') return { from: day(new Date(now - 6 * 86400000)) };
  if (f.range === 'month') return { from: day(new Date(now - 29 * 86400000)) };
  if (f.range === 'year') return { from: `${now.getFullYear()}-01-01` };
  if (f.range === 'custom') return { from: f.from || undefined, to: f.to || undefined };
  return {};
}

/** The /api/find query for the words + filters (undefined values are left out) */
function paramsOf(q, f, archive) {
  const p = {
    q: q.trim() || undefined, type: f.types.length ? f.types.join(',') : undefined, ...rangeDates(f),
    project: f.project || undefined, scope: f.scope !== 'all' ? f.scope : undefined, attach: f.attach ? '1' : undefined,
    category: f.category || undefined, status: f.status || undefined, recordings: archive ? '1' : undefined,
  };
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== ''));
}

const filterCount = f => (f.types.length ? 1 : 0) + (f.range !== 'any' ? 1 : 0) + (f.project ? 1 : 0) + (f.scope !== 'all' ? 1 : 0)
  + (f.attach ? 1 : 0) + (f.category ? 1 : 0) + (f.status ? 1 : 0);

function whenLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (Date.now() - d.getTime() < 86400000) return timeAgo(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

function pathOf(r) {
  if (r.kind === 'projects') return `/projects/${r.id}`;
  if (r.kind === 'recordings') return `/recordings/${r.id}`;
  return `/quick/${r.id}`;
}

function ResultIcon({ r }) {
  if (r.kind === 'documents') return <span className="text-lg leading-none" aria-hidden="true">{r.document?.icon || '📄'}</span>;
  const Icon = r.kind === 'projects' ? FolderKanban : r.kind === 'recordings' ? Mic2 : r.kind === 'actions' ? Zap
    : r.kind === 'lists' ? ListChecks : r.hasMedia ? ImageIcon : (QUICK_TYPES[r.type] || QUICK_TYPES.note).icon;
  const color = r.kind === 'projects' ? '#6366F1' : r.kind === 'recordings' ? '#F59E0B' : (QUICK_TYPES[r.type] || QUICK_TYPES.note).color;
  return <Icon size={17} style={{ color }} aria-hidden="true" />;
}

function Result({ r, terms, onOpen }) {
  const meta = [
    r.matchedIn && `in ${r.matchedIn}`,
    r.kind === 'projects' && `${r.notes ?? 0} note${r.notes === 1 ? '' : 's'}`,
    r.projectName && `📁 ${r.projectName}`,
    r.document?.category && r.kind === 'documents' && r.document.category,
    r.attachments > 0 && `${r.attachments} attachment${r.attachments === 1 ? '' : 's'}`,
    whenLabel(r.capturedAt || r.date || r.createdAt),
  ].filter(Boolean);
  return (
    <li>
      <button type="button" onClick={() => onOpen(r)} data-search-result={r.kind}
        className="quick-card w-full text-left flex items-start gap-3 px-3.5 py-3 min-h-[56px] hover:border-gold-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500">
        <span className="w-6 shrink-0 flex justify-center mt-0.5"><ResultIcon r={r} /></span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="font-semibold text-navy-900 dark:text-white break-words min-w-0"><Highlight text={r.title} terms={terms} /></span>
            {r.done && <CheckCircle2 size={14} className="shrink-0 text-emerald-500" aria-label="Done" />}
          </span>
          {r.snippet && <span className="block text-sm text-navy-600 dark:text-white/65 line-clamp-2 break-words"><Highlight text={r.snippet} terms={terms} /></span>}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-xs text-navy-400 dark:text-white/45">
            {r.sharedFrom && <span className="inline-flex items-center gap-1 text-gold-700 dark:text-gold-300"><Users size={11} /> {r.sharedFrom.name ? `From ${r.sharedFrom.name}` : 'Shared with you'}</span>}
            {meta.map((m, i) => <span key={i}>{m}</span>)}
          </span>
        </span>
      </button>
    </li>
  );
}

function Chip({ on, onClick, children, label }) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} onClick={onClick}
      className={`min-h-[36px] px-3 rounded-xl text-sm font-medium border transition-colors ${on
        ? 'bg-gold-500/15 border-gold-400 text-gold-800 dark:text-gold-200'
        : 'border-navy-200 dark:border-white/15 text-navy-600 dark:text-white/70 hover:border-gold-300'}`}>
      {children}
    </button>
  );
}

function Filters({ f, setF, preset, archive }) {
  const [projects, setProjects] = useState(null);
  useEffect(() => { getProjects().then(l => setProjects(Array.isArray(l) ? l : [])).catch(() => setProjects([])); }, []);
  const toggleType = t => setF(x => ({ ...x, types: x.types.includes(t) ? x.types.filter(y => y !== t) : [...x.types, t] }));
  const types = GROUPS.filter(([k]) => (k !== 'recordings' || archive) && (k !== 'actions' || preset.types?.includes('actions')));
  const label = 'text-[11px] font-bold uppercase tracking-wider text-navy-400 dark:text-white/45 mb-1.5';
  return (
    <div className="mt-2 rounded-2xl border border-navy-100 dark:border-white/10 p-3 space-y-3 bg-white/60 dark:bg-white/[0.03]" data-search-filters="">
      <div>
        <p className={label}>Type</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip on={!f.types.length} onClick={() => setF(x => ({ ...x, types: [] }))}>All</Chip>
          {types.map(([k, l]) => <Chip key={k} on={f.types.includes(k)} onClick={() => toggleType(k)}>{l}</Chip>)}
        </div>
      </div>
      <div>
        <p className={label}>When</p>
        <div className="flex flex-wrap gap-1.5">
          {RANGES.map(([k, l]) => <Chip key={k} on={f.range === k} onClick={() => setF(x => ({ ...x, range: k }))}>{l}</Chip>)}
        </div>
        {f.range === 'custom' && (
          <div className="flex flex-wrap items-center gap-2 mt-2 text-sm">
            <label className="flex items-center gap-1.5">From <input type="date" className="search-input !py-1.5 !w-auto" value={f.from} onChange={e => setF(x => ({ ...x, from: e.target.value }))} /></label>
            <label className="flex items-center gap-1.5">To <input type="date" className="search-input !py-1.5 !w-auto" value={f.to} onChange={e => setF(x => ({ ...x, to: e.target.value }))} /></label>
          </div>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className={`block ${label}`}>Project</span>
          <select className="search-input !py-2" value={f.project} onChange={e => setF(x => ({ ...x, project: e.target.value }))}>
            <option value="">Any project</option>
            <option value="none">Not in a project</option>
            {(projects || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={`block ${label}`}>Document category</span>
          <select className="search-input !py-2" value={f.category} onChange={e => setF(x => ({ ...x, category: e.target.value }))}>
            <option value="">Any</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <div>
          <p className={label}>Whose</p>
          <div className="flex flex-wrap gap-1.5">
            {[['all', 'All'], ['mine', 'Mine'], ['shared', 'Shared with me']].map(([k, l]) => <Chip key={k} on={f.scope === k} onClick={() => setF(x => ({ ...x, scope: k }))}>{l}</Chip>)}
          </div>
        </div>
        <div>
          <p className={label}>Status</p>
          <div className="flex flex-wrap gap-1.5">
            {[['', 'Any'], ['open', 'Open'], ['done', 'Done']].map(([k, l]) => <Chip key={k || 'any'} on={f.status === k} onClick={() => setF(x => ({ ...x, status: k }))}>{l}</Chip>)}
          </div>
        </div>
        <div>
          <p className={label}>Attachments</p>
          <Chip on={f.attach} onClick={() => setF(x => ({ ...x, attach: !x.attach }))}><Paperclip size={13} className="inline -mt-0.5" /> Has attachment</Chip>
        </div>
      </div>
    </div>
  );
}

/**
 * Search your notes, lists, documents, projects (+ shared with you; recordings for the archive admin).
 * variant: 'bar' (top of a page — onActiveChange hides the page while results show), 'overlay' (global), 'page'.
 * preset: filters this page starts with (e.g. { types: ['documents'] } on Documents, { scope: 'shared' } on Shared).
 */
export default function NoteSearch({ variant = 'bar', preset = {}, placeholder, onActiveChange, onClose, autoFocus = false }) {
  const navigate = useNavigate();
  const { archive } = useLayout();
  const base = useMemo(() => ({ ...EMPTY, ...preset }), [preset]);
  const [q, setQ] = useState('');
  const [f, setF] = useState(base);
  const [showFilters, setShowFilters] = useState(false);
  const [focused, setFocused] = useState(autoFocus);
  const [recent, setRecent] = useState(getRecent);
  const [data, setData] = useState(null);      // { key, res } | { key, error }
  const [more, setMore] = useState({});
  const input = useRef(null);
  const blurTimer = useRef(null);

  const presetCount = filterCount(base);
  const count = filterCount(f);
  const changedFilters = JSON.stringify(f) !== JSON.stringify(base);
  const active = q.trim().length >= 2 || (changedFilters && count > 0);
  const params = useMemo(() => paramsOf(q, f, archive), [q, f, archive]);
  const key = JSON.stringify(params);

  useEffect(() => { onActiveChange?.(active); }, [active, onActiveChange]);

  // Instant results: 220 ms after the last key, the previous request cancelled
  useEffect(() => {
    if (!active) return undefined;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      findNotes(params, ctl.signal)
        .then(res => setData({ key, res }))
        .catch(err => { if (err.name !== 'CanceledError' && err.code !== 'ERR_CANCELED') setData({ key, error: err.response?.data?.error || 'Search isn’t available right now' }); });
    }, 220);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [active, key, params]);

  const voice = useVoiceSearch(useCallback(text => { setQ(text); setRecent(addRecent(text)); input.current?.focus(); }, []));
  const res = data?.key === key ? data.res : null;
  const error = data?.key === key ? data.error : null;
  const loading = active && !res && !error;
  const terms = res?.terms || [];
  const total = res ? GROUPS.reduce((n, [g]) => n + (res.groups[g]?.length || 0), 0) : 0;

  function open(r) {
    if (q.trim().length >= 2) setRecent(addRecent(q));
    // A page's own bar: back to the page with the note open
    if (variant === 'bar') { setQ(''); setF(base); setMore({}); }
    onClose?.();
    navigate(pathOf(r));
  }
  function clearAll() { setQ(''); setF(base); setMore({}); input.current?.focus(); }
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (q || changedFilters) clearAll();
      else if (onClose) onClose();
      else input.current?.blur();
    } else if (e.key === 'Enter') {
      if (q.trim().length >= 2) setRecent(addRecent(q));
      input.current?.blur();
    }
  }

  const showIdle = focused && !active;
  const shortcuts = [
    ['Receipts', () => setF(x => ({ ...x, category: 'Receipts' }))],
    ['Open lists', () => setF(x => ({ ...x, types: ['lists'], status: 'open' }))],
    ['With attachments', () => setF(x => ({ ...x, attach: true }))],
    ['This week', () => setF(x => ({ ...x, range: 'week' }))],
    ['Shared with me', () => setF(x => ({ ...x, scope: 'shared' }))],
  ].filter(([l]) => !(l === 'Shared with me' && base.scope === 'shared') && !(l === 'Open lists' && base.types.length));

  return (
    <div className={variant === 'bar' ? 'mb-4' : ''} data-note-search={variant}>
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-400 dark:text-white/40 pointer-events-none" />
          <input
            ref={input}
            type="search"
            className="search-input pl-10 pr-20 text-base"
            placeholder={voice.state === 'listening' ? 'Listening… tap the mic to stop' : placeholder || 'Search notes, lists, documents…'}
            aria-label={placeholder || 'Search notes'}
            autoComplete="off"
            enterKeyHint="search"
            autoFocus={autoFocus}
            value={q}
            onChange={e => { setQ(e.target.value); setMore({}); }}
            onKeyDown={onKeyDown}
            onFocus={() => { clearTimeout(blurTimer.current); setFocused(true); setRecent(getRecent()); }}
            onBlur={() => { blurTimer.current = setTimeout(() => setFocused(false), 200); }}
          />
          <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center">
            {(q || changedFilters) && (
              <button type="button" className="w-10 h-11 flex items-center justify-center text-navy-400 hover:text-navy-700 dark:text-white/50 dark:hover:text-white" onClick={clearAll} aria-label="Clear search"><X size={17} /></button>
            )}
            {voice.supported && (
              <button type="button" onClick={voice.start} aria-label={voice.state === 'listening' ? 'Stop listening' : 'Search by voice'} aria-pressed={voice.state === 'listening'}
                className={`w-10 h-11 flex items-center justify-center rounded-r-xl ${voice.state === 'listening' ? 'text-red-500 animate-pulse' : 'text-navy-400 hover:text-gold-600 dark:text-white/50 dark:hover:text-gold-300'}`}>
                {voice.state === 'working' ? <Loader2 size={17} className="animate-spin" /> : <Mic size={17} />}
              </button>
            )}
          </div>
        </div>
        <button type="button" onClick={() => setShowFilters(s => !s)} aria-expanded={showFilters} aria-label={`Filters${count ? ` (${count} on)` : ''}`}
          className={`relative shrink-0 w-11 h-11 rounded-xl border flex items-center justify-center ${showFilters || count > presetCount ? 'border-gold-400 bg-gold-500/10 text-gold-700 dark:text-gold-300' : 'border-navy-200 dark:border-white/15 text-navy-500 dark:text-white/60'}`}>
          <SlidersHorizontal size={17} />
          {count > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-gold-500 text-[11px] font-bold text-white flex items-center justify-center">{count}</span>}
        </button>
      </div>
      {voice.error && <p className="text-xs text-red-600 dark:text-red-400 mt-1.5" role="alert">{voice.error}</p>}
      {showFilters && <Filters f={f} setF={setF} preset={base} archive={archive} />}

      {/* Completions from your own data */}
      {active && res?.suggestions?.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto mt-2 pb-1 -mx-1 px-1" aria-label="Suggestions">
          {res.suggestions.map(s => (
            <button key={s.text} type="button" className="shrink-0 min-h-[32px] px-2.5 rounded-lg bg-navy-50 dark:bg-white/5 text-xs text-navy-700 dark:text-white/75 hover:bg-gold-500/10"
              onClick={() => setQ(s.text)}>{s.kind === 'project' ? '📁 ' : s.kind === 'store' ? '🏪 ' : s.kind === 'category' ? '🏷️ ' : ''}{s.text}</button>
          ))}
        </div>
      )}

      {/* Idle: recent searches + shortcuts */}
      {showIdle && (
        <div className="mt-2 rounded-2xl border border-navy-100 dark:border-white/10 p-3 bg-white/60 dark:bg-white/[0.03]" data-search-idle=""
          onMouseDown={e => e.preventDefault()}>
          {recent.length > 0 && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <History size={13} className="text-navy-400" />
                <p className="flex-1 text-[11px] font-bold uppercase tracking-wider text-navy-400 dark:text-white/45">Recent</p>
                <button type="button" className="text-xs font-semibold text-navy-500 dark:text-white/55 min-h-[32px] px-2" onClick={() => setRecent(clearRecent())}>Clear</button>
              </div>
              <ul className="mb-2">
                {recent.map(r => (
                  <li key={r} className="flex items-center">
                    <button type="button" className="flex-1 text-left text-sm text-navy-800 dark:text-white/85 min-h-[40px] px-1 truncate" onClick={() => setQ(r)}>{r}</button>
                    <button type="button" className="w-9 h-9 flex items-center justify-center text-navy-300 hover:text-navy-600 dark:text-white/30" onClick={() => setRecent(removeRecent(r))} aria-label={`Remove ${r}`}><X size={14} /></button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="text-[11px] font-bold uppercase tracking-wider text-navy-400 dark:text-white/45 mb-1.5">Try</p>
          <div className="flex flex-wrap gap-1.5">
            {shortcuts.map(([l, fn]) => <Chip key={l} on={false} onClick={() => { fn(); setShowFilters(true); }}>{l}</Chip>)}
          </div>
        </div>
      )}

      {active && (
        <div className="mt-3" aria-live="polite" data-search-results="">
          {loading && <p className="flex items-center gap-2 text-sm text-navy-500 dark:text-white/55 py-3"><Loader2 size={15} className="animate-spin" /> Searching…</p>}
          {error && <p className="text-sm text-red-600 dark:text-red-400 py-3" role="alert">{error}</p>}
          {res && total === 0 && (
            <div className="glass-card p-6 text-center">
              <p className="font-semibold text-navy-900 dark:text-white">{q.trim() ? <>Nothing matches “{q.trim()}”</> : 'Nothing matches these filters'}</p>
              <p className="text-sm text-navy-500 dark:text-white/50 mt-1">Try fewer words{count > presetCount ? ' or clear a filter' : ''}.</p>
            </div>
          )}
          {res && GROUPS.map(([g, label]) => {
            const list = res.groups[g] || [];
            if (!list.length) return null;
            const shown = more[g] ? list : list.slice(0, 5);
            return (
              <section key={g} className="mb-4" aria-label={label} data-search-group={g}>
                <h3 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-navy-400 dark:text-white/45">{label} · {list.length}{list.length >= 30 ? '+' : ''}</h3>
                <ul className="flex flex-col gap-2">{shown.map(r => <Result key={`${g}-${r.id}`} r={r} terms={terms} onOpen={open} />)}</ul>
                {list.length > 5 && (
                  <button type="button" className="btn-ghost text-xs mt-1.5" onClick={() => setMore(m => ({ ...m, [g]: !m[g] }))}>
                    {more[g] ? 'Show fewer' : `Show all ${list.length}`} <ChevronDown size={13} className={more[g] ? 'rotate-180' : ''} />
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
