// Projects: named groups of quick notes with a "living summary" that Claude
// keeps up to date as notes are added or removed.
//
// Storage: ARCHIVE/08_Projects/{id}.json
//   { id, name, aliases[], status: 'active'|'archived', livingSummary, livingSummaryStatus,
//     livingSummaryUpdatedAt, noteIds[], audit[], deleted, deletedAt, mergedInto,
//     createdAt, updatedAt }
// Soft delete keeps the file (deleted: true) so it can be restored from Trash.

const fs   = require('fs');
const path = require('path');

const LIVING_SUMMARY_SYSTEM = `You maintain the "living summary" of a personal project from the voice notes filed under it.

Write Markdown with only the sections that have real content, each with a "### " heading, in this order:
### Overview — one or two sentences on what the project is.
### Current status — where things stand now, based on the most recent notes.
### Key decisions — bullets.
### Open action items — bullets; include dates or deadlines exactly as given ("Tue, Oct 20"). Leave out anything a later note says is done.
### People & places — bullets.

Rules:
- Leave out any section with nothing to say — never write "None" or "Not yet".
- Never invent facts, names, numbers or dates. If notes disagree, the newest note wins; mention the change only if it matters.
- Be concise: aim for under 200 words. No preamble, no closing remarks, no code fences.`;

