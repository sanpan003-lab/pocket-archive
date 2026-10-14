// Quick Capture — one-tap voice notes that are transcribed (Gemini),
// classified (Claude) and acted on: calendar events, reminders, notes
// linked to a recording, or standalone notes. Everything is undoable.
//
// Storage: ARCHIVE/07_Quick_Notes/{id}.json + 07_Quick_Notes/audio/{id}.{ext}

const fs     = require('fs');
const path   = require('path');
const multer = require('multer');
const gcal   = require('./googleCalendar');

const TIMEZONE = gcal.TIMEZONE;
const QUICK_TYPES = ['event', 'reminder', 'note_link', 'note'];
const LINK_MIN_CONFIDENCE = 0.7;
const INLINE_AUDIO_LIMIT  = 15 * 1024 * 1024; // Gemini inline requests cap at 20 MB total
const NEEDS_REVIEW_SPOKEN = "Saved, but I couldn't understand it — check your inbox.";

const AUDIO_TYPES = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/flac': 'flac',
};
// MIME types Gemini accepts for each stored extension (it lists m4a, not mp4)
const GEMINI_MIME = {
  webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/m4a', aac: 'audio/aac',
  mp3: 'audio/mp3', wav: 'audio/wav', flac: 'audio/flac',
};

// ── Time helpers (America/New_York) ────────────────────────────────────────

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HAS_ZONE_RE  = /(Z|[+-]\d{2}:?\d{2})$/i;

function zonedParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = type => Number(parts.find(p => p.type === type).value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

// Minutes the zone is ahead of UTC at this instant (e.g. -240 for EDT)
function zoneOffsetMinutes(date) {
  const p = zonedParts(date);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

const pad = n => String(n).padStart(2, '0');

// 2026-10-20T15:00:00-04:00
function toZonedIso(date) {
  const p   = zonedParts(date);
  const off = zoneOffsetMinutes(date);
  const sign = off >= 0 ? '+' : '-';
  const abs  = Math.abs(off);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// Parse an ISO string; one without a UTC offset is treated as New York wall time
function parseZoned(str) {
  if (typeof str !== 'string' || !str.trim()) return null;
  const s = str.trim();
  if (HAS_ZONE_RE.test(s)) {
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  let guess = wall - zoneOffsetMinutes(new Date(wall)) * 60000;
  guess = wall - zoneOffsetMinutes(new Date(guess)) * 60000; // settle DST edges
  return new Date(guess);
}

// Normalize to "YYYY-MM-DD" (all-day) or a zoned ISO datetime; null if invalid
function normalizeWhen(value, allDay) {
  if (!value) return null;
  const s = String(value).trim();
  if (DATE_ONLY_RE.test(s)) return s;
  const d = parseZoned(s);
  if (!d) return null;
  return allDay ? toZonedIso(d).slice(0, 10) : toZonedIso(d);
}

function addDays(dateOnly, days) {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function describeNow(date) {
  const human = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
  return { iso: toZonedIso(date), human };
}

// ── Storage ────────────────────────────────────────────────────────────────

function createStore(archivePath) {
  const dir      = path.join(archivePath, '07_Quick_Notes');
  const audioDir = path.join(dir, 'audio');

  const fileFor = id => path.join(dir, `${id}.json`);

  function ensureDirs() {
    fs.mkdirSync(audioDir, { recursive: true });
  }

  function read(id) {
    try { return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')); }
    catch { return null; }
  }

  function write(note) {
    ensureDirs();
    note.updatedAt = new Date().toISOString();
    const tmp = fileFor(note.id) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(note, null, 2), 'utf8');
    fs.renameSync(tmp, fileFor(note.id));
    return note;
  }

  function list() {
    if (!fs.existsSync(dir)) return [];
    const notes = [];
    for (const file of fs.readdirSync(dir)) {
      if (!/^qn_[\w-]+\.json$/.test(file)) continue;
      try { notes.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))); }
      catch { /* skip corrupt entries */ }
    }
    notes.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return notes;
  }

  return { dir, audioDir, read, write, list, ensureDirs };
}

function newId() {
  return `qn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isQuickId(id) {
  return typeof id === 'string' && /^qn_\d+_[a-z0-9]+$/.test(id);
}

// ── Gemini transcription ───────────────────────────────────────────────────

async function transcribe(audioPath, ext) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const { GoogleGenAI } = await import('@google/genai');
  const client   = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const mimeType = GEMINI_MIME[ext] || 'audio/webm';

  let audio;
  if (fs.statSync(audioPath).size <= INLINE_AUDIO_LIMIT) {
    audio = { type: 'audio', data: fs.readFileSync(audioPath, { encoding: 'base64' }), mime_type: mimeType };
  } else {
    const uploaded = await client.files.upload({ file: audioPath, config: { mimeType } });
    audio = { type: 'audio', uri: uploaded.uri, mime_type: uploaded.mimeType || mimeType };
  }

  // Flash is often overloaded (503) — fall back to Flash-Lite rather than
  // making a driver wait through long SDK retry loops
  const models = [...new Set([
    process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite',
  ])];

  let lastErr;
  for (const [i, model] of models.entries()) {
    const isLast = i === models.length - 1;
    try {
      const interaction = await client.interactions.create({
        model,
        system_instruction:
          'You transcribe short voice memos recorded on a phone, often in a car. ' +
          'Output only the spoken words as plain text — no labels, timestamps, or commentary. ' +
          'If there is no intelligible speech, output nothing.',
        input: [
          { type: 'text', text: 'Transcribe this voice memo verbatim.' },
          audio,
        ],
      }, {
        timeout_ms: 20000,
        // Fail fast on the primary (fallback is next); one retry on the last model
        retries: isLast
          ? { strategy: 'attempt-count-backoff', maxRetries: 1, retryConnectionErrors: true }
          : { strategy: 'none' },
      });
      return (interaction.output_text || '').trim();
    } catch (err) {
      lastErr = err;
      console.warn(`[quick] Gemini ${model} failed: ${err.message}`);
    }
  }
  throw lastErr;
}

// ── Claude classification ──────────────────────────────────────────────────

const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    type:               { type: 'string', enum: QUICK_TYPES },
    title:              { type: 'string' },
    start:              NULLABLE_STRING,
    end:                NULLABLE_STRING,
    allDay:             { type: 'boolean' },
    location:           NULLABLE_STRING,
    dueDate:            NULLABLE_STRING,
    linkedRecordingId:  NULLABLE_STRING,
    linkConfidence:     { type: 'number' },
    content:            { type: 'string' },
    spokenConfirmation: { type: 'string' },
  },
  required: [
    'type', 'title', 'start', 'end', 'allDay', 'location', 'dueDate',
    'linkedRecordingId', 'linkConfidence', 'content', 'spokenConfirmation',
  ],
  additionalProperties: false,
};

const CLASSIFY_SYSTEM = `You turn a short voice memo, dictated while driving, into exactly one action for a personal recording archive.

Choose "type":
- "event": something scheduled for a specific day (appointment, meeting, call, pickup). Fill start/end.
- "reminder": a task or to-do ("remind me to…", "I need to…", "don't forget…"). Put any deadline in dueDate.
- "note_link": the memo adds information to ONE of the listed recordings (same topic, person, or case). Set linkedRecordingId to that recording's id and linkConfidence to how sure you are (0–1). Only choose this when linkConfidence >= 0.7; otherwise use "note".
- "note": anything else.

Dates and times:
- Resolve relative dates ("tomorrow at 3", "next Tuesday", "in two weeks") against the current date/time given, in the America/New_York timezone. A bare weekday means its next upcoming occurrence.
- Timed values: ISO 8601 with the New York UTC offset, e.g. 2026-10-20T15:00:00-04:00.
- Events with a time but no end last 1 hour. Events with a day but no time are all-day: allDay true and start as "YYYY-MM-DD".
- A requested event with no determinable day becomes a "reminder" with dueDate null.
- Reminders: dueDate is "YYYY-MM-DD" (no time) or a timed ISO value; allDay true when there is no time.
- Use null for fields that don't apply; linkConfidence 0 when not linking.

Text:
- title: short and specific (under 60 characters), no trailing period.
- content: the memo cleaned up — remove filler words and false starts, keep every detail (names, numbers, places).
- spokenConfirmation: one short sentence to be read aloud, under 20 words, with natural day names and times (never ISO dates), for example "Added to calendar: Dentist, Tuesday at 3 PM", "Reminder set: Call the pharmacy, tomorrow", "Saved note for CVS Specialty Refill", or "Saved quick note: Gas mileage idea".`;

async function classify({ transcript, now, recordings }) {
  if (!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY not set');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const ctx = describeNow(now);
  const recentList = recordings.length
    ? recordings.map(r => `${r.id} | ${r.date} | ${r.title}`).join('\n')
    : '(none)';

  const msg = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
    max_tokens: 4000,
    system:     CLASSIFY_SYSTEM,
    messages: [{
      role: 'user',
      content:
        `Current date/time: ${ctx.human} (${ctx.iso})\nTimezone: ${TIMEZONE}\n\n` +
        `Recent recordings (id | date | title):\n${recentList}\n\n` +
        `<transcript>\n${transcript}\n</transcript>`,
    }],
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: CLASSIFICATION_SCHEMA },
    },
    // Retry on a fallback model if the primary model declines the request
    fallbacks: 'default',
  }, { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } });

  if (msg.stop_reason === 'refusal') throw new Error('Claude declined to classify this memo');
  // Thinking blocks may precede the answer — keep only the text blocks
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Claude returned no JSON');
    return JSON.parse(m[0]);
  }
}

// ── Classification → note fields ───────────────────────────────────────────

function applyFields(note, fields, { recordingExists }) {
  const type = QUICK_TYPES.includes(fields.type) ? fields.type : note.type || 'note';
  const allDay = !!fields.allDay;

  note.type     = type;
  note.title    = (fields.title || '').trim() || note.title || 'Quick note';
  note.content  = typeof fields.content === 'string' ? fields.content.trim() : (note.content || '');
  note.location = fields.location ? String(fields.location).trim() : null;
  note.allDay   = allDay;
  note.start    = null;
  note.end      = null;
  note.dueDate  = null;
  note.linkedRecordingId = null;
  note.linkConfidence    = typeof fields.linkConfidence === 'number' ? fields.linkConfidence : null;

  if (type === 'event') {
    note.start = normalizeWhen(fields.start, allDay);
    if (!note.start) {
      // No usable date → keep it as a reminder instead of a broken event
      note.type   = 'reminder';
      note.allDay = true;
    } else if (allDay || DATE_ONLY_RE.test(note.start)) {
      note.allDay = true;
      note.start  = note.start.slice(0, 10);
      const end   = normalizeWhen(fields.end, true);
      note.end    = end && end > note.start ? end : null;
    } else {
      const end   = normalizeWhen(fields.end, false);
      const s     = parseZoned(note.start);
      const e     = end && parseZoned(end);
      note.end    = e && e > s ? end : toZonedIso(new Date(s.getTime() + 60 * 60 * 1000));
    }
  }

  if (note.type === 'reminder') {
    const due = normalizeWhen(fields.dueDate ?? fields.start, false);
    note.dueDate = due;
    note.allDay  = !due || DATE_ONLY_RE.test(due);
  }

  if (type === 'note_link') {
    const id = fields.linkedRecordingId;
    const confident = fields.linkConfidence === undefined || fields.linkConfidence >= LINK_MIN_CONFIDENCE;
    if (id && confident && recordingExists(id)) {
      note.linkedRecordingId = id;
    } else {
      note.type = 'note';
    }
  }
  return note;
}

// ── Google Calendar reconciliation ─────────────────────────────────────────

function desiredGoogleEvent(note) {
  if (note.undone) return null;
  const description = [
    note.content,
    note.transcript && note.transcript !== note.content ? `Transcript: ${note.transcript}` : null,
    'Created by Pocket Archive Quick Capture',
  ].filter(Boolean).join('\n\n');

  let start, end, summary;
  if (note.type === 'event' && note.start) {
    summary = note.title;
    if (DATE_ONLY_RE.test(note.start)) {
      start = { date: note.start };
      end   = { date: note.end && note.end > note.start ? addDays(note.end, 1) : addDays(note.start, 1) };
    } else {
      start = { dateTime: note.start, timeZone: TIMEZONE };
      end   = { dateTime: note.end || toZonedIso(new Date(parseZoned(note.start).getTime() + 3600000)), timeZone: TIMEZONE };
    }
  } else if (note.type === 'reminder' && note.dueDate) {
    summary = `⏰ ${note.title}`;
    if (DATE_ONLY_RE.test(note.dueDate)) {
      start = { date: note.dueDate };
      end   = { date: addDays(note.dueDate, 1) };
    } else {
      start = { dateTime: note.dueDate, timeZone: TIMEZONE };
      end   = { dateTime: toZonedIso(new Date(parseZoned(note.dueDate).getTime() + 30 * 60000)), timeZone: TIMEZONE };
    }
  } else {
    return null;
  }
  return { summary, description, location: note.location || undefined, start, end };
}

// Make Google match the note: create, update, or delete its event.
// Never throws — failures are recorded on the note.
async function syncGoogle(note) {
  const ids     = note.googleEventIds || [];
  const desired = desiredGoogleEvent(note);

  if (!desired && !ids.length) { note.googleSync = null; return note; }
  if (!gcal.isConfigured()) {
    note.googleSync = desired ? 'skipped' : note.googleSync;
    return note;
  }

  try {
    if (desired && ids.length) {
      await gcal.updateEvent(ids[0], desired);
      for (const extra of ids.slice(1)) await gcal.deleteEvent(extra);
      note.googleEventIds = [ids[0]];
    } else if (desired) {
      note.googleEventIds = [await gcal.createEvent(desired)];
    } else {
      for (const id of ids) await gcal.deleteEvent(id);
      note.googleEventIds = [];
    }
    note.googleSync  = desired ? 'synced' : null;
    note.googleError = null;
  } catch (err) {
    console.warn(`[quick] Google Calendar sync failed for ${note.id}: ${err.message}`);
    note.googleSync  = 'failed';
    note.googleError = err.message;
  }
  return note;
}

function describeActions(note, recordingTitle) {
  const actions = [];
  if (note.status === 'needs_review') actions.push('Saved for review');
  else if (note.type === 'event')     actions.push('Added to calendar');
  else if (note.type === 'reminder')  actions.push(note.dueDate ? 'Reminder with due date' : 'Reminder (no due date)');
  else if (note.type === 'note_link') actions.push(`Linked to “${recordingTitle || note.linkedRecordingId}”`);
  else                                actions.push('Saved as quick note');

  if (note.googleSync === 'synced')  actions.push('Synced to Google Calendar');
  if (note.googleSync === 'skipped') actions.push('Google Calendar not configured');
  if (note.googleSync === 'failed')  actions.push('Google Calendar sync failed');
  return actions;
}

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * deps: {
 *   archivePath,
 *   getRecentRecordings(limit) → [{ id, title, date }],
 *   recordingExists(id) → bool,
 *   getRecordingTitle(id) → string,
 * }
 */
function createQuickCapture(deps) {
  const store = createStore(deps.archivePath);

  const audioUpload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const base = (file.mimetype || '').split(';')[0].trim().toLowerCase();
      if (AUDIO_TYPES[base]) cb(null, true);
      else cb(new Error(`Unsupported audio type: ${file.mimetype}`));
    },
  });

  function finalize(note) {
    note.actions = describeActions(note, note.linkedRecordingId ? deps.getRecordingTitle(note.linkedRecordingId) : null);
    return store.write(note);
  }

  // Transcribe → classify → act → save. Never throws for AI failures:
  // the capture is kept as a "needs_review" note instead.
  async function runPipeline(note, now) {
    const ext = path.extname(note.audioFile).slice(1);
    try {
      note.transcript = await transcribe(path.join(store.audioDir, note.audioFile), ext);
    } catch (err) {
      console.warn(`[quick] Transcription failed for ${note.id}: ${err.message}`);
      note.error = `Transcription failed: ${err.message}`;
    }

    if (note.transcript) {
      try {
        const recordings = deps.getRecentRecordings(100);
        note.classification = await classify({ transcript: note.transcript, now, recordings });
        applyFields(note, note.classification, deps);
        note.spokenConfirmation = String(note.classification.spokenConfirmation || '').trim() || `Saved: ${note.title}`;
      } catch (err) {
        console.warn(`[quick] Classification failed for ${note.id}: ${err.message}`);
        note.error = `Classification failed: ${err.message}`;
      }
    } else if (!note.error) {
      note.error = 'No speech detected';
    }

    if (!note.classification) {
      note.type    = 'note';
      note.status  = 'needs_review';
      note.title   = note.transcript ? note.transcript.split(/\s+/).slice(0, 8).join(' ') : 'Unclear voice note';
      note.content = note.transcript || '';
      note.spokenConfirmation = NEEDS_REVIEW_SPOKEN;
    }

    await syncGoogle(note);
    if (note.googleSync === 'failed') {
      note.spokenConfirmation = `${note.spokenConfirmation.replace(/[.!]?$/, '.')} Google Calendar didn't update.`;
    }
    return finalize(note);
  }

  function referenceTime(capturedAt) {
    const d = capturedAt ? new Date(capturedAt) : null;
    const now = Date.now();
    // Queued captures resolve "tomorrow" against when they were spoken
    if (d && !isNaN(d) && d.getTime() <= now + 5 * 60000 && d.getTime() >= now - 7 * 86400000) return d;
    return new Date(now);
  }

  function register(app) {
    // GET /api/quick — newest first; optional ?recordingId=&status=
    app.get('/api/quick', (req, res) => {
      try {
        let notes = store.list();
        if (req.query.recordingId) notes = notes.filter(n => n.linkedRecordingId === req.query.recordingId);
        if (req.query.status)      notes = notes.filter(n => n.status === req.query.status);
        res.json(notes);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/quick/capture — multipart: audio, clientId?, capturedAt?
    app.post('/api/quick/capture', (req, res, next) => {
      audioUpload.single('audio')(req, res, err => {
        if (err) {
          const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
          return res.status(status).json({ error: err.message });
        }
        next();
      });
    }, async (req, res) => {
      if (!req.file?.buffer?.length) return res.status(400).json({ error: 'audio file is required' });

      const clientId = typeof req.body.clientId === 'string' ? req.body.clientId.slice(0, 64) : null;
      if (clientId) {
        // Retried upload from the offline queue — return what we already did
        const existing = store.list().find(n => n.clientId === clientId);
        if (existing) return res.json({ note: existing, spokenConfirmation: existing.spokenConfirmation });
      }

      const id   = newId();
      const base = req.file.mimetype.split(';')[0].trim().toLowerCase();
      const ext  = AUDIO_TYPES[base] || 'webm';
      const now  = referenceTime(req.body.capturedAt);

      let note;
      try {
        store.ensureDirs();
        fs.writeFileSync(path.join(store.audioDir, `${id}.${ext}`), req.file.buffer);
        note = {
          id, clientId,
          createdAt:  new Date().toISOString(),
          capturedAt: now.toISOString(),
          audioFile:  `${id}.${ext}`,
          transcript: null,
          classification: null,
          type: 'note', status: 'ok', title: 'Quick note', content: '',
          start: null, end: null, allDay: false, location: null, dueDate: null,
          linkedRecordingId: null, linkConfidence: null,
          googleEventIds: [], googleSync: null, googleError: null,
          actions: [], spokenConfirmation: null, error: null,
          undone: false, undoneAt: null,
        };
        store.write(note);
      } catch (err) {
        console.error('/quick/capture save error:', err);
        return res.status(500).json({ error: err.message });
      }

      await runPipeline(note, now);
      res.json({ note, spokenConfirmation: note.spokenConfirmation });
    });

    // POST /api/quick/:id/retry — re-run transcription + classification on a
    // capture that needs review (e.g. the AI service was busy at the time)
    app.post('/api/quick/:id/retry', async (req, res) => {
      const { id } = req.params;
      if (!isQuickId(id)) return res.status(400).json({ error: 'Invalid quick note ID' });
      const note = store.read(id);
      if (!note) return res.status(404).json({ error: 'Quick note not found' });
      if (note.undone) return res.status(409).json({ error: 'This capture was undone' });
      if (note.status !== 'needs_review') return res.status(409).json({ error: 'Only captures that need review can be retried' });

      try {
        Object.assign(note, { transcript: null, classification: null, error: null, status: 'ok' });
        const captured = new Date(note.capturedAt || note.createdAt);
        await runPipeline(note, isNaN(captured) ? new Date() : captured);
        res.json({ note, spokenConfirmation: note.spokenConfirmation });
      } catch (err) {
        console.error('/quick retry error:', err);
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/quick/:id/audio
    app.get('/api/quick/:id/audio', (req, res) => {
      const { id } = req.params;
      if (!isQuickId(id)) return res.status(400).json({ error: 'Invalid quick note ID' });
      const note = store.read(id);
      if (!note?.audioFile) return res.status(404).json({ error: 'Audio not found' });
      const file = path.join(store.audioDir, path.basename(note.audioFile));
      if (!fs.existsSync(file)) return res.status(404).json({ error: 'Audio not found' });
      res.sendFile(path.resolve(file));
    });

    // PUT /api/quick/:id — edit title/content/type/dates/link; updates Google
    app.put('/api/quick/:id', async (req, res) => {
      const { id } = req.params;
      if (!isQuickId(id)) return res.status(400).json({ error: 'Invalid quick note ID' });
      const note = store.read(id);
      if (!note) return res.status(404).json({ error: 'Quick note not found' });
      if (note.undone) return res.status(409).json({ error: 'This capture was undone and can no longer be edited' });

      const body = req.body || {};
      if (body.type !== undefined && !QUICK_TYPES.includes(body.type)) {
        return res.status(400).json({ error: `type must be one of: ${QUICK_TYPES.join(', ')}` });
      }
      if (body.linkedRecordingId && !deps.recordingExists(body.linkedRecordingId)) {
        return res.status(400).json({ error: 'Linked recording not found' });
      }
      const type = body.type ?? note.type;
      if (type === 'note_link' && !(body.linkedRecordingId ?? note.linkedRecordingId)) {
        return res.status(400).json({ error: 'Choose a recording to link to' });
      }

      try {
        const pick = key => (body[key] !== undefined ? body[key] : note[key]);
        applyFields(note, {
          type,
          title:             pick('title'),
          content:           pick('content'),
          start:             pick('start'),
          end:               pick('end'),
          allDay:            pick('allDay'),
          location:          pick('location'),
          dueDate:           pick('dueDate'),
          linkedRecordingId: pick('linkedRecordingId'),
          linkConfidence:    1,
        }, deps);
        if (note.status === 'needs_review') note.status = 'ok';
        note.unlinkedFrom = null;
        await syncGoogle(note);
        res.json(finalize(note));
      } catch (err) {
        console.error('/quick PUT error:', err);
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/quick/:id/undo — remove Google event(s) and link, keep history
    app.post('/api/quick/:id/undo', async (req, res) => {
      const { id } = req.params;
      if (!isQuickId(id)) return res.status(400).json({ error: 'Invalid quick note ID' });
      const note = store.read(id);
      if (!note) return res.status(404).json({ error: 'Quick note not found' });
      if (note.undone) return res.json(note);

      const ids = note.googleEventIds || [];
      if (ids.length && gcal.isConfigured()) {
        try {
          for (const eventId of ids) await gcal.deleteEvent(eventId);
          note.googleEventIds = [];
        } catch (err) {
          console.warn(`[quick] Could not delete Google event for ${id}: ${err.message}`);
          return res.status(502).json({ error: `Could not remove the Google Calendar event: ${err.message}` });
        }
      }
      note.undoneLink       = note.linkedRecordingId || null;
      note.linkedRecordingId = null;
      note.undone           = true;
      note.undoneAt         = new Date().toISOString();
      note.googleSync       = null;
      note.actions          = [...(note.actions || []), 'Undone'];
      res.json(store.write(note));
    });
  }

  // Soft delete of a recording: keep its quick notes, just unlink them
  function unlinkRecording(recordingId) {
    for (const note of store.list()) {
      if (note.linkedRecordingId !== recordingId) continue;
      note.linkedRecordingId = null;
      note.type = 'note';
      note.unlinkedFrom = { recordingId, reason: 'recording_deleted', at: new Date().toISOString() };
      finalize(note);
    }
  }

  // Restore of a recording: re-link notes that were unlinked by its deletion
  function relinkRecording(recordingId) {
    for (const note of store.list()) {
      if (note.undone || note.unlinkedFrom?.recordingId !== recordingId) continue;
      note.linkedRecordingId = recordingId;
      note.type = 'note_link';
      note.unlinkedFrom = null;
      finalize(note);
    }
  }

  function countActive() {
    return store.list().filter(n => !n.undone).length;
  }

  return { register, unlinkRecording, relinkRecording, countActive };
}

module.exports = {
  createQuickCapture,
  // exported for tests
  _internal: { applyFields, normalizeWhen, parseZoned, toZonedIso, desiredGoogleEvent, describeNow, syncGoogle },
};
