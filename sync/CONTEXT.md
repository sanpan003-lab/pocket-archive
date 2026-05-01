# PocketSync — Automated Hey Pocket Export

## Goal
Automatically download ALL Hey Pocket recordings every night at a scheduled time and organize them into 4 structured folders with AI-enhanced summaries.

## What you want in each folder

### 📁 01_Original_Notes
- Hey Pocket's auto-generated notes/summaries as-is
- File: `YYYY-MM-DD_Recording_Title.md`
- Content: Whatever Hey Pocket's AI created (mind map, summary markdown, action items)
- Nothing added, nothing removed — faithful export only

### 📁 02_Transcripts
- Full "who said what" transcript with timestamps
- File: `YYYY-MM-DD_Recording_Title.md`
- Format: `**SPEAKER_01** (0:34): Hello, is this working?`
- Include all speaker labels and timestamps
- Just raw transcript, no summary

### 📁 03_Recordings
- Audio MP3 files downloaded from Hey Pocket
- File: `YYYY-MM-DD_Recording_Title.mp3`
- Matches the filename (minus extension) of transcript/notes for easy cross-reference

### 📁 04_AI_Notes
- Claude-generated detailed, well-structured summaries
- File: `YYYY-MM-DD_Recording_Title.md`
- Input: Claude reads BOTH the transcript AND Hey Pocket's original notes
- Output: Detailed analysis with clear sections, organized bullet points, tables where relevant, action items highlighted
- This is the "premium" version — much more detailed than Hey Pocket's summary

## API Details

### Hey Pocket Public API
- Base URL: `https://public.heypocketai.com/api/v1`
- Authentication: Bearer token with `pk_` API key
- Required endpoints:
  1. `GET /public/recordings` — List all recordings (paginated)
  2. `GET /public/recordings/{id}` — Get full recording with transcript + summarizations
  3. `GET /public/recordings/{id}/audio-url` — Get download URL for MP3

### Hey Pocket API Response structure

