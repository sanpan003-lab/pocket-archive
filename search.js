// Search (2.8.0): GET /api/find — your notes, lists, documents and projects, the notes and projects shared
// with you, and (the archive admin, Full layout) the Hey Pocket recordings. Never anyone else's data: the
// pool is built from req.user's own store + sharing.sharedNotes(req.user.id) only.
//
// Index: one in-memory entry per note file, kept per store folder. Each query checks the folder's file
// mtimes and re-reads only what changed (or was added / removed), so every write path — the app, smart
// append, background summaries, shares — is picked up without hooks. Entries hold lower-cased text per
// field; matching is every word (AND), by word prefix, with fields weighted (title > summary > the rest).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { attachmentSearchText } = require('./attachments');
const multer = require('multer');
const { documentSearchText, TYPES: DOC_TYPES } = require('./documents');

const FIELD_WEIGHT = { title: 8, project: 5, summary: 4, items: 3, document: 3, place: 3, content: 2, transcript: 2, photo: 2, attachments: 2, updates: 1 };
const FIELD_LABEL = {
  title: 'Title', project: 'Project', summary: 'AI summary', items: 'List', document: 'Document details', place: 'Place',
  content: 'Text', transcript: 'Transcript', photo: 'Text in the photo', attachments: 'Attachment', updates: 'Update',
};
const GROUPS = ['notes', 'lists', 'documents', 'projects', 'recordings', 'actions'];
const MAX_PER_GROUP = 30;

const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const textOf = v => (v == null ? '' : typeof v === 'object' ? (v.text || v.summary || '') : String(v));

/** "Eggs, milk" → ['eggs', 'milk'] (words of 1+ letters/digits; at most 8) */
function terms(q) {
  return [...new Set(norm(q).split(/[^\p{L}\p{N}$.]+/u).map(t => t.replace(/^[.$]+|[.]+$/g, '')).filter(Boolean))].slice(0, 8);
}

/** Does `text` contain a word starting with `t`? (numbers / amounts match anywhere: "42.1" in "$142.18") */
function hasWord(text, t) {
  let i = text.indexOf(t);
  while (i !== -1) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1]) || /\d/.test(t[0])) return i;
    i = text.indexOf(t, i + 1);
  }
  return -1;
}

const kindOf = n => (n.type === 'action' ? 'actions' : n.document?.type ? 'documents' : n.format === 'list' || (n.items || []).length ? 'lists' : 'notes');
const isDone = n => !!(n.errandDone || n.done || n.completed) || (n.format === 'list' && (n.items || []).length > 0 && n.items.every(i => i.done));

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
  return {
    id: n.id,
    kind: kindOf(n),
    hidden: !!(n.undone || n.hidden || n.kind === 'append'),
    fields,
    meta: {
      title: n.title || 'Untitled', type: n.type || 'note', format: n.format || null, source: n.source || null,
      capturedAt: n.capturedAt || n.createdAt || null, projectId: n.projectId || null,
      hasMedia: !!n.media, attachments: (n.attachments || []).length,
      document: n.document?.type ? { type: n.document.type, category: n.document.category || DOC_TYPES[n.document.type]?.category || null, label: DOC_TYPES[n.document.type]?.label || null, icon: DOC_TYPES[n.document.type]?.icon || null } : null,
      done: isDone(n),
      merchant: n.document?.fields?.merchant || n.document?.fields?.company || n.document?.fields?.store || null,
    },
  };
}

// ── Per-folder incremental index ───────────────────────────────────────────
const indexes = new Map(); // store dir → { files: Map(file → { mtime, entry }) }

/** Entries for every note in a store folder (re-reads only files whose mtime changed) */
function entriesOf(store) {
  const dir = store.dir;
  let idx = indexes.get(dir);
  if (!idx) indexes.set(dir, idx = { files: new Map() });
  let names = [];
  try { names = fs.readdirSync(dir).filter(f => /^qn_[\w-]+\.json$/.test(f)); } catch { /* no notes yet */ }
  const seen = new Set(names);
  for (const f of idx.files.keys()) if (!seen.has(f)) idx.files.delete(f);
  for (const f of names) {
    let mtime = 0;
    try { mtime = fs.statSync(path.join(dir, f)).mtimeMs; } catch { continue; }
    const cur = idx.files.get(f);
    if (cur && cur.mtime === mtime) continue;
    try { idx.files.set(f, { mtime, entry: entryFor(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) }); }
    catch { idx.files.delete(f); }
  }
  return [...idx.files.values()].map(v => v.entry);
}

