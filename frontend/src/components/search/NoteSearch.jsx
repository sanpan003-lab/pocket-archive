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
import { EMPTY_FILTERS, loadFilters, saveFilters, loadQuery, saveQuery } from '../../lib/filterState';
import { paramsOf, RANGES } from '../../lib/searchParams';
import { QUICK_TYPES, timeAgo } from '../quick/quickMeta';
import Highlight from '../Highlight';

const GROUPS = [
  ['notes', 'Notes'], ['lists', 'Lists'], ['documents', 'Documents'], ['projects', 'Projects'], ['actions', 'Actions'], ['recordings', 'Recordings'],
];
const GROUP_LABEL = Object.fromEntries(GROUPS);
const RANGE_LABEL = Object.fromEntries(RANGES);
const CATEGORIES = [...new Set(Object.values(DOC_TYPES).map(t => t.category))];
/** Your filters as removable chips: [{ key, label, clear(f) → f }] */
function activeChips(f, projectName) {
  const out = [];
  for (const t of f.types) out.push({ key: `type-${t}`, label: GROUP_LABEL[t] || t, clear: x => ({ ...x, types: x.types.filter(y => y !== t) }) });
  if (f.range !== 'any') out.push({ key: 'range', label: f.range === 'custom' ? `${f.from || '…'} – ${f.to || '…'}` : RANGE_LABEL[f.range], clear: x => ({ ...x, range: 'any', from: '', to: '' }) });
  if (f.project) out.push({ key: 'project', label: f.project === 'none' ? 'Not in a project' : `📁 ${projectName(f.project) || 'Project'}`, clear: x => ({ ...x, project: '' }) });
  if (f.scope !== 'all') out.push({ key: 'scope', label: f.scope === 'mine' ? 'Mine' : 'Shared with me', clear: x => ({ ...x, scope: 'all' }) });
  if (f.attach) out.push({ key: 'attach', label: 'Has attachment', clear: x => ({ ...x, attach: false }) });
  if (f.category) out.push({ key: 'category', label: f.category, clear: x => ({ ...x, category: '' }) });
  if (f.status) out.push({ key: 'status', label: f.status === 'done' ? 'Done' : 'Open', clear: x => ({ ...x, status: '' }) });
  return out;
}

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
      <button type="button" onClick={() => onOpen(r)} data-search-result={r.kind} data-id={r.id}
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

