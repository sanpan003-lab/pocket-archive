// Attachments on quick notes (2.5.0): photos, camera shots, scanned documents (PDF), and any file
// (PDF, Word, Excel, audio, …), up to 25 MB each. Works for shared notes (the sharing proxy hands
// the request to the owner's router: viewers can open, editors can add/rename/delete) and for Lite.
//
//   ARCHIVE/07_Quick_Notes/attachments/<noteId>/<attId>.<ext>  (+ <attId>.thumb.jpg when the app sent one)
//   note.attachments = [{ id, name, ext, mime, size, kind, file, thumb, source, pages?, addedAt, addedBy,
//                         text?, textStatus?: reading|done|failed, textAt? }]
//
// Optional AI: photos and PDFs/scans can be read (Gemini) so their text is searchable.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const LIMIT = 25 * 1024 * 1024;
const THUMB_LIMIT = 2 * 1024 * 1024;
const READ_LIMIT = 15 * 1024 * 1024;   // what we send to the AI (inline)
const MAX_PER_NOTE = 50;
const ATT_ID = /^at_[a-z0-9]{6,32}$/;

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', rtf: 'application/rtf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', amr: 'audio/amr',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  zip: 'application/zip', json: 'application/json',
};
const READABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf']);
// Shown in the browser / app (everything else downloads)
const INLINE = /^(image\/|audio\/|video\/|text\/plain|application\/pdf)/;

