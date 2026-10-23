// Smart document processing (2.6.0): photos, scans and PDFs — new document notes and attachments on existing
// notes — are read by Gemini (vision): what kind of document it is, the fields that matter for that kind, the
// text (searchable) and a short summary. Shown as an editable "Details" card on the note.
//
//   note.document = {
//     type: receipt|bill|medical|school|warranty|letter|business_card|whiteboard|other, category,
//     fields: {...}, edited: { field: true, type?: true }, conflicts: { field: newValue },
//     text, summary, status: pending|done|failed|off, error?, processedAt, changedAt?, inputs,
//     project?: { id, name, confidence, status: applied|ask|declined|undone }
//   }
//   note.docFirst = true for notes created from a photo/scan (their title + summary come from the document)
//
// Privacy: card, bank account, SSN and other long ID numbers keep only their last 4 digits (privacy.js) before
// anything is stored or shown. Manual edits are never overwritten: a different value found later is offered as
// a conflict ("Use it / Keep mine"). Nothing is sent or created automatically except filing into a project
// above the smart-append auto threshold (with Undo).

const fs = require('fs');
const path = require('path');
const { maskText, maskDeep } = require('./privacy');
const { processable, READ_LIMIT } = require('./attachments');

const TYPES = {
  receipt:       { label: 'Receipt',       category: 'Receipts', icon: '🧾', fields: ['merchant', 'date', 'total', 'tax', 'currency', 'items', 'paymentMethod'] },
  bill:          { label: 'Bill',          category: 'Bills',    icon: '💡', fields: ['company', 'account', 'amountDue', 'currency', 'dueDate', 'period'] },
  medical:       { label: 'Medical',       category: 'Medical',  icon: '🩺', fields: ['provider', 'date', 'visitType', 'instructions'] },
  school:        { label: 'School',        category: 'School',   icon: '🎒', fields: ['school', 'student', 'date', 'subject', 'actionNeeded'] },
  warranty:      { label: 'Warranty',      category: 'Warranty', icon: '🛡️', fields: ['product', 'store', 'purchaseDate', 'expiryDate'] },
  letter:        { label: 'Letter',        category: 'Documents', icon: '✉️', fields: ['sender', 'date', 'subject', 'actionNeeded'] },
  business_card: { label: 'Business card', category: 'Contacts', icon: '📇', fields: ['name', 'jobTitle', 'company', 'phone', 'email', 'website', 'address'] },
  whiteboard:    { label: 'Notes',         category: 'Notes',    icon: '🖍️', fields: ['topic'] },
  other:         { label: 'Document',      category: 'Documents', icon: '📄', fields: [] },
};
const TYPE_KEYS = Object.keys(TYPES);
const ALL_FIELDS = [...new Set(Object.values(TYPES).flatMap(t => t.fields))];
const DEFAULT_SETTINGS = { auto: true, types: Object.fromEntries(TYPE_KEYS.filter(t => t !== 'other').map(t => [t, true])) };
const MAX_INPUTS = 12;
const MAX_INPUT_BYTES = 18 * 1024 * 1024;
const DEBOUNCE_MS = 3500;
// After the main model is overloaded / rate-limited / slow, use the fallback for a while (no 40 s waits)
const PRIMARY_PAUSE_MS = 5 * 60 * 1000;
let primaryPausedUntil = 0;

