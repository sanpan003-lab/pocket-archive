// Quick Capture — one-tap voice notes that are transcribed (Gemini),
// classified (Claude) and acted on: calendar events, reminders, errands
// (checklists at a store, with arrival reminders on Android), notes linked
// to a recording, or standalone notes. Everything is undoable.
//
// Also typed notes, checklists, photos and drawings (the "+" create menu): the
// same classify → smart append → errands/calendar → summary pipeline, minus
// transcription (photos: Gemini reads them first).
//
// Storage: ARCHIVE/07_Quick_Notes/{id}.json + audio/{id}.{ext} + media/{id}.{ext}

const fs     = require('fs');
const path   = require('path');
const multer = require('multer');
const gcal   = require('./googleCalendar');
const { convertToM4a, ffmpegAvailable } = require('./audioConvert');
const { createProjects } = require('./projects');
const { createAppender } = require('./quickAppend');

const TIMEZONE = gcal.TIMEZONE;
const QUICK_TYPES = ['event', 'reminder', 'errand', 'note_link', 'note'];
const ERRAND_TRIGGERS = ['time', 'arrival', 'both'];
const LINK_MIN_CONFIDENCE = 0.7;
const INLINE_AUDIO_LIMIT  = 15 * 1024 * 1024; // Gemini inline requests cap at 20 MB total
const NEEDS_REVIEW_SPOKEN = "Saved, but I couldn't understand it — check your inbox.";

const AUDIO_TYPES = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/flac': 'flac',
};
const IMAGE_TYPES = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heif', 'image/gif': 'gif',
};
const IMAGE_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif' };
const MEDIA_LIMIT = 20 * 1024 * 1024;
const NOTE_COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
const SOURCES = ['voice', 'text', 'list', 'image', 'drawing'];

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

// Field groups written by background jobs; the newer timestamp wins on write
const FIELD_GROUPS = [
  { stamp: 'summaryUpdatedAt', fields: ['summary', 'summaryStatus', 'summaryError', 'summaryUpdatedAt'] },
  { stamp: 'audioUpdatedAt',   fields: ['audioFile', 'durationSec', 'audioConverted', 'audioMigration', 'audioUpdatedAt'] },
];