**List recordings:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "string",
      "recording_at": "ISO 8601 datetime",
      "created_at": "ISO 8601 datetime",
      "duration": 1902,
      "state": "completed"
    }
  ],
  "pagination": {
    "has_more": true,
    "page": 1,
    "total_pages": 5
  }
}
```

**Single recording (with ?include_transcript=true&include_summarizations=true):**
```json
{
  "success": true,
  "data": {
    "recording": {
      "id": "uuid",
      "title": "string",
      "recordingAt": "ISO 8601",
      "duration": 1902
    },
    "transcription": {
      "transcription": {
        "text": "full concatenated text",
        "segments": [
          {
            "text": "...",
            "start": 0.8,
            "end": 15.5,
            "speaker": "SPEAKER_01",
            "originalText": "..."
          }
        ]
      }
    },
    "summarizations": {
      "{uuid}": {
        "v2": {
          "summary": {
            "markdown": "## Summary\n\nKey points..."
          },
          "actionItems": {
            "actions": [
              {
                "title": "Follow up with X",
                "description": "...",
                "status": "TODO"
              }
            ]
          }
        }
      }
    }
  }
}
```

### Claude API (for AI Notes generation)
- Model: `claude-3-5-sonnet-20241022` (latest, best balance of quality/cost)
- Endpoint: Will use official Python SDK
- Cost: ~$0.01-0.02 per recording

## Project structure to create
H:\My Drive\Hey Pocket Archive
├── pocket_sync.py              (Main script)
├── .env                        (API keys — GITIGNORED)
├── .env.example                (Template showing required env vars)
├── .gitignore
├── requirements.txt            (Python dependencies)
├── README.md                   (Setup + usage instructions)
├── state.json                  (Tracks last run timestamp + processed IDs)
│
├── 01_Original_Notes/          (Created automatically on first run)
├── 02_Transcripts/
├── 03_Recordings/
├── 04_AI_Notes/
├── 05_Calendar_Events/         (Optional: .ics files for action items)
│
└── _logs/                       (Created automatically)
└── sync_YYYY-MM-DD.log     (Per-day logs)

## What the script must do

### Startup
1. Load `.env` file → extract `POCKET_API_KEY` and `CLAUDE_API_KEY`
2. Fail with clear error if either key is missing
3. Load `state.json` to find `last_run_timestamp`
   - If `state.json` doesn't exist, assume it's the first run (fetch everything)
4. Create all 4 folders if they don't exist
5. Create `_logs` folder if it doesn't exist

### Main sync loop
For each execution (run this every night at a scheduled time):

1. **Fetch list of new recordings** since `last_run_timestamp`
   - Handle pagination (loop until `has_more` is false)
   - Filter to only recordings with `state: "completed"`
   
2. **For each new recording:**
   - Fetch full recording data (transcript + summarizations)
   - Download audio MP3 to `03_Recordings/`
   
   - **Extract and save Original Notes** → `01_Original_Notes/YYYY-MM-DD_Title.md`
     - Extract from `summarizations[key].v2.summary.markdown`
     - Add metadata (recording ID, duration, date)
   
   - **Extract and save Transcript** → `02_Transcripts/YYYY-MM-DD_Title.md`
     - Build from `transcription.transcription.segments`
     - Format: `**SPEAKER_01** (0:34): text here`
     - Include all segments in order
   
   - **Generate and save AI Notes** → `04_AI_Notes/YYYY-MM-DD_Title.md`
     - Call Claude API with prompt:
   You are a professional meeting analyst. I have a transcript and Hey Pocket's AI summary of a conversation.
   
   Transcript:
   {full_transcript_text}
   
   Hey Pocket Summary:
   {original_notes}
   
   Create a detailed, well-structured analysis that includes:
   - Clear executive summary (2-3 paragraphs)
   - Key discussion points (as bullet list)
   - Decision made (if any)
   - Action items with owners (if any)
   - Key quotes or insights (if notable)
   - Any tables or structured data if relevant
   
   Format as clean Markdown.
     - Save response to file
   
   - **Extract action items** → `05_Calendar_Events/YYYY-MM-DD_*.ics` (optional)
     - For each action item with a due date, create a `.ics` calendar file
     - User can import these into Google Calendar later
   
3. **Handle errors gracefully:**
   - If one recording fails (e.g., Claude API error), log it and continue with next
   - Don't update `state.json` if any failures occurred
   - Report failures clearly in log
   
4. **Update state.json** on success:
   - Set `last_run_timestamp` to current time
   - Append processed recording IDs to `processed_ids` array (to avoid re-processing)
   
5. **Log all actions:**
   - Create log file: `_logs/sync_YYYY-MM-DD.log`
   - Log: start time, each recording processed, any errors, end time
   - Example: `2026-04-25 21:00:15 | Fetching list... | Found 3 new recordings`

### Rate limiting
- Add 1-second delay between Claude API calls (don't hammer the API)
- Add 0.5-second delay between Hey Pocket API calls

## Environment variables (.env)
POCKET_API_KEY=sk_your_hey_pocket_api_key_here
CLAUDE_API_KEY=sk-ant-your_claude_api_key_here
EXPORT_FOLDER=H:\My Drive\Hey Pocket Archive
LOG_FOLDER=_logs

## Dependencies (requirements.txt)
requests==2.31.0
python-dotenv==1.0.0
anthropic==0.28.0

## Error handling & edge cases

1. **API key invalid:** Fail immediately with helpful message
2. **Network error:** Retry up to 3 times with exponential backoff
3. **Recording has no transcript:** Still save notes/recording, skip transcript file
4. **Recording has no summary:** Generate from transcript using Claude
5. **Audio download fails:** Log warning, continue with metadata files
6. **Claude API rate limit hit:** Queue for retry tomorrow
7. **File already exists:** Skip (don't re-export same recording)

## Filename safety

All filenames must be filesystem-safe:
- Replace `/ \ : * ? " < > |` with `-`
- Keep dates as `YYYY-MM-DD` prefix (sortable, readable)
- Example: `2026-04-25_Verizon_Promotion_Call.md`

## Testing strategy

Before running nightly:
1. Test with `--dry-run` flag: fetch but don't save files
2. Test with `--test-count=1`: process only 1 recording
3. Manual run: `python pocket_sync.py`
4. Check that all 4 folders have content
5. Check that `state.json` was updated
6. Check that log file was created

## Future enhancements (don't build now, design for these)

1. **Google Calendar integration:** Auto-add action items to Google Calendar via API
2. **Notion integration:** Push summaries to a Notion database
3. **Email digest:** Send daily summary email of new recordings
4. **Search index:** Build local search across all transcripts
5. **Windows Task Scheduler integration:** Auto-schedule nightly runs

## Important constraints

- **API key security:** Never log API keys, never commit `.env` file
- **Data integrity:** Never delete or overwrite existing files
- **Fault tolerance:** Script must be resumable — if interrupted, next run picks up where it left off
- **No external services:** Only use Hey Pocket API + Claude API, no third-party sync services
- **Google Drive friendly:** All files are plain text (markdown/MP3), Google Drive can sync them to your phone

---

## Questions for Claude Code before building

Before you start, confirm:
1. Is the folder structure clear?
2. Is the markdown format for each folder clear?
3. Should I add Windows Task Scheduler setup instructions to README?
4. Should the script create a `.ics` calendar file for each action item? (Optional feature)