// Attachments on quick notes: photos, camera shots, scanned documents and any file (PDF, Word, Excel, audio, …),
// up to 25 MB each. Works for shared notes (the sharing proxy hands the request to the owner's router: viewers can
// open, editors can change) and for Lite.
//
//   ARCHIVE/07_Quick_Notes/attachments/<noteId>/
//     <attId>.<ext>                 the file (images: the current version, <attId>.v<n>.jpg after edits)
//     <attId>.orig.<ext>            an edited image's original (Restore original)
//     <attId>.thumb.jpg             preview (sent by the app/browser; there's no image library on the server)
//     <attId>_<pgId>.jpg (+ .thumb.jpg, .orig.jpg)   pages of a scan (2.6.0); <attId>.pdf is rebuilt from them
//
//   note.attachments = [{ id, name, ext, mime, size, kind, file, thumb, source, addedAt, addedBy,
//                         version?, original?, edited?,                      (images)
//                         pages?, pageList?: [{ id, file, thumb, original?, version? }],   (scans)
//                         text?, textStatus?: reading|done|failed, textAt? }]
//   note.coverId = '<attId>' | '<attId>/<pgId>'   (the cover image on cards)
//
// Every change that alters what a document says calls onChanged(noteId) → document processing runs again.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const { maskText } = require('./privacy');

const LIMIT = 25 * 1024 * 1024;
const THUMB_LIMIT = 2 * 1024 * 1024;
const READ_LIMIT = 15 * 1024 * 1024;   // what we send to the AI (inline)
const MAX_PER_NOTE = 50;
const MAX_PAGES = 60;
const ATT_ID = /^at_[a-z0-9]{6,32}$/;
const PG_ID = /^pg_[a-z0-9]{6,32}$/;

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
const EDITABLE_IMAGE = /^image\/(jpeg|png|webp)$/;
const PAGE_MIME = /^image\/(jpeg|png)$/;
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
const mimeOf = (file, ext) => {
  const m = String(file?.mimetype || '').split(';')[0].trim().toLowerCase();
  return !m || m === 'application/octet-stream' ? (MIME_BY_EXT[ext] || 'application/octet-stream') : m;
};
const newAttId = () => `at_${crypto.randomBytes(8).toString('hex')}`;
const newPageId = () => `pg_${crypto.randomBytes(8).toString('hex')}`;
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');

/** Is this attachment something document processing can read (photos, scans, PDFs)? */
const processable = a => !!a && (a.kind === 'image' || a.kind === 'pdf');

/** A scan's PDF, rebuilt from its page images (letter-ish size, image fills the page) */
async function buildPdf(dir, att) {
  const pdf = await PDFDocument.create();
  for (const pg of att.pageList || []) {
    const bytes = fs.readFileSync(path.join(dir, pg.file));
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const scale = 792 / Math.max(img.width, img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const page = pdf.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  const out = await pdf.save();
  const file = `${att.id}.v${att.version || 1}.pdf`;
  fs.writeFileSync(path.join(dir, file), out);
  return { file, size: out.length };
}

function multerFields() {
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMIT, files: 2 * MAX_PAGES + 2 } }).fields([
    { name: 'file', maxCount: 1 }, { name: 'thumb', maxCount: 1 },
    { name: 'page', maxCount: MAX_PAGES }, { name: 'pthumb', maxCount: MAX_PAGES },
  ]);
}

/** Wrap a multer middleware: readable errors (413 for too big) */
function parse(upload) {
  return (req, res, next) => upload(req, res, err => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'That file is over 25 MB' : `Upload failed: ${err.message}` });
  });
}

/**
 * The attachment toolkit for one user's store (also used to create document notes).
 * onChanged(noteId, reason): content changed → re-run document processing (debounced by the caller)
 */
