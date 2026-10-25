// Search (2.8.0): GET /api/find — your notes, lists, documents and projects, the notes and projects shared
// with you, and (the archive admin, Full layout) the Hey Pocket recordings. Never anyone else's data: the
// pool is built from req.user's own store + sharing.sharedNotes(req.user.id) only.
//
// Index: one in-memory entry per note file, kept per store folder. Each query checks the folder's file
// mtimes and re-reads only what changed (or was added / removed), so every write path — the app, smart
// append, background summaries, shares — is picked up without hooks.
//
// The matching itself (fields, tabs, filters, ranking, snippets) is search-core.mjs (2.9.0), which the
// Android app runs on its offline copy — so offline search gives the same results.

const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const { TYPES: DOC_TYPES } = require('./documents');
const coreModule = require('./search-core.mjs');

const core = coreModule.createSearchCore({ docTypes: DOC_TYPES });
const { entryFor } = core;

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

/**
 * deps: { contexts, sharing, searchRecordings(q) → [{ id, title, date, snippet, … }] (admin archive), transcribe(file, ext) }
 */
function createSearch({ contexts, sharing, searchRecordings, transcribe }) {
  /** Everything req.user may search: own notes + notes shared with them; own + shared projects */
  function pool(userId) {
    const ctx = contexts.get(userId);
    return core.pool({
      own: entriesOf(ctx.quick.store),
      shared: sharing.sharedNotes(userId),
      ownProjects: ctx.quick.projects.list(),
      sharedProjects: sharing.sharedProjects?.(userId) || [],
    });
  }

  function find(user, qs) {
    return core.find({ pool: pool(user.id), user, qs, searchRecordings });
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

module.exports = {
  createSearch, TABS: coreModule.TABS, entriesOf,
  _internal: { terms: coreModule.terms, hasWord: coreModule.hasWord, entryFor, scoreEntry: coreModule.scoreEntry, snippetOf: coreModule.snippetOf, parseFilters: coreModule.parseFilters },
};
