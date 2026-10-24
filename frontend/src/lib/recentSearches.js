// Recent searches: on this device only (localStorage), newest first, at most 8; clearable.
const KEY = 'pa_recentSearches';
const MAX = 8;

export function getRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, MAX) : [];
  } catch { return []; }
}

export function addRecent(q) {
  const t = String(q || '').trim().slice(0, 100);
  if (t.length < 2) return getRecent();
  const next = [t, ...getRecent().filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

export function removeRecent(q) {
  const next = getRecent().filter(x => x !== q);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function clearRecent() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return [];
}
