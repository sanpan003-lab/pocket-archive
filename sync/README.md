# PocketSync

Automatically exports all your Hey Pocket recordings every night and organizes them into 4 structured folders with Claude AI-enhanced summaries.

---

## What it does

Each night, PocketSync fetches every new Hey Pocket recording and produces:

| Folder | Contents |
|---|---|
| `01_Original_Notes/` | Hey Pocket's AI summary, as-is |
| `02_Transcripts/` | Full speaker-labeled transcript with timestamps |
| `03_Recordings/` | MP3 audio file |
| `04_AI_Notes/` | Claude-generated detailed analysis |
| `05_Calendar_Events/` | `.ics` files for action items (importable into Google Calendar) |

Filenames are always `YYYY-MM-DD_Recording_Title.md` — sortable, readable, and Google Drive friendly.

---

## Requirements

- Python 3.9 or later
- Hey Pocket account with API access enabled
- Anthropic API key (Claude)

---

## Installation

**1. Clone or copy this folder to your machine**

```
H:\My Drive\Hey Pocket Archive\
```

**2. Install dependencies**

```bash
pip install -r requirements.txt
```

**3. Create your `.env` file**

```bash
copy .env.example .env
```

Then open `.env` and fill in your real API keys (see [Configuration](#configuration) below).

**4. Run once to verify setup**

```bash
python pocket_sync.py --dry-run
```

You should see a list of your recordings without any files being written.

---

## Configuration

Open `.env` and set these values:

### Required

| Variable | Description | Where to find it |
|---|---|---|
| `POCKET_API_KEY` | Hey Pocket API key — starts with `pk_` | Hey Pocket app → Settings → API Access |
| `CLAUDE_API_KEY` | Anthropic API key — starts with `sk-ant-` | console.anthropic.com → Settings → API Keys |

### Optional (safe to leave as defaults)

| Variable | Default | Description |
|---|---|---|
| `EXPORT_FOLDER` | Script directory | Root folder for all output subfolders |
| `LOG_FOLDER` | `_logs` | Log folder, relative to `EXPORT_FOLDER` |
| `CLAUDE_MODEL` | `claude-3-5-sonnet-20241022` | Swap to `haiku` for cheaper/faster, `opus` for smarter |
| `POCKET_API_DELAY` | `0.5` | Seconds between Hey Pocket API calls |
| `CLAUDE_API_DELAY` | `1.0` | Seconds between Claude API calls |
| `MAX_RETRIES` | `3` | Retries on network errors (exponential backoff) |

---

## Usage

### Normal run (processes all new recordings since last run)

```bash
python pocket_sync.py
```

### Dry run — fetch and preview, no files written

```bash
python pocket_sync.py --dry-run
```

### Limit to N recordings (safe for first-time testing)

```bash
python pocket_sync.py --test-count 1
python pocket_sync.py --test-count 3
```

### Combine flags

```bash
python pocket_sync.py --dry-run --test-count 2
```

### Force a full re-sync from the beginning (ignores state.json)

```bash
python pocket_sync.py --full-sync
```

---

## Output structure

```
H:\My Drive\Hey Pocket Archive\
│
├── 01_Original_Notes\
│   └── 2026-04-25_Verizon_Promotion_Call.md
│
├── 02_Transcripts\
│   └── 2026-04-25_Verizon_Promotion_Call.md
│
├── 03_Recordings\
│   └── 2026-04-25_Verizon_Promotion_Call.mp3
│
├── 04_AI_Notes\
│   └── 2026-04-25_Verizon_Promotion_Call.md
│
├── 05_Calendar_Events\
│   └── 2026-04-25_Verizon_Promotion_Call_action_1.ics
│
├── _logs\
│   └── sync_2026-04-25.log
│
├── state.json          ← tracks last run + processed IDs
├── pocket_sync.py
├── .env                ← your API keys (never committed to git)
├── .env.example        ← safe template
└── requirements.txt
```

### Transcript format (`02_Transcripts/`)

```markdown
# 2026-04-25 — Verizon Promotion Call

**SPEAKER_01** (0:34): Hello, is this working?
**SPEAKER_02** (0:41): Yes, I can hear you fine.
**SPEAKER_01** (1:02): Great. So I wanted to follow up on...
```

### AI Notes format (`04_AI_Notes/`)

Claude reads both the transcript AND the original Hey Pocket summary and produces:
- Executive summary (2–3 paragraphs)
- Key discussion points
- Decisions made
- Action items with owners
- Notable quotes or insights
- Tables where relevant

---

## Scheduling nightly runs (Windows Task Scheduler)

Run PocketSync automatically every night using Windows Task Scheduler:

**1. Open Task Scheduler**

Press `Win + S`, search **Task Scheduler**, open it.

**2. Create a new task**

- Click **Create Task** (not Basic Task — you need more control)
- **General tab:**
  - Name: `PocketSync Nightly`
  - Check **Run whether user is logged on or not**
  - Check **Run with highest privileges**

**3. Set the trigger**

- **Triggers tab** → New
  - Begin the task: **On a schedule**
  - Daily, starting at `9:00 PM` (or your preferred time)
  - Recur every `1` day

**4. Set the action**

- **Actions tab** → New
  - Action: **Start a program**
  - Program/script: path to your Python executable, e.g.:
    ```
    C:\Users\YourName\AppData\Local\Programs\Python\Python312\python.exe
    ```
  - Add arguments:
    ```
    pocket_sync.py
    ```
  - Start in (the folder containing the script):
    ```
    H:\My Drive\Hey Pocket Archive
    ```

**5. Set conditions**

- **Conditions tab:**
  - Uncheck **Start the task only if the computer is on AC power** (if you use a laptop)

**6. Save and test**

- Click OK, enter your Windows password when prompted
- Right-click the task → **Run** to test it immediately
- Check `_logs/` for a log file confirming it ran

---

## Error handling

| Situation | Behavior |
|---|---|
| Missing API key | Exits immediately with a clear message |
| Network error | Retries up to `MAX_RETRIES` times with exponential backoff |
| Recording has no transcript | Skips transcript file, still saves notes + audio |
| Recording has no summary | Generates summary from transcript via Claude |
| Audio download fails | Logs a warning, continues with text files |
| Claude rate limit hit | Logs error, marks recording for retry next run |
| File already exists | Skips — never overwrites existing exports |
| Any single recording fails | Logs it, continues with remaining recordings |

State is only updated in `state.json` when all recordings succeed. If the script is interrupted, the next run picks up where it left off.

---

## Cost estimate

Claude API pricing for `claude-3-5-sonnet-20241022`:

| Usage | Approx. cost |
|---|---|
| Per recording (AI Notes) | ~$0.01–$0.02 |
| 30 recordings/month | ~$0.30–$0.60 |
| 100 recordings/month | ~$1.00–$2.00 |

Hey Pocket API: free with your subscription.

---

## Troubleshooting

**`POCKET_API_KEY not found` error**
→ Make sure `.env` exists (not just `.env.example`) and the key is filled in.

**`ModuleNotFoundError`**
→ Run `pip install -r requirements.txt` again. Make sure you're using the right Python environment.

**Audio download is slow**
→ Normal for large MP3 files. PocketSync resumes interrupted downloads automatically — just re-run.

**`state.json` is out of sync**
→ Delete `state.json` and run with `--full-sync` to reprocess everything. Existing files are skipped automatically.

**Task Scheduler runs but nothing happens**
→ Check `_logs/` for the log file. The most common cause is the wrong Python path in the Action step.

---

## Security notes

- `.env` is listed in `.gitignore` — API keys are never committed
- API keys are never written to log files
- All files stay local — no third-party sync services involved
- Google Drive syncs the output folders to your phone automatically
