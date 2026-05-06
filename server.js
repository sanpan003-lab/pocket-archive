require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const fs           = require('fs');
const multer       = require('multer');
const cookieParser = require('cookie-parser');
const { randomUUID } = require('crypto');
const {
  verifyPassword, generateToken, verifyToken,
  hashPassword, savePassword, mustChangePassword,
} = require('./auth');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Archive paths ──────────────────────────────────────────────────────────
const ARCHIVE_PATH = process.env.ARCHIVE_PATH || 'H:\\My Drive\\Hey Pocket Archive';

const DIRS = {
  notes:       path.join(ARCHIVE_PATH, '01_Original_Notes'),
  transcripts: path.join(ARCHIVE_PATH, '02_Transcripts'),
  recordings:  path.join(ARCHIVE_PATH, '03_Recordings'),
  aiNotes:     path.join(ARCHIVE_PATH, '04_AI_Notes'),
  attachments: path.join(ARCHIVE_PATH, '05_Attachments'),
  deleted:     path.join(ARCHIVE_PATH, '99_Deleted'),
};

// Ensure deleted folder exists
fs.mkdirSync(DIRS.deleted, { recursive: true });

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Serve audio files — Express handles Range/streaming natively
app.use('/api/audio', express.static(DIRS.recordings, {
  setHeaders: (res) => {
    res.set('Accept-Ranges', 'bytes');
    res.set('Cache-Control', 'public, max-age=86400');
  },
}));

// ── Multer — file attachments ──────────────────────────────────────────────
const attachmentStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(DIRS.attachments, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => cb(null, file.originalname),
});
const upload = multer({
  storage: attachmentStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ── Multer — audio uploads for Create Recording ────────────────────────────
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.mp3', '.m4a', '.wav', '.ogg'].includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported audio format: ${ext}`));
  },
});

// ── Helpers ────────────────────────────────────────────────────────────────

function readFileSafe(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch { return null; }
}

function extractVisualizations(markdown) {
  if (!markdown) return [];
  const vizs = [];
  const re = /```json\s*(\{[\s\S]*?\})\s*```/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj && typeof obj.type === 'string') vizs.push(obj);
    } catch { /* skip */ }
  }
  return vizs;
}

// ID parsing for standard date-prefixed IDs
function parseTitle(id) { return id.slice(11).replace(/_/g, ' '); }
function parseDate(id)  { return id.slice(0, 10); }

function isManualId(id) { return typeof id === 'string' && id.startsWith('manual_'); }

// Per-recording metadata overrides (title, date, etc.)
function readMeta(id) {
  const p = path.join(DIRS.notes, `${id}.meta.json`);
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return {}; }
}

function writeMeta(id, data) {
  fs.mkdirSync(DIRS.notes, { recursive: true });
  fs.writeFileSync(
    path.join(DIRS.notes, `${id}.meta.json`),
    JSON.stringify(data, null, 2),
    'utf8',
  );
}

function getTitle(id) {
  const meta = readMeta(id);
  if (meta.title) return meta.title;
  if (isManualId(id)) return id;
  return parseTitle(id);
}

function getDate(id) {
  const meta = readMeta(id);
  if (meta.date) return meta.date;
  if (isManualId(id)) return new Date().toISOString().slice(0, 10);
  return parseDate(id);
}

function findAudioFile(id) {
  for (const ext of ['.mp3', '.m4a', '.wav', '.ogg']) {
    if (fs.existsSync(path.join(DIRS.recordings, `${id}${ext}`))) return `${id}${ext}`;
  }
  return null;
}

function getDeletedIds() {
  if (!fs.existsSync(DIRS.deleted)) return new Set();
  return new Set(
    fs.readdirSync(DIRS.deleted, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name),
  );
}

function getAllIds() {
  const seen      = new Set();
  const deletedIds = getDeletedIds();

  for (const [key, dir] of Object.entries(DIRS)) {
    if (key === 'deleted' || key === 'attachments') continue;
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.meta.json')) continue;
      if (!/\.(md|mp3|m4a|wav|ogg|txt|json)$/i.test(file)) continue;
      const base = file.replace(/\.[^.]+$/, '');
      if (/^\d{4}-\d{2}-\d{2}_/.test(base) || /^manual_/.test(base)) {
        if (!deletedIds.has(base)) seen.add(base);
      }
    }
  }

  // Also discover manual recordings stored only as meta.json (no content files yet)
  if (fs.existsSync(DIRS.notes)) {
    for (const file of fs.readdirSync(DIRS.notes)) {
      if (!file.endsWith('.meta.json')) continue;
      const base = file.slice(0, -10); // strip '.meta.json'
      if (/^manual_/.test(base) && !deletedIds.has(base)) seen.add(base);
    }
  }

  const ids = [...seen];
  ids.sort((a, b) => getDate(b).localeCompare(getDate(a)));
  return ids;
}