function createAttachments({ store, readText, onChanged = () => {} }) {
  const root = () => path.join(store.dir, 'attachments');
  const dirOf = noteId => path.join(root(), noteId);
  const now = () => new Date().toISOString();

  /** Save the attachments list (and cover) on the latest copy (newer changes from other requests are kept) */
  function save(noteId, change, extra = null) {
    const fresh = store.read(noteId);
    if (!fresh) return null;
    fresh.attachments = change(fresh.attachments || []);
    if (extra) extra(fresh);
    // The cover must point at something that still exists
    if (fresh.coverId && !resolveCover(fresh)) fresh.coverId = null;
    fresh.attachmentsAt = now();
    return store.write(fresh);
  }

  function resolveCover(note) {
    const [aid, pid] = String(note.coverId || '').split('/');
    const att = (note.attachments || []).find(a => a.id === aid);
    if (!att) return null;
    if (pid) return (att.pageList || []).some(p => p.id === pid) ? note.coverId : null;
    return note.coverId;
  }

  function writeThumb(dir, base, file) {
    if (file && file.size <= THUMB_LIMIT && /^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      fs.writeFileSync(path.join(dir, `${base}.thumb.jpg`), file.buffer);
      return true;
    }
    return false;
  }

  /** A new image attachment from an uploaded file */
  function imageFrom(noteId, file, thumb, { name, source, addedBy }) {
    const dir = dirOf(noteId);
    fs.mkdirSync(dir, { recursive: true });
    const clean = cleanName(name || file.originalname, `Photo ${stamp()}.jpg`);
    const ext = extOf(clean) || extOf(file.originalname) || 'jpg';
    const mime = mimeOf(file, ext);
    const id = newAttId();
    const stored = `${id}.${ext}`;
    fs.writeFileSync(path.join(dir, stored), file.buffer);
    return {
      id, name: clean, ext, mime, size: file.size, kind: kindOf(mime, ext), file: stored,
      thumb: writeThumb(dir, id, thumb), source: source || 'file', addedAt: now(), addedBy: addedBy || null,
    };
  }

  /** A new scan attachment from page images (the PDF is built from them) */
  async function scanFrom(noteId, pages, pthumbs, { name, addedBy }) {
    const dir = dirOf(noteId);
    fs.mkdirSync(dir, { recursive: true });
    const id = newAttId();
    const att = {
      id, name: cleanName(name, `Scan ${stamp()}.pdf`), ext: 'pdf', mime: 'application/pdf', kind: 'pdf',
      source: 'scan', version: 1, pageList: [], addedAt: now(), addedBy: addedBy || null,
    };
    if (!/\.pdf$/i.test(att.name)) att.name = `${att.name}.pdf`.slice(0, 120);
    addPages(dir, att, pages, pthumbs);
    Object.assign(att, await buildPdf(dir, att));
    att.pages = att.pageList.length;
    att.thumb = false;
    return att;
  }

  function addPages(dir, att, pages, pthumbs = [], at = null) {
    const added = pages.map((p, i) => {
      if (!PAGE_MIME.test(p.mimetype)) throw Object.assign(new Error('Scan pages must be JPEG or PNG images'), { status: 400 });
      const pid = newPageId();
      const file = `${att.id}_${pid}.${p.mimetype === 'image/png' ? 'png' : 'jpg'}`;
      fs.writeFileSync(path.join(dir, file), p.buffer);
      return { id: pid, file, thumb: writeThumb(dir, `${att.id}_${pid}`, pthumbs[i]), size: p.size };
    });
    if ((att.pageList || []).length + added.length > MAX_PAGES) throw Object.assign(new Error(`A scan can have up to ${MAX_PAGES} pages`), { status: 409 });
    const list = [...(att.pageList || [])];
    list.splice(at == null ? list.length : at, 0, ...added);
    att.pageList = list;
    return added;
  }

  /** After the pages of a scan changed: new version of its PDF */
  async function rebuild(noteId, att) {
    const dir = dirOf(noteId);
    const old = att.file;
    att.version = (att.version || 1) + 1;
    Object.assign(att, await buildPdf(dir, att));
    att.pages = att.pageList.length;
    if (old && old !== att.file) { try { fs.unlinkSync(path.join(dir, old)); } catch { /* gone */ } }
    return att;
  }

  function removeFiles(noteId, names) {
    for (const f of names.filter(Boolean)) { try { fs.unlinkSync(path.join(dirOf(noteId), path.basename(f))); } catch { /* gone */ } }
  }
  function filesOf(att) {
    const list = [att.file, att.original, `${att.id}.thumb.jpg`];
    for (const p of att.pageList || []) list.push(p.file, p.original, `${att.id}_${p.id}.thumb.jpg`);
    return list;
  }

  /** Text read by AI is masked (card / account / ID numbers keep only the last 4 digits) */
  async function readInBackground(noteId, att) {
    save(noteId, list => list.map(a => (a.id === att.id ? { ...a, textStatus: 'reading' } : a)));
    let text = null;
    let ok = false;
    try {
      text = maskText(String(await readText(path.join(dirOf(noteId), att.file), att.mime) || '').trim().slice(0, 20000));
      ok = true;
    } catch (err) {
      console.warn(`[attachments] reading ${att.id} failed: ${err.message}`);
    }
    save(noteId, list => list.map(a => (a.id === att.id
      ? { ...a, text: ok ? text : a.text, textStatus: ok ? 'done' : 'failed', textAt: now() }
      : a)));
  }
  const canRead = att => READABLE.has(att.mime) && att.size <= READ_LIMIT;

  /** A photo note from before 2.6.0 (note.media): becomes an ordinary attachment so it can be edited */
  function adoptMedia(noteId, mediaDir) {
    const note = store.read(noteId);
    if (!note?.media || note.media.kind !== 'image') return note;
    const src = path.join(mediaDir, path.basename(note.media.file));
    if (!fs.existsSync(src)) return note;
    const dir = dirOf(noteId);
    fs.mkdirSync(dir, { recursive: true });
    const id = newAttId();
    const ext = note.media.ext || extOf(note.media.file) || 'jpg';
    const stored = `${id}.${ext}`;
    fs.copyFileSync(src, path.join(dir, stored));
    const att = {
      id, name: `${note.title || 'Photo'}.${ext}`.replace(/[\\/:*?"<>|]/g, '').slice(0, 120), ext, mime: MIME_BY_EXT[ext] || 'image/jpeg',
      size: fs.statSync(src).size, kind: 'image', file: stored, thumb: false, source: 'photos', addedAt: note.createdAt || now(), addedBy: null,
      text: note.mediaText || null, textStatus: note.mediaText ? 'done' : null,
    };
    return save(noteId, list => [att, ...list], fresh => {
      fresh.adoptedMedia = fresh.media;   // kept for reference; the file stays in media/
      fresh.media = null;
      if (!fresh.coverId) fresh.coverId = id;
    });
  }

  // ── Routes ───────────────────────────────────────────────────────────────
  function register(app, { loadNote, mediaDir }) {
    const upload = parse(multerFields());
    const find = (note, aid) => (ATT_ID.test(aid) ? (note.attachments || []).find(a => a.id === aid) : null);
    const pageOf = (att, pid) => (PG_ID.test(pid) ? (att?.pageList || []).find(p => p.id === pid) : null);
    const fail = (res, err) => res.status(err.status || 500).json({ error: err.status ? err.message : `That didn't work: ${err.message}` });
    const sendFile = (res, file, mime, name, inline = true) => {
      if (!fs.existsSync(file)) return res.status(404).json({ error: 'Attachment not found' });
      if (name) res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
      res.set('Cache-Control', 'private, max-age=86400');
      res.set('X-Content-Type-Options', 'nosniff');
      return res.sendFile(path.resolve(file), { headers: { 'Content-Type': mime } });
    };
    // Every route that edits works on an active note
    const load = (req, res) => loadNote(req, res);

    // POST /api/quick/:id/attachments — multipart: file (≤ 25 MB) + thumb?, or page[] (+ pthumb[]) for a scan;
    // name?, source?, read=1?
    app.post('/api/quick/:id/attachments', upload, async (req, res) => {
      const note = load(req, res);
      if (!note) return;
      const file = req.files?.file?.[0];
      const pages = req.files?.page || [];
      if (!file?.size && !pages.length) return res.status(400).json({ error: 'No file' });
      if ((note.attachments || []).length >= MAX_PER_NOTE) return res.status(409).json({ error: `A note can have up to ${MAX_PER_NOTE} attachments` });
      try {
        const by = req.user?.id || null;
        let att;
        if (pages.length) {
          att = await scanFrom(note.id, pages, req.files?.pthumb || [], { name: req.body?.name, addedBy: by });
        } else {
          att = imageFrom(note.id, file, req.files?.thumb?.[0], {
            name: req.body?.name || file.originalname,
            source: ['camera', 'photos', 'scan', 'file', 'drop'].includes(req.body?.source) ? req.body.source : 'file',
            addedBy: by,
          });
          const p = Number(req.body?.pages);
          if (p > 0 && p < 1000) att.pages = Math.floor(p);
        }
        // Document processing reads photos/scans itself; "Read text" only for the rest (or when it's off)
        const docs = onChanged(note.id, 'added', att) === true;
        const wantRead = !docs && req.body?.read === '1' && canRead(att);
        if (wantRead) att.textStatus = 'reading';
        const saved = save(note.id, list => [...list, att], fresh => {
          if (!fresh.coverId && (att.kind === 'image' || att.pageList?.length)) fresh.coverId = att.pageList?.length ? `${att.id}/${att.pageList[0].id}` : att.id;
        });
        res.json(saved);
        if (wantRead) readInBackground(note.id, att);
      } catch (err) { fail(res, err); }
    });

    // POST /api/quick/:id/attachments/order { ids } — new order (any ids left out keep their place at the end)
    app.post('/api/quick/:id/attachments/order', (req, res) => {
      const note = load(req, res);
      if (!note) return;
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
      const saved = save(note.id, list => {
        const by = new Map(list.map(a => [a.id, a]));
        const ordered = ids.map(i => by.get(i)).filter(Boolean);
        return [...ordered, ...list.filter(a => !ids.includes(a.id))];
      });
      res.json(saved);
      onChanged(note.id, 'order');
    });

    // POST /api/quick/:id/attachments/merge { ids } — scans: all pages go into the first one
    app.post('/api/quick/:id/attachments/merge', async (req, res) => {
      const note = load(req, res);
      if (!note) return;
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
      const scans = ids.map(i => find(note, i)).filter(a => a?.pageList?.length);
      if (scans.length < 2) return res.status(400).json({ error: 'Pick two or more scans to merge' });
      try {
        const [first, ...rest] = scans.map(a => JSON.parse(JSON.stringify(a)));
        const dir = dirOf(note.id);
        for (const other of rest) {
          for (const pg of other.pageList) {
            // Keep the files; they're renamed to belong to the merged scan
            const pid = newPageId();
            const ext = extOf(pg.file) || 'jpg';
            const file = `${first.id}_${pid}.${ext}`;
            fs.renameSync(path.join(dir, pg.file), path.join(dir, file));
            const moved = { id: pid, file, thumb: false, size: pg.size };
            if (pg.thumb && fs.existsSync(path.join(dir, `${other.id}_${pg.id}.thumb.jpg`))) {
              fs.renameSync(path.join(dir, `${other.id}_${pg.id}.thumb.jpg`), path.join(dir, `${first.id}_${pid}.thumb.jpg`));
              moved.thumb = true;
            }
            if (pg.original) {
              const orig = `${first.id}_${pid}.orig.${extOf(pg.original) || 'jpg'}`;
              fs.renameSync(path.join(dir, pg.original), path.join(dir, orig));
              moved.original = orig;
            }
            first.pageList.push(moved);
          }
          removeFiles(note.id, [other.file]);
        }
        await rebuild(note.id, first);
        const restIds = rest.map(a => a.id);
        res.json(save(note.id, list => list.filter(a => !restIds.includes(a.id)).map(a => (a.id === first.id ? first : a))));
        onChanged(note.id, 'merge');
      } catch (err) { fail(res, err); }
    });

    // PUT /api/quick/:id/cover { attachmentId, pageId? } (null = none)
    app.put('/api/quick/:id/cover', (req, res) => {
      const note = load(req, res);
      if (!note) return;
      const att = req.body?.attachmentId ? find(note, String(req.body.attachmentId)) : null;
      if (req.body?.attachmentId && !att) return res.status(404).json({ error: 'Attachment not found' });
      const pg = att && req.body?.pageId ? pageOf(att, String(req.body.pageId)) : null;
      res.json(save(note.id, list => list, fresh => { fresh.coverId = att ? (pg ? `${att.id}/${pg.id}` : att.id) : null; }));
    });

    // POST /api/quick/:id/attachments/adopt-media — an older photo note → an editable attachment
    app.post('/api/quick/:id/attachments/adopt-media', (req, res) => {
      const note = load(req, res);
      if (!note) return;
      res.json(adoptMedia(note.id, mediaDir));
    });

    // GET /api/quick/:id/attachments/:aid[?download=1] — the file (Range works: audio/video seek)
    app.get('/api/quick/:id/attachments/:aid', (req, res) => {
      const note = load(req, res);
      if (!note) return;
      const att = find(note, req.params.aid);
      if (!att) return res.status(404).json({ error: 'Attachment not found' });
      sendFile(res, path.join(dirOf(note.id), path.basename(att.file)), att.mime, att.name, !req.query.download && INLINE.test(att.mime));
    });

    // GET /api/quick/:id/attachments/:aid/thumb
    app.get('/api/quick/:id/attachments/:aid/thumb', (req, res) => {
      const note = load(req, res);
      if (!note) return;
      const att = find(note, req.params.aid);
      if (!att?.thumb) return res.status(404).json({ error: 'No preview' });
      sendFile(res, path.join(dirOf(note.id), `${att.id}.thumb.jpg`), 'image/jpeg');
    });

    // GET /api/quick/:id/attachments/:aid/original — an edited image's original
    app.get('/api/quick/:id/attachments/:aid/original', (req, res) => {
      const note = load(req, res);
      if (!note) return;
      const att = find(note, req.params.aid);
      if (!att?.original) return res.status(404).json({ error: 'No original' });
      sendFile(res, path.join(dirOf(note.id), path.basename(att.original)), MIME_BY_EXT[extOf(att.original)] || 'image/jpeg');
    });

    // PUT /api/quick/:id/attachments/:aid/content — edited image (rotate, crop, markup, retake): file + thumb?
    // The first version is kept as the original.
    app.put('/api/quick/:id/attachments/:aid/content', upload, (req, res) => {
      const note = load(req, res);
      if (!note) return;
      const att = find(note, req.params.aid);
      const file = req.files?.file?.[0];
      if (!att) return res.status(404).json({ error: 'Attachment not found' });
      if (att.kind !== 'image' || !EDITABLE_IMAGE.test(att.mime)) return res.status(409).json({ error: 'Only JPEG, PNG and WebP photos can be edited' });
      if (!file?.size || !EDITABLE_IMAGE.test(file.mimetype)) return res.status(400).json({ error: 'Send the edited image (JPEG or PNG)' });
      const dir = dirOf(note.id);
      const next = { ...att, version: (att.version || 1) + 1, edited: true };
      if (!att.original) next.original = att.file;          // the very first version stays
      else removeFiles(note.id, [att.file]);
      const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
      next.file = `${att.id}.v${next.version}.${ext}`;
      next.ext = ext;
      next.mime = file.mimetype;
      next.size = file.size;
      if (extOf(next.name) !== ext && extOf(next.name)) next.name = next.name.replace(/\.[a-z0-9]{1,8}$/i, `.${ext}`);
      fs.writeFileSync(path.join(dir, next.file), file.buffer);
      next.thumb = writeThumb(dir, att.id, req.files?.thumb?.[0]) || false;
      if (!next.thumb) removeFiles(note.id, [`${att.id}.thumb.jpg`]);
      res.json(save(note.id, list => list.map(a => (a.id === att.id ? next : a))));
      onChanged(note.id, 'edited');
    });

    // POST /api/quick/:id/attachments/:aid/restore — back to the original photo
    app.post('/api/quick/:id/attachments/:aid/restore', (req, res) => {
      const note = load(req, res);
      if (!note) return;
      const att = find(note, req.params.aid);
      if (!att?.original) return res.status(409).json({ error: 'This photo has no other version' });
      removeFiles(note.id, [att.file, `${att.id}.thumb.jpg`]);
      const ext = extOf(att.original) || 'jpg';
      const next = { ...att, file: att.original, original: undefined, edited: false, version: (att.version || 1) + 1, thumb: false, ext, mime: MIME_BY_EXT[ext] || att.mime };
      next.size = fs.statSync(path.join(dirOf(note.id), next.file)).size;
      delete next.original;
      res.json(save(note.id, list => list.map(a => (a.id === att.id ? next : a))));
      onChanged(note.id, 'restored');
    });

    // PATCH /api/quick/:id/attachments/:aid { name } — rename (keeps the extension if it was left off)
    app.patch('/api/quick/:id/attachments/:aid', (req, res) => {
      const note = load(req, res);
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
      const note = load(req, res);
      if (!note) return;
      const att = find(note, req.params.aid);
      if (!att) return res.status(404).json({ error: 'Attachment not found' });
      removeFiles(note.id, filesOf(att));
      res.json(save(note.id, list => list.filter(a => a.id !== att.id)));
      if (processable(att)) onChanged(note.id, 'deleted');
    });

    // POST /api/quick/:id/attachments/:aid/read — "Read text" (AI) for a photo or PDF
    app.post('/api/quick/:id/attachments/:aid/read', (req, res) => {
      const note = load(req, res);
      if (!note) return;
      const att = find(note, req.params.aid);
      if (!att) return res.status(404).json({ error: 'Attachment not found' });
      if (!canRead(att)) return res.status(409).json({ error: READABLE.has(att.mime) ? 'That file is too big to read (15 MB max)' : 'Only photos and PDFs can be read' });
      res.json(save(note.id, list => list.map(a => (a.id === att.id ? { ...a, textStatus: 'reading' } : a))));
      readInBackground(note.id, att);
    });

    // ── Scan pages ──
    const pageRoute = (req, res) => {
      const note = load(req, res);
      if (!note) return {};
      const att = find(note, req.params.aid);
      if (!att?.pageList) { res.status(404).json({ error: 'Scan not found' }); return {}; }
      const pg = req.params.pid ? pageOf(att, req.params.pid) : null;
      if (req.params.pid && !pg) { res.status(404).json({ error: 'Page not found' }); return {}; }
      return { note, att: JSON.parse(JSON.stringify(att)), pg };
    };
    const saveScan = async (res, note, att, reason) => {
      await rebuild(note.id, att);
      res.json(save(note.id, list => list.map(a => (a.id === att.id ? att : a))));
      onChanged(note.id, reason);
    };

    app.get('/api/quick/:id/attachments/:aid/pages/:pid', (req, res) => {
      const { note, att, pg } = pageRoute(req, res);
      if (!pg) return;
      sendFile(res, path.join(dirOf(note.id), path.basename(pg.file)), extOf(pg.file) === 'png' ? 'image/png' : 'image/jpeg');
    });
    app.get('/api/quick/:id/attachments/:aid/pages/:pid/thumb', (req, res) => {
      const { note, att, pg } = pageRoute(req, res);
      if (!pg) return;
      if (!pg.thumb) return res.status(404).json({ error: 'No preview' });
      sendFile(res, path.join(dirOf(note.id), `${att.id}_${pg.id}.thumb.jpg`), 'image/jpeg');
    });

    // POST /api/quick/:id/attachments/:aid/pages — add pages (page[] + pthumb[]), at? (index)
    app.post('/api/quick/:id/attachments/:aid/pages', upload, async (req, res) => {
      const { note, att } = pageRoute(req, res);
      if (!att) return;
      const pages = req.files?.page || [];
      if (!pages.length) return res.status(400).json({ error: 'No pages' });
      try {
        const at = Number.isInteger(Number(req.body?.at)) && req.body?.at !== undefined ? Math.max(0, Math.min(att.pageList.length, Number(req.body.at))) : null;
        addPages(dirOf(note.id), att, pages, req.files?.pthumb || [], at);
        await saveScan(res, note, att, 'pages-added');
      } catch (err) { fail(res, err); }
    });

    // POST /api/quick/:id/attachments/:aid/pages/order { ids }
    app.post('/api/quick/:id/attachments/:aid/pages/order', async (req, res) => {
      const { note, att } = pageRoute(req, res);
      if (!att) return;
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
      const by = new Map(att.pageList.map(p => [p.id, p]));
      att.pageList = [...ids.map(i => by.get(i)).filter(Boolean), ...att.pageList.filter(p => !ids.includes(p.id))];
      try { await saveScan(res, note, att, 'pages-order'); } catch (err) { fail(res, err); }
    });

    // PUT /api/quick/:id/attachments/:aid/pages/:pid/content — edited or retaken page (file + thumb?)
    app.put('/api/quick/:id/attachments/:aid/pages/:pid/content', upload, async (req, res) => {
      const { note, att, pg } = pageRoute(req, res);
      if (!pg) return;
      const file = req.files?.file?.[0] || req.files?.page?.[0];
      if (!file?.size || !PAGE_MIME.test(file.mimetype)) return res.status(400).json({ error: 'Send the page image (JPEG or PNG)' });
      const dir = dirOf(note.id);
      const p = att.pageList.find(x => x.id === pg.id);
      const version = (p.version || 1) + 1;
      if (!p.original) p.original = p.file;
      else removeFiles(note.id, [p.file]);
      p.file = `${att.id}_${p.id}.v${version}.${file.mimetype === 'image/png' ? 'png' : 'jpg'}`;
      p.version = version;
      p.size = file.size;
      fs.writeFileSync(path.join(dir, p.file), file.buffer);
      p.thumb = writeThumb(dir, `${att.id}_${p.id}`, req.files?.thumb?.[0] || req.files?.pthumb?.[0]);
      if (!p.thumb) removeFiles(note.id, [`${att.id}_${p.id}.thumb.jpg`]);
      try { await saveScan(res, note, att, 'page-edited'); } catch (err) { fail(res, err); }
    });

    // POST /api/quick/:id/attachments/:aid/pages/:pid/restore — the page as scanned
    app.post('/api/quick/:id/attachments/:aid/pages/:pid/restore', async (req, res) => {
      const { note, att, pg } = pageRoute(req, res);
      if (!pg) return;
      const p = att.pageList.find(x => x.id === pg.id);
      if (!p.original) return res.status(409).json({ error: 'This page has no other version' });
      removeFiles(note.id, [p.file, `${att.id}_${p.id}.thumb.jpg`]);
      p.file = p.original;
      delete p.original;
      p.thumb = false;
      p.version = (p.version || 1) + 1;
      try { await saveScan(res, note, att, 'page-restored'); } catch (err) { fail(res, err); }
    });

    // DELETE /api/quick/:id/attachments/:aid/pages/:pid (the last page deletes the scan)
    app.delete('/api/quick/:id/attachments/:aid/pages/:pid', async (req, res) => {
      const { note, att, pg } = pageRoute(req, res);
      if (!pg) return;
      removeFiles(note.id, [pg.file, pg.original, `${att.id}_${pg.id}.thumb.jpg`]);
      att.pageList = att.pageList.filter(p => p.id !== pg.id);
      if (!att.pageList.length) {
        removeFiles(note.id, filesOf(att));
        res.json(save(note.id, list => list.filter(a => a.id !== att.id)));
        onChanged(note.id, 'deleted');
        return;
      }
      try { await saveScan(res, note, att, 'page-deleted'); } catch (err) { fail(res, err); }
    });

    // POST /api/quick/:id/attachments/:aid/split { at } — pages from index `at` become a new scan right after it
    app.post('/api/quick/:id/attachments/:aid/split', async (req, res) => {
      const { note, att } = pageRoute(req, res);
      if (!att) return;
      const at = Math.floor(Number(req.body?.at));
      if (!(at >= 1 && at < att.pageList.length)) return res.status(400).json({ error: 'Split between two pages' });
      try {
        const dir = dirOf(note.id);
        const second = {
          id: newAttId(), name: cleanName(`${att.name.replace(/\.pdf$/i, '')} (part 2).pdf`, 'Scan.pdf'), ext: 'pdf', mime: 'application/pdf', kind: 'pdf',
          source: 'scan', version: 1, pageList: [], thumb: false, addedAt: now(), addedBy: req.user?.id || null,
        };
        for (const pg of att.pageList.slice(at)) {
          const pid = newPageId();
          const file = `${second.id}_${pid}.${extOf(pg.file) || 'jpg'}`;
          fs.renameSync(path.join(dir, pg.file), path.join(dir, file));
          const moved = { id: pid, file, thumb: false, size: pg.size };
          if (pg.thumb && fs.existsSync(path.join(dir, `${att.id}_${pg.id}.thumb.jpg`))) {
            fs.renameSync(path.join(dir, `${att.id}_${pg.id}.thumb.jpg`), path.join(dir, `${second.id}_${pid}.thumb.jpg`));
            moved.thumb = true;
          }
          if (pg.original) {
            const orig = `${second.id}_${pid}.orig.${extOf(pg.original) || 'jpg'}`;
            fs.renameSync(path.join(dir, pg.original), path.join(dir, orig));
            moved.original = orig;
          }
          second.pageList.push(moved);
        }
        att.pageList = att.pageList.slice(0, at);
        Object.assign(second, await buildPdf(dir, second));
        second.pages = second.pageList.length;
        await rebuild(note.id, att);
        res.json(save(note.id, list => list.flatMap(a => (a.id === att.id ? [att, second] : [a]))));
        onChanged(note.id, 'split');
      } catch (err) { fail(res, err); }
    });
  }

  return { register, imageFrom, scanFrom, save, dirOf, adoptMedia, processable, resolveCover };
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

module.exports = {
  createAttachments, attachmentSearchText, removeAttachments, multerFields, parse,
  kindOf, cleanName, processable, LIMIT, MIME_BY_EXT, READABLE, READ_LIMIT,
};
