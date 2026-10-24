// Search query building (2.8.1): a page's fixed scope AND your filters.

export const RANGES = [['any', 'Any time'], ['today', 'Today'], ['week', 'Last 7 days'], ['month', 'Last 30 days'], ['year', 'This year'], ['custom', 'Pick dates']];
const day = d => d.toLocaleDateString('en-CA');

export function rangeDates(f) {
  const now = new Date();
  if (f.range === 'today') return { from: day(now) };
  if (f.range === 'week') return { from: day(new Date(now - 6 * 86400000)) };
  if (f.range === 'month') return { from: day(new Date(now - 29 * 86400000)) };
  if (f.range === 'year') return { from: `${now.getFullYear()}-01-01` };
  if (f.range === 'custom') return { from: f.from || undefined, to: f.to || undefined };
  return {};
}

/**
 * The /api/find query: the page's fixed scope AND your filters (AND everywhere). null = nothing can match
 * (e.g. "Lists" on the Actions page, or "Mine" on Shared with me) — no request, "No matches".
 * scope: { types?: [...], tab?: Inbox tab, scope?: 'shared', actions?: true, project?: 'any' (notes in a project) }
 */
export function paramsOf(q, f, scope, recordings) {
  // Kinds this page can show: its own (Actions page → actions only), else everything but actions (+ recordings
  // where they're offered). A saved type the page can't show matches nothing — it never widens the page.
  const allowed = scope.types || ['notes', 'lists', 'documents', 'projects', ...(recordings ? ['recordings'] : [])];
  let types = f.types.filter(t => allowed.includes(t));
  if (f.types.length && !types.length) return null;
  if (scope.types && !types.length) types = scope.types;
  if (scope.project === 'any' && f.project === 'none') return null;
  let whose = f.scope;
  if (scope.scope === 'shared') {
    if (f.scope === 'mine') return null;
    whose = 'shared';
  }
  const p = {
    q: q.trim() || undefined, type: types.length ? types.join(',') : undefined, ...rangeDates(f),
    project: f.project || scope.project || undefined, scope: whose !== 'all' ? whose : undefined, attach: f.attach ? '1' : undefined,
    category: f.category || undefined, status: f.status || undefined,
    tab: scope.tab || undefined, actions: scope.tab && scope.actions ? '1' : undefined,
    recordings: recordings ? '1' : undefined,
  };
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== ''));
}