function existsAnyExt(dir, id, exts) {
  return exts.some(ext => fs.existsSync(path.join(dir, `${id}${ext}`)));
}

function buildMeta(id) {
  const audioFile = findAudioFile(id);
  return {
    id,
    title:            getTitle(id),
    date:             getDate(id),
    hasOriginalNotes: existsAnyExt(DIRS.notes,       id, ['.md', '.txt']),
    hasTranscript:    existsAnyExt(DIRS.transcripts,  id, ['.md', '.txt', '.json']),
    hasAudio:         !!audioFile,
    hasAiNotes:       existsAnyExt(DIRS.aiNotes,      id, ['.md', '.txt', '.json']),
    audioFilename:    audioFile || `${id}.mp3`,
  };
}

function isValidId(id) {
  return /^\d{4}-\d{2}-\d{2}_[\w.\-]+$/.test(id) || /^manual_[\w-]+$/.test(id);
}

function readTranscript(id) {
  const jsonPath = path.join(DIRS.transcripts, `${id}.json`);
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      return data.transcription || null;
    } catch { /* fall through */ }
  }
  return readFileSafe(path.join(DIRS.transcripts, `${id}.md`));
}

function buildRecordingResponse(id) {
  const aiNotes   = readFileSafe(path.join(DIRS.aiNotes, `${id}.md`));
  const audioFile = findAudioFile(id);
  return {
    id,
    title:          getTitle(id),
    date:           getDate(id),
    originalNotes:  readFileSafe(path.join(DIRS.notes, `${id}.md`)),
    transcript:     readTranscript(id),
    aiNotes,
    visualizations: extractVisualizations(aiNotes),
    hasAudio:       !!audioFile,
    audioFilename:  audioFile || `${id}.mp3`,
  };
}

// Move a single file with cross-device fallback
function moveFile(src, dst) {
  if (!fs.existsSync(src)) return false;
  try { fs.renameSync(src, dst); return true; }
  catch {
    try { fs.copyFileSync(src, dst); fs.unlinkSync(src); return true; }
    catch { return false; }
  }
}

// Move a directory tree with cross-device fallback
function moveDirSync(src, dst) {
  if (!fs.existsSync(src)) return false;
  try { fs.renameSync(src, dst); return true; }
  catch {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (entry.isDirectory()) moveDirSync(s, d);
      else fs.copyFileSync(s, d);
    }
    fs.rmSync(src, { recursive: true, force: true });
    return true;
  }
}

