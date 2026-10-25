// GENERATED from the backend's search-core.mjs by scripts/shared-code.mjs — edit it there, not here.
// Search core (2.9.0): the matching, filters, tabs, ranking and snippets of GET /api/find — shared, byte for byte,
// by the server (search.js) and the Android app's offline search (frontend src/lib/offline/searchCore.js, copied
// by scripts/shared-code.mjs). Pure functions, no I/O, no dependencies: give it notes, get the same answer.
//
// createSearchCore({ docTypes = DOC_TYPES }) — the document kinds (label, category, icon).

// Document kinds as the server names them (documents.js TYPES: label, category, icon) — the default for both sides
// (a test checks this table still matches documents.js)
export const DOC_TYPES = {
  receipt:       { label: 'Receipt',       category: 'Receipts',  icon: '🧾' },
  bill:          { label: 'Bill',          category: 'Bills',     icon: '💡' },
  medical:       { label: 'Medical',       category: 'Medical',   icon: '🩺' },
  school:        { label: 'School',        category: 'School',    icon: '🎒' },
  warranty:      { label: 'Warranty',      category: 'Warranty',  icon: '🛡️' },
  letter:        { label: 'Letter',        category: 'Documents', icon: '✉️' },
  business_card: { label: 'Business card', category: 'Contacts',  icon: '📇' },
  whiteboard:    { label: 'Notes',         category: 'Notes',     icon: '🖍️' },
  other:         { label: 'Document',      category: 'Documents', icon: '📄' },
};

export const GROUPS = ['notes', 'lists', 'documents', 'projects', 'recordings', 'actions'];
export const MAX_PER_GROUP = 30;
const FIELD_WEIGHT = { title: 8, project: 5, summary: 4, items: 3, document: 3, place: 3, content: 2, transcript: 2, photo: 2, attachments: 2, updates: 1 };
const FIELD_LABEL = {
  title: 'Title', project: 'Project', summary: 'AI summary', items: 'List', document: 'Document details', place: 'Place',
  content: 'Text', transcript: 'Transcript', photo: 'Text in the photo', attachments: 'Attachment', updates: 'Update',
};

export const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const textOf = v => (v == null ? '' : typeof v === 'object' ? (v.text || v.summary || '') : String(v));

/** "Eggs, milk" → ['eggs', 'milk'] (words of 1+ letters/digits; at most 8) */
export function terms(q) {
  return [...new Set(norm(q).split(/[^\p{L}\p{N}$.]+/u).map(t => t.replace(/^[.$]+|[.]+$/g, '')).filter(Boolean))].slice(0, 8);
}

/** Does `text` contain a word starting with `t`? (numbers / amounts match anywhere: "42.1" in "$142.18") */
export function hasWord(text, t) {
  let i = text.indexOf(t);
  while (i !== -1) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1]) || /\d/.test(t[0])) return i;
    i = text.indexOf(t, i + 1);
  }
  return -1;
}

const kindOf = n => (n.type === 'action' ? 'actions' : n.document?.type ? 'documents'
  : n.type === 'errand' || n.format === 'list' || (n.items || []).length ? 'lists' : 'notes');

// The Inbox tabs (and the Lists page), exactly as the web app filters its list (QuickInboxPage FILTERS / LISTS):
// a search on a tab returns what that tab shows. m = an entry's meta.
export const TABS = {
  all:       m => !m.undone,
  shared:    m => !m.undone && m.shared,
  review:    m => !m.undone && m.status === 'needs_review',
  event:     m => !m.undone && m.type === 'event',
  reminder:  m => !m.undone && m.type === 'reminder',
  errand:    m => !m.undone && m.type === 'errand',
  projects:  m => !m.undone && !!m.projectId,
  notes:     m => !m.undone && (m.type === 'note' || m.type === 'note_link'),
  documents: m => !m.undone && !!m.document && !m.docOff,
  undone:    m => m.undone,
  lists:     m => !m.undone && (m.type === 'errand' || m.format === 'list'),
};
const isDone = n => !!(n.errandDone || n.done || n.completed) || (n.format === 'list' && (n.items || []).length > 0 && n.items.every(i => i.done));

