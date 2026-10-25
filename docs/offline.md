# Offline mode (2.9.0) — the Android app works without the NAS

## App shell
- The screens still load from the NAS. When it can't be reached (airplane mode, no signal, NAS down), the app opens
  the screens **bundled in the APK** instead — at the same NAS address, so sign-in, local settings and the offline copy
  are the same. `offline/ShellClient.kt` (a BridgeWebViewClient): a page load while `NasProbe` (GET /api/health, 2.5 s,
  remembered 20 s, re-checked on network changes) says unreachable → `assets/public/index.html`; bundled files
  (`/assets/…`, icons) always from the APK. Capacitor's error page (`offline.html`) is the same app
  (`scripts/android-config.mjs` copies it) — and at start, `MainActivity.startShell()` probes and reloads straight
  into the bundled screens instead of waiting 30 s. The bridge script reaches self-served pages through the WebView's
  DOCUMENT_START_SCRIPT (all current WebViews).
- `bundle-version.json` (written at `npm run build:android`) — verify-release checks it equals the release.
  `main.jsx`: `/offline.html` → back to the last route; `window.PA_BUNDLED`; the header chip offers "Back online · tap
  to refresh" to load the NAS's screens again.

## The copy (native, `android/app/.../offline/`)
- `SqlCipherData` — one SQLCipher database (`noBackupFilesDir/offline/copy.db`): notes (own / shared), kv (saved
  server answers by path: settings, places, `/auth/me`, recordings…), queue, failed, media index, recordings (text for
  search), meta (cursor, idmap, mediaKey, userId).
- `MediaVault` — every media file encrypted in 64 KiB AES-256-GCM chunks (random IV, file name + chunk number as AAD):
  any byte range readable (audio seeking, PMTiles maps), downloads resume after the last whole chunk. File names are
  SHA-256 of the request path. The media key is stored inside the database.
- `OfflineKeys` — the database key: random 256 bits, wrapped by an Android Keystore key (lock off) or by a key derived
  from the full device token (lock on — only in memory after the fingerprint/PIN). Lock switched on/off → re-wrapped
  (`QuickRecorderPlugin.turnOn/turnOff`). New fingerprint → the token is renewed → the old wrap can't be opened → the
  copy starts over (`Result.Lost`). Locked → nothing opens it (not the background sync either); captures keep using the
  capture-only token, which `/api/offline/*` refuses (403 locked).
- One account per phone: `meta.userId` ≠ signed-in user → cleared. Sign out (`clearToken`), "Delete offline data",
  and a 401 at sync (device revoked / signed out elsewhere) → `OfflineStore.wipe` (files + keys).

## Sync (`SyncEngine.kt`, pure logic, JVM-tested with `MemoryData` + `FakeServer`)
1. **Replay** the queue oldest first. Ids made offline (`qn_<ms>_off<6>`, `pj_…_off…`) → the server's (idmap, rewritten
   in paths / bodies / form fields, never file bytes). Sequential edits of one note get the server's latest `textRev` as
   their base. `409 { conflict }` → the server's note + `_conflict { mine, theirs }` (kept across syncs until the user
   picks Keep mine / Keep theirs / Keep both). Other 4xx → dropped, listed in "couldn't be saved". Network / 5xx →
   stop, keep. 401 → wipe. Creates are retry-safe: `clientId` on notes, media, documents, attachments, projects.
2. **Text** (only when the queue is empty): `GET /api/offline/sync?since=&page=` → changed notes (paged 300), all ids
   (deletions), shared notes + projects, media lists; then the saved answers (`KV_SYNC`).
3. **Archive** (admin, setting on): `GET /api/offline/archive?since=` → changed recordings, each `/api/recordings/:id`
   (+ attachments) saved; audio as media.
4. **Media**: `MediaPlan` (mode, Keep offline ids, pinned, last 30 days, limit — text always kept), thumbnails first,
   Wi-Fi only (default) for the rest, resumable.
- When: the app opens / resumes / comes back online / a live update arrives / Sync now (`OfflineWorker.now`), every
  15 minutes in the background (`OfflineWorker`, network constraint), and in 8-minute rounds until a big first download
  is done.

## The web layer (`src/lib/offline/`)
- `adapter.js` (axios adapter, app only): online → the NAS as always (+ write-through of saved answers and changed
  notes); no connection → `localApi.js` answers with the server's shapes; changes made offline → queued **and** applied
  to the copy at once; while changes wait, new changes queue behind them (order) and note reads come from the copy.
  Things only the server can do are queued with "Will be processed when online" (AI, reading documents); things that
  need the internet now (place search, sharing with someone new, admin) answer "needs a connection".
- Search offline = `searchCore.js`, a generated copy of the backend's `search-core.mjs` (`scripts/shared-code.mjs`,
  prebuild; verify-release checks they're identical) — the same results as `/api/find`.
- `status.js` (chip: Offline · last synced / Syncing N changes… / Up to date), `OfflineSettings.jsx` (Settings →
  Offline & storage), `OfflineNote.jsx` (badge, conflict banner, Keep offline).
- Browser tests use `testStore.js` (localStorage `pa_offlineTest=1`; unencrypted, test only) with the same contract.

## Widget and watch
- No connection: the widget's recent list and the watch's recent notes / open errands come from the copy
  (`OfflineViews`, same rules as `/api/quick/recent` and `/api/errands/open`). Never while the app is locked.

## Tests
JVM: `SyncEngineTest`, `MediaVaultTest`, `MediaPlanTest`, `OfflineViewsTest`. Server: `offline-e2e.cjs` (sync, delta,
paging, deletions, shared, scope, archive admin-only, conflicts, idempotent uploads, capture token, revoked device).
Browser: `fftools/offline-ui.cjs` (offline read / search = server / changes / conflict / replay once / wipe).
Not testable without the phone: SQLCipher on the device, the Keystore wraps, the shell serving bundled screens and media.
