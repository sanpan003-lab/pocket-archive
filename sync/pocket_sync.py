#!/usr/bin/env python3
"""
PocketSync — automated Hey Pocket export with Claude AI summaries.

Usage:
    python pocket_sync.py                   # normal nightly run
    python pocket_sync.py --dry-run         # preview only, no files written
    python pocket_sync.py --test-count 1    # process only 1 recording
    python pocket_sync.py --full-sync       # ignore state.json, reprocess all
"""

import os
import sys
import json
import time
import argparse
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
import anthropic
from tqdm import tqdm
from icalendar import Calendar, Todo

try:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.lib import colors as rl_colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        HRFlowable, PageBreak,
    )
    from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon, Circle
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.graphics.charts.piecharts import Pie
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

POCKET_BASE_URL = "https://public.heypocketai.com/api/v1"

OUTPUT_FOLDERS = [
    "01_Original_Notes",
    "02_Transcripts",
    "03_Recordings",
    "04_AI_Notes",
    "05_Calendar_Events",
]

AI_NOTES_PROMPT = """\
You are generating enhanced AI notes for a voice recording transcript/summary. \
Create structured markdown with visualizations where relevant.

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

```json
{{
  "type": "timeline",
  "title": "Action Timeline",
  "events": [
    {{"date": "YYYY-MM-DD", "label": "Task name", "status": "pending"}},
    {{"date": "YYYY-MM-DD", "label": "Deadline", "status": "critical"}}
  ]
}}
```

### 4. Decisions & Options
ALWAYS include this section. Identify the central decision, trade-off, or open question from the recording. If no explicit decision exists, frame the most likely one. You MUST output this JSON block:

```json
{{
  "type": "decision_tree",
  "title": "Decision Options",
  "root": {{
    "question": "Main decision to make?",
    "yes": {{"action": "If yes: what to do", "outcome": "positive"}},
    "no": {{"action": "If no: what to do", "outcome": "neutral"}}
  }}
}}
```

### 5. Metrics & Data
ALWAYS include this section. Extract any numbers, counts, percentages, durations, or quantities mentioned. If the content is qualitative, estimate relative values (e.g. priority levels, effort scores). Choose bar_chart OR pie_chart — whichever fits better. You MUST output one of these JSON blocks:

Bar Chart:
```json
{{
  "type": "bar_chart",
  "title": "Chart title",
  "data": [
    {{"label": "Category 1", "value": 45}},
    {{"label": "Category 2", "value": 62}}
  ]
}}
```

Pie Chart:
```json
{{
  "type": "pie_chart",
  "title": "Chart title",
  "data": [
    {{"label": "Category 1", "value": 40}},
    {{"label": "Category 2", "value": 60}}
  ]
}}
```

### 6. Process & Workflow
ALWAYS include this section. Map out the sequence of steps, events, or actions discussed in the recording as a flowchart. Even a simple 3-step summary of the conversation flow is valid. You MUST output this JSON block:

```json
{{
  "type": "flowchart",
  "title": "Process name",
  "steps": [
    {{"id": 1, "label": "Step 1", "next": 2}},
    {{"id": 2, "label": "Step 2", "next": 3}},
    {{"id": 3, "label": "Step 3", "next": null}}
  ]
}}
```

## Rules

- ALWAYS include Executive Summary and Key Points — these are mandatory
- JSON visualization blocks are REQUIRED, not optional
- For every section (Timeline, Decisions, Metrics, Process), output the JSON block even if the data is minimal — use estimated or placeholder values if needed rather than omitting the block
- Every AI note MUST contain at least 2-3 JSON visualization blocks
- If a section could apply even loosely to the content, include it
- All JSON must be valid and properly formatted
- Use realistic data extracted from the transcript
- Keep titles concise (under 50 chars)
- Dates in timelines must be ISO format (YYYY-MM-DD)
- Status values: "pending", "completed", "critical"
- Outcome values: "positive", "neutral", "negative"
- Flowchart steps should be sequential with next pointers (last step has next: null)\
"""

# Maps Hey Pocket action status → iCalendar VTODO status
ICAL_STATUS_MAP = {
    "TODO": "NEEDS-ACTION",
    "DONE": "COMPLETED",
    "IN_PROGRESS": "IN-PROCESS",
}


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

_logger = logging.getLogger("pocketsync")


