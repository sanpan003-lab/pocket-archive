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
  `project=<id>|none|any`, `scope=mine|shared`, `attach=1`, `category=Receipts…`, `status=open|done`, `recordings=1`,
  `tab=<Inbox tab>|lists` + `actions=1` (2.8.1). Everything is AND. Filters alone (no words) list matches too.
- **Tabs (2.8.1):** `TABS` in search.js is the Inbox's `FILTERS` / `LISTS` (QuickInboxPage) on the server — keep the
  two identical (the browser test compares every tab's list with `/api/find?tab=`). With a tab, actions come back
  only with `actions=1` ("Show actions in Inbox") and no type filter; `type=actions` can't pull them into a tab.
  Deleted notes only with `tab=undone`.
- **Answer:** `{ q, terms, groups: { notes, lists, documents, projects, recordings, actions }, total, suggestions,
  tookMs }`. Each result has `snippet` (around the match), `matchedIn` ("Transcript", "Document details"…),
  `projectName`, `sharedFrom`, `document { type, category, label, icon }`, `done`, `attachments`. At most 30 per group.
  `suggestions`: completions of the last word from project names, stores (receipts), categories and titles.
- **Voice:** `POST /api/find/voice` (multipart `audio`, ≤ 3 MB, 60 per hour per user) → `{ text }`. Transcribed
  on the NAS with the same Gemini call as captures, written to a temp file and deleted. Nothing is saved.
- The old `GET /api/quick/search` stays for older app builds.

## Notes search — web (`components/search/`)

- `NoteSearch` (one component): `variant` bar (top of Inbox / Lists / Shared / Projects / Actions; the page's own
  content is `hidden` while results show), `overlay` (the header's global search), `page` (/search).
- **Scope ≠ filters (2.8.1).** `scope` is what the page is about and can't be removed: Inbox → `{ tab, actions }` (the
  tab you're on), Lists → `{ tab: 'lists' }`, Shared → `{ scope: 'shared' }`, Projects → `{ types, project: 'any' }`,
  Actions → `{ types: ['actions'] }`. Your filters AND the scope (`lib/searchParams.js` `paramsOf`; an impossible mix,
  e.g. Mine on Shared with me, = "No matches" without a request). Type chips only offer kinds the page can show.
  In 2.8.0 the scope was only a starting filter: "All" on the Actions page dropped it and the Inbox search ignored the tab.
- **Per-page state (`lib/filterState.js`):** `stateKey` → filters in localStorage `pa_filters:<page>` (kept until
  cleared), words in sessionStorage `pa_query:<page>`, the Inbox / Actions tab in sessionStorage `pa_tab:<page>`.
  Every read is cleaned (`cleanFilters`); `pa_filterStateVersion` resets everything once per version.
- Active filters show as chips (✕ removes one) with the result count and Clear filters; no results → "No matches" +
  Clear filters. Opening a result keeps the search (Back shows it again).
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
filters, live index, capture token, voice errors, tabs / actions), `fftools/s29-ui.cjs` (every page × every filter
alone and combined × with/without words against an oracle; list = server per tab; state per page; reset),
`fftools/s28-ui.cjs` (toasts, settings search, notes search;
desktop + 375 px, light + dark, reduced motion; user B in the UI), `settings-index-test.mjs`.
