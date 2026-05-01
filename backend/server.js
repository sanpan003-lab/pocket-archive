require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const multer       = require('multer');
const cookieParser = require('cookie-parser');
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
};

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
}));
app.use(express.json());
app.use(cookieParser());

// Serve MP3s — Express handles Range/streaming natively
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

function parseTitle(id) { return id.slice(11).replace(/_/g, ' '); }
function parseDate(id)  { return id.slice(0, 10); }

function getAllIds() {
  const seen = new Set();
  for (const dir of Object.values(DIRS)) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/\.(md|mp3|m4a|wav|ogg|txt|json)$/i.test(file)) continue;
      const base = file.replace(/\.[^.]+$/, '');
      if (/^\d{4}-\d{2}-\d{2}_/.test(base)) seen.add(base);
    }
  }
  return [...seen].sort((a, b) => b.localeCompare(a));
}

function existsAnyExt(dir, id, exts) {
  return exts.some(ext => fs.existsSync(path.join(dir, `${id}${ext}`)));
}

function buildMeta(id) {
  return {
    id,
    title:            parseTitle(id),
    date:             parseDate(id),
    hasOriginalNotes: existsAnyExt(DIRS.notes,       id, ['.md', '.txt', '.json']),
    hasTranscript:    existsAnyExt(DIRS.transcripts, id, ['.md', '.txt', '.json']),
    hasAudio:         existsAnyExt(DIRS.recordings,  id, ['.mp3', '.m4a', '.wav', '.ogg']),
    hasAiNotes:       existsAnyExt(DIRS.aiNotes,     id, ['.md', '.txt', '.json']),
  };
}

function isValidId(id) {
  return /^\d{4}-\d{2}-\d{2}_[\w.\-]+$/.test(id);
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
  const aiNotes = readFileSafe(path.join(DIRS.aiNotes, `${id}.md`));
  return {
    id,
    title:          parseTitle(id),
    date:           parseDate(id),
    originalNotes:  readFileSafe(path.join(DIRS.notes,  `${id}.md`)),
    transcript:     readTranscript(id),
    aiNotes,
    visualizations: extractVisualizations(aiNotes),
    hasAudio:       fs.existsSync(path.join(DIRS.recordings, `${id}.mp3`)),
    audioFilename:  `${id}.mp3`,
  };
}

// ── AI Notes prompt (mirrors pocket_sync.py) ──────────────────────────────
const AI_NOTES_PROMPT = `You are generating enhanced AI notes for a voice recording transcript/summary. Create structured markdown with visualizations where relevant.

Transcript:
{transcript}

Hey Pocket Summary:
{original_notes}

## Output Format

### 1. Executive Summary
2-3 sentence overview of the recording content and main theme.

### 2. Key Points
Bullet list of 3-5 main takeaways.

### 3. Action Items & Timeline
ALWAYS include this section. Map every task, follow-up, or event from the recording into the timeline. If no exact dates were mentioned, infer approximate dates or use relative ones (e.g. "2026-05-01"). You MUST output this JSON block:

\`\`\`json
{
  "type": "timeline",
  "title": "Action Timeline",
  "events": [
    {"date": "YYYY-MM-DD", "label": "Task name", "status": "pending"},
    {"date": "YYYY-MM-DD", "label": "Deadline", "status": "critical"}
  ]
}
\`\`\`

### 4. Decisions & Options
ALWAYS include this section. Identify the central decision, trade-off, or open question from the recording. If no explicit decision exists, frame the most likely one. You MUST output this JSON block:

\`\`\`json
{
  "type": "decision_tree",
  "title": "Decision Options",
  "root": {
    "question": "Main decision to make?",
    "yes": {"action": "If yes: what to do", "outcome": "positive"},
    "no": {"action": "If no: what to do", "outcome": "neutral"}
  }
}
\`\`\`

### 5. Metrics & Data
ALWAYS include this section. Extract any numbers, counts, percentages, durations, or quantities mentioned. If the content is qualitative, estimate relative values (e.g. priority levels, effort scores). You MUST output one of these JSON blocks:

\`\`\`json
{
  "type": "bar_chart",
  "title": "Chart title",
  "data": [
    {"label": "Category 1", "value": 45},
    {"label": "Category 2", "value": 62}
  ]
}
\`\`\`

### 6. Process & Workflow
ALWAYS include this section. Map out the sequence of steps, events, or actions discussed in the recording as a flowchart. You MUST output this JSON block:

\`\`\`json
{
  "type": "flowchart",
  "title": "Process name",
  "steps": [
    {"id": 1, "label": "Step 1", "next": 2},
    {"id": 2, "label": "Step 2", "next": 3},
    {"id": 3, "label": "Step 3", "next": null}
  ]
}
\`\`\`

## Rules
- ALWAYS include Executive Summary and Key Points — these are mandatory
- JSON visualization blocks are REQUIRED, not optional
- Every AI note MUST contain at least 2-3 JSON visualization blocks
- All JSON must be valid and properly formatted
- Dates in timelines must be ISO format (YYYY-MM-DD)`;

