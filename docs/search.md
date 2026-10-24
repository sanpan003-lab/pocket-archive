# Search, settings search and toasts (2.8.0)

## Notes search — `GET /api/find` (`search.js`)

- **Scope (security):** the pool is req.user's own store + `sharing.sharedNotes(req.user.id)` + own and shared
  projects (`sharing.sharedProjects`). Nothing else is ever read. Recordings (the Hey Pocket archive) only when
  `recordings=1` **and** `req.user.role === 'admin'`. Actions (alarms, messages…) are private and only searched with
  `type=actions` (the Actions page); shared actions never. A capture-only token (app lock) gets 403 `{ locked: true }`
  — `/api/find` is not in `CAPTURE_ROUTES`.
- **Index:** in memory, one entry per note file, kept per store folder. Every query lists the folder and re-reads only
  files whose mtime changed (and drops removed ones), so every write path is covered without hooks. Shared notes are
  indexed per query from `sharedNotes` (they're few).
- **Fields** (weight): title 8, project name 5, AI summary 4, checklist items 3, document details 3, places 3, typed
  text 2, transcript 2, photo / scan text (`mediaText`) 2, attachment names + read text 2, updates 1.
  Every word must match the start of a word somewhere (numbers match anywhere: `42.1` in `$142.18`); accents and
  case are ignored.
- **Query:** `q`, `type=notes,lists,documents,projects,recordings,actions`, `from`/`to` (YYYY-MM-DD on capturedAt),
  `project=<id>|none`, `scope=mine|shared`, `attach=1`, `category=Receipts…`, `status=open|done`, `recordings=1`.
  Filters alone (no words) list matches too.
- **Answer:** `{ q, terms, groups: { notes, lists, documents, projects, recordings, actions }, total, suggestions,
  tookMs }`. Each result has `snippet` (around the match), `matchedIn` ("Transcript", "Document details"…),
  `projectName`, `sharedFrom`, `document { type, category, label, icon }`, `done`, `attachments`. At most 30 per group.
  `suggestions`: completions of the last word from project names, stores (receipts), categories and titles.
- **Voice:** `POST /api/find/voice` (multipart `audio`, ≤ 3 MB, 60 per hour per user) → `{ text }`. Transcribed
  on the NAS with the same Gemini call as captures, written to a temp file and deleted. Nothing is saved.
- The old `GET /api/quick/search` stays for older app builds.

## Notes search — web (`components/search/`)

- `NoteSearch` (one component): `variant` bar (top of Inbox / Lists / Shared / Documents tab / Projects / Actions; the
  page's own content is `hidden` while results show), `overlay` (the header's global search), `page` (/search).
  `preset` = the page's filter (Shared → `scope: shared`, Documents → `types: ['documents']`, Actions →
  `types: ['actions']`).
- 220 ms debounce, the previous request aborted. Highlighting: `components/Highlight.jsx` (word starts, accent-safe).
- Recent searches: `lib/recentSearches.js` (localStorage `pa_recentSearches`, 8, per device). Voice:
  `lib/voiceSearch.js` (MediaRecorder up to 7 s → `/api/find/voice`; the Android WebView grants the mic through
  Capacitor's chrome client).
- Global: `SearchOverlay` (mobile top bar 🔍, desktop header pill, Ctrl+K, "/" when the page has no search box).

## Settings search (`lib/settingsIndex.js`, `components/SettingsSearch.jsx`)

- Entries: section id, title, description, synonyms, flags (`native`, `web`, `admin`, `full`, `archive`, `boost`),
  optional anchor text. Visible = the flags **and** the row really exists on the page (`findSettingElement`: the
  section's element whose text is the title — exact, then starts-with, then the shortest containing it).
- Picking: opens any `<details>` around it, fires `pa:settings-reveal`, scrolls to the row and adds `.setting-flash`
  (static outline with reduced motion). "/" focuses (web), Esc clears, ↑/↓ + Enter.
- New setting? Add a line to `ENTRIES` — the test `settings-index-test.mjs` checks the synonyms from the request.
- The box is `sticky top-14` under the top bar. That needs `main` **not** to be a scroll container: it's
  `overflow-x-clip` (it was `overflow-auto`, which silently broke every `sticky` inside it).

## Toasts (`components/Toast.jsx`, `lib/swipeDismiss.js`)

- Every pop-up goes through `Toast` (`QuickToast` is a thin wrapper; DocumentCard and Dashboard use it too). One
  `.toast-stack` portal on `<body>`: under the top bar (`top: safe-area + 4rem`; desktop also right of the sidebar via
  `--sidebar-w`), `pointer-events: none` except on the cards, newest three shown.
- ✕ top-right (44×44), swipe left/right (> 80 px) or up (> 40 px); a swipe never presses a button; tapping the
  message does nothing. The timer pauses while hovered, touched or focused. `role="alert"` for errors / review.
- Motion: Settings → Appearance → Animations (`data-motion`), else the system's reduced-motion setting.
- Undo after the toast: deleted notes keep Restore (Deleted filter / the note's toolbar). "No speech — set aside"
  recordings: Settings → Accidental recordings shows **Restore** with a countdown while the phone still keeps the
  file (`QuickRecorder.getIgnored()` / `restoreIgnored({ name })`, `AccidentalStore.kept`, 30 s).
- UpdateBanner: ✕ / swipe hides it until the app is opened again (sessionStorage); Later = until the next version.

## Tests (scratchpad, fake archive)

`search-e2e.cjs` (scope: user B never finds user A's notes until shared and loses them when unshared; fields,
filters, live index, capture token, voice errors), `fftools/s28-ui.cjs` (toasts, settings search, notes search;
desktop + 375 px, light + dark, reduced motion; user B in the UI), `settings-index-test.mjs`.