/** Score an entry for the query terms: null when a term is missing everywhere */
function scoreEntry(entry, ts) {
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
function snippetOf(entry, best) {
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

function parseFilters(qs) {
  const day = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    types: list(qs.type).filter(t => GROUPS.includes(t)),
    from: day(qs.from), to: day(qs.to),
    project: qs.project ? String(qs.project).slice(0, 60) : null,
    scope: ['mine', 'shared'].includes(qs.scope) ? qs.scope : 'all',
    attach: qs.attach === '1' || qs.attach === 'true',
    category: qs.category ? String(qs.category).slice(0, 40) : null,
    status: ['done', 'open'].includes(qs.status) ? qs.status : null,
  };
}

function passes(e, f) {
  const m = e.meta;
  if (f.from && (m.capturedAt || '').slice(0, 10) < f.from) return false;
  if (f.to && (m.capturedAt || '').slice(0, 10) > f.to) return false;
  if (f.project === 'none' ? m.projectId : f.project && m.projectId !== f.project) return false;
  if (f.attach && !m.attachments && !m.hasMedia) return false;
  if (f.category && m.document?.category !== f.category) return false;
  if (f.status === 'done' && !m.done) return false;
  if (f.status === 'open' && m.done) return false;
  return true;
}

/**
 * deps: { contexts, sharing, searchRecordings(q) → [{ id, title, date, snippet, … }] (admin archive), transcribe(file, ext) }
 */
function createSearch({ contexts, sharing, searchRecordings, transcribe }) {
  /** Everything req.user may search: own notes + notes shared with them; own + shared projects */
  function pool(userId) {
    const ctx = contexts.get(userId);
    const own = entriesOf(ctx.quick.store).filter(e => !e.hidden);
    const ownProjects = ctx.quick.projects.list().filter(p => !p.deleted);
    const shared = sharing.sharedNotes(userId).filter(n => n.type !== 'action').map(n => ({ ...entryFor(n), sharedFrom: { name: n.sharedFrom?.name || null, role: n.sharedFrom?.role || 'view', ownerId: n.sharedFrom?.ownerId } }))
      .filter(e => !e.hidden && !own.some(o => o.id === e.id));
    const sharedProjects = (sharing.sharedProjects?.(userId) || []).filter(p => !p.deleted);
    return { ownProjects, sharedProjects, notes: [...own, ...shared] };
  }

  function find(user, qs) {
    const t0 = Date.now();
    const q = String(qs.q || '').trim().slice(0, 200);
    const ts = terms(q);
    const f = parseFilters(qs);
    const filtering = f.from || f.to || f.project || f.attach || f.category || f.status || f.scope !== 'all' || f.types.length;
    const groups = Object.fromEntries(GROUPS.map(g => [g, []]));
    if (!ts.length && !filtering) return { q, terms: [], groups, total: 0, suggestions: [], tookMs: 0 };

    const { notes, ownProjects, sharedProjects } = pool(user.id);
    const projectName = new Map([...ownProjects, ...sharedProjects].map(p => [p.id, p.name]));
    // Actions (alarms, messages…) are private and only searched on the Actions page (type=actions)
    const want = g => (g === 'actions' ? f.types.includes('actions') : !f.types.length || f.types.includes(g));

    // Notes, lists, documents
    for (const e of notes) {
      if (!want(e.kind)) continue;
      if (f.scope === 'mine' && e.sharedFrom) continue;
      if (f.scope === 'shared' && !e.sharedFrom) continue;
      if (!passes(e, f)) continue;
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
    if (want('projects') && ts.length && !(f.attach || f.category || f.status || f.from || f.to || f.project)) {
      for (const [p, shared] of [...ownProjects.map(p => [p, false]), ...sharedProjects.map(p => [p, true])]) {
        if (f.scope === 'mine' && shared) continue;
        if (f.scope === 'shared' && !shared) continue;
        const e = { fields: {} };
        for (const [k, v] of [['title', p.name], ['summary', [p.description, ...(p.aliases || [])].filter(Boolean).join('\n')]]) {
          if (v) e.fields[k] = { raw: String(v), lc: norm(v) };
        }
        const s = scoreEntry(e, ts);
        if (!s) continue;
        groups.projects.push({
          id: p.id, kind: 'projects', title: p.name, notes: (p.noteIds || []).length, archived: p.status === 'archived',
          sharedFrom: shared ? { name: p.sharedFrom?.name || null, role: p.sharedFrom?.role || 'view' } : null,
          snippet: p.description ? String(p.description).slice(0, 160) : '', matchedIn: null, score: s.score, capturedAt: p.updatedAt || p.createdAt || null,
        });
      }
    }

    // Hey Pocket recordings: the archive admin only (and only when the Full layout asks)
    if (want('recordings') && ts.length && qs.recordings === '1' && user.role === 'admin' && f.scope !== 'shared' && searchRecordings) {
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
    return { q, terms: ts, groups, total, suggestions: suggest(ts, notes, [...ownProjects, ...sharedProjects]), tookMs: Date.now() - t0 };
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

  const voiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } });

  function register(app) {
    app.get('/api/find', (req, res) => {
      try { res.json(find(req.user, req.query)); } catch (err) { console.warn('[search]', err.message); res.status(500).json({ error: 'Search failed' }); }
    });

    // Voice search: a few seconds of audio → the words (transcribed on the NAS, nothing is saved)
    const recent = new Map(); // userId → [times]
    app.post('/api/find/voice', voiceUpload.single('audio'), async (req, res) => {
      const now = Date.now();
      const times = (recent.get(req.user.id) || []).filter(t => now - t < 60 * 60 * 1000);
      if (times.length >= 60) return res.status(429).json({ error: 'Too many voice searches — type it instead' });
      recent.set(req.user.id, [...times, now]);
      const file = req.file;
      if (!file?.buffer?.length) return res.status(400).json({ error: 'No audio' });
      if (file.buffer.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'Keep it short — a few words' });
      const ext = /mp4|m4a|aac/.test(file.mimetype || '') ? 'm4a' : /ogg/.test(file.mimetype || '') ? 'ogg' : /wav/.test(file.mimetype || '') ? 'wav' : 'webm';
      const tmp = path.join(os.tmpdir(), `pa-voice-${process.pid}-${now}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
      try {
        fs.writeFileSync(tmp, file.buffer);
        const text = (await transcribe(tmp, ext)).replace(/[.!?]+$/, '').trim().slice(0, 200);
        res.json({ text });
      } catch (err) {
        console.warn('[search] voice:', err.message);
        res.status(502).json({ error: 'Couldn’t hear that — try again or type it' });
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* gone */ }
      }
    });
  }

  return { register, find, pool };
}

module.exports = { createSearch, _internal: { terms, hasWord, entryFor, scoreEntry, snippetOf, parseFilters } };
