// Filters per page (2.8.1): each page keeps its own search filters and tab until you clear them — also after
// opening a note and going Back, and after the app restarts (localStorage, this device). The search words and
// the Inbox tab last for the session (sessionStorage; the app opens on your default tab). Anything that doesn't look right is dropped, and state saved by
// an older version is reset once.
const VERSION = '2';
const VERSION_KEY = 'pa_filterStateVersion';
const FILTERS_PREFIX = 'pa_filters:';
const QUERY_PREFIX = 'pa_query:';
const TAB_PREFIX = 'pa_tab:';

export const EMPTY_FILTERS = Object.freeze({ types: [], range: 'any', from: '', to: '', project: '', scope: 'all', attach: false, category: '', status: '' });
const TYPES = ['notes', 'lists', 'documents', 'projects', 'recordings', 'actions'];
const RANGES = ['any', 'today', 'week', 'month', 'year', 'custom'];
const day = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');

/** A filters object from anything (old / corrupted / hand-edited) — always a valid one */
export function cleanFilters(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    types: Array.isArray(r.types) ? [...new Set(r.types.filter(t => TYPES.includes(t)))] : [],
    range: RANGES.includes(r.range) ? r.range : 'any',
    from: day(r.from), to: day(r.to),
    project: typeof r.project === 'string' && /^(none|pj_[\w-]{1,60})$/.test(r.project) ? r.project : '',
    scope: ['all', 'mine', 'shared'].includes(r.scope) ? r.scope : 'all',
    attach: r.attach === true,
    category: typeof r.category === 'string' && r.category.length <= 40 ? r.category : '',
    status: ['', 'open', 'done'].includes(r.status) ? r.status : '',
  };
}

function keys(store, prefixes) {
  const out = [];
  try { for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k && prefixes.some(p => k.startsWith(p))) out.push(k); } } catch { /* blocked */ }
  return out;
}

/** Once per version: forget saved filters from before (they might not match the pages any more) */
export function migrateFilterState() {
  try {
    if (localStorage.getItem(VERSION_KEY) === VERSION) return false;
    for (const k of keys(localStorage, [FILTERS_PREFIX, TAB_PREFIX, 'pa_search:'])) localStorage.removeItem(k);
    for (const k of keys(sessionStorage, [QUERY_PREFIX, TAB_PREFIX, 'pa_search:'])) sessionStorage.removeItem(k);
    // Recent searches: keep the good ones only
    try {
      const r = JSON.parse(localStorage.getItem('pa_recentSearches') || '[]');
      if (!Array.isArray(r)) localStorage.removeItem('pa_recentSearches');
      else localStorage.setItem('pa_recentSearches', JSON.stringify(r.filter(x => typeof x === 'string' && x.trim()).slice(0, 8)));
    } catch { localStorage.removeItem('pa_recentSearches'); }
    localStorage.setItem(VERSION_KEY, VERSION);
    return true;
  } catch { return false; }
}
migrateFilterState();

export function loadFilters(page) {
  try { return cleanFilters(JSON.parse(localStorage.getItem(FILTERS_PREFIX + page) || 'null')); } catch { return cleanFilters(null); }
}
export function saveFilters(page, f) {
  try {
    const c = cleanFilters(f);
    if (JSON.stringify(c) === JSON.stringify(cleanFilters(null))) localStorage.removeItem(FILTERS_PREFIX + page);
    else localStorage.setItem(FILTERS_PREFIX + page, JSON.stringify(c));
  } catch { /* private mode */ }
}

export function loadQuery(page) {
  try { const q = sessionStorage.getItem(QUERY_PREFIX + page); return typeof q === 'string' ? q.slice(0, 200) : ''; } catch { return ''; }
}
export function saveQuery(page, q) {
  try { if (q) sessionStorage.setItem(QUERY_PREFIX + page, q.slice(0, 200)); else sessionStorage.removeItem(QUERY_PREFIX + page); } catch { /* ignore */ }
}

/** A page's tab (Inbox: All / Events / …), only if it's one of `allowed` */
export function loadTab(page, allowed, fallback) {
  try { const t = sessionStorage.getItem(TAB_PREFIX + page); return allowed.includes(t) ? t : fallback; } catch { return fallback; }
}
export function saveTab(page, tab) {
  try { sessionStorage.setItem(TAB_PREFIX + page, tab); } catch { /* ignore */ }
}
