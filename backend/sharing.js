// Sharing + live sync between users.
//
// Items stay in the owner's folder. CONFIG_DIR/shares.json is the source of truth for access:
//   [{ ownerId, kind: 'note'|'project', itemId, userId, role: 'edit'|'view', addedAt, addedBy }]
// The item also carries sharedWith: [{ userId, role, addedAt }] for display.
// Sharing a project shares its notes with the same role.
//
// Requests for a shared item are routed to the OWNER's per-user routes after a permission check:
//   view  → read it (GET note / audio / media / project), a fired location reminder still counts
//   edit  → also list items (PATCH items, POST ops), title + text (PUT, only those fields), done, summarize
//   owner → everything else (delete, combine, move, merge, project, sharing, …)
// Live: GET /api/events (Server-Sent Events, per user, 25 s heartbeat). Background (phone): GET /api/changes.

const fs = require('fs');
const path = require('path');

const ROLES = ['edit', 'view'];
const NOTE_RE = /^qn_[\w-]+$/;
const PROJECT_RE = /^pj_\d+_[a-z0-9]+$/;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function createSharing({ users, contexts, getConfig }) {
  const SHARES_PATH = path.join(users.CONFIG_DIR, 'shares.json');
  const personOf = id => {
    const u = users.getUser(id);
    return u ? { id: u.id, name: u.displayName || u.username, initials: u.initials, color: u.color } : null;
  };
  const active = id => { const u = users.getUser(id); return !!u && !u.disabled; };

  // ── Share index ──────────────────────────────────────────────────────────
  function allShares() {
    // Entries whose owner or recipient no longer exists are ignored (deleted accounts)
    return readJson(SHARES_PATH, []).filter(s => users.getUser(s.ownerId) && users.getUser(s.userId));
  }
  const saveShares = list => writeJson(SHARES_PATH, list);
  const sharesFor = (ownerId, kind, itemId) => allShares().filter(s => s.ownerId === ownerId && s.kind === kind && s.itemId === itemId);

  const ctxOf = id => contexts.get(id);
  const ownNote = (userId, id) => ctxOf(userId).quick.store.read(id);
  const ownProject = (userId, id) => { const p = ctxOf(userId).quick.projects.read(id); return p && !p.deleted ? p : null; };

  /** { ownerId, role } for a note shared with this user (directly or through its project), or null */
  function noteAccess(userId, noteId) {
    let best = null;
    for (const s of allShares()) {
      if (s.userId !== userId || !active(s.ownerId)) continue;
      let hit = false;
      if (s.kind === 'note' && s.itemId === noteId) hit = true;
      else if (s.kind === 'project') {
        const n = ownNote(s.ownerId, noteId);
        hit = !!n && n.projectId === s.itemId;
      }
      if (hit && (!best || (best.role === 'view' && s.role === 'edit'))) best = { ownerId: s.ownerId, role: s.role };
    }
    return best;
  }
  function projectAccess(userId, projectId) {
    const s = allShares().find(x => x.userId === userId && x.kind === 'project' && x.itemId === projectId && active(x.ownerId));
    return s ? { ownerId: s.ownerId, role: s.role } : null;
  }

  /** Users (besides the owner) who can see a note right now */
  function audienceOf(ownerId, note) {
    const ids = new Set(sharesFor(ownerId, 'note', note.id).map(s => s.userId));
    if (note.projectId) for (const s of sharesFor(ownerId, 'project', note.projectId)) ids.add(s.userId);
    return [...ids];
  }
  const isShared = (ownerId, note) => audienceOf(ownerId, note).length > 0;

  /** A note as a recipient sees it: plus who shared it and with which role */
  function annotate(note, ownerId, role) {
    return { ...note, sharedFrom: { ownerId, ...personOf(ownerId), role } };
  }

  /** Notes shared with userId (all roles, or only editable ones) */
  function sharedNotes(userId, { editableOnly = false } = {}) {
    const out = new Map();
    for (const s of allShares()) {
      if (s.userId !== userId || !active(s.ownerId)) continue;
      if (editableOnly && s.role !== 'edit') continue;
      const ownerCtx = ctxOf(s.ownerId);
      const notes = s.kind === 'note' ? [ownerCtx.quick.store.read(s.itemId)]
        : ownerCtx.quick.store.list().filter(n => n.projectId === s.itemId);
      for (const n of notes) {
        if (!n || n.undone || n.hidden) continue;
        const prev = out.get(n.id);
        if (!prev || (prev.sharedFrom.role === 'view' && s.role === 'edit')) out.set(n.id, annotate(n, s.ownerId, s.role));
      }
    }
    return [...out.values()];
  }

  /** Projects shared with userId (with sharedFrom) */
  function sharedProjects(userId) {
    return allShares().filter(s => s.userId === userId && s.kind === 'project' && active(s.ownerId))
      .map(s => { const p = ownProject(s.ownerId, s.itemId); return p && { ...p, sharedFrom: { ownerId: s.ownerId, ...personOf(s.ownerId), role: s.role } }; })
      .filter(Boolean);
  }

  /** For userContext: editable shared notes as a store-like accessor (smart append + errand feeds) */
  function foreignFor(userId) {
    const strip = n => { const { sharedFrom, ...rest } = n; return rest; };
    return {
      list: () => sharedNotes(userId, { editableOnly: true }),
      listAll: () => sharedNotes(userId),
      read: id => {
        const a = noteAccess(userId, id);
        if (!a || a.role !== 'edit') return null;
        const n = ownNote(a.ownerId, id);
        return n ? annotate(n, a.ownerId, a.role) : null;
      },
      write: note => {
        const a = noteAccess(userId, note.id);
        if (!a || a.role !== 'edit') throw Object.assign(new Error('You can’t edit this list'), { status: 403 });
        return annotate(ctxOf(a.ownerId).quick.saveFromShare(strip(note)), a.ownerId, a.role);
      },
    };
  }

  // ── Live events (SSE) ────────────────────────────────────────────────────
  const streams = new Map(); // userId → Set(res)
  function publish(userIds, event) {
    const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const id of new Set(userIds)) for (const res of streams.get(id) || []) { try { res.write(data); } catch { /* closed */ } }
  }
  /** Called by every per-user store after a note is saved */
  function noteWritten(ownerId, note) {
    const audience = audienceOf(ownerId, note);
    const last = (note.activity || []).at(-1);
    const recent = last && Date.now() - Date.parse(last.at) < 10_000 ? last : null;
    publish([ownerId, ...audience], {
      type: 'note', id: note.id, ownerId, at: note.updatedAt, title: note.title,
      by: recent?.by || null, byName: recent?.byName || null, action: recent?.action || null, text: recent?.text || null,
    });
  }

  // ── Permission check for shared items → owner's routes ───────────────────
  const EDIT_PUT_KEYS = new Set(['title', 'content', 'regenerateSummary', 'bodyPosition']);
  function allowedNote(role, method, sub, body) {
    // Viewers: the note, its audio/photo, and every attachment, page and preview
    if (method === 'GET' && (['', '/audio', '/media'].includes(sub) || sub.startsWith('/attachments/:aid'))) return true;
    if (role !== 'edit') return false;
    // Editors: attachments and pages (add, edit, reorder, rotate…), the cover, the document details + reprocess.
    // Filing the note into a project stays the owner's (it's the owner's project list).
    if (method !== 'GET' && (sub.startsWith('/attachments') || sub === '/cover')) return true;
    if (method !== 'GET' && sub.startsWith('/document') && sub !== '/document/project') return true;
    if (method === 'POST' && ['/ops', '/done', '/summarize'].includes(sub)) return true;
    if (method === 'PATCH' && sub === '/items') return true;
    if (method === 'PUT' && sub === '') return Object.keys(body || {}).every(k => EDIT_PUT_KEYS.has(k));
    return false;
  }
  function route(req, res, next) {
    if (!req.user) return next();
    const own = ctxOf(req.user.id);
    let m = req.path.match(/^\/api\/quick\/(qn_[\w-]+)((?:\/(?:[a-z-]+|at_[a-z0-9]+|pg_[a-z0-9]+))*)$/);
    if (m && !own.quick.store.read(m[1])) {
      const a = noteAccess(req.user.id, m[1]);
      if (!a) return own.router(req, res, next); // → the user's own 404
      if (!allowedNote(a.role, req.method, (m[2] || '').replace(/\/at_[a-z0-9]+/g, '/:aid').replace(/\/pg_[a-z0-9]+/g, '/:pid'), req.body)) {
        return res.status(403).json({ error: a.role === 'view' ? 'You can view this but not change it' : `Only ${personOf(a.ownerId)?.name || 'the owner'} can do that` });
      }
      req.sharedAccess = a;
      // Responses say whose note it is and what this person may do
      const json = res.json.bind(res);
      res.json = body => json(body?.id === m[1] ? annotate(body, a.ownerId, a.role)
        : body?.note?.id === m[1] ? { ...body, note: annotate(body.note, a.ownerId, a.role) } : body);
      return ctxOf(a.ownerId).router(req, res, next);
    }
    m = req.path.match(/^\/api\/errands\/(qn_[\w-]+)\/triggered$/);
    if (m && req.method === 'POST' && !own.quick.store.read(m[1])) {
      const a = noteAccess(req.user.id, m[1]);
      if (a) return ctxOf(a.ownerId).router(req, res, next);
    }
    m = req.path.match(/^\/api\/projects\/(pj_\d+_[a-z0-9]+)(\/.*)?$/);
    if (m && !ownProject(req.user.id, m[1])) {
      const a = projectAccess(req.user.id, m[1]);
      if (!a) return own.router(req, res, next);
      if (!(req.method === 'GET' && !m[2])) return res.status(403).json({ error: `Only ${personOf(a.ownerId)?.name || 'the owner'} can change this project` });
      const json = res.json.bind(res);
      res.json = body => json(body?.id === m[1] ? annotate(body, a.ownerId, a.role) : body);
      return ctxOf(a.ownerId).router(req, res, next);
    }
    return own.router(req, res, next);
  }

  // ── Mirror on the item (display) ─────────────────────────────────────────
  function mirror(ownerId, kind, itemId) {
    const sharedWith = sharesFor(ownerId, kind, itemId).map(s => ({ userId: s.userId, role: s.role, addedAt: s.addedAt }));
    const ctx = ctxOf(ownerId);
    if (kind === 'note') {
      const n = ctx.quick.store.read(itemId);
      if (n) { n.sharedWith = sharedWith; ctx.quick.store.write(n); }
    } else {
      const p = ctx.quick.projects.read(itemId);
      if (p) { p.sharedWith = sharedWith; ctx.quick.projects.write(p); }
      // its notes changed audience too
      for (const n of ctx.quick.store.list().filter(x => x.projectId === itemId)) noteWritten(ownerId, n);
    }
  }

  // ── Routes ───────────────────────────────────────────────────────────────
  function register(app) {
    const kindOk = (req, res) => {
      const { kind, id } = req.params;
      if (!(kind === 'note' && NOTE_RE.test(id)) && !(kind === 'project' && PROJECT_RE.test(id))) { res.status(400).json({ error: 'Unknown item' }); return false; }
      return true;
    };
    const ownsItem = (userId, kind, id) => (kind === 'note' ? !!ownNote(userId, id) : !!ownProject(userId, id));

    // People you can share with
    app.get('/api/share/people', (req, res) => {
      res.json(users.listUsers().filter(u => u.id !== req.user.id && !u.disabled).map(u => personOf(u.id)));
    });

    // Who has access (owner or a recipient can ask)
    app.get('/api/share/:kind/:id', (req, res) => {
      if (!kindOk(req, res)) return;
      const { kind, id } = req.params;
      let ownerId = ownsItem(req.user.id, kind, id) ? req.user.id : null;
      if (!ownerId) ownerId = (kind === 'note' ? noteAccess(req.user.id, id) : projectAccess(req.user.id, id))?.ownerId || null;
      if (!ownerId) return res.status(404).json({ error: 'Not found' });
      res.json({
        owner: personOf(ownerId), isOwner: ownerId === req.user.id,
        people: sharesFor(ownerId, kind, id).map(s => ({ ...personOf(s.userId), role: s.role, addedAt: s.addedAt })),
      });
    });

    // Share or change the role (owner only)
    app.post('/api/share/:kind/:id', (req, res) => {
      if (!kindOk(req, res)) return;
      const { kind, id } = req.params;
      const { userId, role } = req.body || {};
      if (!ownsItem(req.user.id, kind, id)) return res.status(403).json({ error: 'Only the owner can share this' });
      if (kind === 'note' && ctxOf(req.user.id).quick.store.read(id)?.type === 'action') return res.status(400).json({ error: 'Actions are private' });
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'role must be edit or view' });
      if (!userId || userId === req.user.id || !active(userId)) return res.status(400).json({ error: 'Pick someone to share with' });
      const list = readJson(SHARES_PATH, []);
      const existing = list.find(s => s.ownerId === req.user.id && s.kind === kind && s.itemId === id && s.userId === userId);
      if (existing) existing.role = role;
      else list.push({ ownerId: req.user.id, kind, itemId: id, userId, role, addedAt: new Date().toISOString(), addedBy: req.user.id });
      saveShares(list);
      if (kind === 'note') {
        const ctx = ctxOf(req.user.id);
        const n = ctx.quick.store.read(id);
        ctx.quick.logActivity(n, { id: req.user.id, name: req.user.displayName || req.user.username }, 'shared with', personOf(userId)?.name);
        ctx.quick.store.write(n);
      }
      mirror(req.user.id, kind, id);
      publish([userId], { type: 'share', kind, id, ownerId: req.user.id, byName: req.user.displayName || req.user.username, role, at: new Date().toISOString() });
      users.logEvent('share', { userId: req.user.id, kind, to: userId, role });
      res.json({ success: true });
    });

    // Remove someone (owner) or leave (the recipient removes themselves)
    app.delete('/api/share/:kind/:id/:userId', (req, res) => {
      if (!kindOk(req, res)) return;
      const { kind, id, userId } = req.params;
      const owner = ownsItem(req.user.id, kind, id);
      if (!owner && userId !== req.user.id) return res.status(403).json({ error: 'Only the owner can remove people' });
      const list = readJson(SHARES_PATH, []);
      const entry = list.find(s => s.kind === kind && s.itemId === id && s.userId === userId && (owner ? s.ownerId === req.user.id : true));
      if (!entry) return res.status(404).json({ error: 'Not shared with that person' });
      saveShares(list.filter(s => s !== entry));
      mirror(entry.ownerId, kind, id);
      publish([entry.ownerId, userId], { type: 'share', kind, id, ownerId: entry.ownerId, removed: userId, at: new Date().toISOString() });
      res.json({ success: true });
    });

    // Shared with me
    app.get('/api/shared', (req, res) => {
      const notes = sharedNotes(req.user.id).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      res.json({ notes, projects: sharedProjects(req.user.id) });
    });

    // Changes by others since a time (phone background check → widget + notification)
    app.get('/api/changes', (req, res) => {
      const since = Date.parse(req.query.since) || Date.now() - 15 * 60 * 1000;
      const me = req.user.id;
      const own = ctxOf(me).quick.store.list().filter(n => !n.undone && !n.hidden);
      const changes = [];
      for (const n of [...own, ...sharedNotes(me)]) {
        for (const a of n.activity || []) {
          if (a.by && a.by !== me && Date.parse(a.at) > since) {
            changes.push({ noteId: n.id, ownerId: n.sharedFrom?.ownerId || me, title: n.title, by: a.by, byName: a.byName, action: a.action, text: a.text, at: a.at });
          }
        }
      }
      changes.sort((a, b) => a.at.localeCompare(b.at));
      res.json({ now: new Date().toISOString(), changes: changes.slice(-100), notify: { mode: 'every', quietStart: '22:00', quietEnd: '07:00', shareLocation: false, ...(ctxOf(me).getSettings().notify || {}) } });
    });

    // Live stream (web + app screens). Auth: cookie, device token, or ?mt= media token (EventSource can't send headers)
    app.get('/api/events', (req, res) => {
      res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // nginx / Synology reverse proxy: don't buffer
      });
      res.flushHeaders?.();
      res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ userId: req.user.id, at: new Date().toISOString() })}\n\n`);
      const set = streams.get(req.user.id) || new Set();
      set.add(res);
      streams.set(req.user.id, set);
      const beat = setInterval(() => { try { res.write(`: ping ${Date.now()}\n\n`); } catch { /* closed */ } }, 25_000);
      req.on('close', () => { clearInterval(beat); set.delete(res); });
    });
  }

  /** Family calendar (admin setting, empty by default): events on shared items go there when set */
  function calendarIdFor(ownerId, note, fallback) {
    const family = String(getConfig().familyCalendarId || '').trim();
    return family && isShared(ownerId, note) ? family : fallback;
  }

  return { route, register, foreignFor, noteWritten, isShared, calendarIdFor, publish, sharedNotes, sharedProjects, SHARES_PATH };
}

module.exports = { createSharing };