// ── AI Notes prompt ────────────────────────────────────────────────────────
const AI_NOTES_PROMPT = `You are analyzing a voice recording transcript and summary.
Create comprehensive notes with an adaptive structure that best fits the content.
Do not use a rigid template — choose the sections that make the most sense for this recording.

Transcript:
{transcript}

Hey Pocket Summary:
{original_notes}

---

## STEP 1: Silently Analyze the Recording

Before writing, internally determine (do not output this):
- Recording type: meeting, phone call, brainstorm, lecture, interview, personal memo,
  technical discussion, medical update, financial review, creative session, or other
- Content domain: business, technical, medical/health, personal, educational, creative,
  legal, financial, or other
- Key themes: the 3-5 most important topics covered

Use this analysis only to choose the right sections in Step 2.

---

## STEP 2: Choose 3-7 Sections

Pick the sections below that best capture this specific recording.
You may also invent a custom heading if none of these fit.
Always include at least one overview section and end with Action Items if any tasks exist.

**Overview (pick one or both):**
- Executive Summary — broad overview of everything important
- Key Insights — main takeaways, implications, and what matters most

**Action & Decisions:**
- Action Items — use a markdown table (Date | Task | Owner | Status)
- Decisions Made — what was decided, by whom, and why
- Open Questions — unresolved questions that still need answers
- Next Steps — ordered sequence of what happens after this recording

**Technical:**
- Technical Details — specs, configurations, code notes, system behavior
- Implementation Approach — how to build, deploy, or integrate something
- Requirements — functional and non-functional requirements captured
- Bug Analysis — root cause, reproduction steps, impact, and fix
- Security Considerations — risks, attack surface, mitigations, access control
- Architecture & Design — system design, data flow, component relationships

**Meeting & Discussion:**
- Discussion Points — what was talked about and the key positions taken
- Decisions Made — agreements, conclusions, and who owns them
- Stakeholder Notes — who said what, their concerns, their priorities
- Attendees & Context — who was involved, their roles, meeting purpose

**Research & Learning:**
- Key Takeaways — what to remember and apply from this
- Main Arguments — positions argued and the logic behind them
- Supporting Evidence — data, examples, studies, or references cited
- Related Concepts — connected topics worth exploring further

**Medical & Health:**
- Clinical Summary — condition, symptoms, diagnosis, current status
- Medications & Treatment — names, doses, schedules, instructions, refills
- Warning Signs — when to seek care immediately, symptoms to monitor
- Follow-up Care — next appointments, pending tests, who to contact

**Financial & Business:**
- Financial Details — amounts, costs, billing, insurance, copays, estimates
- Contact Information — names, phone numbers, addresses, fax, reference numbers
- Risk Assessment — identified risks, probability, impact, mitigation steps
- Business Context — background, market situation, strategic implications

**Creative & Personal:**
- Ideas Generated — brainstorm output, concepts, possibilities explored
- Personal Reflections — thoughts, feelings, realizations, intentions
- Goals & Intentions — what the person wants to achieve and why
- Creative Direction — style decisions, tone, approach, constraints

---

## STEP 3: Write the Notes

Start directly with the first section heading. No preamble, no meta-commentary,
no explanation of your section choices.

**Formatting rules:**
- Use ## for every section heading (e.g., ## Executive Summary)
- Use **bold labels** on every bullet: - **Label:** detail
- Action Items must always be a markdown table:

| Date / Deadline | Action Item | Owner | Status |
|----------------|-------------|-------|--------|
| YYYY-MM-DD | Task description | Person or "—" | Pending |

If no specific dates were mentioned, use: ASAP, TBD, or "Within X days/weeks"

**Content rules:**
- COMPLETENESS FIRST — if it was mentioned, it must appear in the notes
- No length limits — write as much as needed to capture everything
- Include specific details: exact dates, amounts, phone numbers, addresses, names,
  reference numbers, authorization codes, medication doses, case numbers
- Medical / pharmacy / financial / legal content: capture every specific detail
- Do not use JSON visualization blocks — use markdown tables for structured data
- Do not pad with filler — if a section has nothing meaningful to say, skip it
- If the recording has no action items, omit the Action Items section entirely

---

## STEP 4: Always Append These Two Sections Last

These are MANDATORY. They must appear at the very end of every note, after all
sections chosen in Step 2.

### Metrics & Data Analysis

Present every number, quantity, cost, duration, percentage, count, or measurable
value from the recording as a structured table. Include estimated values if exact
numbers were not given (e.g. "~2 hours", "roughly $500", "high priority = 3/5").

| Metric | Value | Change / Trend | Notes |
|--------|-------|---------------|-------|
| [metric name] | [value + units] | ↑ / ↓ / → / N/A | [context or source] |

If no quantitative data exists at all, include one row:
| Overall | Qualitative only | — | No numbers mentioned in this recording |

### Process & Workflow

If any process, sequence of steps, workflow, decision path, or procedure was
discussed, represent it as a Mermaid flowchart. Follow these rules exactly:

\`\`\`mermaid
graph TD
    A[Start] --> B[First Step]
    B --> C{Decision Point?}
    C -->|Yes| D[Action A]
    C -->|No| E[Action B]
    D --> F[End / Outcome]
    E --> F
\`\`\`

Mermaid syntax rules — a violation causes a render error:
- Use graph TD (top-down) or graph LR (left-right)
- Node IDs: letters or short alphanumeric only — A, B, C1, Step2 (no spaces)
- Square brackets for steps:    A[Step label]
- Curly braces for decisions:   B{Question?}
- Arrow labels:                 -->|Yes| or -->|No|
- Node labels must be under 35 characters
- No quotes or nested brackets inside node labels

If no process or workflow was discussed, write this plain text (no code block):
No sequential process or workflow was described in this recording.`;