def log(message: str) -> None:
    """Write a pipe-delimited log entry to stdout and the log file."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts} | {message}"
    print(line)
    _logger.info(line)


def setup_file_logging(log_folder: Path) -> None:
    """Add a file handler to the logger after the log folder is known."""
    log_file = log_folder / f"sync_{datetime.now().strftime('%Y-%m-%d')}.log"
    handler = logging.FileHandler(log_file, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(message)s"))
    _logger.addHandler(handler)
    _logger.setLevel(logging.INFO)


# ---------------------------------------------------------------------------
# Filename helpers
# ---------------------------------------------------------------------------

def safe_filename(title: str) -> str:
    """Replace filesystem-unsafe characters and collapse whitespace."""
    sanitized = re.sub(r'[/\\:*?"<>|]', "-", title)
    sanitized = re.sub(r"\s+", "_", sanitized.strip())
    return sanitized[:100]  # cap for Windows MAX_PATH safety


def make_filename(recording_at: str, title: str, ext: str) -> str:
    """Return 'YYYY-MM-DD_Safe_Title.ext' from an ISO 8601 datetime string."""
    date_prefix = recording_at[:10]  # "2026-04-25"
    return f"{date_prefix}_{safe_filename(title)}{ext}"


def format_timestamp(seconds: float) -> str:
    """Convert 94.3 seconds → '1:34'."""
    m, s = divmod(int(seconds), 60)
    return f"{m}:{s:02d}"


# ---------------------------------------------------------------------------
# State management
# ---------------------------------------------------------------------------

def load_state(state_path: Path) -> dict:
    if state_path.exists():
        with open(state_path, encoding="utf-8") as f:
            return json.load(f)
    return {"last_run_timestamp": None, "processed_ids": []}


def save_state(state_path: Path, state: dict) -> None:
    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Hey Pocket API client
# ---------------------------------------------------------------------------

class PocketAPI:
    def __init__(self, api_key: str, delay: float, max_retries: int):
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {api_key}"
        self.delay = delay
        self.max_retries = max_retries

    def _request(self, method: str, path: str, **kwargs) -> dict:
        """Make an API request with exponential-backoff retry."""
        url = f"{POCKET_BASE_URL}{path}"
        last_exc = None

        for attempt in range(1, self.max_retries + 1):
            try:
                resp = self.session.request(method, url, timeout=30, **kwargs)
                resp.raise_for_status()
                return resp.json()

            except requests.exceptions.HTTPError as exc:
                status = exc.response.status_code
                if status == 401:
                    sys.exit(
                        "ERROR: Hey Pocket API key rejected (401). "
                        "Check POCKET_API_KEY in your .env file."
                    )
                if status == 429:
                    wait = 60  # back off a full minute on rate limit
                    log(f"Rate limited by Hey Pocket API. Waiting {wait}s...")
                    time.sleep(wait)
                    last_exc = exc
                    continue
                if attempt == self.max_retries:
                    raise
                last_exc = exc

            except requests.exceptions.RequestException as exc:
                if attempt == self.max_retries:
                    raise
                last_exc = exc

            wait = 2 ** attempt
            log(
                f"Request failed (attempt {attempt}/{self.max_retries}), "
                f"retrying in {wait}s: {last_exc}"
            )
            time.sleep(wait)

        raise last_exc  # should not reach here, but satisfies type checkers

    def get_all_recordings(self) -> list:
        """Fetch every recording across all pages."""
        recordings = []
        page = 1
        while True:
            log(f"Fetching recordings page {page}...")
            data = self._request("GET", "/public/recordings", params={"page": page})
            recordings.extend(data["data"])
            pagination = data.get("pagination", {})
            if not pagination.get("has_more", False):
                break
            page += 1
            time.sleep(self.delay)
        return recordings

    def get_recording(self, recording_id: str) -> dict:
        """Fetch full recording with transcript and summarizations."""
        time.sleep(self.delay)
        data = self._request(
            "GET",
            f"/public/recordings/{recording_id}",
            params={
                "include_transcript": "true",
                "include_summarizations": "true",
            },
        )
        return data["data"]

    def download_audio(self, recording_id: str, dest: Path) -> bool:
        """
        Fetch a fresh signed URL then immediately download the MP3.
        On 400/403, regenerates a fresh signed URL and retries up to
        self.max_retries times with exponential backoff (1s, 2s, 4s…).
        Supports resuming partial files via HTTP Range headers.
        Returns True on success.
        """
        for attempt in range(1, self.max_retries + 1):
            if attempt > 1:
                wait = 2 ** (attempt - 1)  # 1s, 2s, 4s…
                log(
                    f"Retry {attempt - 1}/{self.max_retries - 1}: "
                    f"Fetching fresh signed URL for {dest.name} "
                    f"(waiting {wait}s)..."
                )
                time.sleep(wait)

            # ── Fetch a fresh signed URL on every attempt ─────────────────
            time.sleep(self.delay)
            try:
                data = self._request(
                    "GET", f"/public/recordings/{recording_id}/audio-url"
                )
                signed_url = data.get("data", {}).get("signed_url")
            except Exception as exc:
                log(f"Could not retrieve audio URL for {recording_id}: {exc}")
                if attempt == self.max_retries:
                    return False
                continue

            if not signed_url:
                log(f"No signed_url in audio-url response for {recording_id}")
                return False

            # ── Download immediately before the URL can expire ────────────
            existing_bytes = dest.stat().st_size if dest.exists() else 0
            # Use plain requests.get — NOT self.session — so the Hey Pocket
            # Authorization header is not sent to S3. Signed URLs carry auth
            # in their query parameters; an extra Authorization header causes
            # S3 to return 400 (signature mismatch).
            dl_headers = {"Range": f"bytes={existing_bytes}-"} if existing_bytes else {}

            try:
                resp = requests.get(
                    signed_url, headers=dl_headers, stream=True, timeout=120
                )

                if resp.status_code == 416:
                    # Range Not Satisfiable → file is already fully downloaded
                    log(f"Audio already complete: {dest.name}")
                    return True

                if resp.status_code in (400, 403):
                    log(
                        f"Audio URL rejected ({resp.status_code}) for {dest.name} "
                        f"(attempt {attempt}/{self.max_retries}) — "
                        f"{'retrying with fresh URL...' if attempt < self.max_retries else 'all retries exhausted.'}"
                    )
                    if attempt < self.max_retries:
                        continue  # loop back → fetch a fresh signed URL
                    return False

                resp.raise_for_status()

                total = int(resp.headers.get("content-length", 0)) + existing_bytes
                write_mode = "ab" if existing_bytes else "wb"

                with open(dest, write_mode) as fh, tqdm(
                    total=total,
                    initial=existing_bytes,
                    unit="B",
                    unit_scale=True,
                    unit_divisor=1024,
                    desc=dest.name,
                    leave=False,
                ) as bar:
                    for chunk in resp.iter_content(chunk_size=8192):
                        fh.write(chunk)
                        bar.update(len(chunk))

                log(f"Downloaded: {dest.name}")
                return True

            except Exception as exc:
                log(
                    f"Audio download error for {dest.name} "
                    f"(attempt {attempt}/{self.max_retries}): {exc}"
                )
                if attempt == self.max_retries:
                    return False
                # fall through to next iteration → fresh URL on retry

        return False  # all retries exhausted


# ---------------------------------------------------------------------------
# Claude API client
# ---------------------------------------------------------------------------

class ClaudeAPI:
    def __init__(self, api_key: str, model: str, delay: float):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model
        self.delay = delay

    def generate_ai_notes(
        self, transcript: str, original_notes: str, title: str
    ) -> str:
        """Call Claude and return structured markdown with embedded JSON visualizations."""
        prompt = AI_NOTES_PROMPT.format(
            transcript=transcript or "(No transcript available)",
            original_notes=original_notes or "(No Hey Pocket summary available)",
        )
        log(
            f"Sending prompt to Claude — "
            f"{len(prompt)} chars, "
            f"transcript: {len(transcript or '')} chars, "
            f"summary: {len(original_notes or '')} chars"
        )
        time.sleep(self.delay)
        message = self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text


# ---------------------------------------------------------------------------
# Summarization extraction
# ---------------------------------------------------------------------------

def extract_summarization(summarizations: dict) -> tuple:
    """
    Pull the markdown summary and action items out of the summarizations dict.
    The dict can have multiple UUID keys; we use the first one that has v2 data.
    Returns (summary_markdown: str, actions: list).
    """
    for _, summ in summarizations.items():
        v2 = summ.get("v2", {})
        summary_md = v2.get("summary", {}).get("markdown", "")
        actions = v2.get("actionItems", {}).get("actions", [])
        if summary_md or actions:
            return summary_md, actions
    return "", []


# ---------------------------------------------------------------------------
# File writers — each checks for existing files and respects --dry-run
# ---------------------------------------------------------------------------

def write_original_notes(
    folder: Path,
    filename: str,
    recording: dict,
    summary_md: str,
    dry_run: bool,
    rec_id: str = "",
    recording_at: str = "",
    duration_sec: float = 0.0,
    title: str = "",
) -> None:
    path = folder / filename
    if path.exists():
        log(f"Skipping (exists): {path.name}")
        return
    if dry_run:
        log(f"[DRY RUN] Would write: {path.name}")
        return

    # Duration — caller supplies best guess; fall back to recording dict field names
    if not duration_sec:
        raw = (
            recording.get("durationSeconds")
            or recording.get("audioDuration")
            or recording.get("duration")
            or 0
        )
        try:
            duration_sec = float(raw)
        except (TypeError, ValueError):
            duration_sec = 0.0
    if duration_sec > 0:
        duration_min = int(duration_sec) // 60
        duration_rem = int(duration_sec) % 60
        duration_str = f"{duration_min} min {duration_rem:02d} sec"
    else:
        duration_str = "N/A"

    # Date — prefer value from bulk list; fall back to recording dict field names
    date_raw = (
        recording_at
        or recording.get("recordingDate")
        or recording.get("recordingAt")
        or ""
    )
    _MONTHS = [
        "", "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ]
    try:
        # Parse YYYY-MM-DD portion (always present)
        y, mo, d = int(date_raw[0:4]), int(date_raw[5:7]), int(date_raw[8:10])
        date_str = f"{_MONTHS[mo]} {d}, {y}"
        # Append time when available (YYYY-MM-DDTHH:MM...)
        if len(date_raw) >= 16 and "T" in date_raw:
            h, m = int(date_raw[11:13]), int(date_raw[14:16])
            ampm = "AM" if h < 12 else "PM"
            date_str += f" at {h % 12 or 12}:{m:02d} {ampm}"
    except (ValueError, IndexError, TypeError):
        date_str = date_raw[:10] if date_raw else "N/A"

    # ID — prefer value from bulk list
    id_str = rec_id or recording.get("recordingId") or recording.get("id") or "N/A"

    log(f"Original notes — date: {date_str}, duration: {duration_str}, id: {id_str}")

    title_str = title or recording.get("title") or recording.get("recordingTitle") or "Untitled"

    header = (
        f"# {title_str}\n\n"
        f"- **Date:** {date_str}\n"
        f"- **Duration:** {duration_str}\n"
        f"- **Recording ID:** {id_str}\n\n"
        f"---\n\n"
    )
    path.write_text(header + (summary_md or "_No summary available._"), encoding="utf-8")
    log(f"Saved: {path.name}")


def write_ai_notes(
    folder: Path,
    filename: str,
    ai_content: str,
    dry_run: bool,
) -> None:
    path = folder / filename
    if path.exists():
        log(f"Skipping (exists): {path.name}")
        return
    if dry_run:
        log(f"[DRY RUN] Would write: {path.name}")
        return
    path.write_text(ai_content, encoding="utf-8")
    log(f"Saved: {path.name}")


def write_calendar_events(
    folder: Path,
    base_name: str,
    actions: list,
    recording_at: str,
    dry_run: bool,
) -> None:
    """Create one .ics VTODO file per action item."""
    try:
        rec_date = datetime.fromisoformat(
            recording_at.replace("Z", "+00:00")
        ).date()
    except ValueError:
        rec_date = datetime.now().date()

    for i, action in enumerate(actions, 1):
        filename = f"{base_name}_action_{i}.ics"
        path = folder / filename
        if path.exists():
            continue
        if dry_run:
            log(f"[DRY RUN] Would write: {filename}")
            continue

        cal = Calendar()
        cal.add("prodid", "-//PocketSync//EN")
        cal.add("version", "2.0")

        todo = Todo()
        todo.add("summary", action.get("title", "Untitled Action Item"))
        description = action.get("description", "")
        pocket_status = action.get("status", "TODO")
        if description:
            todo.add("description", f"{description}\n\nOriginal status: {pocket_status}")
        todo.add("dtstart", rec_date)
        todo.add("status", ICAL_STATUS_MAP.get(pocket_status, "NEEDS-ACTION"))

        cal.add_component(todo)
        path.write_bytes(cal.to_ical())
        log(f"Saved: {filename}")


# ---------------------------------------------------------------------------
# PDF generation (requires: pip install reportlab)
# ---------------------------------------------------------------------------

def _parse_ai_notes_md(text: str) -> dict:
    """Extract executive summary, key points, and typed JSON visualizations."""
    result = {"executive_summary": "", "key_points": [], "visualizations": {}}

    # Collect every ```json { "type": "..." } ``` block, keyed by type
    for raw in re.findall(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL):
        try:
            obj = json.loads(raw)
            viz_type = obj.get("type")
            if viz_type:
                result["visualizations"][viz_type] = obj
        except json.JSONDecodeError:
            pass

    # Strip JSON blocks before section parsing so we only get prose
    clean = re.sub(r"```json.*?```", "", text, flags=re.DOTALL)
    for m in re.finditer(
        r"###?\s*\d+\.\s*(.+?)\n(.*?)(?=###?\s*\d+\.|\Z)", clean, re.DOTALL
    ):
        heading = m.group(1).strip().lower()
        content = m.group(2).strip()
        if "executive" in heading:
            result["executive_summary"] = content
        elif "key" in heading and "point" in heading:
            result["key_points"] = [
                line.lstrip("-•* ").strip()
                for line in content.splitlines()
                if line.strip() and line.strip()[0] in "-•*"
            ]

    return result


def _header_table(text: str) -> "Table":
    """Full-width navy background section header."""
    style = ParagraphStyle(
        "hdr", fontName="Helvetica-Bold", fontSize=12,
        textColor=rl_colors.white,
    )
    tbl = Table([[Paragraph(text, style)]], colWidths=[6.3 * inch])
    tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), rl_colors.HexColor("#1a2744")),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
    ]))
    return tbl


def _drawing_timeline(viz: dict) -> Drawing:
    events = viz.get("events", [])
    if not events:
        return None
    row_h = 46
    h = max(120, len(events) * row_h + 40)
    d = Drawing(460, h)
    BLUE = rl_colors.HexColor("#2563eb")
    NAVY = rl_colors.HexColor("#1a2744")
    STATUS_COLOR = {
        "completed": rl_colors.HexColor("#10b981"),
        "pending":   rl_colors.HexColor("#f59e0b"),
        "critical":  rl_colors.HexColor("#ef4444"),
    }
    lx = 115  # x position of the vertical spine
    d.add(Line(lx, 10, lx, h - 20, strokeColor=BLUE, strokeWidth=2))
    for i, ev in enumerate(events):
        y = h - 30 - i * row_h
        color = STATUS_COLOR.get(ev.get("status", "pending"), BLUE)
        d.add(Circle(lx, y, 7, fillColor=color, strokeColor=color))
        d.add(String(lx - 12, y - 4, ev.get("date", ""),
                     textAnchor="end", fontSize=8,
                     fillColor=rl_colors.HexColor("#6b7280")))
        d.add(String(lx + 18, y - 4, ev.get("label", ""),
                     fontSize=9, fillColor=NAVY))
    return d


def _drawing_decision_tree(viz: dict) -> Drawing:
    root = viz.get("root", {})
    if not root:
        return None
    NAVY  = rl_colors.HexColor("#1a2744")
    BLUE  = rl_colors.HexColor("#2563eb")
    GREEN = rl_colors.HexColor("#10b981")
    RED   = rl_colors.HexColor("#ef4444")
    LGRAY = rl_colors.HexColor("#f5f7fa")

    d = Drawing(480, 195)

    def box(x, y, bw, bh, text, stroke):
        d.add(Rect(x, y, bw, bh, fillColor=LGRAY, strokeColor=stroke,
                   strokeWidth=1.5, rx=4, ry=4))
        label = (text[:30] + "…") if len(text) > 30 else text
        d.add(String(x + bw / 2, y + bh / 2 - 5, label,
                     textAnchor="middle", fontSize=8, fillColor=NAVY))

    rw, rh = 220, 44
    rx, ry = (480 - rw) / 2, 140
    box(rx, ry, rw, rh, root.get("question", "Decision?"), BLUE)

    lw, lh = 175, 40
    yes_x, yes_y = 15, 55
    box(yes_x, yes_y, lw, lh, root.get("yes", {}).get("action", "Yes path"), GREEN)
    d.add(String(yes_x + lw / 2, yes_y + lh + 7, "YES",
                 textAnchor="middle", fontSize=7, fillColor=GREEN))
    d.add(Line(rx + rw * 0.25, ry, yes_x + lw / 2, yes_y + lh,
               strokeColor=GREEN, strokeWidth=1.2))

    no_x, no_y = 480 - lw - 15, 55
    box(no_x, no_y, lw, lh, root.get("no", {}).get("action", "No path"), RED)
    d.add(String(no_x + lw / 2, no_y + lh + 7, "NO",
                 textAnchor="middle", fontSize=7, fillColor=RED))
    d.add(Line(rx + rw * 0.75, ry, no_x + lw / 2, no_y + lh,
               strokeColor=RED, strokeWidth=1.2))

    return d


def _drawing_bar_chart(viz: dict) -> Drawing:
    data = viz.get("data", [])
    if not data:
        return None
    d = Drawing(450, 220)
    chart = VerticalBarChart()
    chart.x, chart.y = 55, 40
    chart.width, chart.height = 375, 150
    chart.data = [[item.get("value", 0) for item in data]]
    chart.categoryAxis.categoryNames = [item.get("label", "") for item in data]
    chart.categoryAxis.labels.fontSize = 8
    chart.valueAxis.labels.fontSize = 8
    chart.bars[0].fillColor = rl_colors.HexColor("#2563eb")
    d.add(String(225, 210, viz.get("title", ""),
                 textAnchor="middle", fontSize=10,
                 fillColor=rl_colors.HexColor("#1a2744")))
    d.add(chart)
    return d


def _drawing_pie_chart(viz: dict) -> Drawing:
    data = viz.get("data", [])
    if not data:
        return None
    PALETTE = [
        "#2563eb", "#10b981", "#f59e0b", "#ef4444",
        "#8b5cf6", "#ec4899", "#06b6d4",
    ]
    d = Drawing(400, 230)
    pie = Pie()
    pie.x, pie.y = 55, 30
    pie.width = pie.height = 160
    pie.data = [item.get("value", 0) for item in data]
    total = sum(pie.data) or 1
    pie.labels = [
        f"{item.get('label', '')} ({item.get('value', 0) / total * 100:.0f}%)"
        for item in data
    ]
    pie.sideLabels = True
    for i in range(len(data)):
        pie.slices[i].fillColor = rl_colors.HexColor(PALETTE[i % len(PALETTE)])
        pie.slices[i].strokeColor = rl_colors.white
        pie.slices[i].strokeWidth = 1
    d.add(String(200, 218, viz.get("title", ""),
                 textAnchor="middle", fontSize=10,
                 fillColor=rl_colors.HexColor("#1a2744")))
    d.add(pie)
    return d


def _drawing_flowchart(viz: dict) -> Drawing:
    steps = viz.get("steps", [])
    if not steps:
        return None
    BLUE  = rl_colors.HexColor("#2563eb")
    NAVY  = rl_colors.HexColor("#1a2744")
    LGRAY = rl_colors.HexColor("#f5f7fa")

    max_per_row = 5
    rows = [steps[i: i + max_per_row] for i in range(0, len(steps), max_per_row)]
    bw, bh, gx, gy = 105, 38, 26, 52
    w = max_per_row * bw + (max_per_row - 1) * gx + 20
    h = len(rows) * (bh + gy) + 20
    d = Drawing(w, h)

    pos = {}  # step id → (x, y) top-left corner
    for ri, row in enumerate(rows):
        used_w = len(row) * bw + (len(row) - 1) * gx
        start_x = (w - used_w) / 2
        y = h - 20 - (ri + 1) * (bh + gy) + gy
        for ci, step in enumerate(row):
            x = start_x + ci * (bw + gx)
            pos[step["id"]] = (x, y)
            d.add(Rect(x, y, bw, bh, fillColor=LGRAY, strokeColor=BLUE,
                       strokeWidth=1.5, rx=5, ry=5))
            label = step.get("label", f"Step {step['id']}")
            if len(label) > 13:
                label = label[:10] + "…"
            d.add(String(x + bw / 2, y + bh / 2 - 5, label,
                         textAnchor="middle", fontSize=8, fillColor=NAVY))

    for step in steps:
        nxt = step.get("next")
        if not nxt or step["id"] not in pos or nxt not in pos:
            continue
        sx, sy = pos[step["id"]]
        ex, ey = pos[nxt]
        smx, smy = sx + bw, sy + bh / 2
        emx, emy = ex, ey + bh / 2
        if abs(smy - emy) < 5:
            d.add(Line(smx, smy, emx, emy, strokeColor=BLUE, strokeWidth=1.5))
            d.add(Polygon([emx, emy, emx - 8, emy + 4, emx - 8, emy - 4],
                          fillColor=BLUE, strokeColor=BLUE))
        else:
            mid_x = sx + bw / 2
            d.add(Line(mid_x, sy, mid_x, ey + bh, strokeColor=BLUE, strokeWidth=1.5))
            d.add(Polygon([mid_x, ey + bh, mid_x - 4, ey + bh + 8, mid_x + 4, ey + bh + 8],
                          fillColor=BLUE, strokeColor=BLUE))
    return d


_VIZ_RENDERERS = {
    "timeline":      _drawing_timeline,
    "decision_tree": _drawing_decision_tree,
    "bar_chart":     _drawing_bar_chart,
    "pie_chart":     _drawing_pie_chart,
    "flowchart":     _drawing_flowchart,
}
_VIZ_LABELS = {
    "timeline":      "Action Timeline",
    "decision_tree": "Decision Analysis",
    "bar_chart":     "Metrics",
    "pie_chart":     "Distribution",
    "flowchart":     "Process Workflow",
}


def generate_pdf(
    folder: Path,
    filename: str,
    recording: dict,
    recording_at: str,
    ai_notes_md: str,
    dry_run: bool,
) -> None:
    if not REPORTLAB_AVAILABLE:
        log("WARNING: reportlab not installed — PDF skipped. Run: pip install reportlab")
        return
    path = folder / filename
    if path.exists():
        log(f"Skipping (exists): {path.name}")
        return
    if not ai_notes_md:
        return
    if dry_run:
        log(f"[DRY RUN] Would generate PDF: {path.name}")
        return
    try:
        _build_pdf(path, recording, recording_at, ai_notes_md)
        log(f"Saved: {path.name}")
    except Exception as exc:
        log(f"PDF generation failed for {path.name}: {exc}")


def _build_pdf(path: Path, recording: dict, recording_at: str, md: str) -> None:
    NAVY  = rl_colors.HexColor("#1a2744")
    BLUE  = rl_colors.HexColor("#2563eb")
    LGRAY = rl_colors.HexColor("#f5f7fa")
    DGRAY = rl_colors.HexColor("#374151")
    MGRAY = rl_colors.HexColor("#e5e7eb")

    doc = SimpleDocTemplate(
        str(path), pagesize=letter,
        leftMargin=0.85 * inch, rightMargin=0.85 * inch,
        topMargin=0.85 * inch, bottomMargin=0.85 * inch,
    )

    base = getSampleStyleSheet()
    S = {
        "app":    ParagraphStyle("app", fontName="Helvetica", fontSize=10,
                                 textColor=BLUE, spaceAfter=4),
        "title":  ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=22,
                                 textColor=NAVY, spaceAfter=10, leading=28),
        "meta":   ParagraphStyle("meta", fontName="Helvetica", fontSize=11,
                                 textColor=DGRAY, spaceAfter=4),
        "body":   ParagraphStyle("body", fontName="Helvetica", fontSize=10,
                                 textColor=DGRAY, leading=15, spaceAfter=6),
        "bullet": ParagraphStyle("bullet", fontName="Helvetica", fontSize=10,
                                 textColor=DGRAY, leftIndent=16, leading=14, spaceAfter=4),
        "vlabel": ParagraphStyle("vlabel", fontName="Helvetica-Bold", fontSize=10,
                                 textColor=BLUE, spaceAfter=6, spaceBefore=10),
        "tkey":   ParagraphStyle("tkey", fontName="Helvetica-Bold", fontSize=9,
                                 textColor=NAVY),
        "tval":   ParagraphStyle("tval", fontName="Helvetica", fontSize=9,
                                 textColor=DGRAY),
    }

    parsed = _parse_ai_notes_md(md)
    duration_sec = recording.get("duration", 0)
    duration_str = f"{duration_sec // 60} min {duration_sec % 60:02d} sec"
    date_str     = recording_at[:10] if recording_at else "Unknown"
    title        = recording.get("title", "Untitled Recording")
    story        = []

    # ── Cover page ──────────────────────────────────────────────────────────
    story.append(Spacer(1, 0.5 * inch))
    story.append(Paragraph("PocketSync AI Notes", S["app"]))
    story.append(Spacer(1, 0.15 * inch))
    story.append(Paragraph(title, S["title"]))
    story.append(HRFlowable(width="100%", thickness=2, color=BLUE, spaceAfter=14))
    story.append(Paragraph(f"<b>Date:</b>        {date_str}", S["meta"]))
    story.append(Paragraph(f"<b>Duration:</b>    {duration_str}", S["meta"]))
    story.append(Paragraph(f"<b>Recording ID:</b> {recording.get('id', 'N/A')}", S["meta"]))
    story.append(PageBreak())

    # ── Executive Summary ───────────────────────────────────────────────────
    story.append(_header_table("Executive Summary"))
    story.append(Spacer(1, 0.1 * inch))
    story.append(Paragraph(
        parsed["executive_summary"] or "(No executive summary extracted.)", S["body"]
    ))

    # ── Key Points ──────────────────────────────────────────────────────────
    story.append(Spacer(1, 0.15 * inch))
    story.append(_header_table("Key Points"))
    story.append(Spacer(1, 0.1 * inch))
    if parsed["key_points"]:
        for pt in parsed["key_points"]:
            story.append(Paragraph(f"• {pt}", S["bullet"]))
    else:
        story.append(Paragraph("(No key points extracted.)", S["body"]))

    # ── Visualizations ──────────────────────────────────────────────────────
    vizs = parsed["visualizations"]
    if vizs:
        story.append(Spacer(1, 0.15 * inch))
        story.append(_header_table("Visualizations"))
        for viz_type, renderer in _VIZ_RENDERERS.items():
            if viz_type not in vizs:
                continue
            label = _VIZ_LABELS.get(viz_type, viz_type.replace("_", " ").title())
            story.append(Spacer(1, 0.1 * inch))
            story.append(Paragraph(label, S["vlabel"]))
            try:
                drawing = renderer(vizs[viz_type])
                if drawing:
                    story.append(drawing)
            except Exception as exc:
                story.append(Paragraph(f"(Visualization error: {exc})", S["body"]))

    # ── Technical Details ───────────────────────────────────────────────────
    story.append(Spacer(1, 0.2 * inch))
    story.append(_header_table("Technical Details"))
    story.append(Spacer(1, 0.1 * inch))
    rows = [
        ("Recording ID", recording.get("id", "N/A")),
        ("Date",         date_str),
        ("Duration",     duration_str),
        ("Generated",    datetime.now().strftime("%Y-%m-%d %H:%M")),
    ]
    tbl = Table(
        [[Paragraph(k, S["tkey"]), Paragraph(v, S["tval"])] for k, v in rows],
        colWidths=[1.8 * inch, 4.5 * inch],
    )
    tbl.setStyle(TableStyle([
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [rl_colors.white, LGRAY]),
        ("GRID",           (0, 0), (-1, -1), 0.5, MGRAY),
        ("TOPPADDING",     (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING",  (0, 0), (-1, -1), 6),
        ("LEFTPADDING",    (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",   (0, 0), (-1, -1), 8),
    ]))
    story.append(tbl)

    doc.build(story)


# ---------------------------------------------------------------------------
# Single-recording orchestrator
# ---------------------------------------------------------------------------

def process_recording(
    rec_summary: dict,
    pocket: PocketAPI,
    claude: ClaudeAPI,
    folders: dict,
    dry_run: bool,
) -> bool:
    """
    Process one recording end-to-end.
    Returns True if all steps succeeded (partial failures are logged but
    don't return False unless the whole recording can't be processed).
    """
    rec_id = rec_summary["id"]
    title = rec_summary.get("title", "Untitled")
    # List endpoint uses snake_case; fall back to camelCase just in case
    recording_at = rec_summary.get("recording_at") or rec_summary.get("recordingAt", "")
    # Duration from bulk list — try every field name the API might use
    _dur_raw = (
        rec_summary.get("durationSeconds")
        or rec_summary.get("audioDuration")
        or rec_summary.get("duration")
        or 0
    )
    try:
        summary_duration_sec = float(_dur_raw)
    except (TypeError, ValueError):
        summary_duration_sec = 0.0

    log(f"--- Processing: {title}")

    try:
        # ----------------------------------------------------------------
        # Fetch full recording data
        # ----------------------------------------------------------------
        full = pocket.get_recording(rec_id)
        recording = full.get("recording", {})
        transcription = full.get("transcription", {})
        summarizations = full.get("summarizations", {})

        summary_md, actions = extract_summarization(summarizations)

        # Build plain-text transcript for Claude prompt
        # content = full text; transcriptSegments = [{speaker, start, end, text}]
        transcript_text = recording.get("content", "")
        if not transcript_text:
            segments = recording.get("transcriptSegments") or []
            transcript_text = " ".join(s.get("text", "").strip() for s in segments)

        # If there's no summary from Hey Pocket, generate one via Claude
        if not summary_md and transcript_text:
            log(f"No Hey Pocket summary found — will generate from transcript via Claude")

        # ----------------------------------------------------------------
        # Filenames
        # ----------------------------------------------------------------
        base_name  = make_filename(recording_at, title, "")
        md_name    = base_name + ".md"
        json_name  = base_name + ".json"
        mp3_name   = base_name + ".mp3"

        # ----------------------------------------------------------------
        # 01_Original_Notes
        # ----------------------------------------------------------------
        write_original_notes(folders["01"], md_name, recording, summary_md, dry_run,
                             rec_id=rec_id, recording_at=recording_at,
                             duration_sec=summary_duration_sec, title=title)

        # ----------------------------------------------------------------
        # 03_Recordings — fetch signed URL + download atomically
        # ----------------------------------------------------------------
        audio_path = folders["03"] / mp3_name
        if audio_path.exists() and audio_path.stat().st_size > 0:
            log(f"Skipping (exists): {mp3_name}")
        elif dry_run:
            log(f"[DRY RUN] Would fetch signed URL and download: {mp3_name}")
        else:
            pocket.download_audio(rec_id, audio_path)

        # ----------------------------------------------------------------
        # 04_AI_Notes — Claude-generated analysis
        # ----------------------------------------------------------------
        ai_notes_path = folders["04"] / md_name
        pdf_name      = base_name + ".pdf"
        ai_content    = None

        if ai_notes_path.exists():
            log(f"Skipping (exists): {ai_notes_path.name}")
            # Read existing markdown so we can still generate a missing PDF
            if not (folders["04"] / pdf_name).exists() and not dry_run:
                ai_content = ai_notes_path.read_text(encoding="utf-8")
        elif dry_run:
            log(f"[DRY RUN] Would call Claude to generate AI Notes for: {title}")
        else:
            log(f"Calling Claude to generate AI Notes for: {title}")
            try:
                ai_content = claude.generate_ai_notes(transcript_text, summary_md, title)
                write_ai_notes(folders["04"], md_name, ai_content, dry_run)
            except anthropic.RateLimitError:
                log(f"WARNING: Claude rate limit hit for '{title}' — will retry next run")
            except anthropic.APIError as exc:
                log(f"WARNING: Claude API error for '{title}': {exc} — will retry next run")

        generate_pdf(folders["04"], pdf_name, recording, recording_at, ai_content, dry_run)

        # ----------------------------------------------------------------
        # 05_Calendar_Events — one .ics per action item
        # ----------------------------------------------------------------
        if actions:
            log(f"Writing {len(actions)} calendar event(s) for: {title}")
            write_calendar_events(
                folders["05"], base_name, actions, recording_at, dry_run
            )

        return True

    except Exception as exc:
        log(f"ERROR: Failed to process '{title}' ({rec_id}): {exc}")
        return False


# ---------------------------------------------------------------------------
# Main sync
# ---------------------------------------------------------------------------

def sync(args: argparse.Namespace) -> None:
    load_dotenv()

    # --- Validate required env vars ---
    pocket_key = os.getenv("POCKET_API_KEY", "").strip()
    claude_key = os.getenv("CLAUDE_API_KEY", "").strip()

    if not pocket_key or pocket_key.startswith("pk_your_"):
        sys.exit(
            "ERROR: POCKET_API_KEY is missing or still set to the example value.\n"
            "Open .env and paste your real Hey Pocket API key."
        )
    if not claude_key or claude_key.startswith("sk-ant-your_"):
        sys.exit(
            "ERROR: CLAUDE_API_KEY is missing or still set to the example value.\n"
            "Open .env and paste your real Anthropic API key."
        )

    # --- Resolve paths ---
    export_folder = Path(os.getenv("EXPORT_FOLDER", ".")).expanduser().resolve()
    log_folder = Path(os.getenv("LOG_FOLDER", "_logs"))
    if not log_folder.is_absolute():
        log_folder = export_folder / log_folder
    state_path = export_folder / "state.json"

    # --- Create output folders ---
    log_folder.mkdir(parents=True, exist_ok=True)
    setup_file_logging(log_folder)

    folder_map = {
        "01": export_folder / "01_Original_Notes",
        "02": export_folder / "02_Transcripts",
        "03": export_folder / "03_Recordings",
        "04": export_folder / "04_AI_Notes",
        "05": export_folder / "05_Calendar_Events",
    }
    for folder in folder_map.values():
        folder.mkdir(parents=True, exist_ok=True)

    log("PocketSync starting")
    log(f"Export folder: {export_folder}")
    if args.dry_run:
        log("Mode: DRY RUN — no files will be written")
    if args.full_sync:
        log("Mode: FULL SYNC — ignoring state.json")

    # --- Load state ---
    state = load_state(state_path)
    if args.full_sync:
        processed_ids = set()
        last_run = None
    else:
        processed_ids = set(state.get("processed_ids", []))
        last_run = state.get("last_run_timestamp")

    if last_run:
        log(f"Last successful run: {last_run}")
    else:
        log("No previous run found — syncing all recordings")

    # --- Init API clients ---
    pocket = PocketAPI(
        api_key=pocket_key,
        delay=float(os.getenv("POCKET_API_DELAY", "0.5")),
        max_retries=int(os.getenv("MAX_RETRIES", "3")),
    )
    claude = ClaudeAPI(
        api_key=claude_key,
        model=os.getenv("CLAUDE_MODEL", "claude-3-5-sonnet-20241022"),
        delay=float(os.getenv("CLAUDE_API_DELAY", "1.0")),
    )

    # --- Fetch and filter recordings ---
    log("Fetching recordings list from Hey Pocket...")
    all_recordings = pocket.get_all_recordings()
    log(f"Total recordings in account: {len(all_recordings)}")

    new_recordings = [
        r for r in all_recordings
        if r.get("state") == "completed"
        and r["id"] not in processed_ids
        and (
            last_run is None
            or r.get("recording_at", r.get("recordingAt", "")) > last_run
        )
    ]

    if not new_recordings:
        log("No new recordings to process. All done.")
        return

    log(f"Found {len(new_recordings)} new completed recording(s) to process")

    if args.test_count:
        new_recordings = new_recordings[: args.test_count]
        log(f"--test-count {args.test_count}: limiting to {len(new_recordings)} recording(s)")

    # --- Process each recording ---
    succeeded_ids = []
    failed_titles = []

    for i, rec in enumerate(new_recordings, 1):
        log(f"[{i}/{len(new_recordings)}]")
        ok = process_recording(rec, pocket, claude, folder_map, dry_run=args.dry_run)
        if ok:
            succeeded_ids.append(rec["id"])
        else:
            failed_titles.append(rec.get("title", rec["id"]))

    # --- Update state.json ---
    if not args.dry_run:
        if not failed_titles:
            state["last_run_timestamp"] = datetime.now(timezone.utc).isoformat()
            all_processed = set(state.get("processed_ids", [])) | set(succeeded_ids)
            state["processed_ids"] = sorted(all_processed)
            save_state(state_path, state)
            log("state.json updated successfully")
        else:
            log(
                f"WARNING: {len(failed_titles)} recording(s) failed — "
                f"state.json NOT updated so they will be retried next run:"
            )
            for title in failed_titles:
                log(f"  - {title}")
    else:
        log("[DRY RUN] state.json was not modified")

    # --- Final summary ---
    log(
        f"Run complete — {len(succeeded_ids)} succeeded, "
        f"{len(failed_titles)} failed"
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="PocketSync — export Hey Pocket recordings with Claude AI summaries",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python pocket_sync.py                  # normal nightly run\n"
            "  python pocket_sync.py --dry-run        # preview, no files written\n"
            "  python pocket_sync.py --test-count 1   # process 1 recording only\n"
            "  python pocket_sync.py --full-sync      # reprocess everything\n"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch recordings but do not write any files or update state.json",
    )
    parser.add_argument(
        "--test-count",
        type=int,
        metavar="N",
        help="Process only the N most recent new recordings (useful for testing)",
    )
    parser.add_argument(
        "--full-sync",
        action="store_true",
        help="Ignore state.json and reprocess all recordings (existing files are still skipped)",
    )

    args = parser.parse_args()
    sync(args)


if __name__ == "__main__":
    main()