const PROMPT =
  'You read documents saved into a personal notes app: photos, scans and PDFs. Classify the document and extract its key ' +
  'fields as JSON.\n' +
  'docType: receipt (a store/restaurant purchase), bill (an invoice or statement asking for payment), medical (visit summary, ' +
  'prescription, lab result, referral), school (from a school or teacher: permission slip, report card, schedule), warranty ' +
  '(a warranty card, product manual or proof of purchase for a warranty), letter (letters and official documents), ' +
  'business_card, whiteboard (a whiteboard, sticky notes or handwritten notes), other.\n' +
  'Fields (only those that apply; leave the rest out or empty):\n' +
  '- receipt: merchant, date, total, tax, currency, items [{name, qty, price}], paymentMethod (e.g. "Visa ending 1234" — never a full card number)\n' +
  '- bill: company, account (last 4 digits only), amountDue, currency, dueDate, period (e.g. "Oct 1 – Oct 31, 2026")\n' +
  '- medical: provider, date, visitType, instructions (the key instructions, short)\n' +
  '- school: school, student, date, subject, actionNeeded\n' +
  '- warranty: product, store, purchaseDate, expiryDate (compute it from the purchase date and warranty length if needed)\n' +
  '- letter: sender, date, subject, actionNeeded\n' +
  '- business_card: name, jobTitle, company, phone, email, website, address\n' +
  '- whiteboard: topic\n' +
  'Dates as YYYY-MM-DD. Money as plain numbers with 2 decimals ("43.18"), currency as a code (USD).\n' +
  'NEVER output a full card number, bank account number, routing number, Social Security number or other ID number: ' +
  'keep only the last 4 digits ("•••• 1234").\n' +
  'title: a short title (≤ 6 words), e.g. "Publix receipt", "Comcast bill — November", "Dr. Patel visit".\n' +
  'summary: 1–3 short sentences, plain Markdown, with what matters (amounts, dates, what to do).\n' +
  'text: every readable word, verbatim, in reading order (with the same masking).\n' +
  'projectId: if a PROJECT below clearly fits this document, its id, else "". projectConfidence: 0–1.';

const SCHEMA = {
  type: 'object',
  properties: {
    docType: { type: 'string', enum: TYPE_KEYS },
    title: { type: 'string' },
    summary: { type: 'string' },
    text: { type: 'string' },
    confidence: { type: 'number' },
    fields: {
      type: 'object',
      properties: {
        ...Object.fromEntries(ALL_FIELDS.filter(f => f !== 'items').map(f => [f, { type: 'string' }])),
        items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'number' }, price: { type: 'string' } }, required: ['name', 'qty', 'price'] } },
      },
      // Every field is asked for ("" when it doesn't apply) — with optional fields models fill only a few
      required: ALL_FIELDS,
    },
    projectId: { type: 'string' },
    projectConfidence: { type: 'number' },
  },
  required: ['docType', 'title', 'summary', 'text', 'fields', 'projectId', 'projectConfidence'],
};

/** JSON from a model reply (code fences / extra text tolerated) */
function parseJson(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(s); } catch { /* try the outermost object */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error('The AI reply wasn’t JSON');
}