function createStore(archivePath) {
  const dir      = path.join(archivePath, '07_Quick_Notes');
  const audioDir = path.join(dir, 'audio');
  const mediaDir = path.join(dir, 'media');

  const fileFor = id => path.join(dir, `${id}.json`);

  function ensureDirs() {
    fs.mkdirSync(audioDir, { recursive: true });
    fs.mkdirSync(mediaDir, { recursive: true });
  }

  function read(id) {
    try { return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')); }
    catch { return null; }
  }

  function write(note) {
    ensureDirs();
    // Background jobs (summaries, audio conversion) update their own field
    // groups on disk. Never let a stale in-memory copy overwrite a newer group.
    const onDisk = read(note.id);
    if (onDisk) {
      for (const { stamp, fields } of FIELD_GROUPS) {
        if ((onDisk[stamp] || '') > (note[stamp] || '')) {
          for (const f of fields) note[f] = onDisk[f];
        }
      }
    }
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

  return { dir, audioDir, mediaDir, read, write, list, ensureDirs };
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

// ── Gemini: read a photo / drawing ─────────────────────────────────────────

const IMAGE_PROMPTS = {
  organize:
    'You read photos saved into a personal notes app (receipts, whiteboards, labels, documents, screenshots, ' +
    'handwritten notes, objects). Output plain text in two parts:\n' +
    'Text:\n<every readable word, verbatim, keeping line breaks and numbers; "(none)" if there is no text>\n\n' +
    'Description:\n<one or two sentences on what the photo shows; for a receipt: store, date, total; ' +
    'for a whiteboard or list: what it is about>.\nNo other commentary.',
  handwriting:
    'This is a hand drawing or handwritten note. Output only the handwritten text, verbatim, keeping line breaks. ' +
    'If there is no readable writing, output one short sentence describing the drawing, starting with "Drawing:".',
};

async function readImage(filePath, ext, mode = 'organize') {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const { GoogleGenAI } = await import('@google/genai');
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const image = { type: 'image', data: fs.readFileSync(filePath, { encoding: 'base64' }), mime_type: IMAGE_MIME[ext] || 'image/jpeg' };
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
        system_instruction: IMAGE_PROMPTS[mode] || IMAGE_PROMPTS.organize,
        input: [{ type: 'text', text: mode === 'handwriting' ? 'Read the handwriting.' : 'Read this photo.' }, image],
      }, {
        timeout_ms: 30000,
        retries: isLast
          ? { strategy: 'attempt-count-backoff', maxRetries: 1, retryConnectionErrors: true }
          : { strategy: 'none' },
      });
      return (interaction.output_text || '').trim();
    } catch (err) {
      lastErr = err;
      console.warn(`[quick] Gemini image ${model} failed: ${err.message}`);
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
    items:              { type: 'array', items: { type: 'string' } },
    place: {
      anyOf: [
        {
          type: 'object',
          properties: {
            query: { type: 'string' },
            kind:  { anyOf: [{ type: 'string', enum: ['chain', 'specific'] }, { type: 'null' }] },
          },
          required: ['query', 'kind'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
    trigger:            { anyOf: [{ type: 'string', enum: ERRAND_TRIGGERS }, { type: 'null' }] },
    content:            { type: 'string' },
    spokenConfirmation: { type: 'string' },
    // Smart append
    action:             { type: 'string', enum: ['create', 'append', 'update', 'cancel'] },
    targetId:           { type: 'string' },
    targetType:         { anyOf: [{ type: 'string', enum: ['errand', 'note', 'project', 'event', 'reminder', 'recording'] }, { type: 'null' }] },
    targetName:         { type: 'string' },
    explicitTarget:     { type: 'boolean' },
    confidence:         { type: 'number' },
    addItems:           { type: 'array', items: { type: 'string' } },
    removeItems:        { type: 'array', items: { type: 'string' } },
    changes: {
      type: 'object',
      properties: { start: { type: 'string' }, end: { type: 'string' }, title: { type: 'string' }, location: { type: 'string' } },
      required: ['start', 'end', 'title', 'location'],
      additionalProperties: false,
    },
    appendText:         { type: 'string' },
    alsoProjectId:      { type: 'string' },
    newProjectName:     { type: 'string' },
    // Location reminders for any place ("when I get home", "when I leave work")
    geoWhen:            { type: 'string', enum: ['', 'arrive', 'leave'] },
    geoPlace:           { type: 'string' },
    geoPlaceId:         { type: 'string' },
  },
  required: [
    'type', 'title', 'start', 'end', 'allDay', 'location', 'dueDate',
    'linkedRecordingId', 'linkConfidence', 'items', 'place', 'trigger', 'content', 'spokenConfirmation',
    'action', 'targetId', 'targetType', 'targetName', 'explicitTarget', 'confidence',
    'addItems', 'removeItems', 'changes', 'appendText', 'alsoProjectId', 'newProjectName',
    'geoWhen', 'geoPlace', 'geoPlaceId',
  ],
  additionalProperties: false,
};

const CLASSIFY_SYSTEM = `You turn a short voice memo, dictated while driving, into exactly one action for a personal recording archive.

Choose "type":
- "event": something scheduled for a specific day (appointment, meeting, call, pickup). Fill start/end.
- "reminder": a task or to-do ("remind me to…", "I need to…", "don't forget…"). Put any deadline in dueDate.
- "errand": a trip to a store or place to buy or pick up things, and/or a list of things to get ("Tomorrow I need to go to Publix for milk and eggs", "Remind me when I get to Publix to buy soda", "Pick up at Home Depot: screws, tape", "I need milk, bread and coffee"). Prefer "errand" over "event" or "reminder" whenever the memo lists things to buy or get, or ties a task to arriving at a store.
- "note_link": the memo adds information to ONE of the listed recordings (same topic, person, or case). Set linkedRecordingId to that recording's id and linkConfidence to how sure you are (0–1). Only choose this when linkConfidence >= 0.7; otherwise use "note".
- "note": anything else.

Dates and times:
- Resolve relative dates ("tomorrow at 3", "next Tuesday", "in two weeks") against the current date/time given, in the America/New_York timezone. A bare weekday means its next upcoming occurrence.
- Timed values: ISO 8601 with the New York UTC offset, e.g. 2026-10-20T15:00:00-04:00.
- Events with a time but no end last 1 hour. Events with a day but no time are all-day: allDay true and start as "YYYY-MM-DD".
- A requested event with no determinable day becomes a "reminder" with dueDate null.
- Reminders: dueDate is "YYYY-MM-DD" (no time) or a timed ISO value; allDay true when there is no time.
- Use null for fields that don't apply; linkConfidence 0 when not linking; items [] when there is no list.

Errands:
- items: each thing to buy or get as its own entry — clean and capitalized, no filler, no quantities unless spoken ("Milk", "Ketchup", "Chicken sandwich", "2 boxes of screws"). Split "milk, soda and chicken" into three items. Never invent items.
- place: { "query": the store or place as spoken, e.g. "Publix", "Home Depot", "Dr. Smith's office", "kind": "chain" for a store brand with many locations (Publix, Target, CVS, Home Depot, Costco), "specific" for one particular place or address, or null if unsure }. place is null when no place is named.
- trigger: "arrival" when the reminder should happen on getting there ("when I get to", "when I'm at", "next time I'm at", "once I'm at"); "time" when a day or time is given for the trip ("tomorrow", "on Saturday at 10"); "both" when both are said; null otherwise.
- A dated errand puts the day in start ("YYYY-MM-DD", allDay true) or a timed start when a time is said; end null. start is null when no day is given.
- title: short, e.g. "Publix shopping" or "Home Depot pickup"; content: the full request.

Text:
- title: short and specific (under 60 characters), no trailing period.
- content: the memo cleaned up — remove filler words and false starts, keep every detail (names, numbers, places).
- spokenConfirmation: one short sentence to be read aloud, under 20 words, with natural day names and times (never ISO dates), for example "Added to calendar: Dentist, Tuesday at 3 PM", "Reminder set: Call the pharmacy, tomorrow", "Publix list saved, 4 items, for tomorrow", "Saved note for CVS Specialty Refill", or "Saved quick note: Gas mileage idea".

Adding to existing things (smart append):
You also get CANDIDATES: open errands with their items, active projects, quick notes from the last 14 days, upcoming events/reminders, and recent recordings. Decide whether the memo creates something new or changes one of them.
- "action":
  - "create": a new, separate thing (the default).
  - "append": add to an existing target — items to a list, more information to a note or project ("add eggs and bread to my Publix list", "also need milk", "for the Tesla drawer project: the cubby is 7 inches deep", "add to my notes about the kitchen").
  - "update": change an existing event/reminder/errand ("move the dentist to 4 PM", "the Publix trip is Saturday now", "rename…"). Put the new values in "changes"; keep the original day when only a time is given (e.g. dentist on Tue Oct 20 at 3, "move it to 4" → "2026-10-20T16:00:00-04:00").
  - "cancel": cancel an existing event/reminder/errand ("cancel the dentist", "never mind the Publix trip").
- targetId/targetType: the candidate being changed (ids exactly as listed; recordings use type "recording"). For create: targetId "" and targetType null.
- explicitTarget: true when the memo itself names the target ("my Publix list", "the dentist", "the Tesla drawer project", "add to Pocket Archive", "this is for X", "add this to my X notes").
- targetName: the target as spoken when explicitTarget is true (e.g. "Pocket Archive", "Publix list"), even if no candidate matches; otherwise "".
- confidence 0–1: how sure the memo is about that target. Explicit references: 0.9+. Implicit matches only when the memo clearly continues the target (same store, topic, people, or thing); weigh recent targets higher; unrelated memos are "create". An ambiguous continuation is 0.6–0.8.
- A short memo that only names more things to get ("also need milk", "and paper towels") continues the most recent open errand: append with confidence 0.9.
- Append to a NOTE only when the memo adds detail to that same specific thing. A separate idea, bug, task or item that merely shares a topic or product name with a note ("Pocket Archive idea: …" after "Pocket Archive bug: …") is "create" — related notes are grouped by projects, not merged — UNLESS the memo explicitly says to add it somewhere (next rule).
- Explicit "add to" phrasing ALWAYS appends, whatever is being added: "I want to add to Pocket Archive: …", "add this to my Pocket Archive notes", "this is for Pocket Archive", "put this under the kitchen project" → action "append", explicitTarget true, targetName as spoken (e.g. "Pocket Archive"), confidence 0.95, appendText = what to add. Set targetId only when exactly one candidate is meant (a project, list or a single note); when several notes share that name, or nothing matches, leave targetId "" — the app groups them into a project.
- addItems/removeItems: for list appends ("take soda off the Publix list" → removeItems ["Soda"]), cleaned like items; [] otherwise.
- appendText: for append to a note/project, the new information cleaned up (keep every detail); "" otherwise.
- changes: for update; unchanged fields "" (all "" otherwise).
- newProjectName: when the memo starts/creates a project ("start a project called kitchen backsplash" → "Kitchen backsplash"); action "create"; "" otherwise.
- alsoProjectId: when a NEW note clearly belongs to an active project but is its own thing (e.g. a reminder for that project); otherwise "".
- Always also fill the create fields (type, title, content, …) as if the memo were new, so it can be kept as its own note if the user prefers.
- spokenConfirmation for appends describes the change ("Added eggs and bread to your Publix list").

Location reminders (any place, not just stores):
- When the memo ties a reminder, note or list to arriving at or leaving a PERSONAL place — home, work, school, the gym, someone's house, a named place that isn't a store to shop at ("remind me to put clothes in the dryer when I get home", "when I leave work call mom", "next time I'm at the gym, book a trainer", "when I get to my son's school, ask about the field trip") — set geoWhen "arrive" (get to / get home / arrive / next time I'm at / once I'm at) or "leave" (leave / leaving / head out of / when I'm done at), and geoPlace to the place as spoken ("home", "work", "my son's school", "the gym").
- geoPlaceId: the id from PLACES when the place is clearly one of them (home → "home"; work → the work place; aliases count); otherwise "".
- Use type "reminder" for a task ("put clothes in the dryer"), "note" for information, "errand" only for things to buy at a store. A shopping trip to a store keeps using errand place/trigger as above (not geoWhen), except when leaving ("when I leave Publix …"), which uses geoWhen "leave".
- A location reminder with no time has dueDate null; don't invent a date. geoWhen "" and geoPlace "" / geoPlaceId "" when there's no place trigger.
- spokenConfirmation for location reminders: "I'll remind you when you get home: put clothes in the dryer".`;

async function classify({ transcript, now, recordings, candidates = '', places = '' }) {
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
        `CANDIDATES\n${candidates || '(none)'}\n\n` +
        `PLACES (id | name | aliases)\n${places || '(none)'}\n\n` +
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

// ── Claude summary ─────────────────────────────────────────────────────────

const SUMMARY_SYSTEM = `You write clean, structured summaries of voice memos for a personal archive, in the style of meeting-recorder summaries.

Scale the summary to the memo:
- A memo of one or two sentences gets one bold title line followed by 1–3 bullets. Nothing else — no headings, no overview, no padding.
- A longer memo gets a one- or two-sentence overview, then only the sections that apply, each with a "### " heading: Key Points, Action Items, People & Places, Details. Skip any section with nothing real to say. Never use "#" or "##" headings.

Formatting:
- Bullets with bold labels where they help: "- **Label:** detail".
- Action Items include their dates or deadlines when the memo gives them.
- Use a Markdown table only when it makes things clearer, e.g. several items that each have a date, amount, or owner.

Content:
- Remove filler words ("uh", "um", "like", "you know"), false starts, and repetition.
- Never add facts, names, numbers, or dates that are not in the memo. If something is unclear, leave it out rather than guess.
- Resolve relative dates ("tomorrow", "next Tuesday") against the capture time in America/New_York and write them like "Tue, Oct 20".
- Output only the summary — no preamble, no closing remarks, no code fences.`;

async function summarize(note) {
  if (!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY not set');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const captured = new Date(note.capturedAt || note.createdAt);
  const ctx = describeNow(isNaN(captured) ? new Date() : captured);
  const edited = note.contentEdited && note.content && note.content !== note.transcript
    ? `\n\n<edited_note>\n${note.content}\n</edited_note>\n(The user corrected the note above — trust it over the transcript where they differ.)`
    : '';

  // Later voice updates / merged notes: the summary covers all of them
  const updates = (note.updates || []).length
    ? `\n\n<updates>\n${note.updates.map(u => `[${describeNow(new Date(u.at)).human}] ${u.text}`).join('\n')}\n</updates>\n(Updates added later, oldest first — fold them into one summary; newer information wins.)`
    : '';
  const itemsNow = (note.type === 'errand' || note.format === 'list') && (note.items || []).length
    ? `\n\n<checklist>\n${note.items.map(i => `${i.done ? '[x]' : '[ ]'} ${i.text}`).join('\n')}\n</checklist>`
    : '';

  const msg = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
    max_tokens: 4000,
    system:     SUMMARY_SYSTEM,
    messages: [{
      role: 'user',
      content:
        `Captured: ${ctx.human} (${TIMEZONE})${note.source && note.source !== 'voice' ? ` · typed in the app (${note.source}), not spoken` : ''}\n\n` +
        `<transcript>\n${note.transcript || note.content || ''}\n</transcript>${edited}${updates}${itemsNow}` +
        (note.mediaText ? `\n\n<from_${note.media?.kind || 'image'}>\n${note.mediaText}\n</from_${note.media?.kind || 'image'}>` : ''),
    }],
    output_config: { effort: 'medium' },
    // Retry on a fallback model if the primary model declines the request
    fallbacks: 'default',
  }, { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } });

  if (msg.stop_reason === 'refusal') throw new Error('Claude declined to summarize this memo');
  // Thinking blocks may precede the answer — keep only the text blocks
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim()
    .replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i, '$1')
    .trim();
  if (!text) throw new Error('Claude returned an empty summary');
  return text;
}

async function suggestTitle(notes) {
  if (!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY not set');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const msg = await client.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
    max_tokens: 200,
    system: 'Write one short title (under 60 characters, no quotes, no trailing period) for a note that combines the voice notes below. Output only the title.',
    messages: [{ role: 'user', content: notes.map(n => `- ${n.title}: ${String(n.summary || n.content || '').slice(0, 300)}`).join('\n') }],
    output_config: { effort: 'low' },
    fallbacks: 'default',
  }, { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } });
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim().replace(/^["']|["']$/g, '').replace(/\.$/, '');
  if (!text) throw new Error('No title');
  return text.slice(0, 80);
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

  if (type === 'errand') {
    // Optional day of the trip: all-day unless a time was said
    const start = normalizeWhen(fields.start, false);
    if (start && (allDay || DATE_ONLY_RE.test(start) || DATE_ONLY_RE.test(String(fields.start).trim()))) {
      note.allDay = true;
      note.start  = start.slice(0, 10);
    } else if (start) {
      note.allDay = false;
      note.start  = start;
      note.end    = toZonedIso(new Date(parseZoned(start).getTime() + 60 * 60 * 1000));
    } else {
      note.allDay = true;
    }
    note.items = normalizeItems(fields.items, note.items);
    const spec = fields.place && typeof fields.place === 'object' ? fields.place : null;
    note.placeSpec = spec && String(spec.query || '').trim()
      ? { query: String(spec.query).trim().slice(0, 100), kind: spec.kind === 'chain' || spec.kind === 'specific' ? spec.kind : null }
      : null;
    note.trigger = ERRAND_TRIGGERS.includes(fields.trigger) ? fields.trigger : null;
  }

  if (note.type === 'reminder') {
    const due = normalizeWhen(fields.dueDate ?? fields.start, false);
    note.dueDate = due;
    note.allDay  = !due || DATE_ONLY_RE.test(due);
  }

  // Location reminder (resolved to a place by prepareGeo)
  const geoWhen = fields.geoWhen === 'arrive' || fields.geoWhen === 'leave' ? fields.geoWhen : null;
  const geoPlace = String(fields.geoPlace || '').trim().slice(0, 80);
  if (geoWhen && geoPlace) {
    const same = note.geo && note.geo.when === geoWhen && note.geo.query === geoPlace;
    note.geo = same ? note.geo : { when: geoWhen, query: geoPlace, placeIdHint: String(fields.geoPlaceId || '').trim() || null, status: 'pending' };
  } else if (fields.geoWhen !== undefined) {
    note.geo = null;
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

// ── Errands: checklist items, place, trigger ───────────────────────────────

const newItemId = () => `it_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function cleanItemText(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '').slice(0, 120);
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/** Strings (classifier) or {id,text,done} (edits) → [{ id, text, done }]; keeps ids/done of matching items. */
function normalizeItems(list, previous = []) {
  const prev = Array.isArray(previous) ? previous : [];
  if (!Array.isArray(list)) return prev;
  const out = [];
  for (const entry of list.slice(0, 100)) {
    const obj = entry && typeof entry === 'object' ? entry : { text: entry };
    const text = cleanItemText(obj.text);
    if (!text) continue;
    const match = (obj.id && prev.find(p => p.id === obj.id))
      || prev.find(p => p.text.toLowerCase() === text.toLowerCase() && !out.some(o => o.id === p.id));
    out.push({ id: match?.id || newItemId(), text, done: typeof obj.done === 'boolean' ? obj.done : !!match?.done });
  }
  return out;
}

// "YYYY-MM-DD" today in New York
const todayNY = (now = new Date()) => toZonedIso(now).slice(0, 10);

const hasArrival = note => note.trigger === 'arrival' || note.trigger === 'both';
const hasTime    = note => note.trigger !== 'arrival' && !!note.start;

/** Last day an arrival reminder stays armed: N days after it became active (or last fired). */
function arrivalExpiresOn(note, settings) {
  const from = note.arrival?.triggeredOn || note.arrival?.activeFrom;
  return from ? addDays(from, settings.arrivalExpiryDays) : null;
}

/** A note with an active location reminder (arrive / leave a personal place) */
function isActiveGeo(note) {
  return !!note.geo && note.geo.status === 'active' && !note.undone && !note.hidden && !note.cancelled &&
    note.status !== 'pending_decision' && Number.isFinite(note.geo.lat) && Number.isFinite(note.geo.lng);
}

function isActiveArrival(note, settings, today = todayNY()) {
  if (note.type !== 'errand' || note.undone || note.errandDone || note.hidden || note.cancelled || note.status === 'pending_decision' || !hasArrival(note)) return false;
  if (!note.place?.resolved || !note.place.branches?.length) return false;
  const from = note.arrival?.activeFrom;
  if (from && from > today) return false;
  const until = arrivalExpiresOn(note, settings);
  return !until || today <= until;
}

const placeLabel = note => note.place?.query || note.placeSpec?.query || null;

function errandItemsText(note) {
  return (note.items || []).map(i => `${i.done ? '☑' : '☐'} ${i.text}`).join('\n');
}

// ── Google Calendar reconciliation ─────────────────────────────────────────

function errandDescription(note, link) {
  const place = note.place;
  return [
    note.items?.length ? `🛒 Shopping list\n${errandItemsText(note)}` : null,
    place?.resolved ? `📍 ${[place.name, place.address].filter(Boolean).join(' — ')}` : null,
    hasArrival(note) ? '🔔 The Pocket Archive app also reminds you when you arrive.' : null,
    note.errandDone ? '✅ Done' : null,
    link ? `Open in Pocket Archive: ${link}` : 'Created by Pocket Archive Quick Capture',
  ].filter(Boolean).join('\n\n');
}

function desiredGoogleEvent(note, { link } = {}) {
  if (note.undone || note.cancelled || note.status === 'pending_decision') return null;
  if (note.kind === 'append') return null; // a voice update living inside another note
  if (note.type === 'errand') {
    // Arrival-only errands live on the phone, not in the calendar
    if (!note.start || note.trigger === 'arrival') return null;
    const timed = !DATE_ONLY_RE.test(note.start);
    const place = note.place;
    return {
      summary:     `${note.errandDone ? '✅' : '🛒'} ${note.title}`,
      description: errandDescription(note, link),
      location:    place?.resolved ? [place.name, place.address].filter(Boolean).join(', ') : (placeLabel(note) || note.location || undefined),
      start: timed ? { dateTime: note.start, timeZone: TIMEZONE } : { date: note.start },
      end:   timed
        ? { dateTime: note.end || toZonedIso(new Date(parseZoned(note.start).getTime() + 3600000)), timeZone: TIMEZONE }
        : { date: addDays(note.start, 1) },
    };
  }
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
// Link back to the note in the app, e.g. https://nas.example.com/quick/inbox?note=qn_…
let seenOrigin = null;
function rememberOrigin(req) {
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!host) return;
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  seenOrigin = `${proto}://${host}`;
}
function noteLink(note) {
  const base = (process.env.PUBLIC_URL || seenOrigin || '').replace(/\/+$/, '');
  return base ? `${base}/quick/${encodeURIComponent(note.id)}` : null;
}

async function syncGoogle(note, calendarId = process.env.GOOGLE_CALENDAR_ID) {
  const ids     = note.googleEventIds || [];
  const desired = desiredGoogleEvent(note, { link: noteLink(note) });

  if (!desired && !ids.length) { note.googleSync = null; return note; }
  if (!gcal.isConfigured(calendarId)) {
    note.googleSync = desired ? 'skipped' : note.googleSync;
    return note;
  }

  try {
    if (desired && ids.length) {
      await gcal.updateEvent(ids[0], desired, calendarId);
      for (const extra of ids.slice(1)) await gcal.deleteEvent(extra, calendarId);
      note.googleEventIds = [ids[0]];
    } else if (desired) {
      note.googleEventIds = [await gcal.createEvent(desired, calendarId)];
    } else {
      for (const id of ids) await gcal.deleteEvent(id, calendarId);
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

// ── Short confirmation (Android notification; mirrors the web toast) ──────

// "Today 3 PM", "Tomorrow", "Fri", "Oct 27, 9:30 AM" — relative to now in New York
function shortWhen(value) {
  if (!value) return '';
  const today = (() => { const p = zonedParts(new Date()); return Date.UTC(p.y, p.mo - 1, p.d); })();
  const [y, mo, d] = value.slice(0, 10).split('-').map(Number);
  const day = Date.UTC(y, mo - 1, d);
  const diff = Math.round((day - today) / 86400000);
  const asDate = new Date(day);
  const dayLabel = diff === 0 ? 'Today'
    : diff === 1 ? 'Tomorrow'
      : diff > 1 && diff < 7 ? asDate.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
        : asDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (DATE_ONLY_RE.test(value)) return dayLabel;
  const [h, m] = value.slice(11, 16).split(':').map(Number);
  const time = `${h % 12 || 12}${m ? `:${pad(m)}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
  return `${dayLabel}${diff >= 0 && diff < 7 ? ' ' : ', '}${time}`;
}

// { icon, text, tone: 'success'|'review', detail? }
function confirmationFor(note, recordingTitle) {
  if (note.appendConfirmation) return { ...note.appendConfirmation, captureId: note.id };
  if (note.status === 'needs_review') return { icon: '⚠️', text: 'Saved — needs review', tone: 'review' };
  if (note.geo) {
    const verb = note.geo.when === 'leave' ? 'when you leave' : 'when you get to';
    const where = note.geo.placeId === 'home' ? (note.geo.when === 'leave' ? 'when you leave home' : 'when you get home') : `${verb} ${note.geo.name || note.geo.query}`;
    if (note.geo.status === 'needs_place') return { icon: '📍', text: `Where is “${note.geo.query}”?`, tone: 'review', detail: `Open the note to set the place — ${note.title}` };
    return { icon: '📍', text: `Reminder ${where}: ${note.title}`, tone: 'success' };
  }
  const calendarFailed = note.googleSync === 'failed';
  const tone = calendarFailed ? 'review' : 'success';
  const detail = calendarFailed ? "Google Calendar didn't update" : null;
  if (note.type === 'event') {
    const when = shortWhen(note.start);
    return { icon: '📅', text: `Added: ${note.title}${when ? ` · ${when}` : ''}`, tone, detail };
  }
  if (note.type === 'reminder') {
    const when = shortWhen(note.dueDate);
    return { icon: '⏰', text: `Reminder: ${note.title}${when ? ` · ${when}` : ''}`, tone, detail };
  }
  if (note.type === 'note_link') {
    return { icon: '📝', text: recordingTitle ? `Saved to ${recordingTitle}` : 'Saved to recording', tone, detail };
  }
  if (note.type === 'errand') {
    const n = (note.items || []).length;
    const placeName = placeLabel(note);
    const text = [
      placeName ? `${placeName} list` : note.title,
      n ? `${n} item${n === 1 ? '' : 's'}` : null,
      hasTime(note) ? shortWhen(note.start) : null,
      hasArrival(note) ? 'reminds on arrival' : null,
    ].filter(Boolean).join(' · ');
    const placeProblem = hasArrival(note) && note.place && !note.place.resolved ? note.place.error : null;
    return { icon: '🛒', text, tone: placeProblem ? 'review' : tone, detail: detail || placeProblem || null };
  }
  const saved = { text: ['📝', 'Note saved'], list: ['☑️', 'List saved'], image: ['🖼️', 'Photo saved'], drawing: ['✏️', 'Drawing saved'] }[note.source];
  if (saved) return { icon: saved[0], text: saved[1], tone, detail };
  return { icon: '📝', text: 'Quick note saved', tone, detail };
}

function describeActions(note, recordingTitle) {
  const actions = [];
  if (note.status === 'needs_review') actions.push('Saved for review');
  else if (note.type === 'event')     actions.push('Added to calendar');
  else if (note.type === 'reminder')  actions.push(note.dueDate ? 'Reminder with due date' : 'Reminder (no due date)');
  else if (note.type === 'note_link') actions.push(`Linked to “${recordingTitle || note.linkedRecordingId}”`);
  else if (note.type === 'errand') {
    const n = (note.items || []).length;
    actions.push(n ? `Checklist with ${n} item${n === 1 ? '' : 's'}` : 'Errand saved');
    if (hasArrival(note)) {
      actions.push(note.place?.resolved ? `Arrival reminder at ${placeLabel(note)}` : `Arrival reminder off: ${note.place?.error || 'no place'}`);
    }
  }
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
 *   places?: createPlaces(…) — store lookups + errand settings (optional)
 * }
 */
function createQuickCapture(deps) {
  const store = createStore(deps.archivePath);
  // Per-user Google Calendar (users.json googleCalendarId; the admin falls back to GOOGLE_CALENDAR_ID)
  const calendarId = () => (deps.calendarId ? deps.calendarId() : process.env.GOOGLE_CALENDAR_ID) || null;
  const syncCal = note => syncGoogle(note, calendarId());
  const usage = kind => { try { deps.onUsage?.(kind); } catch { /* counters are best effort */ } };
  const places = deps.places || null;
  const errandSettings = () => places?.getErrandSettings() || { arrivalForStoreErrands: true, arrivalExpiryDays: 14 };

  /** Read-modify-write one note on disk (used by projects / merges) */
  function updateNote(id, fn) {
    const n = store.read(id);
    if (!n) return null;
    fn(n);
    return store.write(n);
  }

  const projects = createProjects({
    archivePath: deps.archivePath,
    getNote: id => store.read(id),
    updateNote,
  });

  /**
   * Resolve the errand's place and settle its trigger.
   * auto: apply the "Remind me on arrival for store errands" setting (new captures);
   * edits pass the user's explicit trigger instead.
   */
  async function prepareErrand(note, { auto = true, now = new Date() } = {}) {
    if (note.type !== 'errand') return note;
    const spec = note.placeSpec;
    if (spec?.query) {
      const changed = !note.place || String(note.place.query || '').toLowerCase() !== spec.query.toLowerCase();
      if (changed || !note.place.resolved) {
        note.place = places
          ? await places.resolve(spec)
          : { query: spec.query, kind: spec.kind, name: spec.query, resolved: false, branches: [], error: 'Place lookup is not available' };
      }
    } else {
      note.place = null;
    }

    let t = note.trigger;
    if (auto) {
      if (spec?.query && errandSettings().arrivalForStoreErrands) {
        if (t === 'time' || (!t && note.start)) t = 'both';
        else if (!t) t = 'arrival';
      }
      if (!t && note.start) t = 'time';
    }
    if ((t === 'arrival' || t === 'both') && !spec?.query) t = note.start ? 'time' : null; // nowhere to arrive at
    if (!note.start && t === 'both') t = 'arrival';
    if (!note.start && t === 'time') t = null;
    note.trigger = t;

    // Arrival reminders start on the day of the trip (or now) and expire after N days
    note.arrival = hasArrival(note)
      ? { activeFrom: note.start ? note.start.slice(0, 10) : todayNY(now), triggeredOn: note.arrival?.triggeredOn || null }
      : null;
    return note;
  }

  /** Location reminder → a known place (home / saved) or "needs_place" (ask "Where is …?") */
  /** note.geo with the place's current pin and radius (places can move or change size after the note was made) */
  function liveGeo(note) {
    const g = note.geo;
    if (!g || g.status !== 'active' || !g.placeId) return g;
    const p = places?.personalPlace('', g.placeId);
    return p ? { ...g, lat: p.lat, lng: p.lng, radiusM: p.radiusM, radiusMode: p.radiusMode, name: p.name, address: p.address } : g;
  }

  // A place moved or got a new radius: update the copy in every active reminder that uses it
  function refreshGeoNotes() {
    for (const n of store.list()) {
      if (!isActiveGeo(n) || !n.geo.placeId) continue;
      const g = liveGeo(n);
      if (g.lat === n.geo.lat && g.lng === n.geo.lng && g.radiusM === n.geo.radiusM && g.name === n.geo.name && g.radiusMode === n.geo.radiusMode) continue;
      const fresh = store.read(n.id);
      if (!fresh?.geo) continue;
      fresh.geo = { ...fresh.geo, lat: g.lat, lng: g.lng, radiusM: g.radiusM, radiusMode: g.radiusMode, name: g.name, address: g.address };
      store.write(fresh);
    }
  }
  places?.onChange?.(() => { try { refreshGeoNotes(); } catch (err) { console.warn(`[quick] Reminder refresh failed: ${err.message}`); } });

  function prepareGeo(note, now = new Date()) {
    if (!note.geo) return note;
    if (note.geo.status === 'done') return note;
    const p = places?.personalPlace(note.geo.query, note.geo.placeIdHint);
    if (p) {
      note.geo = { ...note.geo, ...p, status: 'active', activeFrom: note.geo.activeFrom || todayNY(now), error: null };
    } else {
      note.geo = { ...note.geo, status: 'needs_place', placeId: null, lat: null, lng: null,
        error: note.geo.placeIdHint === 'home' || /^(?:(?:my|our|the) )?(?:home|house)$/i.test(String(note.geo.query || '').trim()) ? 'Set your home location in Settings → Places & errands' : null };
    }
    return note;
  }

  // Phone-wide geofence events (registered / errors), newest last; reminder events live on the note
  const geofenceLog = [];

  // Checklist taps can come in quick succession: one Calendar update per burst
  const calendarTimers = new Map();
  function queueCalendarSync(id, delayMs = 1500) {
    clearTimeout(calendarTimers.get(id));
    calendarTimers.set(id, setTimeout(async () => {
      calendarTimers.delete(id);
      const snapshot = store.read(id);
      if (!snapshot) return;
      await syncCal(snapshot);
      // Only copy the Google fields onto the latest copy (items may have changed meanwhile)
      const latest = store.read(id);
      if (!latest) return;
      Object.assign(latest, {
        googleEventIds: snapshot.googleEventIds, googleSync: snapshot.googleSync, googleError: snapshot.googleError,
      });
      finalize(latest);
    }, delayMs));
  }

  function setErrandDone(note, done) {
    note.errandDone  = !!done;
    note.completedAt = done ? (note.completedAt || new Date().toISOString()) : null;
  }

  const audioUpload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const base = (file.mimetype || '').split(';')[0].trim().toLowerCase();
      if (AUDIO_TYPES[base]) cb(null, true);
      else cb(new Error(`Unsupported audio type: ${file.mimetype}`));
    },
  });

  const mediaUpload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: MEDIA_LIMIT },
    fileFilter: (_req, file, cb) => {
      const base = (file.mimetype || '').split(';')[0].trim().toLowerCase();
      if (IMAGE_TYPES[base]) cb(null, true);
      else cb(Object.assign(new Error(`Unsupported image type: ${file.mimetype}`), { status: 400 }));
    },
  });

  const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '');
  const cleanList = list => (Array.isArray(list) ? list : [])
    .map(x => (x && typeof x === 'object' ? x.text : x)).map(cleanItemText).filter(Boolean).slice(0, 100);
  const doneTexts = list => (Array.isArray(list) ? list : [])
    .filter(x => x && typeof x === 'object' && x.done).map(x => cleanItemText(x.text)).filter(Boolean);
  /** Items ticked off while writing the list stay ticked */
  const applyTypedDone = note => {
    const done = new Set((note.typed?.done || []).map(t => t.toLowerCase()));
    if (done.size) note.items = (note.items || []).map(i => (done.has(i.text.toLowerCase()) ? { ...i, done: true } : i));
  };
  const wantsAi = v => !(v === false || v === 'false' || v === '0');
  const pickColor = c => (NOTE_COLORS.includes(c) && c !== 'default' ? c : null);

  // Capture/retry response: note + spoken text + short confirmation (for notifications)
  function captureResponse(note) {
    const title = note.linkedRecordingId ? deps.getRecordingTitle(note.linkedRecordingId) : null;
    return { note, spokenConfirmation: note.spokenConfirmation, confirmation: confirmationFor(note, title) };
  }

  // Smart append engine (needs the helpers above; created lazily so all are defined)
  let appender = null;
  const smart = () => appender || (appender = createAppender({
    store, projects, deps,
    finalize, syncGoogle, updateNote, cleanItemText, setErrandDone,
    queueCalendarSync,
    markSummaryPending: n => markSummaryPending(n),
    queueSummaryLater: id => setImmediate(() => queueSummary(id)),
    normalizeWhen, parseZoned, toZonedIso, shortWhen, DATE_ONLY_RE,
  }));

  function finalize(note) {
    note.actions = describeActions(note, note.linkedRecordingId ? deps.getRecordingTitle(note.linkedRecordingId) : null);
    return store.write(note);
  }

  // Update one field group on the latest copy on disk (safe for background jobs)
  function updateGroup(id, fields, stamp) {
    const fresh = store.read(id);
    if (!fresh) return null;
    Object.assign(fresh, fields, { [stamp]: new Date().toISOString() });
    return store.write(fresh);
  }

  // ── Audio: convert to .m4a so players get a real duration ──
  async function processAudio(note) {
    const result = await convertToM4a(path.join(store.audioDir, note.audioFile));
    if (!result.converted && result.error !== 'ffmpeg not available') {
      console.warn(`[quick] Audio conversion failed for ${note.id}: ${result.error}`);
    }
    Object.assign(note, {
      audioFile:      result.file,
      durationSec:    result.durationSec,
      audioConverted: result.converted,
      audioUpdatedAt: new Date().toISOString(),
    });
    return note;
  }

  // One-time migration of audio saved before conversion existed
  async function migrateAudio() {
    if (!(await ffmpegAvailable())) return;
    const todo = store.list().filter(n =>
      n.audioFile && n.audioMigration !== 'failed' &&
      (!n.audioFile.endsWith('.m4a') || !n.durationSec));
    if (!todo.length) return;
    console.log(`[quick] Converting audio for ${todo.length} quick note(s)…`);
    for (const n of todo) {
      const result = await convertToM4a(path.join(store.audioDir, n.audioFile));
      updateGroup(n.id, {
        audioFile:      result.file,
        durationSec:    result.durationSec,
        audioConverted: result.converted,
        audioMigration: result.converted || result.durationSec ? 'done' : 'failed',
      }, 'audioUpdatedAt');
      if (!result.converted) console.warn(`[quick] Audio conversion failed for ${n.id}: ${result.error}`);
    }
  }

  // ── Summaries: generated in the background, one at a time ──
  const summaryQueue = [];
  let summaryRunning = false;

  function markSummaryPending(note) {
    if (note.transcript || note.content || note.mediaText || (note.items || []).length || (note.updates || []).length) {
      Object.assign(note, { summaryStatus: 'pending', summaryError: null });
    } else {
      Object.assign(note, { summaryStatus: 'failed', summaryError: 'No transcript to summarize' });
    }
    note.summaryUpdatedAt = new Date().toISOString();
    return note.summaryStatus === 'pending';
  }

  function queueSummary(id) {
    if (!summaryQueue.includes(id)) summaryQueue.push(id);
    drainSummaries();
  }

  async function drainSummaries() {
    if (summaryRunning) return;
    summaryRunning = true;
    try {
      while (summaryQueue.length) {
        const id = summaryQueue.shift();
        const note = store.read(id);
        if (!note || note.undone || note.kind === 'append' || !(note.transcript || note.content || note.mediaText || (note.items || []).length || (note.updates || []).length)) continue;
        try {
          usage('summary');
          const summary = await summarize(note);
          updateGroup(id, { summary, summaryStatus: 'done', summaryError: null }, 'summaryUpdatedAt');
        } catch (err) {
          // Keep the note and transcript — only the summary is missing
          console.warn(`[quick] Summary failed for ${id}: ${err.message}`);
          updateGroup(id, { summaryStatus: 'failed', summaryError: err.message }, 'summaryUpdatedAt');
        }
      }
    } finally {
      summaryRunning = false;
    }
  }

  // Notes with no summary yet (or left "pending" by a restart)
  function backfillSummaries() {
    const todo = store.list().filter(n =>
      !n.undone && n.kind !== 'append' && (n.transcript || (n.typed && n.aiOrganize && (n.content || n.mediaText || (n.items || []).length)))
      && (!n.summaryStatus || n.summaryStatus === 'pending'));
    if (!todo.length) return;
    console.log(`[quick] Queueing summaries for ${todo.length} quick note(s)`);
    for (const n of todo.reverse()) { // oldest first
      if (n.summaryStatus !== 'pending') updateGroup(n.id, { summaryStatus: 'pending', summaryError: null }, 'summaryUpdatedAt');
      queueSummary(n.id);
    }
  }

  // Background startup work — never blocks the server from starting
  function start() {
    setTimeout(() => {
      migrateAudio()
        .catch(err => console.warn(`[quick] Audio migration stopped: ${err.message}`))
        .then(() => backfillSummaries())
        .then(() => projects.backfill())
        .catch(err => console.warn(`[quick] Summary backfill stopped: ${err.message}`));
    }, 3000);
    // "Add to …?" questions nobody answered within 2 minutes → keep as new notes
    setInterval(() => smart().sweepPending().catch(() => {}), 30_000).unref?.();
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
        note.classification = await classify({ transcript: note.transcript, now, recordings, candidates: smart().candidates(now), places: places?.placesForPrompt() || '' });
        applyFields(note, note.classification, deps);
        note.spokenConfirmation = String(note.classification.spokenConfirmation || '').trim() || `Saved: ${note.title}`;
        await routeIntent(note, note.classification, now);
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

    await syncCal(note);
    if (note.googleSync === 'failed') {
      note.spokenConfirmation = `${note.spokenConfirmation.replace(/[.!]?$/, '.')} Google Calendar didn't update.`;
    }
    if (note.kind !== 'append') markSummaryPending(note); // generated after the response is sent
    return finalize(note);
  }

  /**
   * Typed note / list / photo: the voice pipeline without transcription.
   * What the user typed wins over the classifier's rewrite (title, body, items).
   */
  async function runTextPipeline(note, now) {
    const typed = note.typed || {};
    const text = [
      typed.title ? `Title: ${typed.title}` : null,
      typed.body || null,
      typed.items?.length ? `List:\n${typed.items.map(t => `- ${t}`).join('\n')}` : null,
      note.mediaText ? `(From an attached ${note.media?.kind || 'photo'})\n${note.mediaText}` : null,
    ].filter(Boolean).join('\n\n');
    try {
      if (!text.trim()) throw new Error('Nothing to organize');
      const recordings = deps.getRecentRecordings(100);
      const cls = await classify({ transcript: text, now, recordings, candidates: smart().candidates(now), places: places?.placesForPrompt() || '' });
      // A typed checklist added to a list: the typed items are the items to add
      if (typed.items?.length && cls.action === 'append' && !(cls.addItems || []).length) cls.addItems = typed.items;
      note.classification = cls;
      applyFields(note, cls, deps);
      if (typed.title) note.title = typed.title;
      if (typed.body) note.content = typed.body;
      else if (note.source === 'image' || note.source === 'list') note.content = typed.caption || '';
      if (typed.items?.length) {
        note.items = normalizeItems(typed.items, note.type === 'errand' ? note.items : []);
        applyTypedDone(note);
        if (note.type !== 'errand') note.format = 'list';
      }
      note.spokenConfirmation = String(cls.spokenConfirmation || '').trim() || `Saved: ${note.title}`;
      await routeIntent(note, cls, now);
    } catch (err) {
      console.warn(`[quick] Organizing typed note ${note.id} failed: ${err.message}`);
      note.error = `AI organize failed: ${err.message}`;
    }
    if (!note.classification) {
      saveAsTyped(note);
      note.status = 'needs_review';
      note.spokenConfirmation = 'Saved, but the AI couldn\'t organize it — check your inbox.';
    }
    await syncCal(note);
    if (note.kind !== 'append') markSummaryPending(note);
    return finalize(note);
  }

  /** "Let AI organize" off (or AI failed): keep exactly what was typed. */
  function saveAsTyped(note) {
    const typed = note.typed || {};
    const firstLine = String(typed.body || typed.caption || '').split('\n').map(l => l.trim()).find(Boolean) || '';
    note.type = 'note';
    note.title = typed.title || firstLine.slice(0, 60) || typed.items?.[0]
      || { list: 'List', image: 'Photo', drawing: 'Drawing' }[note.source] || 'Note';
    note.content = typed.body || typed.caption || '';
    if (typed.items?.length) {
      note.format = 'list';
      note.items = normalizeItems(typed.items, note.items || []);
      applyTypedDone(note);
    }
    note.spokenConfirmation = `Saved: ${note.title}`;
    return note;
  }

  /** Shared skeleton for every capture */
  function blankNote(id, now, extra = {}) {
    return {
      id, clientId: null,
      createdAt:  new Date().toISOString(),
      capturedAt: now.toISOString(),
      audioFile:  null,
      transcript: null,
      classification: null,
      type: 'note', status: 'ok', title: 'Quick note', content: '',
      start: null, end: null, allDay: false, location: null, dueDate: null,
      linkedRecordingId: null, linkConfidence: null,
      googleEventIds: [], googleSync: null, googleError: null,
      actions: [], spokenConfirmation: null, error: null,
      undone: false, undoneAt: null,
      ...extra,
    };
  }

  /** Smart append: apply / ask / create (+ projects) for a freshly classified capture. */
  async function routeIntent(note, cls, now) {
    const decision = smart().decide(note, cls);
    if (decision.mode === 'apply') {
      note.lastPayload = decision.payload;
      await smart().apply(note, decision.target, decision.payload, { origin: 'voice' });
      return;
    }
    if (decision.mode === 'createProject') {
      smart().createProjectFrom(note, decision);
      return;
    }
    if (decision.mode === 'ask') {
      await prepareErrand(note, { now });   // ready in case the answer is "New note"
      prepareGeo(note, now);
      smart().markPending(note, decision);
      return;
    }
    await prepareErrand(note, { now });
    prepareGeo(note, now);
    // New project by voice ("start a project called …"), or a note for an existing project
    const name = String(cls.newProjectName || '').trim();
    if (name) {
      const existing = projects.findByName(name, { includeArchived: false });
      const p = existing || projects.create({ name });
      projects.addNote(p.id, note.id);
      note.projectId = p.id;
      note.appliedTo = { type: 'project', id: p.id, title: p.name, origin: 'voice', created: !existing, moved: [] };
      note.appendConfirmation = { icon: '📁', text: existing ? `Added to project ${p.name}` : `Started project ${p.name}`, tone: 'success', detail: null, undoable: true, movable: false };
    } else if (cls.alsoProjectId && projects.read(cls.alsoProjectId) && !projects.read(cls.alsoProjectId).deleted) {
      projects.addNote(cls.alsoProjectId, note.id);
      note.projectId = cls.alsoProjectId;
    }
  }

  function referenceTime(capturedAt) {
    const d = capturedAt ? new Date(capturedAt) : null;
    const now = Date.now();
    // Queued captures resolve "tomorrow" against when they were spoken
    if (d && !isNaN(d) && d.getTime() <= now + 5 * 60000 && d.getTime() >= now - 7 * 86400000) return d;
    return new Date(now);
  }

  function register(app) {
    function loadNoteRoute(req, res) {
      const { id } = req.params;
      if (!isQuickId(id)) { res.status(400).json({ error: 'Invalid quick note ID' }); return null; }
      const note = store.read(id);
      if (!note) { res.status(404).json({ error: 'Quick note not found' }); return null; }
      if (note.undone) { res.status(409).json({ error: 'This note was deleted' }); return null; }
      return note;
    }

    // GET /api/quick — newest first; optional ?recordingId=&status=
    app.get('/api/quick', (req, res) => {
      try {
        let notes = store.list();
        // Voice updates and merged notes live inside their target (see its "updates")
        if (req.query.all !== '1') notes = notes.filter(n => !n.hidden);
        if (req.query.projectId) notes = notes.filter(n => n.projectId === req.query.projectId);
        if (req.query.recordingId) notes = notes.filter(n => n.linkedRecordingId === req.query.recordingId);
        if (req.query.status)      notes = notes.filter(n => n.status === req.query.status);
        res.json(notes);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/quick/text — { title?, body?, items?[], aiOrganize = true, clientId?, color? }
    // A typed note (body) or checklist (items) through the same pipeline as voice.
    app.post('/api/quick/text', async (req, res) => {
      const b = req.body || {};
      const title = cleanText(b.title, 120);
      const body  = cleanText(b.body, 20000);
      const items = cleanList(b.items);
      if (!title && !body && !items.length) return res.status(400).json({ error: 'Write something first' });
      rememberOrigin(req);
      const clientId = typeof b.clientId === 'string' ? b.clientId.slice(0, 64) : null;
      if (clientId) {
        const existing = store.list().find(n => n.clientId === clientId);
        if (existing) return res.json(captureResponse(existing));
      }
      const now = referenceTime(b.capturedAt);
      const note = blankNote(newId(), now, {
        clientId,
        source: items.length ? 'list' : 'text',
        typed: { title, body, items, done: doneTexts(b.items) },
        aiOrganize: wantsAi(b.aiOrganize),
        color: pickColor(b.color),
        pinned: b.pinned === true,
      });
      try {
        if (note.aiOrganize) await runTextPipeline(note, now);
        else { saveAsTyped(note); note.summaryStatus = 'none'; finalize(note); }
        res.json(captureResponse(note));
        if (note.summaryStatus === 'pending') queueSummary(note.id);
      } catch (err) {
        console.error('/quick/text error:', err);
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/quick/media — multipart: file (image ≤ 20 MB), kind 'image'|'drawing', caption?, title?, aiOrganize?, clientId?
    app.post('/api/quick/media', (req, res, next) => {
      mediaUpload.single('file')(req, res, err => {
        if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.status || 400)).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Images can be up to 20 MB' : err.message });
        next();
      });
    }, async (req, res) => {
      if (!req.file?.buffer?.length) return res.status(400).json({ error: 'An image is required' });
      rememberOrigin(req);
      const b = req.body || {};
      const clientId = typeof b.clientId === 'string' ? b.clientId.slice(0, 64) : null;
      if (clientId) {
        const existing = store.list().find(n => n.clientId === clientId);
        if (existing) return res.json(captureResponse(existing));
      }
      const kind = b.kind === 'drawing' ? 'drawing' : 'image';
      const ext  = IMAGE_TYPES[req.file.mimetype.split(';')[0].trim().toLowerCase()] || 'jpg';
      const id   = newId();
      const now  = referenceTime(b.capturedAt);
      const caption = cleanText(b.caption, 4000);
      const note = blankNote(id, now, {
        clientId,
        source: kind,
        typed: { title: cleanText(b.title, 120), caption, body: '', items: [] },
        aiOrganize: kind === 'image' && wantsAi(b.aiOrganize),
        media: { kind, file: `${id}.${ext}`, ext, mime: IMAGE_MIME[ext], bytes: req.file.size },
        color: pickColor(b.color),
      });
      try {
        store.ensureDirs();
        fs.writeFileSync(path.join(store.mediaDir, note.media.file), req.file.buffer);
        store.write(note);
      } catch (err) {
        console.error('/quick/media save error:', err);
        return res.status(500).json({ error: err.message });
      }
      try {
        if (note.aiOrganize) {
          try {
            note.mediaText = await readImage(path.join(store.mediaDir, note.media.file), ext, 'organize');
          } catch (err) {
            console.warn(`[quick] Reading photo ${id} failed: ${err.message}`);
            note.error = `Reading the photo failed: ${err.message}`;
          }
          await runTextPipeline(note, now);
        } else {
          saveAsTyped(note);
          note.content = caption;
          note.summaryStatus = 'none';
          finalize(note);
        }
        res.json(captureResponse(note));
        if (note.summaryStatus === 'pending') queueSummary(note.id);
      } catch (err) {
        console.error('/quick/media error:', err);
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
      rememberOrigin(req);

      const clientId = typeof req.body.clientId === 'string' ? req.body.clientId.slice(0, 64) : null;
      if (clientId) {
        // Retried upload from the offline queue — return what we already did
        const existing = store.list().find(n => n.clientId === clientId);
        if (existing) return res.json(captureResponse(existing));
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
          source:     'voice',
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

      try {
        await processAudio(note);
        store.write(note);
      } catch (err) {
        console.warn(`[quick] Audio processing error for ${id}: ${err.message}`);
      }

      await runPipeline(note, now);
      res.json(captureResponse(note));
      if (note.summaryStatus === 'pending') queueSummary(note.id);
    });

    // GET /api/quick/recent?limit=5[&summary=1] — compact list for the Android widget and the watch
    // (summary=1 adds the AI summary, shortened, for the watch's note screen)
    // (registered before /api/quick/:id so "recent" isn't treated as an id)
    app.get('/api/quick/recent', (req, res) => {
      try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
        const withSummary = req.query.summary === '1';
        const recent = store.list()
          .filter(n => !n.undone && (!n.hidden || n.kind === 'append'))
          .slice(0, limit)
          .map(n => ({
            id:            n.kind === 'append' && n.appliedTo ? n.appliedTo.id : n.id,
            title:         n.kind === 'append' && n.resultLine ? n.resultLine : n.title,
            type:          n.kind === 'append' && n.appliedTo ? (n.appliedTo.type === 'note' ? 'note' : n.appliedTo.type) : n.type,
            append:        n.kind === 'append' || undefined,
            pending:       n.status === 'pending_decision' || undefined,
            createdAt:     n.capturedAt || n.createdAt,
            needsReview:   n.status === 'needs_review',
            summaryStatus: n.summaryStatus || null,
            ...(n.type === 'errand' ? {
              itemsTotal: (n.items || []).length,
              itemsDone:  (n.items || []).filter(i => i.done).length,
              errandDone: !!n.errandDone,
            } : {}),
            ...(withSummary ? {
              summary: n.summaryStatus === 'done' && n.summary ? String(n.summary).slice(0, 1500) : null,
            } : {}),
          }));
        res.json(recent);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // (registered before /api/quick/:id so these words aren't treated as ids)
    // GET /api/quick/targets?q= — picker for "Other…", Move, Merge into
    app.get('/api/quick/targets', (req, res) => {
      const q = String(req.query.q || '').toLowerCase().trim();
      const match = t => !q || t.toLowerCase().includes(q);
      const exclude = req.query.exclude;
      const out = [];
      for (const p of projects.active()) {
        if (match(`${p.name} ${(p.aliases || []).join(' ')}`)) out.push({ type: 'project', id: p.id, title: p.name, subtitle: `Project · ${p.noteIds.length} notes` });
      }
      for (const n of store.list().filter(x => smart().visible(x) && x.id !== exclude).slice(0, 200)) {
        const type = n.type === 'errand' ? 'errand' : ['event', 'reminder'].includes(n.type) ? n.type : 'note';
        const title = smart().errandName(n) || n.title;
        if (!match(`${title} ${n.title} ${n.summary || ''}`)) continue;
        out.push({ type, id: n.id, title, subtitle: `${type === 'note' ? 'Note' : type[0].toUpperCase() + type.slice(1)} · ${(n.capturedAt || n.createdAt || '').slice(0, 10)}` });
        if (out.length >= 40) break;
      }
      res.json(out);
    });

    // GET /api/quick/search?q= — quick notes for the Search page (titles, text, lists, photo text, updates)
    app.get('/api/quick/search', (req, res) => {
      const q = String(req.query.q || '').trim().toLowerCase();
      if (q.length < 2) return res.json([]);
      const out = [];
      for (const n of store.list()) {
        if (n.undone || n.hidden) continue;
        const fields = [n.title, n.content, n.transcript, n.summary, n.mediaText,
          (n.items || []).map(i => i.text).join('\n'), (n.updates || []).map(u => u.text).join('\n')];
        const hit = fields.find(f => f && String(f).toLowerCase().includes(q));
        if (!hit) continue;
        const raw = String(hit);
        const i = raw.toLowerCase().indexOf(q);
        out.push({
          id: n.id, title: n.title, type: n.type, source: n.source || 'voice', format: n.format || null,
          capturedAt: n.capturedAt || n.createdAt, projectId: n.projectId || null, hasMedia: !!n.media,
          snippet: raw === n.title ? '' : raw.slice(Math.max(0, i - 60), i + 140).replace(/\s+/g, ' ').trim(),
        });
        if (out.length >= 50) break;
      }
      res.json(out);
    });

    app.get('/api/quick/settings', (_req, res) => res.json(smart().settings()));
    app.put('/api/quick/settings', (req, res) => {
      try { res.json(smart().saveSettings(req.body || {})); } catch (err) { fail(res, err); }
    });

    // GET /api/quick/:id — one quick note (used to poll summary progress)
    app.get('/api/quick/:id', (req, res) => {
      const { id } = req.params;
      if (!isQuickId(id)) return res.status(400).json({ error: 'Invalid quick note ID' });
      const note = store.read(id);
      if (!note) return res.status(404).json({ error: 'Quick note not found' });
      res.json(note);
    });

    // POST /api/quick/:id/summarize — (re)generate the AI summary in the background
    app.post('/api/quick/:id/summarize', (req, res) => {
      const { id } = req.params;
      if (!isQuickId(id)) return res.status(400).json({ error: 'Invalid quick note ID' });
      const note = store.read(id);
      if (!note) return res.status(404).json({ error: 'Quick note not found' });
      if (note.undone) return res.status(409).json({ error: 'This capture was undone' });
      if (!note.transcript && !note.content && !note.mediaText && !(note.items || []).length) {
        return res.status(409).json({ error: 'There is nothing to summarize' });
      }

      markSummaryPending(note);
      const saved = store.write(note);
      queueSummary(id);
      res.json(saved);
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
        const captured = new Date(note.capturedAt || note.createdAt);
        const at = isNaN(captured) ? new Date() : captured;
        if (note.typed && note.source !== 'voice') {
          Object.assign(note, { classification: null, error: null, status: 'ok' });
          if (note.source === 'image' && note.media && !note.mediaText) {
            try { note.mediaText = await readImage(path.join(store.mediaDir, note.media.file), note.media.ext, 'organize'); }
            catch (err) { note.error = `Reading the photo failed: ${err.message}`; }
          }
          await runTextPipeline(note, at);
        } else {
          Object.assign(note, { transcript: null, classification: null, error: null, status: 'ok' });
          await runPipeline(note, at);
        }
        res.json(captureResponse(note));
        if (note.summaryStatus === 'pending') queueSummary(note.id);
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

    // GET /api/quick/:id/media — the photo / drawing
    app.get('/api/quick/:id/media', (req, res) => {
      const { id } = req.params;
      if (!isQuickId(id)) return res.status(400).json({ error: 'Invalid quick note ID' });
      const note = store.read(id);
      if (!note?.media?.file) return res.status(404).json({ error: 'Image not found' });
      const file = path.join(store.mediaDir, path.basename(note.media.file));
      if (!fs.existsSync(file)) return res.status(404).json({ error: 'Image not found' });
      res.set('Cache-Control', 'private, max-age=86400');
      res.sendFile(path.resolve(file));
    });

    // POST /api/quick/:id/handwriting — "Convert handwriting" (Gemini) for a drawing or photo
    app.post('/api/quick/:id/handwriting', async (req, res) => {
      const note = loadNoteRoute(req, res);
      if (!note) return;
      if (!note.media?.file) return res.status(409).json({ error: 'This note has no drawing' });
      try {
        const text = await readImage(path.join(store.mediaDir, note.media.file), note.media.ext, 'handwriting');
        const fresh = store.read(note.id);
        fresh.mediaText = text;
        fresh.handwritingAt = new Date().toISOString();
        if (fresh.title === 'Drawing' && text && !/^drawing:/i.test(text)) fresh.title = text.split('\n')[0].slice(0, 60);
        const resum = markSummaryPending(fresh);
        res.json(finalize(fresh));
        if (resum) queueSummary(fresh.id);
      } catch (err) {
        res.status(502).json({ error: `Couldn't read the handwriting: ${err.message}` });
      }
    });

    // PATCH /api/quick/:id/meta — { pinned?, color? } (no AI, no calendar)
    app.patch('/api/quick/:id/meta', (req, res) => {
      const note = loadNoteRoute(req, res);
      if (!note) return;
      const b = req.body || {};
      if (typeof b.pinned === 'boolean') { note.pinned = b.pinned; note.pinnedAt = b.pinned ? new Date().toISOString() : null; }
      if (b.color !== undefined) {
        if (!NOTE_COLORS.includes(b.color)) return res.status(400).json({ error: `color must be one of: ${NOTE_COLORS.join(', ')}` });
        note.color = pickColor(b.color);
      }
      res.json(store.write(note));
    });

    // POST /api/quick/:id/restore — bring back a deleted (undone) note, with its calendar event
    app.post('/api/quick/:id/restore', async (req, res) => {
      const { id } = req.params;
      if (!isQuickId(id)) return res.status(400).json({ error: 'Invalid quick note ID' });
      const note = store.read(id);
      if (!note) return res.status(404).json({ error: 'Quick note not found' });
      if (!note.undone) return res.json(note);
      if (note.kind === 'append' || note.appendOrigin === 'voice' && note.hidden) {
        return res.status(409).json({ error: 'This update was undone; record or type it again' });
      }
      note.undone = false;
      note.undoneAt = null;
      note.hidden = false;
      if (note.undoneLink && deps.recordingExists(note.undoneLink)) note.linkedRecordingId = note.undoneLink;
      note.undoneLink = null;
      note.actions = (note.actions || []).filter(a => a !== 'Undone');
      rememberOrigin(req);
      await syncCal(note);
      res.json(finalize(note));
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

      const wasType = note.type;
      try {
        if (typeof body.content === 'string' && body.content.trim() !== (note.content || '').trim()) {
          note.contentEdited = true; // the summarizer trusts the user's corrections
        }
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
          items:             body.items !== undefined ? body.items : note.items,
          place:             body.placeQuery !== undefined
            ? (String(body.placeQuery || '').trim()
              ? { query: body.placeQuery, kind: body.placeKind ?? (note.placeSpec?.query?.toLowerCase() === String(body.placeQuery).trim().toLowerCase() ? note.placeSpec.kind : null) }
              : null)
            : note.placeSpec,
          trigger:           pick('trigger'),
        }, deps);
        if (note.format === 'list' && note.type !== 'errand' && Array.isArray(body.items)) {
          note.items = normalizeItems(body.items, note.items);
        }
        rememberOrigin(req);
        // New errand (type changed): apply the arrival setting; otherwise keep the chosen trigger
        await prepareErrand(note, { auto: wasType !== 'errand' && body.trigger === undefined });
        if (note.type === 'errand' && body.items !== undefined && note.items.length) {
          setErrandDone(note, note.items.every(i => i.done));
        }
        if (note.status === 'needs_review') note.status = 'ok';
        note.unlinkedFrom = null;
        await syncCal(note);
        const resummarize = body.regenerateSummary === true && markSummaryPending(note);
        res.json(finalize(note));
        if (resummarize) queueSummary(note.id);
      } catch (err) {
        console.error('/quick PUT error:', err);
        res.status(500).json({ error: err.message });
      }
    });

    // ── Errands ────────────────────────────────────────────────────────────

    function loadErrand(req, res) {
      const { id } = req.params;
      if (!isQuickId(id)) { res.status(400).json({ error: 'Invalid quick note ID' }); return null; }
      const note = store.read(id);
      if (!note) { res.status(404).json({ error: 'Quick note not found' }); return null; }
      if (note.undone) { res.status(409).json({ error: 'This capture was undone' }); return null; }
      if (note.type !== 'errand' && note.format !== 'list' && !(note.geo && req.path.match(/\/(done|triggered)$/))) {
        res.status(409).json({ error: 'Only lists and errands have a checklist' }); return null;
      }
      return note;
    }

    // PATCH /api/quick/:id/items — { action: 'toggle'|'add'|'edit'|'remove', itemId?, text?, done? }
    app.patch('/api/quick/:id/items', (req, res) => {
      const note = loadErrand(req, res);
      if (!note) return;
      const { action, itemId, text, done } = req.body || {};
      const items = [...(note.items || [])];
      const idx = items.findIndex(i => i.id === itemId);
      const needItem = ['toggle', 'edit', 'remove'].includes(action);
      if (needItem && idx < 0) return res.status(404).json({ error: 'Item not found' });

      if (action === 'toggle') {
        items[idx] = { ...items[idx], done: typeof done === 'boolean' ? done : !items[idx].done };
      } else if (action === 'add' || action === 'edit') {
        const clean = cleanItemText(text);
        if (!clean) return res.status(400).json({ error: 'text is required' });
        if (action === 'add') {
          if (items.length >= 100) return res.status(400).json({ error: 'A list can have up to 100 items' });
          items.push({ id: newItemId(), text: clean, done: false });
        } else {
          items[idx] = { ...items[idx], text: clean };
        }
      } else if (action === 'remove') {
        items.splice(idx, 1);
      } else if (action === 'reorder') {
        const order = Array.isArray(req.body.order) ? req.body.order : [];
        const byId = new Map(items.map(i => [i.id, i]));
        const sorted = order.map(id => byId.get(id)).filter(Boolean);
        if (sorted.length !== items.length) return res.status(400).json({ error: 'order must list every item id' });
        items.splice(0, items.length, ...sorted);
      } else {
        return res.status(400).json({ error: 'action must be toggle, add, edit, remove or reorder' });
      }

      note.items = items;
      const allDone = items.length > 0 && items.every(i => i.done);
      if (allDone) setErrandDone(note, true);                        // last item checked → complete
      else if (note.errandDone && action !== 'remove') setErrandDone(note, false); // reopened
      rememberOrigin(req);
      res.json(finalize(note));
      queueCalendarSync(note.id);
    });

    // POST /api/quick/:id/done — { done = true } "Mark done" / reopen; stops arrival reminders
    app.post('/api/quick/:id/done', (req, res) => {
      const note = loadErrand(req, res);
      if (!note) return;
      if (note.geo && note.type !== 'errand' && note.format !== 'list') {
        // Location reminder done (from the notification / watch): stop the geofence
        const done = req.body?.done !== false;
        note.geo = { ...note.geo, status: done ? 'done' : (Number.isFinite(note.geo.lat) ? 'active' : 'needs_place'), doneAt: done ? new Date().toISOString() : null };
        note.reminderDone = done;
        return res.json(finalize(note));
      }
      setErrandDone(note, req.body?.done !== false);
      rememberOrigin(req);
      res.json(finalize(note));
      queueCalendarSync(note.id, 0);
    });

    // GET /api/errands/active — arrival errands for the phone's geofences.
    // Only store coordinates go down; the phone never sends its location.
    app.get('/api/errands/active', (_req, res) => {
      try {
        const settings = errandSettings();
        const today = todayNY();
        const geo = store.list().filter(isActiveGeo).map(n => ({ n, g: liveGeo(n) })).map(({ n, g }) => ({
          id:        n.id,
          kind:      'reminder',
          when:      g.when,                        // arrive | leave
          title:     n.title,
          text:      String(n.content || n.title || '').slice(0, 300),
          placeName: g.name,
          address:   g.address || null,
          radiusM:   g.radiusM || 150,
          items:     (n.items || []).map(i => ({ id: i.id, text: i.text, done: !!i.done })),
          itemsLeft: (n.items || []).filter(i => !i.done).length,
          expiresOn: null,
          branches:  [{ key: `${g.when === 'leave' ? 'lv' : 'ar'}:${g.placeId || 'p'}:${g.lat.toFixed(5)},${g.lng.toFixed(5)}`,
            lat: g.lat, lng: g.lng, name: g.name, address: g.address || null, distanceM: 0 }],
        }));
        const errands = store.list()
          .filter(n => isActiveArrival(n, settings, today))
          .map(n => ({
            id:         n.id,
            title:      n.title,
            placeName:  placeLabel(n),
            address:    n.place.address || null,
            items:      (n.items || []).map(i => ({ id: i.id, text: i.text, done: !!i.done })),
            itemsLeft:  (n.items || []).filter(i => !i.done).length,
            expiresOn:  arrivalExpiresOn(n, settings),
            branches:   n.place.branches.map(b => ({
              key: b.key, lat: b.lat, lng: b.lng, name: b.name || null, address: b.address || null,
              distanceM: Number.isFinite(b.distanceM) ? b.distanceM : null,
            })),
          }));
        res.json({ generatedAt: new Date().toISOString(), errands: [...geo, ...errands] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/location-reminders — Settings → Location reminders (all states, newest first)
    app.get('/api/location-reminders', (_req, res) => {
      const settings = errandSettings();
      const today = todayNY();
      const out = [];
      for (const n of store.list()) {
        if (n.undone || n.hidden) continue;
        if (n.geo) {
          const g = liveGeo(n);
          out.push({ id: n.id, title: n.title, type: n.type, when: g.when, place: g.name || g.query, query: g.query,
            placeId: g.placeId || null, address: g.address || null, lat: g.lat ?? null, lng: g.lng ?? null,
            radiusM: g.radiusM || null, radiusMode: g.radiusMode || 'auto', status: g.status, error: g.error || null,
            triggeredAt: g.triggeredAt || null, events: (g.events || []).slice(-10), capturedAt: n.capturedAt || n.createdAt });
        } else if (n.type === 'errand' && hasArrival(n) && !n.errandDone) {
          const active = isActiveArrival(n, settings, today);
          out.push({ id: n.id, title: n.title, type: 'errand', when: 'arrive', place: placeLabel(n), query: placeLabel(n),
            placeId: n.place?.savedPlaceId || null, address: n.place?.address || null, lat: n.place?.lat ?? null, lng: n.place?.lng ?? null,
            stores: n.place?.branches?.length || 0, radiusM: 150, status: active ? 'active' : (n.place?.resolved ? 'expired' : 'needs_place'),
            error: n.place?.error || null, triggeredAt: n.arrival?.triggeredOn || null, events: (n.arrival?.events || []).slice(-10),
            capturedAt: n.capturedAt || n.createdAt });
        }
      }
      res.json(out.slice(0, 100));
    });

    // POST /api/quick/:id/geo-place — answer "Where is <place>?":
    //   { placeId } (home / a saved place) or { name?, address, lat, lng, save = true } (new place, spoken words as alias)
    //   { when } to switch arrive/leave; { remove: true } to drop the location reminder
    app.post('/api/quick/:id/geo-place', (req, res) => {
      const note = loadNoteRoute(req, res);
      if (!note) return;
      const b = req.body || {};
      if (!note.geo && !b.query) return res.status(409).json({ error: 'This note has no location reminder' });
      if (b.remove) { note.geo = null; return res.json(finalize(note)); }
      const geo = { ...(note.geo || { when: b.when === 'leave' ? 'leave' : 'arrive', query: String(b.query).slice(0, 80) }) };
      if (b.when === 'arrive' || b.when === 'leave') geo.when = b.when;
      let p = null;
      if (b.placeId) {
        p = places?.personalPlace('', b.placeId);
        if (!p) return res.status(404).json({ error: b.placeId === 'home' ? 'Set your home location first' : 'Place not found' });
      } else if (Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng))) {
        const saved = places?.savePlace({
          name: String(b.name || geo.query).trim(), address: b.address || null, lat: b.lat, lng: b.lng,
          aliases: [geo.query], kind: /\b(work|office)\b/i.test(geo.query) ? 'work' : 'other',
          autoRadiusM: Number(b.areaRadiusM) || null, radiusMode: b.radiusMode, radiusM: b.radiusM,
        });
        if (!saved || saved.error) return res.status(400).json({ error: saved?.error || 'Could not save the place' });
        p = places.personalPlace('', saved.id);
      } else {
        return res.status(400).json({ error: 'Pick a place' });
      }
      note.geo = { ...geo, ...p, status: 'active', activeFrom: geo.activeFrom || todayNY(), error: null, placeIdHint: null };
      res.json(finalize(note));
    });

    // POST /api/location-reminders/events { events: [{ at, type, reminderId?, key?, source? }] }
    //   type: registered | enter | exit | dwell | fallback | notified | test. key "ar:<placeId>:…" → placeId only.
    app.post('/api/location-reminders/events', (req, res) => {
      const list = Array.isArray(req.body?.events) ? req.body.events.slice(0, 50) : [];
      const TYPES = ['registered', 'enter', 'exit', 'dwell', 'fallback', 'notified', 'test', 'error'];
      let stored = 0;
      for (const e of list) {
        const type = String(e?.type || '');
        if (!TYPES.includes(type)) continue;
        const at = Number.isFinite(Date.parse(e.at)) ? new Date(e.at).toISOString() : new Date().toISOString();
        const placeId = String(e.key || '').match(/^(?:ar|lv):([^:]+):/)?.[1] || (e.placeId ? String(e.placeId).slice(0, 40) : null);
        const entry = { at, type, placeId, source: e.source ? String(e.source).slice(0, 20) : null, detail: e.detail ? String(e.detail).slice(0, 80) : null };
        if (e.reminderId && isQuickId(String(e.reminderId))) {
          const note = store.read(String(e.reminderId));
          if (!note) continue;
          if (note.geo) note.geo = { ...note.geo, events: [...(note.geo.events || []), entry].slice(-20) };
          else if (note.arrival) note.arrival = { ...note.arrival, events: [...(note.arrival.events || []), { ...entry, placeId: null }].slice(-20) };
          else continue;
          store.write(note);
        } else {
          geofenceLog.push(entry);
          if (geofenceLog.length > 50) geofenceLog.splice(0, geofenceLog.length - 50);
        }
        stored++;
      }
      res.json({ stored });
    });
    app.get('/api/location-reminders/events', (_req, res) => res.json(geofenceLog.slice(-50)));

    // GET /api/errands/open — every unfinished errand with its checklist (the watch's Errands screen)
    app.get('/api/errands/open', (_req, res) => {
      try {
        const errands = store.list()
          .filter(n => n.type === 'errand' && !n.undone && !n.errandDone && !n.hidden && !n.cancelled && n.status !== 'pending_decision')
          .slice(0, 20)
          .map(n => ({
            id:        n.id,
            title:     n.title,
            placeName: placeLabel(n),
            address:   n.place?.resolved ? n.place.address || null : null,
            whenLabel: hasTime(n) ? shortWhen(n.start) : null,
            arrival:   hasArrival(n),
            items:     (n.items || []).map(i => ({ id: i.id, text: i.text, done: !!i.done })),
          }));
        res.json({ generatedAt: new Date().toISOString(), errands });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/errands/:id/triggered — the phone showed the arrival reminder.
    // Records only the day (no store, no location) so the reminder doesn't expire mid-trip.
    app.post('/api/errands/:id/triggered', (req, res) => {
      const note = loadErrand(req, res);
      if (!note) return;
      if (note.arrival) note.arrival = { ...note.arrival, triggeredOn: todayNY() };
      if (note.geo) note.geo = { ...note.geo, triggeredAt: new Date().toISOString(), triggerCount: (note.geo.triggerCount || 0) + 1 };
      res.json({ success: true, expiresOn: arrivalExpiresOn(note, errandSettings()) });
      store.write(note);
    });

    // ── Smart append: answers, Move, Merge, Combine, settings ──────────────

    const loadNote = (req, res) => {
      const { id } = req.params;
      if (!isQuickId(id)) { res.status(400).json({ error: 'Invalid quick note ID' }); return null; }
      const note = store.read(id);
      if (!note) { res.status(404).json({ error: 'Quick note not found' }); return null; }
      if (note.undone) { res.status(409).json({ error: 'This capture was undone' }); return null; }
      return note;
    };
    const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });
    const destOf = body => (body?.new ? { new: true } : { targetType: body?.targetType, targetId: body?.targetId });

    // POST /api/quick/:id/decide { choice: 'yes'|'new'|'other', targetType?, targetId? }
    app.post('/api/quick/:id/decide', async (req, res) => {
      const note = loadNote(req, res);
      if (!note) return;
      if (note.status !== 'pending_decision') return res.json(captureResponse(note)); // already decided (e.g. on another device)
      const choice = ['yes', 'new', 'other'].includes(req.body?.choice) ? req.body.choice : 'new';
      try {
        rememberOrigin(req);
        const confirmation = await smart().resolvePending(note, choice, choice === 'other' ? destOf(req.body) : null);
        if (choice !== 'yes' && note.kind !== 'append' && markSummaryPending(note)) queueSummary(note.id);
        res.json({ ...captureResponse(store.read(note.id)), confirmation: { ...confirmation, captureId: note.id, undoable: true } });
      } catch (err) { fail(res, err); }
    });

    // POST /api/quick/:id/move { targetType, targetId } | { new: true }
    app.post('/api/quick/:id/move', async (req, res) => {
      const note = loadNote(req, res);
      if (!note) return;
      try {
        rememberOrigin(req);
        const confirmation = await smart().move(note, destOf(req.body));
        if (req.body?.new && markSummaryPending(note)) queueSummary(note.id);
        res.json({ ...captureResponse(store.read(note.id)), confirmation: { ...confirmation, captureId: note.id, undoable: true } });
      } catch (err) { fail(res, err); }
    });

    // POST /api/quick/:id/merge { targetId, targetType? } — "Merge into…"
    app.post('/api/quick/:id/merge', async (req, res) => {
      const note = loadNote(req, res);
      if (!note) return;
      const target = smart().readTarget(req.body?.targetType || 'note', req.body?.targetId)
        || ['errand', 'note', 'event', 'reminder'].map(t => smart().readTarget(t, req.body?.targetId)).find(Boolean);
      if (!target || target.id === note.id) return res.status(404).json({ error: 'Choose another note' });
      if (target.type === 'project') {
        projects.addNote(target.id, note.id);
        return res.json(store.read(note.id));
      }
      try {
        const merged = smart().mergeInto(note, target);
        if (markSummaryPending(merged)) { store.write(merged); queueSummary(merged.id); }
        res.json({ source: store.read(note.id), target: store.read(target.id) });
      } catch (err) { fail(res, err); }
    });

    // POST /api/quick/:id/unmerge — "Split back" one merged note
    app.post('/api/quick/:id/unmerge', (req, res) => {
      const note = loadNote(req, res);
      if (!note) return;
      const targetId = note.mergedInto?.id;
      smart().unmerge(note);
      if (targetId) {
        const t = store.read(targetId);
        if (t && markSummaryPending(t)) { store.write(t); queueSummary(t.id); }
      }
      res.json(store.read(note.id));
    });

    // POST /api/quick/combine { mainId, ids[], title } — keep mainId, fold the others in as dated updates
    app.post('/api/quick/combine', async (req, res) => {
      const { mainId, ids = [], title } = req.body || {};
      const main = isQuickId(mainId) ? store.read(mainId) : null;
      if (!main || main.undone || main.hidden) return res.status(404).json({ error: 'Main note not found' });
      const others = [...new Set(ids)].filter(id => id !== mainId).map(id => isQuickId(id) && store.read(id))
        .filter(n => n && !n.undone && !n.hidden);
      if (!others.length) return res.status(400).json({ error: 'Pick at least two notes' });
      const groupId = `cb_${Date.now().toString(36)}`;
      const mainType = main.type === 'errand' ? 'errand' : ['event', 'reminder'].includes(main.type) ? main.type : 'note';
      // Oldest first, so the updates read in order
      others.sort((a, b) => (a.capturedAt || a.createdAt || '').localeCompare(b.capturedAt || b.createdAt || ''));
      try {
        others.forEach((o, i) => smart().mergeInto(o, { type: mainType, id: main.id },
          { groupId, ...(i === 0 ? { titleBefore: main.title } : {}) }));
        const merged = store.read(main.id);
        if (typeof title === 'string' && title.trim()) merged.title = title.trim().slice(0, 120);
        merged.combinedGroups = [...(merged.combinedGroups || []), { groupId, ids: others.map(o => o.id), at: new Date().toISOString() }];
        markSummaryPending(merged);
        finalize(merged);
        queueSummary(merged.id);
        if (merged.googleEventIds?.length) queueCalendarSync(merged.id, 0);
        res.json({ note: store.read(main.id), groupId, combined: others.length + 1 });
      } catch (err) { fail(res, err); }
    });

    // POST /api/quick/:id/split { groupId? } — undo a combine (all of its merges)
    app.post('/api/quick/:id/split', (req, res) => {
      const main = loadNote(req, res);
      if (!main) return;
      const groups = main.combinedGroups || [];
      const group = groups.find(g => g.groupId === req.body?.groupId) || groups.at(-1);
      if (!group) return res.status(409).json({ error: 'Nothing to split' });
      const titleBefore = (main.audit || []).find(a => a.groupId === group.groupId && a.titleBefore !== undefined)?.titleBefore;
      for (const id of group.ids) {
        const n = store.read(id);
        if (n?.mergedInto?.groupId === group.groupId) smart().unmerge(n);
      }
      const fresh = store.read(main.id);
      if (titleBefore !== undefined) fresh.title = titleBefore;
      fresh.combinedGroups = (fresh.combinedGroups || []).filter(g => g.groupId !== group.groupId);
      markSummaryPending(fresh);
      finalize(fresh);
      queueSummary(fresh.id);
      res.json({ note: store.read(main.id), restored: group.ids });
    });

    // POST /api/quick/combine/suggest { ids[] } — AI title for the combined note
    app.post('/api/quick/combine/suggest', async (req, res) => {
      const notes = (req.body?.ids || []).filter(isQuickId).map(id => store.read(id)).filter(Boolean);
      if (notes.length < 2) return res.status(400).json({ error: 'Pick at least two notes' });
      try {
        res.json({ title: await suggestTitle(notes) });
      } catch (err) {
        res.json({ title: notes.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))[0].title, error: err.message });
      }
    });


    projects.register(app);

    // POST /api/quick/:id/undo — remove Google event(s) and link, keep history
    app.post('/api/quick/:id/undo', async (req, res) => {
      const { id } = req.params;
      if (!isQuickId(id)) return res.status(400).json({ error: 'Invalid quick note ID' });
      const note = store.read(id);
      if (!note) return res.status(404).json({ error: 'Quick note not found' });
      if (note.undone) return res.json(note);

      // Voice append / project change: reverse exactly what it did, then discard the capture
      if (note.appliedTo && note.appendOrigin === 'voice') {
        try {
          await smart().undoAppend(note);
        } catch (err) {
          return res.status(500).json({ error: err.message });
        }
      }

      const ids = note.googleEventIds || [];
      if (ids.length && gcal.isConfigured(calendarId())) {
        try {
          for (const eventId of ids) await gcal.deleteEvent(eventId, calendarId());
          note.googleEventIds = [];
        } catch (err) {
          console.warn(`[quick] Could not delete Google event for ${id}: ${err.message}`);
          return res.status(502).json({ error: `Could not remove the Google Calendar event: ${err.message}` });
        }
      }
      if (note.projectId) { projects.removeNote(note.projectId, note.id); note.projectId = null; }
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
    return store.list().filter(n => !n.undone && !n.hidden).length;
  }

  return { register, start, unlinkRecording, relinkRecording, countActive, projects };
}

module.exports = {
  createQuickCapture,
  // exported for tests
  _internal: {
    applyFields, normalizeWhen, parseZoned, toZonedIso, desiredGoogleEvent, describeNow, syncGoogle, confirmationFor,
    normalizeItems, isActiveArrival, arrivalExpiresOn, errandDescription, isActiveGeo,
  },
};