// ── Auth ───────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token || !verifyToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Public auth routes — registered BEFORE the blanket middleware
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (!verifyPassword(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = generateToken();
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ success: true, mustChangePassword: mustChangePassword() });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/auth/status', (req, res) => {
  const token = req.cookies?.token;
  const valid = token && verifyToken(token);
  res.json({ authenticated: !!valid });
});

// Blanket auth guard — all /api/* routes after this point require auth
app.use('/api', requireAuth);

app.post('/api/auth/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!verifyPassword(currentPassword)) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  savePassword(hashPassword(newPassword));
  res.json({ success: true });
});

// ── Routes ─────────────────────────────────────────────────────────────────

// GET /api/recordings — list all (excludes deleted)
app.get('/api/recordings', (req, res) => {
  try {
    res.json(getAllIds().map(buildMeta));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/recordings/deleted — list soft-deleted recordings
// MUST be registered before /api/recordings/:id
app.get('/api/recordings/deleted', (req, res) => {
  try {
    if (!fs.existsSync(DIRS.deleted)) return res.json([]);
    const result = [];
    for (const name of fs.readdirSync(DIRS.deleted)) {
      const metaPath = path.join(DIRS.deleted, name, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        result.push({ id: meta.id, title: meta.title, deletedAt: meta.deletedAt });
      } catch { /* skip corrupt entries */ }
    }
    result.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/recordings/create — create a manual recording
// MUST be registered before /api/recordings/:id
app.post('/api/recordings/create', audioUpload.single('audioFile'), (req, res) => {
  const { title, recordingDate, originalNotes, aiNotes } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  if (!recordingDate)  return res.status(400).json({ error: 'recordingDate is required' });

  const id   = `manual_${randomUUID()}`;
  const date = recordingDate.slice(0, 10);

  // Always write meta.json (source of truth for title/date)
  writeMeta(id, { title: title.trim(), date, source: 'manual' });

  // Write notes .md if content provided
  if (originalNotes?.trim()) {
    fs.mkdirSync(DIRS.notes, { recursive: true });
    fs.writeFileSync(path.join(DIRS.notes, `${id}.md`), originalNotes.trim(), 'utf8');
  }

  // Write AI notes if provided
  if (aiNotes?.trim()) {
    fs.mkdirSync(DIRS.aiNotes, { recursive: true });
    fs.writeFileSync(path.join(DIRS.aiNotes, `${id}.md`), aiNotes.trim(), 'utf8');
  }

  // Write audio file if uploaded
  if (req.file) {
    const ext = path.extname(req.file.originalname).toLowerCase() || '.mp3';
    fs.mkdirSync(DIRS.recordings, { recursive: true });
    fs.writeFileSync(path.join(DIRS.recordings, `${id}${ext}`), req.file.buffer);
  }

  try {
    res.status(201).json(buildRecordingResponse(id));
  } catch (err) {
    console.error('/create error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/recordings/:id — single recording detail
app.get('/api/recordings/:id', (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid recording ID' });
  try {
    res.json(buildRecordingResponse(id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── AI generation helpers ─────────────────────────────────────────────────

async function generateWithGemini(prompt) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
    generationConfig: { maxOutputTokens: 8192 },
  });
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  if (!text) throw new Error('Gemini returned an empty response — content may have been filtered');
  return text;
}

async function generateWithClaude(prompt) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const msg = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-opus-4-5',
    max_tokens: 8192,
    messages:   [{ role: 'user', content: prompt }],
  });
  return msg.content[0].text;
}

// POST /api/recordings/:id/regenerate — re-run AI generation on existing notes
// Body (optional): { "model": "gemini" | "claude" }  — defaults to "gemini"
app.post('/api/recordings/:id/regenerate', async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid recording ID' });

  const model = (req.body?.model || 'gemini').toLowerCase();
  if (!['gemini', 'claude'].includes(model)) {
    return res.status(400).json({ error: 'model must be "gemini" or "claude"' });
  }

  if (model === 'gemini' && !process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'GEMINI_API_KEY not set in backend .env' });
  }
  if (model === 'claude' && !process.env.CLAUDE_API_KEY) {
    return res.status(503).json({ error: 'CLAUDE_API_KEY not set in backend .env' });
  }

  try {
    const transcript    = readFileSafe(path.join(DIRS.transcripts, `${id}.md`));
    const originalNotes = readFileSafe(path.join(DIRS.notes, `${id}.md`));

    const prompt = AI_NOTES_PROMPT
      .replace('{transcript}',     transcript    || '(No transcript available)')
      .replace('{original_notes}', originalNotes || '(No Hey Pocket summary available)');

    const aiNotes = model === 'gemini'
      ? await generateWithGemini(prompt)
      : await generateWithClaude(prompt);

    fs.writeFileSync(path.join(DIRS.aiNotes, `${id}.md`), aiNotes, 'utf8');
    res.json(buildRecordingResponse(id));
  } catch (err) {
    console.error('/regenerate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/recordings/:id/ai-notes — save manually edited AI notes
app.put('/api/recordings/:id/ai-notes', (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid recording ID' });

  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });

  try {
    fs.mkdirSync(DIRS.aiNotes, { recursive: true });
    fs.writeFileSync(path.join(DIRS.aiNotes, `${id}.md`), content, 'utf8');
    res.json(buildRecordingResponse(id));
  } catch (err) {
    console.error('/ai-notes PUT error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/recordings/:id/title — update recording title
app.put('/api/recordings/:id/title', (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid recording ID' });

  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  try {
    const meta = readMeta(id);
    writeMeta(id, { ...meta, title: title.trim() });
    res.json(buildRecordingResponse(id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/recordings/:id/date — update recording date
app.put('/api/recordings/:id/date', (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid recording ID' });

  const { recordingDate } = req.body;
  if (!recordingDate) return res.status(400).json({ error: 'recordingDate is required' });

  try {
    const meta = readMeta(id);
    writeMeta(id, { ...meta, date: recordingDate.slice(0, 10) });
    res.json(buildRecordingResponse(id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/recordings/:id/original-notes — save edited original notes
app.put('/api/recordings/:id/original-notes', (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid recording ID' });

  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });

  try {
    fs.mkdirSync(DIRS.notes, { recursive: true });
    fs.writeFileSync(path.join(DIRS.notes, `${id}.md`), content, 'utf8');
    res.json(buildRecordingResponse(id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/recordings/:id/delete — soft delete (move to 99_Deleted)
app.post('/api/recordings/:id/delete', (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid recording ID' });

  try {
    const deletedDir = path.join(DIRS.deleted, id);
    fs.mkdirSync(deletedDir, { recursive: true });

    const title = getTitle(id);

    // Track which files were moved (for restore)
    const movedFiles = {};

    // Original notes
    if (moveFile(path.join(DIRS.notes, `${id}.md`), path.join(deletedDir, 'original_notes.md'))) {
      movedFiles.hasNotes = true;
    }
    // Meta overrides
    if (moveFile(path.join(DIRS.notes, `${id}.meta.json`), path.join(deletedDir, 'meta_override.json'))) {
      movedFiles.hasMeta = true;
    }
    // AI notes
    if (moveFile(path.join(DIRS.aiNotes, `${id}.md`), path.join(deletedDir, 'ai_notes.md'))) {
      movedFiles.hasAiNotes = true;
    }
    // Audio (find the actual extension)
    const audioFile = findAudioFile(id);
    if (audioFile) {
      const ext = path.extname(audioFile);
      if (moveFile(path.join(DIRS.recordings, audioFile), path.join(deletedDir, `recording${ext}`))) {
        movedFiles.audioExt = ext;
      }
    }
    // Transcript
    for (const ext of ['.md', '.json', '.txt']) {
      const src = path.join(DIRS.transcripts, `${id}${ext}`);
      if (fs.existsSync(src)) {
        moveFile(src, path.join(deletedDir, `transcript${ext}`));
        movedFiles.transcriptExt = ext;
      }
    }
    // Attachments folder
    const attachDir = path.join(DIRS.attachments, id);
    if (fs.existsSync(attachDir)) {
      moveDirSync(attachDir, path.join(deletedDir, 'attachments'));
      movedFiles.hasAttachments = true;
    }

    // Save deletion metadata
    fs.writeFileSync(
      path.join(deletedDir, 'meta.json'),
      JSON.stringify({ id, title, deletedAt: new Date().toISOString(), files: movedFiles }, null, 2),
      'utf8',
    );

    res.json({ success: true, recoverable: true });
  } catch (err) {
    console.error('/delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/recordings/:id/restore — restore from trash
app.post('/api/recordings/:id/restore', (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid recording ID' });

  try {
    const deletedDir = path.join(DIRS.deleted, id);
    if (!fs.existsSync(deletedDir)) {
      return res.status(404).json({ error: 'Recording not found in trash' });
    }

    const metaPath = path.join(deletedDir, 'meta.json');
    const meta = fs.existsSync(metaPath)
      ? JSON.parse(fs.readFileSync(metaPath, 'utf8'))
      : { files: {} };
    const { files = {} } = meta;

    fs.mkdirSync(DIRS.notes,       { recursive: true });
    fs.mkdirSync(DIRS.aiNotes,     { recursive: true });
    fs.mkdirSync(DIRS.recordings,  { recursive: true });
    fs.mkdirSync(DIRS.transcripts, { recursive: true });

    if (files.hasNotes)    moveFile(path.join(deletedDir, 'original_notes.md'),  path.join(DIRS.notes,      `${id}.md`));
    if (files.hasMeta)     moveFile(path.join(deletedDir, 'meta_override.json'), path.join(DIRS.notes,      `${id}.meta.json`));
    if (files.hasAiNotes)  moveFile(path.join(deletedDir, 'ai_notes.md'),         path.join(DIRS.aiNotes,    `${id}.md`));
    if (files.audioExt)    moveFile(path.join(deletedDir, `recording${files.audioExt}`), path.join(DIRS.recordings, `${id}${files.audioExt}`));
    if (files.transcriptExt) moveFile(path.join(deletedDir, `transcript${files.transcriptExt}`), path.join(DIRS.transcripts, `${id}${files.transcriptExt}`));
    if (files.hasAttachments) moveDirSync(path.join(deletedDir, 'attachments'), path.join(DIRS.attachments, id));

    // Remove the deleted directory
    fs.rmSync(deletedDir, { recursive: true, force: true });

    res.json({ success: true });
  } catch (err) {
    console.error('/restore error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/recordings/:id/permanent-delete — irrecoverably remove from trash
app.post('/api/recordings/:id/permanent-delete', (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid recording ID' });
  if (req.query.confirm !== 'true') {
    return res.status(400).json({ error: 'Add ?confirm=true to permanently delete' });
  }

  try {
    const deletedDir = path.join(DIRS.deleted, id);
    if (!fs.existsSync(deletedDir)) {
      return res.status(404).json({ error: 'Recording not found in trash' });
    }
    fs.rmSync(deletedDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    console.error('/permanent-delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Attachment endpoints ───────────────────────────────────────────────────

app.get('/api/recordings/:id/attachments', (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid recording ID' });

  const dir = path.join(DIRS.attachments, id);
  if (!fs.existsSync(dir)) return res.json([]);

  try {
    const files = fs.readdirSync(dir)
      .filter(f => !f.startsWith('.'))
      .map(filename => {
        const stat = fs.statSync(path.join(dir, filename));
        return { filename, size: stat.size, mtime: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recordings/:id/attachments', (req, res, next) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid recording ID' });
  next();
}, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    filename: req.file.filename,
    size:     req.file.size,
    mtime:    new Date().toISOString(),
  });
});

app.delete('/api/recordings/:id/attachments/:filename', (req, res) => {
  const { id } = req.params;
  const filename = path.basename(req.params.filename);
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid recording ID' });

  const filePath = path.join(DIRS.attachments, id, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/recordings/:id/attachments/:filename', (req, res) => {
  const { id } = req.params;
  const filename = path.basename(req.params.filename);
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid recording ID' });

  const filePath = path.join(DIRS.attachments, id, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  res.sendFile(path.resolve(filePath));
});

// ── Search ─────────────────────────────────────────────────────────────────

app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);

  try {
    const results = [];
    for (const id of getAllIds()) {
      const title = getTitle(id).toLowerCase();
      let matched = title.includes(q);
      let snippet = '';

      if (!matched) {
        const sources = [
          path.join(DIRS.aiNotes,     `${id}.md`),
          path.join(DIRS.notes,       `${id}.md`),
          path.join(DIRS.transcripts, `${id}.md`),
        ];
        for (const src of sources) {
          const raw = readFileSafe(src);
          if (!raw) continue;
          const idx = raw.toLowerCase().indexOf(q);
          if (idx !== -1) {
            matched = true;
            const start = Math.max(0, idx - 60);
            const end   = Math.min(raw.length, idx + 140);
            snippet = raw.slice(start, end).replace(/\n+/g, ' ').trim();
            break;
          }
        }
      }
      if (matched) results.push({ ...buildMeta(id), snippet });
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Stats ──────────────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  try {
    const ids = getAllIds();
    let withAudio = 0, withAiNotes = 0, withTranscript = 0, withOriginalNotes = 0;

    for (const id of ids) {
      if (findAudioFile(id))                                               withAudio++;
      if (fs.existsSync(path.join(DIRS.aiNotes,     `${id}.md`)))         withAiNotes++;
      if (existsAnyExt(DIRS.transcripts, id, ['.md', '.json', '.txt']))    withTranscript++;
      if (existsAnyExt(DIRS.notes, id, ['.md', '.txt']))                   withOriginalNotes++;
    }

    res.json({
      total: ids.length,
      withAudio,
      withAiNotes,
      withTranscript,
      withOriginalNotes,
      archivePath: ARCHIVE_PATH,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/health',     (_req, res) => res.json({ ok: true }));

// ── Sync job state ─────────────────────────────────────────────────────────
const syncStatus = {
  running:    false,
  lastSync:   null,
  lastResult: null,
  lastError:  null,
};

app.post('/api/sync', (req, res) => {
  const { spawn } = require('child_process');
  const SYNC_SCRIPT = process.env.SYNC_SCRIPT_PATH || null;

  if (!SYNC_SCRIPT) {
    return res.status(400).json({
      error: 'Sync script not configured. Set SYNC_SCRIPT_PATH in environment.',
    });
  }
  if (!fs.existsSync(SYNC_SCRIPT)) {
    return res.status(404).json({ error: `Sync script not found: ${SYNC_SCRIPT}` });
  }
  if (syncStatus.running) {
    return res.status(409).json({ error: 'Sync already in progress' });
  }

  const SCRIPT_DIR = path.dirname(SYNC_SCRIPT);
  syncStatus.running    = true;
  syncStatus.lastSync   = new Date().toISOString();
  syncStatus.lastResult = null;
  syncStatus.lastError  = null;

  res.json({ success: true, message: 'Sync started' });

  const spawnEnv = {
    ...process.env,
    EXPORT_FOLDER: process.env.ARCHIVE_PATH || 'H:\\My Drive\\Hey Pocket Archive',
  };

  function runBackground(cmd) {
    const proc = spawn(cmd, [SYNC_SCRIPT], { cwd: SCRIPT_DIR, env: spawnEnv });
    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', e => {
      if (e.code === 'ENOENT' && cmd === 'python3') {
        runBackground('python');
      } else {
        syncStatus.running    = false;
        syncStatus.lastResult = 'error';
        syncStatus.lastError  = e.code === 'ENOENT'
          ? `Python not found (tried: ${cmd})`
          : e.message;
      }
    });
    proc.on('close', code => {
      syncStatus.running = false;
      if (code === 0) {
        syncStatus.lastResult = 'success';
        syncStatus.lastError  = null;
      } else {
        syncStatus.lastResult = 'error';
        syncStatus.lastError  = err.trim() || `pocket_sync.py exited with code ${code}`;
      }
    });
  }
  runBackground('python3');
});

app.get('/api/sync/status', (_req, res) => res.json(syncStatus));

// ── Frontend (SPA) ─────────────────────────────────────────────────────────
const FRONTEND_PATH = path.join(__dirname, 'public');
app.use(express.static(FRONTEND_PATH));
app.get('*', (req, res) => {
  const index = path.join(FRONTEND_PATH, 'index.html');
  if (fs.existsSync(index)) {
    res.sendFile(index);
  } else {
    res.status(404).json({ error: 'Frontend not built yet' });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\nPocket Archive API  →  http://localhost:${PORT}`);
  console.log(`Archive path        →  ${ARCHIVE_PATH}\n`);
  for (const [name, dir] of Object.entries(DIRS)) {
    const ok = fs.existsSync(dir);
    console.log(`  ${ok ? '✓' : '✗ (missing)'}  ${name.padEnd(12)} ${dir}`);
  }
  console.log();
});