const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const money = v => {
  const n = Number(String(v || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && String(v || '').trim() ? n.toFixed(2) : '';
};

/** Keep the fields of this type, normalized (dates, money, items) */
function normalizeFields(type, raw = {}) {
  const out = {};
  for (const f of TYPES[type]?.fields || []) {
    let v = raw[f];
    if (f === 'items') {
      if (Array.isArray(v) && v.length) {
        out.items = v.slice(0, 60).map(i => ({ name: String(i?.name || '').trim().slice(0, 120), qty: Number(i?.qty) > 0 ? Number(i.qty) : 1, price: money(i?.price) }))
          .filter(i => i.name);
      }
      continue;
    }
    v = typeof v === 'number' ? String(v) : String(v || '').trim();
    if (!v) continue;
    if (['total', 'tax', 'amountDue'].includes(f)) v = money(v) || v;
    if (/date$|^date$/i.test(f) && !isDate(v)) {
      const d = new Date(v);
      if (!isNaN(d)) v = d.toISOString().slice(0, 10);
    }
    if (f === 'currency') v = v.toUpperCase().slice(0, 3);
    out[f] = v.slice(0, 400);
  }
  return out;
}

const fmtMoney = (v, cur) => (v ? `${!cur || cur === 'USD' ? '$' : `${cur} `}${v}` : '');
const fmtDate = d => (isDate(d) ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : d || '');

/** "🧾 Receipt · Publix · $43.18" — the widget line / notification / toast */
function confirmationFor(note) {
  const d = note.document;
  if (!d || d.status !== 'done') return { icon: '📄', text: note.title || 'Document saved', tone: 'success' };
  const t = TYPES[d.type] || TYPES.other;
  const f = d.fields || {};
  const bits = {
    receipt: [f.merchant, fmtMoney(f.total, f.currency)],
    bill: [f.company, f.amountDue && `${fmtMoney(f.amountDue, f.currency)}${f.dueDate ? ` due ${fmtDate(f.dueDate)}` : ''}`],
    medical: [f.provider, fmtDate(f.date)],
    school: [f.subject || f.school, f.actionNeeded],
    warranty: [f.product, f.expiryDate && `until ${fmtDate(f.expiryDate)}`],
    letter: [f.sender, f.subject],
    business_card: [f.name, f.company],
    whiteboard: [f.topic || note.title],
    other: [note.title],
  }[d.type] || [note.title];
  const detail = bits.filter(Boolean).slice(0, 2);
  return { icon: t.icon, text: [t.label, ...detail].join(' · ').slice(0, 120), tone: 'success', detail: d.project?.status === 'applied' ? `Filed in ${d.project.name}` : null };
}

/** Text of a note's document for search */
function documentSearchText(note) {
  const d = note.document;
  if (!d) return '';
  const f = d.fields || {};
  return [TYPES[d.type]?.label, d.category, d.text, ...Object.entries(f).map(([k, v]) => (k === 'items' ? (v || []).map(i => i.name).join(' ') : v))]
    .filter(Boolean).join('\n');
}

/**
 * deps: { store, attachments, mediaDir, getConfig, saveConfig, projects, thresholds(), blankNote, newId,
 *         syncCal, finalize, onUsage }
 */
function createDocuments(deps) {
  const { store, attachments } = deps;
  const timers = new Map();
  const running = new Map();   // noteId → Promise
  const again = new Set();

  function settings() {
    const s = deps.getConfig()?.documents || {};
    return {
      auto: s.auto !== false,
      types: { ...DEFAULT_SETTINGS.types, ...(s.types || {}) },
    };
  }
  function saveSettings(patch = {}) {
    const cfg = deps.getConfig() || {};
    const cur = settings();
    const next = {
      auto: typeof patch.auto === 'boolean' ? patch.auto : cur.auto,
      types: { ...cur.types },
    };
    for (const [k, v] of Object.entries(patch.types || {})) if (k in next.types && typeof v === 'boolean') next.types[k] = v;
    deps.saveConfig({ ...cfg, documents: next });
    return next;
  }

  /** The files Gemini reads, in order: photos, scan pages, PDFs (and an older photo note's image) */
  function inputsOf(note) {
    const dir = attachments.dirOf(note.id);
    const out = [];
    let bytes = 0;
    const push = (file, mime, ref) => {
      if (out.length >= MAX_INPUTS || !fs.existsSync(file)) return;
      const size = fs.statSync(file).size;
      if (size > READ_LIMIT || bytes + size > MAX_INPUT_BYTES) return;
      bytes += size;
      out.push({ file, mime, ref });
    };
    if (note.media?.kind === 'image' && note.media.file) push(path.join(deps.mediaDir, path.basename(note.media.file)), note.media.mime || 'image/jpeg', 'media');
    for (const a of note.attachments || []) {
      if (!processable(a)) continue;
      if (a.pageList?.length) {
        for (const p of a.pageList) push(path.join(dir, p.file), /\.png$/.test(p.file) ? 'image/png' : 'image/jpeg', `${a.id}/${p.id}`);
      } else if (a.kind === 'image' && /^image\/(jpeg|png|webp|gif|heic|heif)$/.test(a.mime)) push(path.join(dir, a.file), a.mime, a.id);
      else if (a.mime === 'application/pdf') push(path.join(dir, a.file), 'application/pdf', a.id);
    }
    return out;
  }
  const signature = inputs => inputs.map(i => `${i.ref}:${fs.statSync(i.file).mtimeMs}`).join('|');

  /** Does a note have anything to process? (and is processing on) */
  const wants = note => settings().auto && note && !note.undone && note.type !== 'action' && inputsOf(note).length > 0;

  async function analyze(inputs, { projects = [], enabled }) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    const { GoogleGenAI } = await import('@google/genai');
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const parts = inputs.map(i => ({
      type: i.mime === 'application/pdf' ? 'document' : 'image',
      data: fs.readFileSync(i.file, { encoding: 'base64' }),
      mime_type: i.mime,
    }));
    const today = new Date().toISOString().slice(0, 10);
    const ask = `Today is ${today}. ${inputs.length} page(s)/image(s) of one document follow.\n` +
      `Document types the user wants organized: ${enabled.join(', ') || 'none'} (use "other" for anything else).\n` +
      `PROJECTS:\n${projects.length ? projects.map(p => `- ${p.id}: ${p.name}${p.aliases?.length ? ` (also: ${p.aliases.join(', ')})` : ''}`).join('\n') : '(none)'}`;
    const primary = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    const fallback = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite';
    const models = [...new Set(Date.now() < primaryPausedUntil ? [fallback] : [primary, fallback])];
    let lastErr;
    for (const [i, model] of models.entries()) {
      try {
        const interaction = await client.interactions.create({
          model,
          system_instruction: PROMPT,
          input: [{ type: 'text', text: ask }, ...parts],
          response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
        }, {
          timeout_ms: i === models.length - 1 ? 60000 : 40000,
          retries: i === models.length - 1 ? { strategy: 'attempt-count-backoff', maxRetries: 1, retryConnectionErrors: true } : { strategy: 'none' },
        });
        return parseJson(interaction.output_text);
      } catch (err) {
        lastErr = err;
        console.warn(`[documents] Gemini ${model} failed: ${err.message}`);
        if (model === primary && /(429|503)|timed out|timeout|quota|high demand/i.test(err.message)) primaryPausedUntil = Date.now() + PRIMARY_PAUSE_MS;
      }
    }
    throw lastErr;
  }

  /** Merge a fresh reading into the note: edited fields are kept, differing new values become conflicts */
  function merge(prev, result) {
    const edited = { ...(prev?.edited || {}) };
    const type = edited.type && prev?.type ? prev.type : result.type;
    const fresh = normalizeFields(type, result.fields);
    const fields = {};
    const conflicts = {};
    for (const f of TYPES[type].fields) {
      if (edited[f]) {
        if (prev?.fields?.[f] !== undefined) fields[f] = prev.fields[f];
        if (fresh[f] !== undefined && JSON.stringify(fresh[f]) !== JSON.stringify(prev?.fields?.[f])) conflicts[f] = fresh[f];
      } else if (fresh[f] !== undefined) fields[f] = fresh[f];
    }
    if (edited.type && result.type !== prev?.type) conflicts.type = result.type;
    return { type, fields, edited, conflicts };
  }

  /** Read the note's documents now (one run per note at a time; a request during a run runs it again after) */
  async function runDocument(noteId, { force = false } = {}) {
    if (running.has(noteId)) { again.add(noteId); return running.get(noteId); }
    const job = (async () => {
      try { return await processOnce(noteId, force); } finally {
        running.delete(noteId);
        if (again.delete(noteId)) schedule(noteId, { force: true });
      }
    })();
    running.set(noteId, job);
    return job;
  }

  async function processOnce(noteId, force) {
    const note = store.read(noteId);
    if (!note || note.undone) return null;
    const s = settings();
    const inputs = inputsOf(note);
    if (!inputs.length) {
      // Every photo/scan was removed: no document anymore (manual edits stay, nothing to show)
      if (note.document) write(noteId, n => { n.document = { ...n.document, status: 'empty', inputs: '' }; });
      return store.read(noteId);
    }
    const sig = signature(inputs);
    if (!force && note.document?.status === 'done' && note.document.inputs === sig) return note;
    write(noteId, n => { n.document = { ...(n.document || {}), status: 'pending', error: null }; });

    const enabled = Object.entries(s.types).filter(([, on]) => on).map(([k]) => k);
    const projectsList = (deps.projects?.active?.() || []).slice(0, 40).map(p => ({ id: p.id, name: p.name, aliases: p.aliases || [] }));
    let result;
    try {
      deps.onUsage?.('summary');
      const raw = await analyze(inputs, { projects: projectsList, enabled });
      let type = TYPE_KEYS.includes(raw.docType) ? raw.docType : 'other';
      if (type !== 'other' && !s.types[type]) type = 'other'; // that type is switched off: text only
      result = maskDeep({
        type, title: String(raw.title || '').trim().slice(0, 80), summary: String(raw.summary || '').trim().slice(0, 1500),
        text: String(raw.text || '').trim().slice(0, 20000), fields: raw.fields || {},
        projectId: String(raw.projectId || ''), projectConfidence: Number(raw.projectConfidence) || 0,
      });
    } catch (err) {
      console.warn(`[documents] ${noteId}: ${err.message}`);
      write(noteId, n => { n.document = { ...(n.document || {}), status: 'failed', error: err.message.slice(0, 200), processedAt: new Date().toISOString() }; });
      return store.read(noteId);
    }

    let fileTo = null;
    const saved = write(noteId, n => {
      const prev = n.document || null;
      const m = merge(prev, result);
      const before = prev?.status && prev.fields ? JSON.stringify([prev.type, prev.fields]) : null;
      const after = JSON.stringify([m.type, m.fields]);
      const doc = {
        ...m,
        category: TYPES[m.type].category,
        text: result.text,
        summary: result.summary,
        status: 'done', error: null,
        processedAt: new Date().toISOString(),
        inputs: sig,
        project: prev?.project || null,
      };
      if (before && before !== after) doc.changedAt = doc.processedAt;   // "Details updated"
      if (before && Object.keys(m.conflicts).length) doc.changedAt = doc.processedAt;
      // Notes made from a photo/scan: title + summary come from the document (unless the user changed them)
      if (n.docFirst) {
        if (!n.titleEdited && result.title) n.title = result.title;
        if (result.summary) {
          n.summary = result.summary;
          n.summaryStatus = 'done';
          n.summaryError = null;
          n.summaryUpdatedAt = doc.processedAt;
        }
      }
      // A project that fits: auto above the smart-append threshold (Undo), ask in between
      if (!n.projectId && !doc.project && result.projectId) {
        const p = deps.projects?.read?.(result.projectId);
        const t = deps.thresholds();
        if (p && !p.deleted && p.status !== 'archived') {
          const conf = result.projectConfidence;
          if (conf >= t.autoApply) { doc.project = { id: p.id, name: p.name, confidence: conf, status: 'applied' }; fileTo = p.id; }
          else if (conf >= t.ask) doc.project = { id: p.id, name: p.name, confidence: conf, status: 'ask' };
        }
      }
      n.document = doc;
    });
    if (fileTo) { try { deps.projects.addNote(fileTo, noteId); } catch (err) { console.warn(`[documents] filing ${noteId}: ${err.message}`); } }
    return fileTo ? store.read(noteId) : saved;
  }

  /** Write a change to the latest copy of a note (document group stamp) */
  function write(noteId, change) {
    const fresh = store.read(noteId);
    if (!fresh) return null;
    change(fresh);
    fresh.documentAt = new Date().toISOString();
    return store.write(fresh);
  }

  /**
   * Something about a note's photos/scans changed: process again in a few seconds (bursts of edits → one run).
   * Returns true when processing will run (the caller then skips its own "read text").
   */
  function schedule(noteId, { force = false, delay = DEBOUNCE_MS } = {}) {
    if (!settings().auto) return false;
    clearTimeout(timers.get(noteId));
    timers.set(noteId, setTimeout(() => {
      timers.delete(noteId);
      const note = store.read(noteId);
      if (!note || note.undone || note.type === 'action' || !settings().auto) return;
      runDocument(noteId, { force }).catch(err => console.warn(`[documents] ${noteId}: ${err.message}`));
    }, delay));
    // Show "Reading the document…" right away
    const note = store.read(noteId);
    if (note && !note.undone && note.document?.status !== 'pending' && (note.attachments || []).some(processable)) {
      write(noteId, n => { n.document = { ...(n.document || {}), status: 'pending' }; });
    }
    return true;
  }

  // ── Routes ───────────────────────────────────────────────────────────────
  function register(app, { loadNote, captureResponse, referenceTime, rememberOrigin }) {
    const { multerFields, parse } = require('./attachments');
    const upload = parse(multerFields());
    const wantsAi = v => !(v === false || v === 'false' || v === '0');

    // POST /api/quick/document — a new note from a photo / camera shot / scan:
    // page[] (+ pthumb[]) or file (+ thumb), kind: scan|camera|image|file, clientId?, capturedAt?, caption?, title?, aiOrganize?
    app.post('/api/quick/document', upload, async (req, res) => {
      rememberOrigin?.(req);
      const b = req.body || {};
      const pages = req.files?.page || [];
      const file = req.files?.file?.[0];
      if (!pages.length && !file?.size) return res.status(400).json({ error: 'A photo or scan is required' });
      const clientId = typeof b.clientId === 'string' ? b.clientId.slice(0, 64) : null;
      if (clientId) {
        const existing = store.list().find(n => n.clientId === clientId);
        if (existing) return res.json({ ...captureResponse(existing), confirmation: confirmationFor(existing) });
      }
      const kind = ['scan', 'camera', 'image', 'file'].includes(b.kind) ? b.kind : (pages.length ? 'scan' : 'image');
      const now = referenceTime(b.capturedAt);
      const id = deps.newId();
      const caption = typeof b.caption === 'string' ? b.caption.trim().slice(0, 4000) : '';
      const title = typeof b.title === 'string' ? b.title.trim().slice(0, 120) : '';
      const note = deps.blankNote(id, now, {
        clientId, source: kind, docFirst: true, aiOrganize: wantsAi(b.aiOrganize),
        title: title || ({ scan: 'Scan', camera: 'Photo', image: 'Photo', file: 'Document' }[kind]),
        titleEdited: !!title, content: caption, typed: { title, caption, body: caption, items: [] },
        summaryStatus: 'none', attachments: [],
        color: deps.pickColor ? deps.pickColor(b.color) : null,
      });
      try {
        let atts;
        if (kind === 'scan' && pages.length) atts = [await attachments.scanFrom(id, pages, req.files?.pthumb || [], { name: title ? `${title}.pdf` : null, addedBy: req.user?.id })];
        else if (pages.length) atts = pages.map((p, i) => attachments.imageFrom(id, p, req.files?.pthumb?.[i], { name: p.originalname, source: kind === 'camera' ? 'camera' : 'photos', addedBy: req.user?.id }));
        else atts = [attachments.imageFrom(id, file, req.files?.thumb?.[0], { name: file.originalname, source: kind === 'camera' ? 'camera' : kind === 'file' ? 'file' : 'photos', addedBy: req.user?.id })];
        note.attachments = atts;
        const first = atts[0];
        note.coverId = first.pageList?.length ? `${first.id}/${first.pageList[0].id}` : first.kind === 'image' ? first.id : null;
        note.attachmentsAt = new Date().toISOString();
        note.spokenConfirmation = `Saved: ${note.title}`;
        store.write(note);
      } catch (err) {
        console.error('/quick/document save error:', err);
        return res.status(err.status || 500).json({ error: err.message });
      }
      let out = store.read(id);
      if (note.aiOrganize && wants(out)) {
        try { out = (await runDocument(id, { force: true })) || store.read(id); } catch (err) { console.warn(`[documents] ${id}: ${err.message}`); }
      } else if (note.aiOrganize) {
        write(id, n => { n.document = { status: 'off' }; });
        out = store.read(id);
      }
      out = deps.finalize(out);
      res.json({ ...captureResponse(out), confirmation: confirmationFor(out) });
    });

    // POST /api/quick/:id/document/process — "Reprocess" (manual edits are kept)
    app.post('/api/quick/:id/document/process', async (req, res) => {
      const note = loadNote(req, res);
      if (!note) return;
      if (!inputsOf(note).length) return res.status(409).json({ error: 'This note has no photo, scan or PDF to read' });
      res.json(write(note.id, n => { n.document = { ...(n.document || {}), status: 'pending', error: null }; }));
      runDocument(note.id, { force: true }).catch(() => {});
    });

    // PATCH /api/quick/:id/document { type?, fields? } — manual edits (never overwritten by processing)
    app.patch('/api/quick/:id/document', (req, res) => {
      const note = loadNote(req, res);
      if (!note) return;
      const b = req.body || {};
      if (b.type !== undefined && !TYPE_KEYS.includes(b.type)) return res.status(400).json({ error: 'Unknown document type' });
      res.json(write(note.id, n => {
        const d = { fields: {}, edited: {}, conflicts: {}, status: 'done', ...(n.document || {}) };
        d.edited = { ...(d.edited || {}) };
        d.conflicts = { ...(d.conflicts || {}) };
        if (b.type !== undefined && b.type !== d.type) {
          d.type = b.type;
          d.category = TYPES[b.type].category;
          d.edited.type = true;
          delete d.conflicts.type;
          // Keep the values that still apply to the new type
          d.fields = Object.fromEntries(Object.entries(d.fields || {}).filter(([k]) => TYPES[b.type].fields.includes(k)));
        }
        for (const [k, v] of Object.entries(b.fields || {})) {
          if (!TYPES[d.type || 'other'].fields.includes(k)) continue;
          const val = k === 'items' ? normalizeFields(d.type, { items: v }).items || [] : maskText(String(v ?? '').trim().slice(0, 400));
          if (val === '' || (Array.isArray(val) && !val.length)) delete d.fields[k];
          else d.fields[k] = val;
          d.edited[k] = true;
          delete d.conflicts[k];
        }
        n.document = d;
      }));
    });

    // POST /api/quick/:id/document/resolve { field, use: 'new' | 'mine' } — a value found after a manual edit
    app.post('/api/quick/:id/document/resolve', (req, res) => {
      const note = loadNote(req, res);
      if (!note) return;
      const { field, use } = req.body || {};
      if (!note.document?.conflicts || !(field in note.document.conflicts)) return res.status(404).json({ error: 'Nothing to resolve' });
      res.json(write(note.id, n => {
        const d = n.document;
        const value = d.conflicts[field];
        if (use === 'new') {
          if (field === 'type') { d.type = value; d.category = TYPES[value]?.category || 'Documents'; delete d.edited.type; }
          else { d.fields = { ...d.fields, [field]: value }; delete d.edited[field]; }
        }
        d.conflicts = Object.fromEntries(Object.entries(d.conflicts).filter(([k]) => k !== field));
      }));
    });

    // POST /api/quick/:id/document/project { decision: 'yes' | 'no' | 'undo' } — the suggested project
    app.post('/api/quick/:id/document/project', (req, res) => {
      const note = loadNote(req, res);
      if (!note) return;
      const p = note.document?.project;
      if (!p) return res.status(404).json({ error: 'No project suggestion' });
      const decision = req.body?.decision;
      try {
        if (decision === 'yes' && p.status === 'ask') deps.projects.addNote(p.id, note.id);
        if (decision === 'undo' && p.status === 'applied') deps.projects.removeNote(p.id, note.id);
      } catch (err) { return res.status(err.status || 500).json({ error: err.message }); }
      res.json(write(note.id, n => {
        n.document.project = { ...p, status: decision === 'yes' ? 'applied' : decision === 'undo' ? 'undone' : 'declined' };
      }));
    });
  }

  /** Own routes (not per note — never proxied to another user's account) */
  function registerOwn(app) {
    app.get('/api/documents/settings', (_req, res) => res.json({ ...settings(), types: settings().types, labels: Object.fromEntries(TYPE_KEYS.map(k => [k, TYPES[k].label])) }));
    app.put('/api/documents/settings', (req, res) => res.json(saveSettings(req.body || {})));

    // POST /api/documents/reminder { title, date (YYYY-MM-DD), noteId? } — "Remind me" from a bill or warranty (your own reminder)
    app.post('/api/documents/reminder', async (req, res) => {
      const { title, date, noteId } = req.body || {};
      if (!isDate(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      const clean = String(title || '').trim().slice(0, 120);
      if (!clean) return res.status(400).json({ error: 'title?' });
      const note = deps.blankNote(deps.newId(), new Date(), {
        type: 'reminder', title: clean, dueDate: date, allDay: true, source: 'document',
        content: noteId ? `From a document note` : '', fromDocument: typeof noteId === 'string' ? noteId.slice(0, 64) : null,
        summaryStatus: 'none', typed: { title: clean, body: '', items: [] },
      });
      note.spokenConfirmation = `Reminder: ${clean}`;
      try { await deps.syncCal(note); } catch (err) { note.googleError = err.message; }
      res.json({ note: deps.finalize(note), confirmation: { icon: '⏰', text: `Reminder on ${fmtDate(date)}: ${clean}`, tone: 'success' } });
    });
  }

  return { process: runDocument, schedule, settings, saveSettings, register, registerOwn, inputsOf, wants };
}

module.exports = { createDocuments, TYPES, confirmationFor, documentSearchText, normalizeFields, parseJson, PROMPT, SCHEMA };