function Filters({ f, setF, scope, archive, projects }) {
  const toggleType = t => setF(x => ({ ...x, types: x.types.includes(t) ? x.types.filter(y => y !== t) : [...x.types, t] }));
  // Type chips: only kinds this page can show (the Actions page shows actions only, so no type chips there)
  const types = GROUPS.filter(([k]) => (scope.types ? scope.types.includes(k)
    : k !== 'actions' && (k !== 'recordings' || archive)));
  const label = 'text-[11px] font-bold uppercase tracking-wider text-navy-400 dark:text-white/45 mb-1.5';
  return (
    <div className="mt-2 rounded-2xl border border-navy-100 dark:border-white/10 p-3 space-y-3 bg-white/60 dark:bg-white/[0.03]" data-search-filters="">
      {types.length > 1 && (
        <div>
          <p className={label}>Type</p>
          <div className="flex flex-wrap gap-1.5">
            <Chip on={!f.types.length} onClick={() => setF(x => ({ ...x, types: [] }))}>All</Chip>
            {types.map(([k, l]) => <Chip key={k} on={f.types.includes(k)} onClick={() => toggleType(k)}>{l}</Chip>)}
          </div>
        </div>
      )}
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
        {scope.scope !== 'shared' && (
          <div>
            <p className={label}>Whose</p>
            <div className="flex flex-wrap gap-1.5">
              {[['all', 'All'], ['mine', 'Mine'], ['shared', 'Shared with me']].map(([k, l]) => <Chip key={k} on={f.scope === k} onClick={() => setF(x => ({ ...x, scope: k }))}>{l}</Chip>)}
            </div>
          </div>
        )}
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
 * scope: what this page is about, fixed (not a filter you can remove): { types } (Actions, Projects),
 *   { tab, actions } (an Inbox tab — the same rules as its list), { scope: 'shared' } (Shared with me).
 *   scopeLabel names it ("Searching Events").
 * stateKey: this page's own saved filters (lib/filterState) — kept until cleared, also after opening a note and Back.
 */
export default function NoteSearch({
  variant = 'bar', scope: scopeProp, scopeLabel, stateKey, placeholder, onActiveChange, onClose, autoFocus = false,
  resultsHidden = false, recordings = false,
}) {
  const navigate = useNavigate();
  const { archive } = useLayout();
  const scopeKey = JSON.stringify(scopeProp || {});
  const scope = useMemo(() => JSON.parse(scopeKey), [scopeKey]);
  const [q, setQ] = useState(() => (stateKey ? loadQuery(stateKey) : ''));
  const [f, setF] = useState(() => (stateKey ? loadFilters(stateKey) : EMPTY_FILTERS));
  const [showFilters, setShowFilters] = useState(false);
  const [focused, setFocused] = useState(autoFocus);
  const [recent, setRecent] = useState(getRecent);
  const [data, setData] = useState(null);      // { key, res } | { key, error }
  const [more, setMore] = useState({});
  const [projects, setProjects] = useState(null);
  const input = useRef(null);
  const blurTimer = useRef(null);

  // This page's filters are saved for this page only
  useEffect(() => { if (stateKey) saveFilters(stateKey, f); }, [stateKey, f]);
  useEffect(() => { if (stateKey) saveQuery(stateKey, q); }, [stateKey, q]);

  const chips = activeChips(f, id => projects?.find(p => p.id === id)?.name);
  const count = chips.length;
  // Names for the project chip (and the Filters list)
  useEffect(() => {
    if (!showFilters && !f.project) return;
    if (projects) return;
    getProjects().then(l => setProjects(Array.isArray(l) ? l : [])).catch(() => setProjects([]));
  }, [showFilters, f.project, projects]);

  const active = q.trim().length >= 2 || count > 0;
  const params = useMemo(() => paramsOf(q, f, scope, recordings && archive), [q, f, scope, recordings, archive]);
  const key = JSON.stringify(params);

  useEffect(() => { onActiveChange?.(active); }, [active, onActiveChange]);

  // Instant results: 220 ms after the last key, the previous request cancelled
  useEffect(() => {
    if (!active || !params) return undefined;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      findNotes(params, ctl.signal)
        .then(res => setData({ key, res }))
        .catch(err => { if (err.name !== 'CanceledError' && err.code !== 'ERR_CANCELED') setData({ key, error: err.response?.data?.error || 'Search isn’t available right now' }); });
    }, 220);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [active, key, params]);

  const voice = useVoiceSearch(useCallback(text => { setQ(text); setRecent(addRecent(text)); input.current?.focus(); }, []));
  const impossible = active && !params;
  const res = impossible ? { groups: {}, terms: [], suggestions: [] } : data?.key === key ? data.res : null;
  const error = !impossible && data?.key === key ? data.error : null;
  const loading = active && !res && !error;
  const terms = res?.terms || [];
  const total = res ? GROUPS.reduce((n, [g]) => n + (res.groups[g]?.length || 0), 0) : 0;

  function open(r) {
    if (q.trim().length >= 2) setRecent(addRecent(q));
    onClose?.();
    navigate(pathOf(r));
  }
  const clearFilters = () => { setF(EMPTY_FILTERS); setMore({}); };
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (q) setQ('');
      else if (onClose) onClose();
      else input.current?.blur();
    } else if (e.key === 'Enter') {
      if (q.trim().length >= 2) setRecent(addRecent(q));
      input.current?.blur();
    }
  }

  const showIdle = focused && !active;
  const typesAllowed = t => !scope.types || scope.types.includes(t);
  const shortcuts = [
    ['Receipts', () => setF(x => ({ ...x, category: 'Receipts' })), !scope.types || scope.types.includes('documents')],
    ['Open lists', () => setF(x => ({ ...x, types: ['lists'], status: 'open' })), typesAllowed('lists') && !scope.tab],
    ['With attachments', () => setF(x => ({ ...x, attach: true })), true],
    ['This week', () => setF(x => ({ ...x, range: 'week' })), true],
    ['Shared with me', () => setF(x => ({ ...x, scope: 'shared' })), scope.scope !== 'shared'],
  ].filter(([, , ok]) => ok);

  return (
    <div className={variant === 'bar' ? 'mb-4' : ''} data-note-search={variant} data-search-scope={scopeLabel || ''}>
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
            {q && (
              <button type="button" className="w-10 h-11 flex items-center justify-center text-navy-400 hover:text-navy-700 dark:text-white/50 dark:hover:text-white" onClick={() => { setQ(''); input.current?.focus(); }} aria-label="Clear search"><X size={17} /></button>
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
          className={`relative shrink-0 w-11 h-11 rounded-xl border flex items-center justify-center ${showFilters || count ? 'border-gold-400 bg-gold-500/10 text-gold-700 dark:text-gold-300' : 'border-navy-200 dark:border-white/15 text-navy-500 dark:text-white/60'}`}>
          <SlidersHorizontal size={17} />
          {count > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-gold-500 text-[11px] font-bold text-white flex items-center justify-center">{count}</span>}
        </button>
      </div>
      {voice.error && <p className="text-xs text-red-600 dark:text-red-400 mt-1.5" role="alert">{voice.error}</p>}
      {showFilters && <Filters f={f} setF={setF} scope={scope} archive={recordings && archive} projects={projects} />}

      {/* Active filters: chips (✕ removes one), the result count, Clear filters */}
      {active && !resultsHidden && (count > 0 || scopeLabel) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2" data-active-filters="">
          {scopeLabel && <span className="text-xs text-navy-500 dark:text-white/55 mr-0.5" data-scope-label="">In {scopeLabel}</span>}
          {chips.map(c => (
            <button key={c.key} type="button" onClick={() => setF(c.clear)} data-filter-chip={c.key}
              className="inline-flex items-center gap-1 min-h-[32px] pl-2.5 pr-1.5 rounded-lg bg-gold-500/15 border border-gold-400/60 text-xs font-semibold text-gold-800 dark:text-gold-200"
              aria-label={`Remove filter ${c.label}`}>
              {c.label} <X size={13} />
            </button>
          ))}
          {res && <span className="text-xs text-navy-500 dark:text-white/55 ml-1" data-result-count={total}>{total} result{total === 1 ? '' : 's'}</span>}
          {count > 0 && <button type="button" className="text-xs font-semibold text-gold-700 dark:text-gold-300 min-h-[32px] px-1.5 underline" onClick={clearFilters} data-clear-filters="">Clear filters</button>}
        </div>
      )}

      {/* Completions from your own data */}
      {active && !resultsHidden && res?.suggestions?.length > 0 && (
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

      {active && !resultsHidden && (
        <div className="mt-3" aria-live="polite" data-search-results="">
          {loading && <p className="flex items-center gap-2 text-sm text-navy-500 dark:text-white/55 py-3"><Loader2 size={15} className="animate-spin" /> Searching…</p>}
          {error && <p className="text-sm text-red-600 dark:text-red-400 py-3" role="alert">{error}</p>}
          {res && total === 0 && (
            <div className="glass-card p-6 text-center" data-no-matches="">
              <p className="font-semibold text-navy-900 dark:text-white">No matches</p>
              <p className="text-sm text-navy-500 dark:text-white/50 mt-1">
                {q.trim() ? <>Nothing {scopeLabel ? `in ${scopeLabel} ` : ''}matches “{q.trim()}”{count ? ' with these filters' : ''}.</> : 'Nothing matches these filters.'}
              </p>
              {count > 0
                ? <button type="button" className="btn-white text-sm mt-3" onClick={clearFilters} data-clear-filters="">Clear filters</button>
                : <p className="text-sm text-navy-500 dark:text-white/50 mt-1">Try fewer words.</p>}
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