// ── Auth ───────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token || !verifyToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Public auth routes — registered BEFORE the blanket middleware below
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

// Blanket auth guard — protects all /api/* routes registered after this point
app.use('/api', requireAuth);

// POST /api/auth/change-password (protected by blanket middleware above)
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

app.get('/api/recordings', (req, res) => {
  try {
    res.json(getAllIds().map(buildMeta));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

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

// POST /api/recordings/:id/regenerate — re-run Claude on existing transcript/notes
app.post('/api/recordings/:id/regenerate', async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid recording ID' });

  if (!process.env.CLAUDE_API_KEY) {
    return res.status(503).json({ error: 'CLAUDE_API_KEY not set in backend .env' });
  }

  try {
    const transcript    = readFileSafe(path.join(DIRS.transcripts, `${id}.md`));
    const originalNotes = readFileSafe(path.join(DIRS.notes,       `${id}.md`));

    const prompt = AI_NOTES_PROMPT
      .replace('{transcript}',    transcript    || '(No transcript available)')
      .replace('{original_notes}', originalNotes || '(No Hey Pocket summary available)');

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const msg = await client.messages.create({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages:   [{ role: 'user', content: prompt }],
    });

    const aiNotes = msg.content[0].text;
    fs.writeFileSync(path.join(DIRS.aiNotes, `${id}.md`), aiNotes, 'utf8');

    res.json(buildRecordingResponse(id));
  } catch (err) {
    console.error('/regenerate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/recordings/:id/ai-notes — save manually edited notes
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

// ── Attachment endpoints ───────────────────────────────────────────────────

// GET /api/recordings/:id/attachments
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

// POST /api/recordings/:id/attachments
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

// DELETE /api/recordings/:id/attachments/:filename
app.delete('/api/recordings/:id/attachments/:filename', (req, res) => {
  const { id } = req.params;
  const filename = path.basename(req.params.filename); // strip any path components
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

// GET /api/recordings/:id/attachments/:filename — download
app.get('/api/recordings/:id/attachments/:filename', (req, res) => {
  const { id } = req.params;
  const filename = path.basename(req.params.filename);
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid recording ID' });

  const filePath = path.join(DIRS.attachments, id, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  res.sendFile(path.resolve(filePath));
});

// GET /api/search
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);

  try {
    const results = [];
    for (const id of getAllIds()) {
      const title = parseTitle(id).toLowerCase();
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

// GET /api/stats
app.get('/api/stats', (req, res) => {
  try {
    const ids = getAllIds();
    let withAudio = 0, withAiNotes = 0, withTranscript = 0, withOriginalNotes = 0;

    for (const id of ids) {
      if (fs.existsSync(path.join(DIRS.recordings,  `${id}.mp3`))) withAudio++;
      if (fs.existsSync(path.join(DIRS.aiNotes,     `${id}.md`)))  withAiNotes++;
      if (fs.existsSync(path.join(DIRS.transcripts, `${id}.md`)))  withTranscript++;
      if (fs.existsSync(path.join(DIRS.notes,       `${id}.md`)))  withOriginalNotes++;
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
app.get('/health',     (_req, res) => res.json({ ok: true })); // Docker healthcheck alias

// ── Sync job state (in-memory) ─────────────────────────────────────────────
const syncStatus = {
  running:    false,
  lastSync:   null,   // ISO timestamp when last sync started
  lastResult: null,   // 'success' | 'error' | null
  lastError:  null,   // string | null
};

// POST /api/sync — start sync in background, return immediately
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

  // Respond immediately — client will poll /api/sync/status
  res.json({ success: true, message: 'Sync started' });

  // Pass EXPORT_FOLDER so pocket_sync.py writes to the correct archive path
  const spawnEnv = {
    ...process.env,
    EXPORT_FOLDER: process.env.ARCHIVE_PATH || 'H:\\My Drive\\Hey Pocket Archive',
  };

  // Try python3 first (Linux/Docker), fall back to python (Windows/macOS)
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
          ? `Python not found on this system (tried: ${cmd})`
          : e.message;
        console.error('[sync] spawn error:', e.message);
      }
    });

    proc.on('close', code => {
      syncStatus.running = false;
      if (code === 0) {
        syncStatus.lastResult = 'success';
        syncStatus.lastError  = null;
        console.log('[sync] completed successfully');
      } else {
        syncStatus.lastResult = 'error';
        syncStatus.lastError  = err.trim() || `pocket_sync.py exited with code ${code}`;
        console.error('[sync] failed:', syncStatus.lastError);
      }
    });
  }

  runBackground('python3');
});

// GET /api/sync/status — poll for background sync job state
app.get('/api/sync/status', (req, res) => {
  res.json(syncStatus);
});

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