/** Text of a note's attachments (names + what was read) */
export function attachmentSearchText(note) {
  return (note.attachments || []).map(a => [a.name, a.text].filter(Boolean).join('\n')).join('\n');
}

function day(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null; }

export function parseFilters(qs) {
  const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    types: list(qs.type).filter(t => GROUPS.includes(t)),
    from: day(qs.from), to: day(qs.to),
    project: qs.project ? String(qs.project).slice(0, 60) : null,
    scope: ['mine', 'shared'].includes(qs.scope) ? qs.scope : 'all',
    attach: qs.attach === '1' || qs.attach === 'true',
    category: qs.category ? String(qs.category).slice(0, 40) : null,
    status: ['done', 'open'].includes(qs.status) ? qs.status : null,
    tab: Object.prototype.hasOwnProperty.call(TABS, qs.tab) ? qs.tab : null,
    actions: qs.actions === '1',     // "Show actions in Inbox" is on (with a tab)
  };
}

function passes(e, f) {
  const m = e.meta;
  if (f.from && (m.capturedAt || '').slice(0, 10) < f.from) return false;
  if (f.to && (m.capturedAt || '').slice(0, 10) > f.to) return false;
  if (f.project === 'none' ? m.projectId : f.project === 'any' ? !m.projectId : f.project && m.projectId !== f.project) return false;
  if (f.attach && !m.attachments && !m.hasMedia) return false;
  if (f.category && m.document?.category !== f.category) return false;
  if (f.status === 'done' && !m.done) return false;
  if (f.status === 'open' && m.done) return false;
  return true;
}

/** Score an entry for the query terms: null when a term is missing everywhere */
export function scoreEntry(entry, ts) {
  let score = 0;
  let best = null; // { field, at, weight }
  for (const t of ts) {
    let found = false;
    for (const [k, f] of Object.entries(entry.fields)) {
      const at = hasWord(f.lc, t);
      if (at === -1) continue;
      found = true;
      const w = FIELD_WEIGHT[k] || 1;
      score += w + (at === 0 ? 1 : 0);
      if (!best || w > best.weight) best = { field: k, at, weight: w };
    }
    if (!found) return null;
  }
  return { score, best };
}

/** ~200 characters around the match, on word boundaries */
export function snippetOf(entry, best) {
  if (!best || best.field === 'title') {
    const alt = ['summary', 'content', 'transcript', 'items'].find(k => entry.fields[k]);
    return alt ? { field: null, text: entry.fields[alt].raw.replace(/\s+/g, ' ').trim().slice(0, 160) } : { field: null, text: '' };
  }
  const raw = entry.fields[best.field].raw;
  let s = Math.max(0, best.at - 70);
  let e = Math.min(raw.length, best.at + 150);
  while (s > 0 && /\S/.test(raw[s - 1]) && best.at - s < 90) s--;
  while (e < raw.length && /\S/.test(raw[e]) && e - best.at < 180) e++;
  return { field: FIELD_LABEL[best.field] || null, text: `${s > 0 ? '…' : ''}${raw.slice(s, e).replace(/\s+/g, ' ').trim()}${e < raw.length ? '…' : ''}` };
}

