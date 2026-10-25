// Offline copy for the Android app (2.9.0). The phone keeps an encrypted local copy of what the signed-in user can
// read — their notes + what's shared with them; for the archive admin also the Hey Pocket recordings — and asks
// here for what changed. Never anyone else's data: the same pools as the rest of the API (own store +
// sharing.sharedNotes / sharedProjects). The capture-only token (app lock) can't use any of this.
//
//   GET /api/offline/manifest                 sizes per kind (what a full copy needs) — Settings → Offline & storage
//   GET /api/offline/sync?since=&page=        notes changed since (paged), all ids (deletions), shared notes,
//                                             projects, and the media files of the changed notes
//   GET /api/offline/archive?since=           admin: recordings changed since, all ids, their audio / attachments
//
// Media keys are the exact paths the screens request (/api/quick/<id>/media, /api/quick/<id>/attachments/<aid>…),
// so the app can answer those requests from its copy. `v` = the version the screens put in ?v= (cache busting).

const fs = require('fs');
const path = require('path');

const PAGE = 300;
const SAFETY_MS = 2000; // a write that started just before "now" is sent again next time (harmless)

const statSize = file => { try { return fs.statSync(file).size; } catch { return null; } };

/** Media files of one note: [{ key, v, size, kind, noteId }] (only files that exist) */
function noteMedia(note, store) {
  const out = [];
  const add = (key, file, kind, v = null) => {
    const size = statSize(file);
    if (size != null) out.push({ key, v: v == null ? null : String(v), size, kind, noteId: note.id });
  };
  const base = `/api/quick/${note.id}`;
  if (note.audioFile) add(`${base}/audio`, path.join(store.audioDir, path.basename(note.audioFile)), 'audio');
  if (note.media?.file) add(`${base}/media`, path.join(store.mediaDir, path.basename(note.media.file)), 'photo');
  const dir = path.join(store.dir, 'attachments', note.id);
  for (const a of note.attachments || []) {
    if (!a?.id || !a.file) continue;
    const kind = a.pageList?.length || a.source === 'scan' ? 'scan' : a.kind === 'image' ? 'photo' : a.kind === 'audio' ? 'audio' : 'file';
    add(`${base}/attachments/${a.id}`, path.join(dir, path.basename(a.file)), kind, a.version);
    if (a.thumb) add(`${base}/attachments/${a.id}/thumb`, path.join(dir, `${a.id}.thumb.jpg`), 'thumb', a.version);
    for (const p of a.pageList || []) {
      if (!p?.id || !p.file) continue;
      add(`${base}/attachments/${a.id}/pages/${p.id}`, path.join(dir, path.basename(p.file)), 'scan', p.version);
      if (p.thumb) add(`${base}/attachments/${a.id}/pages/${p.id}/thumb`, path.join(dir, `${a.id}_${p.id}.thumb.jpg`), 'thumb', p.version);
    }
  }
  return out;
}

/** Where a shared note's files are: the owner's store */
function ownerStore(contexts, n) {
  try { return contexts.get(n.sharedFrom.ownerId).quick.store; } catch { return null; }
}

/**
 * deps: { contexts, sharing, archive: { ids(), files(id) → [{ key, file, kind }], stamp(id) → ms } | null,
 *         maps: () → [{ name, file, bytes }] (installed PMTiles maps) }
 */