const isProjectId = id => typeof id === 'string' && /^pj_\d+_[a-z0-9]+$/.test(id);
const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function createProjects({ archivePath, getNote, listNotes, updateNote, onChange = () => {} }) {
  const dir = path.join(archivePath, '08_Projects');
  const fileFor = id => path.join(dir, `${id}.json`);

  function read(id) {
    if (!isProjectId(id)) return null;
    try { return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')); } catch { return null; }
  }

  function write(p) {
    fs.mkdirSync(dir, { recursive: true });
    // Background summary runs may have written a newer living summary
    const onDisk = read(p.id);
    if (onDisk && (onDisk.livingSummaryUpdatedAt || '') > (p.livingSummaryUpdatedAt || '')) {
      for (const f of ['livingSummary', 'livingSummaryStatus', 'livingSummaryError', 'livingSummaryUpdatedAt']) p[f] = onDisk[f];
    }
    p.updatedAt = new Date().toISOString();
    const tmp = fileFor(p.id) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(p, null, 2), 'utf8');
    fs.renameSync(tmp, fileFor(p.id));
    onChange(p);
    return p;
  }

  function list({ includeDeleted = false } = {}) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const f of fs.readdirSync(dir)) {
      if (!/^pj_[\w-]+\.json$/.test(f)) continue;
      try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* skip */ }
    }
    return out
      .filter(p => includeDeleted || !p.deleted)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  const active = () => list().filter(p => p.status !== 'archived');

  function create({ name, aliases = [] }) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!clean) throw Object.assign(new Error('name is required'), { status: 400 });
    const now = new Date().toISOString();
    const p = {
      id: `pj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: clean,
      aliases: [...new Set(aliases.map(a => String(a).trim()).filter(Boolean))],
      status: 'active',
      livingSummary: null, livingSummaryStatus: null, livingSummaryUpdatedAt: null,
      noteIds: [], audit: [],
      deleted: false, deletedAt: null, mergedInto: null,
      createdAt: now,
    };
    return write(p);
  }

  /** Project named (or aliased) like `name`: exact first, then close matches. */
  function findByName(name, { includeArchived = true } = {}) {
    const q = norm(name);
    if (!q) return null;
    const pool = includeArchived ? list() : active();
    const names = p => [p.name, ...(p.aliases || [])].map(norm);
    return pool.find(p => names(p).includes(q))
      || pool.find(p => names(p).some(n => n.length >= 4 && (n.includes(q) || q.includes(n))))
      || null;
  }

  function addNote(projectId, noteId) {
    const p = read(projectId);
    if (!p || p.deleted) throw Object.assign(new Error('Project not found'), { status: 404 });
    if (!p.noteIds.includes(noteId)) p.noteIds.unshift(noteId);
    updateNote(noteId, n => { n.projectId = p.id; });
    markSummaryPending(p);
    write(p);
    queueSummary(p.id);
    return p;
  }

  function removeNote(projectId, noteId) {
    const p = read(projectId);
    if (!p) return null;
    p.noteIds = p.noteIds.filter(id => id !== noteId);
    updateNote(noteId, n => { if (n.projectId === projectId) n.projectId = null; });
    markSummaryPending(p);
    write(p);
    queueSummary(p.id);
    return p;
  }

  // ── Living summary (async queue, one at a time) ───────────────────────────

  const queue = [];
  let running = false;

  function markSummaryPending(p) {
    p.livingSummaryStatus = p.noteIds.length ? 'pending' : null;
    if (!p.noteIds.length) p.livingSummary = null;
    p.livingSummaryUpdatedAt = new Date().toISOString();
  }

  function queueSummary(id) {
    if (!queue.includes(id)) queue.push(id);
    drain();
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const id = queue.shift();
        const p = read(id);
        if (!p || p.deleted || !p.noteIds.length) continue;
        try {
          const summary = await summarizeProject(p);
          const fresh = read(id);
          Object.assign(fresh, { livingSummary: summary, livingSummaryStatus: 'done', livingSummaryError: null, livingSummaryUpdatedAt: new Date().toISOString() });
          write(fresh);
        } catch (err) {
          console.warn(`[projects] Living summary failed for ${id}: ${err.message}`);
          const fresh = read(id);
          Object.assign(fresh, { livingSummaryStatus: 'failed', livingSummaryError: err.message, livingSummaryUpdatedAt: new Date().toISOString() });
          write(fresh);
        }
      }
    } finally {
      running = false;
    }
  }

  function noteForSummary(n) {
    const when = (n.capturedAt || n.createdAt || '').slice(0, 10);
    const updates = (n.updates || []).map(u => `  - Update ${(u.at || '').slice(0, 10)}: ${u.text}`).join('\n');
    const items = (n.items || []).length ? `\n  Checklist: ${n.items.map(i => `${i.done ? '[x]' : '[ ]'} ${i.text}`).join(', ')}` : '';
    return `- ${when} · ${n.title}\n  ${String(n.content || n.transcript || '').slice(0, 1500)}${items}${updates ? `\n${updates}` : ''}`;
  }

  async function summarizeProject(p) {
    if (!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY not set');
    const notes = p.noteIds.map(getNote).filter(n => n && !n.undone)
      .sort((a, b) => (a.capturedAt || a.createdAt || '').localeCompare(b.capturedAt || b.createdAt || ''));
    if (!notes.length) return null;
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const msg = await client.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
      max_tokens: 3000,
      system: LIVING_SUMMARY_SYSTEM,
      messages: [{
        role: 'user',
        content: `Project: ${p.name}${p.aliases?.length ? ` (also called ${p.aliases.join(', ')})` : ''}\n\nNotes, oldest first:\n${notes.map(noteForSummary).join('\n')}`,
      }],
      output_config: { effort: 'medium' },
      fallbacks: 'default',
    }, { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } });
    if (msg.stop_reason === 'refusal') throw new Error('Claude declined to summarize this project');
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim()
      .replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();
    if (!text) throw new Error('Claude returned an empty summary');
    return text;
  }

  /** Projects whose living summary never finished (e.g. after a restart). */
  function backfill() {
    for (const p of list()) {
      if (p.noteIds.length && (p.livingSummaryStatus === 'pending' || !p.livingSummaryStatus)) queueSummary(p.id);
    }
  }

  // ── Routes ───────────────────────────────────────────────────────────────

  const withNotes = p => ({
    ...p,
    notes: p.noteIds.map(getNote).filter(n => n && !n.undone)
      .sort((a, b) => (b.capturedAt || b.createdAt || '').localeCompare(a.capturedAt || a.createdAt || '')),
  });

  function register(app) {
    app.get('/api/projects', (req, res) => {
      const all = list({ includeDeleted: req.query.deleted === '1' });
      res.json(req.query.deleted === '1' ? all.filter(p => p.deleted) : all.map(p => ({
        ...p,
        noteCount: p.noteIds.filter(id => { const n = getNote(id); return n && !n.undone; }).length,
      })));
    });

    app.post('/api/projects', (req, res) => {
      try {
        const existing = findByName(req.body?.name, { includeArchived: false });
        if (existing && req.body?.allowDuplicate !== true) return res.status(409).json({ error: `“${existing.name}” already exists`, project: existing });
        res.json(create({ name: req.body?.name, aliases: req.body?.aliases || [] }));
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/projects/:id', (req, res) => {
      const p = read(req.params.id);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      res.json(withNotes(p));
    });

    // PUT /api/projects/:id { name?, aliases?, status? }
    app.put('/api/projects/:id', (req, res) => {
      const p = read(req.params.id);
      if (!p || p.deleted) return res.status(404).json({ error: 'Project not found' });
      const body = req.body || {};
      if (typeof body.name === 'string' && body.name.trim()) {
        const clean = body.name.trim().replace(/\s+/g, ' ').slice(0, 80);
        // Keep the old name as an alias so voice notes still find it
        if (norm(clean) !== norm(p.name) && !p.aliases.some(a => norm(a) === norm(p.name))) p.aliases.push(p.name);
        p.name = clean;
      }
      if (Array.isArray(body.aliases)) p.aliases = [...new Set(body.aliases.map(a => String(a).trim()).filter(Boolean))].filter(a => norm(a) !== norm(p.name));
      if (body.status === 'active' || body.status === 'archived') p.status = body.status;
      res.json(withNotes(write(p)));
    });

    // POST /api/projects/:id/merge { intoId } — move everything into another project
    app.post('/api/projects/:id/merge', (req, res) => {
      const from = read(req.params.id);
      const into = read(req.body?.intoId);
      if (!from || !into || from.deleted || into.deleted) return res.status(404).json({ error: 'Project not found' });
      if (from.id === into.id) return res.status(400).json({ error: 'Choose a different project' });
      for (const id of from.noteIds) {
        if (!into.noteIds.includes(id)) into.noteIds.push(id);
        updateNote(id, n => { n.projectId = into.id; });
      }
      into.aliases = [...new Set([...into.aliases, from.name, ...from.aliases])].filter(a => norm(a) !== norm(into.name));
      into.audit = [...(into.audit || []), { kind: 'merge', fromId: from.id, noteIds: from.noteIds, at: new Date().toISOString() }];
      markSummaryPending(into);
      write(into);
      Object.assign(from, { deleted: true, deletedAt: new Date().toISOString(), mergedInto: into.id });
      write(from);
      queueSummary(into.id);
      res.json(withNotes(into));
    });

    // POST /api/projects/:id/notes { noteIds[] } — "Add to project…"
    app.post('/api/projects/:id/notes', (req, res) => {
      const p = read(req.params.id);
      if (!p || p.deleted) return res.status(404).json({ error: 'Project not found' });
      const ids = (req.body?.noteIds || []).filter(id => getNote(id));
      for (const id of ids) {
        const n = getNote(id);
        if (n.projectId && n.projectId !== p.id) removeNote(n.projectId, id);
        if (!p.noteIds.includes(id)) p.noteIds.unshift(id);
        updateNote(id, x => { x.projectId = p.id; });
      }
      markSummaryPending(p);
      write(p);
      queueSummary(p.id);
      res.json(withNotes(p));
    });

    app.delete('/api/projects/:id/notes/:noteId', (req, res) => {
      const p = removeNote(req.params.id, req.params.noteId);
      if (!p) return res.status(404).json({ error: 'Project not found' });
      res.json(withNotes(p));
    });

    app.post('/api/projects/:id/summarize', (req, res) => {
      const p = read(req.params.id);
      if (!p || p.deleted) return res.status(404).json({ error: 'Project not found' });
      markSummaryPending(p);
      write(p);
      queueSummary(p.id);
      res.json(p);
    });

    // Soft delete / restore (Trash)
    app.delete('/api/projects/:id', (req, res) => {
      const p = read(req.params.id);
      if (!p || p.deleted) return res.status(404).json({ error: 'Project not found' });
      Object.assign(p, { deleted: true, deletedAt: new Date().toISOString() });
      res.json(write(p));
    });

    app.post('/api/projects/:id/restore', (req, res) => {
      const p = read(req.params.id);
      if (!p || !p.deleted) return res.status(404).json({ error: 'Project not found in trash' });
      Object.assign(p, { deleted: false, deletedAt: null, mergedInto: null });
      // Notes that were moved elsewhere meanwhile stay where they are
      p.noteIds = p.noteIds.filter(id => { const n = getNote(id); return n && (!n.projectId || n.projectId === p.id); });
      for (const id of p.noteIds) updateNote(id, n => { n.projectId = p.id; });
      markSummaryPending(p);
      write(p);
      queueSummary(p.id);
      res.json(p);
    });
  }

  return {
    register, read, write, list, active, create, findByName, addNote, removeNote,
    queueSummary, markSummaryPending, backfill, isProjectId,
  };
}

module.exports = { createProjects, isProjectId };