function kindOf(mime, ext) {
  if (/^image\//.test(mime)) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (/^audio\//.test(mime)) return 'audio';
  if (/^video\//.test(mime)) return 'video';
  if (/word|opendocument\.text|rtf/.test(mime) || ['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'doc';
  if (/sheet|excel|csv/.test(mime) || ['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return 'sheet';
  if (/presentation|powerpoint/.test(mime) || ['ppt', 'pptx'].includes(ext)) return 'slides';
  if (/^text\//.test(mime)) return 'text';
  if (/zip|compressed|x-7z|x-rar|tar/.test(mime)) return 'archive';
  return 'other';
}

/** A safe display name (no folders, no control characters), ≤ 120 chars */
function cleanName(name, fallback) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim();
  return (base || fallback).slice(0, 120);
}
const extOf = name => ((/\.([a-z0-9]{1,8})$/i.exec(name || '') || [])[1] || '').toLowerCase();

/**
 * @param app       express app (the user's router)
 * @param store     the user's quick-note store (read/write/dir)
 * @param readText  async (filePath, mime) → text  (AI; throws when unavailable)
 * @param loadNote  (req, res) → note or null (sends 400/404/409)
 */
function registerAttachments(app, { store, readText, loadNote }) {
  const root = () => path.join(store.dir, 'attachments');
  const dirOf = noteId => path.join(root(), noteId);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LIMIT, files: 2 },
  }).fields([{ name: 'file', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]);

  const now = () => new Date().toISOString();
  const find = (note, aid) => (ATT_ID.test(aid) ? (note.attachments || []).find(a => a.id === aid) : null);

  /** Save the attachments list on the latest copy (newer changes from other requests are kept) */
  function save(noteId, change) {
    const fresh = store.read(noteId);
    if (!fresh) return null;
    fresh.attachments = change(fresh.attachments || []);
    fresh.attachmentsAt = now();
    return store.write(fresh);
  }

  /** AI: read the text of a photo / PDF in the background (searchable) */
  async function readInBackground(noteId, att) {
    save(noteId, list => list.map(a => (a.id === att.id ? { ...a, textStatus: 'reading' } : a)));
    let text = null;
    let ok = false;
    try {
      text = String(await readText(path.join(dirOf(noteId), att.file), att.mime) || '').trim().slice(0, 20000);
      ok = true;
    } catch (err) {
      console.warn(`[attachments] reading ${att.id} failed: ${err.message}`);
    }
    save(noteId, list => list.map(a => (a.id === att.id
      ? { ...a, text: ok ? text : a.text, textStatus: ok ? 'done' : 'failed', textAt: now() }
      : a)));
  }
  const canRead = att => READABLE.has(att.mime) && att.size <= READ_LIMIT;

  // POST /api/quick/:id/attachments — multipart: file (≤ 25 MB), thumb? (JPEG), name?, source?, pages?, read=1?
  app.post('/api/quick/:id/attachments', (req, res) => {
    upload(req, res, err => {
      if (err) {
        const tooBig = err.code === 'LIMIT_FILE_SIZE';
        return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'That file is over 25 MB' : `Upload failed: ${err.message}` });
      }
      const note = loadNote(req, res);
      if (!note) return;
      const file = req.files?.file?.[0];
      if (!file || !file.size) return res.status(400).json({ error: 'No file' });
      if ((note.attachments || []).length >= MAX_PER_NOTE) return res.status(409).json({ error: `A note can have up to ${MAX_PER_NOTE} attachments` });

      const name = cleanName(req.body?.name || file.originalname, 'Attachment');
      const ext = extOf(name) || extOf(file.originalname);
      let mime = String(file.mimetype || '').split(';')[0].trim().toLowerCase();
      if (!mime || mime === 'application/octet-stream') mime = MIME_BY_EXT[ext] || 'application/octet-stream';
      const id = `at_${crypto.randomBytes(8).toString('hex')}`;
      const stored = ext ? `${id}.${ext}` : id;
      const att = {
        id, name, ext, mime, size: file.size, kind: kindOf(mime, ext), file: stored, thumb: false,
        source: ['camera', 'photos', 'scan', 'file', 'drop'].includes(req.body?.source) ? req.body.source : 'file',
        addedAt: now(), addedBy: req.user?.id || null,
      };
      const pages = Number(req.body?.pages);
      if (pages > 0 && pages < 1000) att.pages = Math.floor(pages);
      try {
        fs.mkdirSync(dirOf(note.id), { recursive: true });
        fs.writeFileSync(path.join(dirOf(note.id), stored), file.buffer);
        const thumb = req.files?.thumb?.[0];
        if (thumb && thumb.size <= THUMB_LIMIT && /^image\/(jpeg|png|webp)$/.test(thumb.mimetype)) {
          fs.writeFileSync(path.join(dirOf(note.id), `${id}.thumb.jpg`), thumb.buffer);
          att.thumb = true;
        }
      } catch (e) {
        console.error('[attachments] save failed:', e);
        return res.status(500).json({ error: 'Could not save the file' });
      }
      const wantRead = req.body?.read === '1' && canRead(att);
      if (wantRead) att.textStatus = 'reading';
      const saved = save(note.id, list => [...list, att]);
      res.json(saved);
      if (wantRead) readInBackground(note.id, att);
    });
  });

  // GET /api/quick/:id/attachments/:aid[?download=1] — the file (Range works: audio/video seek)
  app.get('/api/quick/:id/attachments/:aid', (req, res) => {
    const note = loadNote(req, res);
    if (!note) return;
    const att = find(note, req.params.aid);
    const file = att && path.join(dirOf(note.id), path.basename(att.file));
    if (!att || !fs.existsSync(file)) return res.status(404).json({ error: 'Attachment not found' });
    const inline = !req.query.download && INLINE.test(att.mime);
    res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${att.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(att.name)}`);
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('X-Content-Type-Options', 'nosniff');
    res.sendFile(path.resolve(file), { headers: { 'Content-Type': att.mime } });
  });

  // GET /api/quick/:id/attachments/:aid/thumb
  app.get('/api/quick/:id/attachments/:aid/thumb', (req, res) => {
    const note = loadNote(req, res);
    if (!note) return;
    const att = find(note, req.params.aid);
    const file = att && path.join(dirOf(note.id), `${att.id}.thumb.jpg`);
    if (!att?.thumb || !fs.existsSync(file)) return res.status(404).json({ error: 'No preview' });
    res.set('Cache-Control', 'private, max-age=604800');
    res.sendFile(path.resolve(file), { headers: { 'Content-Type': 'image/jpeg' } });
  });

  // PATCH /api/quick/:id/attachments/:aid { name } — rename (keeps the extension if it was left off)
  app.patch('/api/quick/:id/attachments/:aid', (req, res) => {
    const note = loadNote(req, res);
    if (!note) return;
    const att = find(note, req.params.aid);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    let name = cleanName(req.body?.name, '');
    if (!name) return res.status(400).json({ error: 'Name?' });
    if (att.ext && !extOf(name)) name = `${name}.${att.ext}`.slice(0, 120);
    res.json(save(note.id, list => list.map(a => (a.id === att.id ? { ...a, name } : a))));
  });

  // DELETE /api/quick/:id/attachments/:aid
  app.delete('/api/quick/:id/attachments/:aid', (req, res) => {
    const note = loadNote(req, res);
    if (!note) return;
    const att = find(note, req.params.aid);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    for (const f of [att.file, `${att.id}.thumb.jpg`]) {
      try { fs.unlinkSync(path.join(dirOf(note.id), path.basename(f))); } catch { /* already gone */ }
    }
    res.json(save(note.id, list => list.filter(a => a.id !== att.id)));
  });

  // POST /api/quick/:id/attachments/:aid/read — "Read text" (AI) for a photo or PDF
  app.post('/api/quick/:id/attachments/:aid/read', (req, res) => {
    const note = loadNote(req, res);
    if (!note) return;
    const att = find(note, req.params.aid);
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    if (!canRead(att)) return res.status(409).json({ error: READABLE.has(att.mime) ? 'That file is too big to read (15 MB max)' : 'Only photos and PDFs can be read' });
    res.json(save(note.id, list => list.map(a => (a.id === att.id ? { ...a, textStatus: 'reading' } : a))));
    readInBackground(note.id, att);
  });
}

/** Text of a note's attachments for search (names + what was read) */
function attachmentSearchText(note) {
  return (note.attachments || []).map(a => [a.name, a.text].filter(Boolean).join('\n')).join('\n');
}

/** Remove a note's attachment folder (permanent delete) */
function removeAttachments(storeDir, noteId) {
  if (!/^qn_[\w-]+$/.test(noteId)) return;
  fs.rmSync(path.join(storeDir, 'attachments', noteId), { recursive: true, force: true });
}

module.exports = { registerAttachments, attachmentSearchText, removeAttachments, kindOf, cleanName, LIMIT, MIME_BY_EXT };
