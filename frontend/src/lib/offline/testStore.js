// Browser tests only (localStorage pa_offlineTest = '1'): a JS stand-in for the native offline store with the same
// contract (native.js) — the copy, the queue, replay in order (ids made offline → real ids, text conflicts), delta
// sync. Plain localStorage, no encryption: never used by real users (the app uses the encrypted native store).
const DB = 'pa_offlineTestDb';
const KV_SYNC = ['/auth/me', '/appearance', '/quick/settings', '/places', '/notify-settings', '/documents/settings', '/actions/settings',
  '/location-reminders', '/errands/active', '/maps/status', '/share/people'];

function load() {
  try { return JSON.parse(localStorage.getItem(DB) || 'null') || null; } catch { return null; }
}
const empty = () => ({ notes: {}, shared: {}, projects: [], sharedProjects: [], kv: {}, media: {}, queue: [], seq: 0, cursor: null, lastSyncAt: null, conflicts: 0, failed: [] });

export function createTestStore() {
  let db = load() || empty();
  const listeners = {};
  let online = navigator.onLine;
  let syncing = false;
  const save = () => { try { localStorage.setItem(DB, JSON.stringify(db)); } catch { /* full */ } };
  const fire = (ev, data) => (listeners[ev] || []).forEach(fn => fn(data));
  const statusNow = () => ({
    available: true, enabled: true, open: true, locked: false, online, syncing, pending: db.queue.length, conflicts: db.conflicts,
    lastSyncAt: db.lastSyncAt, progress: null, settings: { mode: 'everything', wifiOnlyMedia: true, limitBytes: 0 },
    usage: { text: JSON.stringify(db.notes).length + JSON.stringify(db.shared).length, photo: 0, scan: 0, file: 0, audio: 0, thumb: 0, recording: 0 },
  });
  const emitStatus = () => fire('status', statusNow());

  async function api(method, path, { body, form } = {}) {
    let payload; const headers = {};
    if (form) {
      payload = new FormData();
      for (const f of form) {
        if (f.file) {
          const bin = Uint8Array.from(atob(f.file.base64), c => c.charCodeAt(0));
          payload.append(f.name, new Blob([bin], { type: f.file.type }), f.file.filename);
        } else payload.append(f.name, f.value);
      }
    } else if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(path, { method, headers, body: payload, credentials: 'include' });
    let data = null; try { data = await r.json(); } catch { /* empty */ }
    return { status: r.status, data };
  }

  // ── Replay: oldest first; ids made offline become the server's; stop at the first network problem ───────────
  function rewrite(value, idmap) {
    if (typeof value === 'string') return Object.entries(idmap).reduce((s, [a, b]) => s.split(a).join(b), value);
    if (Array.isArray(value)) return value.map(v => rewrite(v, idmap));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'base64' ? v : rewrite(v, idmap)]));
    return value;
  }
  async function replay() {
    db.idmap = db.idmap || {};
    const lastRev = {};
    while (db.queue.length) {
      const op = db.queue[0];
      const path = rewrite(op.path, db.idmap);
      let body = op.body ? rewrite(op.body, db.idmap) : null;
      const noteId = op.noteId ? rewrite(op.noteId, db.idmap) : null;
      if (body && Number.isInteger(body.baseTextRev) && noteId && lastRev[noteId] != null) body = { ...body, baseTextRev: lastRev[noteId] };
      let res;
      try { res = await api(op.method, path, { body, form: op.form ? rewrite(op.form, db.idmap) : null }); } catch { online = false; break; }
      if (res.status >= 500 || res.status === 401 || res.status === 429) break;
      db.queue.shift();
      if (res.status === 409 && res.data?.conflict) {
        const theirs = res.data.note;
        const mine = db.notes[noteId] || db.shared[noteId] || {};
        const conflicted = { ...theirs, _conflict: { mine: { title: body?.title ?? body?.ops?.find(o => o.op === 'rename')?.title ?? mine.title, content: body?.content ?? body?.ops?.find(o => o.op === 'editText')?.text ?? mine.content }, theirs: { title: theirs.title, content: theirs.content }, at: new Date().toISOString() } };
        if (db.shared[noteId]) db.shared[noteId] = { ...conflicted, sharedFrom: db.shared[noteId].sharedFrom }; else db.notes[noteId] = conflicted;
        db.conflicts++;
        fire('conflict', { id: noteId });
        continue;
      }
      if (res.status >= 400) { db.failed.push({ op, status: res.status, error: res.data?.error || null }); continue; }
      const note = res.data?.note?.id ? res.data.note : (res.data?.id && /^qn_/.test(res.data.id) ? res.data : null);
      if (op.createsNote && note) {
        db.idmap[op.tempId] = note.id;
        delete db.notes[op.tempId];
        fire('idmap', { tempId: op.tempId, id: note.id });
      }
      if (op.createsProject && res.data?.id) {
        db.idmap[op.tempId] = res.data.id;
        db.projects = db.projects.map(p => (p.id === op.tempId ? res.data : p));
        fire('idmap', { tempId: op.tempId, id: res.data.id });
      }
      if (note) {
        if (db.shared[note.id]) db.shared[note.id] = { ...note, sharedFrom: db.shared[note.id].sharedFrom }; else db.notes[note.id] = note;
        lastRev[note.id] = note.textRev || 0;
      }
      save(); emitStatus();
    }
    save();
  }

  async function textSync() {
    const first = await api('GET', `/api/offline/sync${db.cursor ? `?since=${encodeURIComponent(db.cursor)}` : ''}`);
    if (first.status !== 200) throw new Error(`sync ${first.status}`);
    let page = first.data;
    const cursor = page.serverTime;
    for (;;) {
      // A conflict waits for the user's choice: the newer server copy doesn't erase it
      for (const n of page.notes) db.notes[n.id] = db.notes[n.id]?._conflict ? { ...n, _conflict: db.notes[n.id]._conflict } : n;
      if (page.nextPage == null) break;
      page = (await api('GET', `/api/offline/sync?${db.cursor ? `since=${encodeURIComponent(db.cursor)}&` : ''}page=${page.nextPage}`)).data;
    }
    const keep = new Set(first.data.ids);
    for (const id of Object.keys(db.notes)) if (!keep.has(id)) delete db.notes[id];
    db.shared = Object.fromEntries(first.data.shared.map(n => [n.id, db.shared[n.id]?._conflict ? { ...n, _conflict: db.shared[n.id]._conflict } : n]));
    db.projects = first.data.projects;
    db.sharedProjects = first.data.sharedProjects;
    for (const key of KV_SYNC) {
      const r = await api('GET', `/api${key}`);
      if (r.status === 200) db.kv[key] = r.data;
    }
    db.cursor = cursor;
    db.lastSyncAt = new Date().toISOString();
    save();
  }

  async function syncNow() {
    if (syncing) return {};
    syncing = true; emitStatus();
    try {
      const h = await fetch('/api/health').then(r => r.ok).catch(() => false);
      online = h && navigator.onLine;
      if (!online) return {};
      await replay();
      if (!db.queue.length) await textSync();
      fire('changed', {});
    } catch { /* next time */ } finally {
      syncing = false; emitStatus();
    }
    return {};
  }
  window.addEventListener('online', () => { syncNow(); });
  window.addEventListener('offline', () => { online = false; emitStatus(); });

  const kindMap = kind => ({ notes: db.notes, shared: db.shared })[kind];
  return {
    async status() { return statusNow(); },
    async getAll({ kind }) {
      if (kind === 'projects') return { items: db.kv.__projects || db.projects };
      if (kind === 'sharedProjects') return { items: db.sharedProjects };
      return { items: Object.values(kindMap(kind) || {}) };
    },
    async get({ kind, id }) { return { item: (kindMap(kind) || {})[id] || null }; },
    async getKv({ key }) { return { value: key in db.kv ? db.kv[key] : null }; },
    async putKv({ key, value }) { db.kv[key] = value; if (key === '__projects') db.projects = value; save(); return {}; },
    async putNotes({ notes, kind }) { for (const n of notes) (kind === 'shared' ? db.shared : db.notes)[n.id] = n; save(); return {}; },
    async removeNote({ id }) { delete db.notes[id]; save(); return {}; },
    async enqueue({ op }) { db.seq++; db.queue.push({ ...op, seq: db.seq }); save(); emitStatus(); return { seq: db.seq }; },
    async queue() { return { ops: db.queue, failed: db.failed }; },
    syncNow,
    async putMedia({ key, base64, type }) { db.media[key] = { type, size: base64.length }; save(); return {}; },
    async setSettings() { return {}; },
    async freeUpSpace() { db.media = {}; save(); return {}; },
    async wipe() { db = empty(); save(); emitStatus(); fire('changed', {}); return {}; },
    async resolveConflict({ id }) {
      for (const map of [db.notes, db.shared]) if (map[id]?._conflict) { const rest = { ...map[id] }; delete rest._conflict; map[id] = rest; db.conflicts = Math.max(0, db.conflicts - 1); }
      save(); emitStatus(); fire('changed', { ids: [id] });
      return {};
    },
    async searchArchive() { return { items: [] }; },
    addListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return Promise.resolve({ remove() { listeners[ev] = listeners[ev].filter(f => f !== fn); } }); },
    // Tests: inspect
    _db: () => db,
  };
}