export function createSearchCore({ docTypes = DOC_TYPES } = {}) {
  /** Text of a note's document for search */
  function documentSearchText(note) {
    const d = note.document;
    if (!d) return '';
    const f = d.fields || {};
    return [docTypes[d.type]?.label, d.category, d.text, ...Object.entries(f).map(([k, v]) => (k === 'items' ? (v || []).map(i => i.name).join(' ') : v))]
      .filter(Boolean).join('\n');
  }

  /** One note → its index entry */
  function entryFor(n) {
    const raw = {
      title: n.title,
      summary: textOf(n.summary),
      content: n.content,
      transcript: n.transcript,
      photo: n.mediaText,
      items: (n.items || []).map(i => i.text).join('\n'),
      updates: (n.updates || []).map(u => u.text).join('\n'),
      attachments: attachmentSearchText(n),
      document: documentSearchText(n),
      place: [n.place?.name, n.place?.query, n.place?.address, n.geo?.name, n.geo?.query].filter(Boolean).join('\n'),
    };
    const fields = {};
    for (const [k, v] of Object.entries(raw)) if (v && String(v).trim()) fields[k] = { raw: String(v), lc: norm(v) };
    const dt = n.document?.type ? docTypes[n.document.type] : null;
    return {
      id: n.id,
      kind: kindOf(n),
      hidden: !!(n.hidden || n.kind === 'append'),
      fields,
      meta: {
        title: n.title || 'Untitled', type: n.type || 'note', format: n.format || null, source: n.source || null,
        capturedAt: n.capturedAt || n.createdAt || null, projectId: n.projectId || null,
        hasMedia: !!n.media, attachments: (n.attachments || []).length,
        document: n.document?.type ? { type: n.document.type, category: n.document.category || dt?.category || null, label: dt?.label || null, icon: dt?.icon || null } : null,
        done: isDone(n),
        undone: !!n.undone, status: n.status || null, shared: !!(n.sharedWith || []).length, docOff: n.document?.status === 'off',
        merchant: n.document?.fields?.merchant || n.document?.fields?.company || n.document?.fields?.store || null,
      },
    };
  }

  /** A note shared with the user (from sharing.sharedNotes / GET /api/shared) → its entry */
  function sharedEntry(n) {
    return { ...entryFor(n), sharedFrom: { name: n.sharedFrom?.name || null, role: n.sharedFrom?.role || 'view', ownerId: n.sharedFrom?.ownerId } };
  }

  /** The search pool: own entries (not hidden) + shared ones (no actions, not duplicates) */
  function pool({ own, shared, ownProjects, sharedProjects }) {
    const ownVisible = own.filter(e => !e.hidden);
    const ids = new Set(ownVisible.map(e => e.id));
    const sharedVisible = shared.filter(n => n.type !== 'action').map(sharedEntry).filter(e => !e.hidden && !ids.has(e.id));
    return { notes: [...ownVisible, ...sharedVisible], ownProjects: ownProjects.filter(p => !p.deleted), sharedProjects: sharedProjects.filter(p => !p.deleted) };
  }

  /** "pub" → Publix (a store), Pub quiz (a title), … — completions for the last word */
  function suggest(ts, notes, projects) {
    const last = ts[ts.length - 1];
    if (!last || last.length < 2) return [];
    const out = new Map();
    const add = (text, kind) => {
      const k = norm(text);
      if (!text || out.has(k) || k === ts.join(' ')) return;
      if (hasWord(k, last) === -1) return;
      out.set(k, { text: String(text).slice(0, 60), kind });
    };
    for (const p of projects) add(p.name, 'project');
    for (const e of notes) if (e.meta.merchant) add(e.meta.merchant, 'store');
    for (const e of notes) if (e.meta.document?.category) add(e.meta.document.category, 'category');
    for (const e of notes) { add(e.meta.title, 'title'); if (out.size >= 12) break; }
    return [...out.values()].slice(0, 6);
  }

  /**
   * The answer of GET /api/find for a pool. user: { role }; searchRecordings(q) → recordings (the admin archive)
   * or null. now: for tookMs.
   */
  function find({ pool: p, user, qs, searchRecordings = null, now = () => Date.now() }) {
    const t0 = now();
    const q = String(qs.q || '').trim().slice(0, 200);
    const ts = terms(q);
    const f = parseFilters(qs);
    const filtering = f.from || f.to || f.project || f.attach || f.category || f.status || f.scope !== 'all' || f.types.length || f.tab;
    const groups = Object.fromEntries(GROUPS.map(g => [g, []]));
    if (!ts.length && !filtering) return { q, terms: [], groups, total: 0, suggestions: [], tookMs: 0 };

    const { notes, ownProjects, sharedProjects } = p;
    const projectName = new Map([...ownProjects, ...sharedProjects].map(pr => [pr.id, pr.name]));
    // Actions (alarms, messages…) are private: only on the Actions page (type=actions), or on an Inbox tab when
    // "Show actions in Inbox" is on (tab + actions=1). Everything else never returns them.
    const want = g => (g === 'actions' ? (f.tab ? f.actions && !f.types.length : f.types.includes('actions')) : !f.types.length || f.types.includes(g));

    // Notes, lists, documents
    for (const e of notes) {
      if (!want(e.kind)) continue;
      if (f.scope === 'mine' && e.sharedFrom) continue;
      if (f.scope === 'shared' && !e.sharedFrom) continue;
      if (!passes(e, f)) continue;
      // Deleted notes only on the Deleted tab; a tab filters like the list does
      if (f.tab ? !TABS[f.tab](e.sharedFrom ? { ...e.meta, shared: true } : e.meta) : e.meta.undone) continue;
      // The project's name counts as a field of its notes
      const pName = e.meta.projectId && projectName.get(e.meta.projectId);
      const withProject = pName ? { ...e, fields: { ...e.fields, project: { raw: pName, lc: norm(pName) } } } : e;
      const s = ts.length ? scoreEntry(withProject, ts) : { score: 0, best: null };
      if (!s) continue;
      const snip = snippetOf(withProject, s.best);
      groups[e.kind].push({
        id: e.id, kind: e.kind, ...e.meta, projectName: pName || null, sharedFrom: e.sharedFrom || null,
        snippet: snip.text, matchedIn: snip.field, score: s.score,
      });
    }

    // Projects (name, aliases, description) — not when filtering by note-only properties
    if (want('projects') && ts.length && !(f.attach || f.category || f.status || f.from || f.to || (f.project && f.project !== 'any') || f.tab)) {
      for (const [pr, shared] of [...ownProjects.map(x => [x, false]), ...sharedProjects.map(x => [x, true])]) {
        if (f.scope === 'mine' && shared) continue;
        if (f.scope === 'shared' && !shared) continue;
        const e = { fields: {} };
        for (const [k, v] of [['title', pr.name], ['summary', [pr.description, ...(pr.aliases || [])].filter(Boolean).join('\n')]]) {
          if (v) e.fields[k] = { raw: String(v), lc: norm(v) };
        }
        const s = scoreEntry(e, ts);
        if (!s) continue;
        groups.projects.push({
          id: pr.id, kind: 'projects', title: pr.name, notes: (pr.noteIds || []).length, archived: pr.status === 'archived',
          sharedFrom: shared ? { name: pr.sharedFrom?.name || null, role: pr.sharedFrom?.role || 'view' } : null,
          snippet: pr.description ? String(pr.description).slice(0, 160) : '', matchedIn: null, score: s.score, capturedAt: pr.updatedAt || pr.createdAt || null,
        });
      }
    }

    // Hey Pocket recordings: the archive admin only (and only when the Full layout asks)
    if (want('recordings') && ts.length && qs.recordings === '1' && user?.role === 'admin' && f.scope !== 'shared' && !f.tab && searchRecordings) {
      try {
        // The archive search matches one phrase: the whole query, else its longest word
        let recs = searchRecordings(q);
        if (!recs.length && ts.length > 1) recs = searchRecordings([...ts].sort((x, y) => y.length - x.length)[0]);
        groups.recordings = recs.filter(r => {
          const d = String(r.date || r.createdAt || '').slice(0, 10);
          return (!f.from || d >= f.from) && (!f.to || d <= f.to);
        }).slice(0, MAX_PER_GROUP).map(r => ({ ...r, kind: 'recordings', score: 1 }));
      } catch { groups.recordings = []; }
    }

    let total = 0;
    for (const g of GROUPS) {
      groups[g].sort((a, b) => b.score - a.score || String(b.capturedAt || '').localeCompare(String(a.capturedAt || '')));
      total += groups[g].length;
      groups[g] = groups[g].slice(0, MAX_PER_GROUP);
    }
    return { q, terms: ts, groups, total, suggestions: suggest(ts, notes, [...ownProjects, ...sharedProjects]), tookMs: now() - t0 };
  }

  return { entryFor, sharedEntry, pool, find, suggest, documentSearchText };
}