function createOffline({ contexts, sharing, archive, maps = () => [] }) {
  /**
   * The map for offline use (only downloaded when the phone's "Keep the map for offline use" is on): the default
   * PMTiles file + what MapLibre needs to draw it — the light and dark sprites and the Latin font ranges.
   */
  function mapMedia() {
    const list = maps();
    const map = list.find(m => m.name === 'florida') || list[0];
    if (!map) return [];
    const out = [{ key: `/api/maps/tiles/${map.name}.pmtiles`, v: null, size: map.bytes, kind: 'map' }];
    for (const flavor of ['light', 'dark']) for (const f of [`${flavor}.json`, `${flavor}.png`, `${flavor}@2x.json`, `${flavor}@2x.png`]) out.push({ key: `/api/maps/sprites/${f}`, v: null, size: 0, kind: 'map' });
    for (const stack of ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic']) for (const range of ['0-255', '256-511', '8192-8447']) out.push({ key: `/api/maps/fonts/${stack}/${range}.pbf`, v: null, size: 0, kind: 'map' });
    return out;
  }

  const userNotes = userId => contexts.get(userId).quick.store.list();

  function manifest(user) {
    const ctx = contexts.get(user.id);
    const store = ctx.quick.store;
    const kinds = { text: { bytes: 0, count: 0 }, photo: { bytes: 0, count: 0 }, scan: { bytes: 0, count: 0 }, file: { bytes: 0, count: 0 }, audio: { bytes: 0, count: 0 }, thumb: { bytes: 0, count: 0 }, recording: { bytes: 0, count: 0 } };
    const addMedia = list => { for (const m of list) { kinds[m.kind].bytes += m.size; kinds[m.kind].count++; } };
    for (const n of userNotes(user.id)) {
      kinds.text.bytes += Buffer.byteLength(JSON.stringify(n)); kinds.text.count++;
      addMedia(noteMedia(n, store));
    }
    for (const n of sharing.sharedNotes(user.id)) {
      kinds.text.bytes += Buffer.byteLength(JSON.stringify(n)); kinds.text.count++;
      const s = ownerStore(contexts, n);
      if (s) addMedia(noteMedia(n, s));
    }
    kinds.text.bytes += Buffer.byteLength(JSON.stringify(ctx.quick.projects.list()));
    let archiveIncluded = false;
    if (user.role === 'admin' && archive) {
      archiveIncluded = true;
      for (const id of archive.ids()) {
        for (const f of archive.files(id)) {
          const size = statSize(f.file);
          if (size == null) continue;
          const k = f.kind === 'text' ? 'text' : f.kind === 'audio' ? 'recording' : 'file';
          kinds[k].bytes += size; if (k !== 'text') kinds[k].count++;
        }
        kinds.text.count++;
      }
    }
    const total = Object.values(kinds).reduce((a, k) => a + k.bytes, 0);
    const map = mapMedia().reduce((a, m) => a + m.size, 0);
    return { kinds, total, archive: archiveIncluded, map, at: new Date().toISOString() };
  }

  function sync(user, qs) {
    const serverTime = new Date(Date.now() - SAFETY_MS).toISOString();
    const since = typeof qs.since === 'string' && !Number.isNaN(Date.parse(qs.since)) ? new Date(qs.since).toISOString() : null;
    const page = Math.max(0, Number.parseInt(qs.page, 10) || 0);
    const limit = Math.min(1000, Math.max(20, Number.parseInt(qs.limit, 10) || PAGE));
    const store = contexts.get(user.id).quick.store;
    const all = userNotes(user.id);
    const changed = (since ? all.filter(n => (n.updatedAt || n.createdAt || '') > since) : all).sort((a, b) => a.id.localeCompare(b.id));
    const slice = changed.slice(page * limit, (page + 1) * limit);
    const out = {
      serverTime, full: !since, page, nextPage: (page + 1) * limit < changed.length ? page + 1 : null,
      changedTotal: changed.length,
      notes: slice,
      media: slice.flatMap(n => noteMedia(n, store)),
    };
    // Once per round (page 0): everything that exists (to drop what was deleted), shared items, projects
    if (page === 0) {
      out.ids = all.map(n => n.id);
      const shared = sharing.sharedNotes(user.id);
      out.shared = shared;
      out.sharedMedia = shared.flatMap(n => { const s = ownerStore(contexts, n); return s ? noteMedia(n, s) : []; });
      out.projects = contexts.get(user.id).quick.projects.list().filter(p => !p.deleted);
      out.sharedProjects = sharing.sharedProjects ? sharing.sharedProjects(user.id) : [];
      out.maps = mapMedia();
    }
    return out;
  }

  function archiveDelta(user, qs) {
    const serverTime = new Date(Date.now() - SAFETY_MS).toISOString();
    const sinceMs = typeof qs.since === 'string' && !Number.isNaN(Date.parse(qs.since)) ? Date.parse(qs.since) : 0;
    const ids = archive.ids();
    const changed = ids.filter(id => archive.stamp(id) > sinceMs);
    const media = [];
    for (const id of changed) {
      for (const f of archive.files(id)) {
        if (f.kind === 'text') continue;
        const size = statSize(f.file);
        if (size != null) media.push({ key: f.key, v: null, size, kind: f.kind === 'audio' ? 'recording' : 'file', recordingId: id });
      }
    }
    return { serverTime, full: !sinceMs, ids, changed, media };
  }

  function register(app) {
    app.get('/api/offline/manifest', (req, res) => {
      try { res.json(manifest(req.user)); } catch (err) { console.warn('[offline] manifest:', err.message); res.status(500).json({ error: 'Could not measure the offline copy' }); }
    });
    app.get('/api/offline/sync', (req, res) => {
      try { res.json(sync(req.user, req.query)); } catch (err) { console.warn('[offline] sync:', err.message); res.status(500).json({ error: 'Sync failed' }); }
    });
    // The Hey Pocket archive belongs to the admin (Lite / member accounts never get it)
    app.get('/api/offline/archive', (req, res) => {
      if (req.user.role !== 'admin' || !archive) return res.status(403).json({ error: 'The archive is the admin’s' });
      try { res.json(archiveDelta(req.user, req.query)); } catch (err) { console.warn('[offline] archive:', err.message); res.status(500).json({ error: 'Sync failed' }); }
    });
  }

  return { register, manifest, sync, archiveDelta };
}

module.exports = { createOffline, noteMedia };
