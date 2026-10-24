# Pocket Archive frontend: notes for Claude

React + Vite web app. The same code runs in the browser and, through Capacitor,
inside the Android app (`android/`). The backend lives in
`C:\Users\sundi\Documents\pocket-archive-backend` (root files are the source of truth).

## Guardrails

- **Never** print, log or commit secrets: API keys, `docker-compose.yml` with real keys,
  service-account JSON, `.env*`, `android/keystore.properties`, `*.jks`.
- The web build must keep using the same-origin `/api` base URL. Don't change the web
  login cookie (name, httpOnly, SameSite, Secure, expiry) or `/api/auth/login`.
- Don't modify the Dockerfiles. Change `C:\Users\sundi\Documents\deploy-to-nas.bat` only to fix deploy
  steps (frontend sync, release check).
- **Never create a new Android signing key.** The app is signed with
  `C:\Users\sundi\keys\pocketarchive.jks` (alias `pocketarchive`, credentials in
  `android/keystore.properties`). Certificate SHA-256:
  `F4:41:B0:E3:7B:F5:10:40:73:9B:96:31:70:61:D1:71:F2:E1:C4:49:7F:79:D5:25:33:F3:12:06:5C:35:C7:21`.
  Phones refuse updates signed with any other key. If the keystore is missing, stop and ask.

## How the Android app loads its screens

- `npm run build:android` = `vite build --mode android` → `cap sync android` →
  `node scripts/android-config.mjs`.
- `scripts/android-config.mjs` reads `VITE_API_BASE_URL` from `.env.android` (gitignored)
  and patches the generated `android/app/src/main/assets/capacitor.config.json`:
  `server.url` = the NAS origin and `server.errorPath` = `offline.html`.
  **The app's screens load from the NAS**, so a web deploy (`deploy-to-nas.bat` + NAS
  rebuild) updates the app's UI without a new APK. A new APK is only needed for native
  changes (Kotlin, manifest, widget, icons, Capacitor plugins).
- If the NAS can't be reached, the WebView shows the bundled `public/offline.html`
  (Retry button; `server-url.js` next to it, written by the script, says where Retry goes).
- In the app, `src/lib/platform.js` uses `window.location.origin` as the API origin; the
  browser keeps `/api`.
- Native code gets the server from the web layer (`QuickRecorder.configure`) and falls
  back to `BuildConfig.API_BASE`, which Gradle reads from `.env.android`.

## Accounts (2.0.0) — read docs/accounts.md in the monorepo

- Backend: `users.js` (users.json / sessions.json / devices.json / security-log.jsonl in the config dir; bcrypt,
  TOTP RFC 6238 with AES-GCM-encrypted secrets, backup codes, lockout, per-IP limit), `accounts.js` (requireAuth
  sets **req.user**; login/device-token/2FA/sessions/admin routes), `userContext.js` (one instance of
  quickCapture/places/projects **per user**, rooted at `ARCHIVE/users/<id>/`, mounted as an Express router per user —
  isolation is structural), `zip.js` (export before delete), `scripts/migrate-users.mjs` (dry-run / run / rollback).
- Session JWT = { uid, sid, kind }; sessions are revocable server-side. Media tokens carry uid. Device tokens per user.
- The Hey Pocket archive routes (/api/recordings, /api/search, /api/stats, /api/sync, /api/audio) are admin-only.
- Until users.json has migratedAt the API answers 503 (except /health, /api/health); re-checked every 2 s.
- Never start server.js without test env vars (ARCHIVE_PATH, CONFIG_PATH, JWT_SECRET) — and never against the
  real archive. Tests use a fake archive + `migrate-users.mjs` (scratchpad: accounts-e2e.cjs, fftools/accounts-ui.cjs,
  fftools/user-switch-app.cjs).
- Android: `TokenStore.userId/lastUserId`, plugin `setToken({token,userId})` / `setUser`, `PendingStore.hold/release`
  (`files/quick_held/<userId>/`). Watch: outbox per user, channel path `/pa/capture/<clientId>/<capturedAt>/<userId>`.

## Sharing & live updates (2.1.0) — read docs/sharing.md in the monorepo

- Backend `sharing.js`: `shares.json` index in the config dir; `route` checks the role and hands a shared note/project
  request to the OWNER's per-user router (responses get `sharedFrom`); `foreignFor(userId)` = editable shared notes for
  smart append + errand feeds; SSE hub (`GET /api/events`, heartbeat 25 s, `X-Accel-Buffering: no`); `/api/changes`;
  family calendar (`config.familyCalendarId`). Item ops: `POST /api/quick/:id/ops` → `applyOps` in quickCapture.js
  (client item ids, replay-safe, attribution, `note.activity`). Per-user `GET/PUT /api/notify-settings`.
- Frontend: `lib/opsQueue.js` (offline queue → ops; `NOTE_UPDATED` / `OPS_REJECTED` window events — ErrandPanel no longer
  PATCHes /items), `lib/liveEvents.js` (EventSource; app uses `?mt=`), `lib/sharing.js` (people cache, roles),
  `components/quick/ShareSheet|SharedBadge|NoteActivity|SharedNoteEditor`, `LiveToast`, `SharingSettings`, route
  `/shared` = QuickInboxPage `sharedOnly`. Toolbar actions have `role` (view/edit/owner → `allowedFor`).
- Android: `quick/ChangesWorker.kt` (15-min WorkManager check of /api/changes → widget + errand sync + notifications on
  channel `shared_changes`; quiet while the app is visible; first run only sets `since`). Plugin `refreshWidget`,
  `checkSharedChanges({delayMs})`.
- Tests (scratchpad): `sharing-e2e.cjs` (API, real AI), `fftools/sharing-ui.cjs`, `fftools/sharing-app.cjs` (emulator).
  Puppeteer: use `networkidle2` — the live stream keeps a connection open, so `networkidle0` never settles.

## Lite layout & welcome tour (2.2.0) — docs/accounts.md

- `lib/layout.js` `useLayout()` → { lite, archive, appName }: lite = plan lite or admin + `pa_liteLayout` on this device;
  archive = admin && !lite. Sidebar (LITE_NAV), Home redirect, `ArchiveRoute` guards, Search/Calendar/Settings/QuickNoteEditor use it.
  Route `/lists` = QuickInboxPage `listsOnly`.
- `components/Welcome.jsx` (mounted in ProtectedRoute): shows when `user.welcomePending`; `openWelcome()` in lib/uiBus.
  Reuses `PasswordBlock`/`TwoFactorBlock` (SecuritySettings) and CalendarSettings; permissions via the existing plugin methods.
- `liveEvents.js` closes the SSE stream while the tab is hidden (browsers allow ~6 connections per host).
- Tests: `fftools/lite-ui.cjs`, `fftools/lite-app.cjs` + `lite-battery.cjs` (emulator).

## Phone actions, Actions tab, accidental recordings (2.3.0) — docs/phone-actions.md

- Backend `phoneActions.js` (classifier field `phoneAction`; pure command → the capture becomes `type:'action'`; command + content → note with
  `actionRef` chip + entry with `parentId`; `/api/actions…`; cleanup after keepDays). Capture responses carry `phoneAction` while pending.
- Android `quick/PhoneActions.kt` (run/undo/choices, reports via ActionReportWorker), called from `ResultNotifier.deliver`; plugin
  `runPhoneAction`/`undoPhoneAction`/`findContacts`/`findApps`/`getActionStatus`/`openActionSetup`. Web: `pages/ActionsPage.jsx`, `lib/phoneActions.js`.
- Accidental: `SpeechDetector.kt` (same file in wear — keep in sync; JVM test with WAVs in app/src/test/resources/vad),
  `AccidentalStore.kt` (30 s Restore, weekly count, 3 s cooldown, `PocketCheck`), recorder service `EXTRA_SOURCE` ("app" skips pocket/confirm).
- Debug build = `com.sanpan003.pocketarchive.debug` / "PA Debug" (src/debug/res) for device tests next to the real app.

## Over-the-air updates (2.4.0) — docs/updates.md

- Backend `updates.js`: `ARCHIVE/_updates/<phone|watch>/` (APKs, newest 3 kept, `latest.json`, `draft.json`); `/api/updates/:target/latest|apk|report`
  need a DEVICE token (`req.device`; cookie session → 403); admin `/api/admin/updates…` (publish draft, discard, rollback).
  Versions live on the device-token entry (`users.setDeviceApp`, `apps.phone|watch`); `users.setDeviceDecorator(updates.annotate)`
  adds `updateStatus` to device lists. Security log: device id + versions only.
- Publishing: `update-android.bat [draft]` → `scripts/publish-update.mjs` (to `P:\_updates`, or `--dir=`/`PA_UPDATES_DIR`) →
  adb install only if something is connected → `verify-release --phone --published`. Tests point `--dir` at a fake archive.
- Android `quick/AppUpdater.kt` (check/download/verify sha+package+version+signer/PackageInstaller session, deferred while
  `RecorderState.recording`, `UpdateWorker` — one-time work is `app-update-now-*`, the daily check `app-update-daily`; never
  reuse the periodic name with REPLACE, it cancels the daily check), `quick/WatchUpdates.kt` (watch version + phone→watch relay).
  Plugin `getUpdateState/checkForUpdates/startUpdate/setUpdateSettings/openInstallSettings/updateWatch`, event `update`.
  Web: `lib/appUpdate.js`, `UpdateBanner`, `AppUpdatePanel` (About), `AppUpdatesAdmin` (Users).
- Watch `wear/WatchUpdater.kt` (direct check, or `/pa/update-request` → phone relays over channel `/pa/update-apk/<code>/<sha>`).
  2.6.1: the relay runs once at a time (AtomicBoolean + `KEEP` work policy) in its own temp file under
  `cache/watch-update/` — a shared fixed file + `REPLACE` let a second run delete the file the first was sending
  (ENOENT). Errors are `RelayProblem` messages, never paths. The watch tries direct whenever it has internet (any
  transport) and reports its progress to the phone (`/pa/update-status`); "Updated to X" when `/pa/watch-info` shows
  the new version.
- What's new uses its own inline renderer (`WhatsNew.jsx` `Rich`: **bold**, *italic*, `code`), not MarkdownRenderer.
- Device test needs a NEWER debug build signed with the debug key (`ota-dev/build-apks.sh` in the scratchpad builds 15 + 99 +
  a wrong-key copy). Play Protect scans each new sideloaded build after the confirm ("Scanning…" → Install).

## Attachments, voice detection, recording log (2.5.0) — docs/attachments.md, docs/phone-actions.md

- Backend `attachments.js` (registered from quickCapture's routes): `note.attachments`, files in `07_Quick_Notes/attachments/<noteId>/`,
  25 MB multer limit, optional Gemini read (`readImage(..., mime)` takes PDFs as `type: 'document'`). `sharing.js` route regex
  allows `/attachments/at_…(/thumb)`; `allowedNote` view = GET, edit = POST/PATCH/DELETE. `MEDIA_PATH_RE` includes them.
  Voice captures accept a `trigger` field → `note.trigger`.
- Web: `lib/attachments.js` (pick, thumbs, upload, open), `quick/AttachSheet.jsx` (portal), `quick/NoteAttachments.jsx`
  (viewer portal, rename/delete/read). API helpers are `*NoteAttachment` — `uploadAttachment`/`deleteAttachment` are the
  RECORDING attachment helpers. Toolbar action `attach` (role edit) is handled inside NoteToolbar (needs `onChanged`).
- Android: `quick/NoteFiles.kt` + plugin `scanDocument` (ML Kit `play-services-mlkit-document-scanner`, launcher registered in
  `load()`) and `openFile` (download with the device token → FileProvider `${applicationId}.fileprovider`, cache/attachments).
- Recorder: `PcmRecorder` (AudioRecord → MediaCodec AAC → MediaMuxer) feeds `VoiceDetector` (pitch + syllables); MediaRecorder +
  `SpeechDetector` is the fallback. Both files are copied into `wear` (keep in sync). Tune `VoiceDetector` with the scratchpad
  prototype `vad/vad.cjs` first (seconds per run), then `VoiceDetectorTest`.
- `RecordingLog` (phone prefs, last 50): every start incl. guard-ignored ones; trigger from `source` + Activity referrer;
  `RecordTrampolineActivity.EXTRA_FROM` (widget / tile / volume-key); watch sends `/pa/rec-log`. Plugin `getRecordingLog`/`clearRecordingLog`.
  Strict setting `unlockedOnly` applies to `RecordingLog.KEY_TRIGGERS`.

## Scan & Camera, smart documents, editing photo notes (2.6.0) — docs/documents.md

- Backend `documents.js` (created in quickCapture's register next to `createAttachments`): Gemini JSON schema
  (`response_format: { type: 'text', mime_type: 'application/json', schema }`; ALL fields `required` — with optional
  fields the models fill only a few), `privacy.js` masking BEFORE storing, edited fields + conflicts, project filing by
  `smart().settings()` thresholds, `POST /api/quick/document` (new note), `/api/documents/settings|reminder` (own routes,
  never proxied). Primary model paused 5 min after 429/503/timeout. Don't name anything `process` in that module
  (it shadowed `process.env` once).
- `attachments.js`: `createAttachments({ store, readText, onChanged })` → scans are `pageList` page images + a PDF rebuilt
  with `pdf-lib` (backend dependency: keep root and `backend/` package*.json identical — the image runs `npm ci`);
  images keep `original` on first edit; `note.coverId`. FIELD_GROUPS: `attachmentsAt` (attachments, coverId), `documentAt`.
  Sharing proxy normalizes `/at_…` → `/:aid`, `/pg_…` → `/:pid`; editors may change attachments/cover/document but not
  `/document/project`.
- Web: `lib/documents.js`, `quick/DocumentCard.jsx` (polls while pending, "Details updated" toast), `quick/PagesEditor.jsx`
  (portal; ImageEditor rendered OUTSIDE the overlay so clicks don't bubble to its close handler), `quick/ImageEditor.jsx`
  (canvas: rotate, crop, pen, highlight, arrow, text), Documents tab + chips in QuickInboxPage, `DocumentSettings`.
  `withMediaToken` appends `&mt=` when the URL already has `?v=`.
- Android: `quick/DocCapture.kt` (scanner options, camera target, `DocQueue` per user, `DocUploadWorker`, `CaptureActivity`
  for widget/shortcuts/tile), `quick/QuickScan.kt` (1x1 widget + tile), plugin `scanUpload` / `captureDocument` /
  `saveContact`, widget buttons `med_scan|med_camera|lg_scan|lg_camera` (2x1 hides the status line unless busy).
  Shortcuts are in BOTH `src/main/res/xml/shortcuts.xml` and `src/debug/res/xml/shortcuts.xml` (debug package).

## App lock and passkeys (2.7.0) — docs/security.md

- Android app lock: TWO device tokens. Full token behind an auth-bound Keystore key (`AppLock.kt`, 30 s validity,
  invalidated by a new fingerprint), in memory only once unlocked; a CAPTURE-ONLY token (`TokenStore.captureToken`)
  for everything that runs while locked. `TokenStore.token()` = unlocked full token, else capture token;
  `backgroundToken()` (the watch) = capture token whenever the lock is on. Server allowlist `CAPTURE_ROUTES` in
  accounts.js — a new background API call made by native code must be added there or it gets 403 `{locked:true}`.
  Lock screen = native overlay (`LockScreen` in AppLockFlows.kt, weak refs — a recreated activity gets its own);
  `getToken` waits for unlock; `ResultNotifier`/widget say "🔒 Saved" while locked. Timing rule `AppLock.timedOut`
  (JVM test `AppLockTest`). Fingerprints changed → password → `POST /api/auth/device-token/renew` (same device id).
- Passkeys (web only): `passkeys.js` (@simplewebauthn/server; ESM → `import()`), `passkeys.json` in the config dir,
  RP ID from the request Origin and stored per passkey; passkey sign-in skips 2FA. Web: `lib/passkeys.js`
  (@simplewebauthn/browser), Settings → Security `PasskeysBlock`, Login "Sign in with a passkey".
  Browser test uses Chrome's WebAuthn virtual authenticator over CDP (`fftools/passkey-ui.cjs`).

## Search, settings search, toasts (2.8.0) — docs/search.md

- Notes search: `GET /api/find` in backend `search.js` — pool = req.user's store + `sharing.sharedNotes` (+ own/shared
  projects; recordings only for the admin with `recordings=1`; actions only with `type=actions`). Never widen the
  pool without a cross-user test (`search-e2e.cjs`). In-memory index per store folder, refreshed by file mtime on
  each query. Voice: `POST /api/find/voice` (transcribe, nothing saved). Web: `components/search/NoteSearch.jsx`
  (bar / overlay / page), `SearchOverlay` (header 🔍, Ctrl+K, "/").
- Search scope vs filters (2.8.1): a page's `scope` (Inbox tab, Lists, Shared, Projects, Actions) is fixed; user
  filters AND it (`lib/searchParams.js`) and are saved per page (`lib/filterState.js`, bump its VERSION to reset
  everyone's saved filters). Server `TABS` (search.js) must stay identical to the Inbox `FILTERS` — `s29-ui.cjs`
  checks list = server for every tab and every filter against an oracle.
- Settings search: `lib/settingsIndex.js` (add every new setting there, with synonyms and flags), `SettingsSearch.jsx`.
- Toasts: always `components/Toast.jsx` (or `QuickToast`) — never a hand-made fixed popup. Swipe hook in
  `lib/swipeDismiss.js`. Stack below the top bar; ✕ 44 px; body taps don't dismiss.
- `main` in AppLayout is `overflow-x-clip`, not `overflow-auto` (that made `sticky` never stick). Desktop has a
  sticky header (h-14) now: sticky things go at `top-14` or lower.

## Every release (rule)

1. Bump the version and add an entry at the top of `pocket-archive-monorepo\CHANGELOG.md` (the single
   source of truth): `## X.Y.Z — Mon D, YYYY`, user-facing bullets. Set `"version"` in `package.json`
   to the same number, and `NEXT_VERSION_NAME=X.Y.Z` in `android/app/version.properties` and
   `android/wear/version.properties` (the next release build uses it once and removes it).
2. `npm run changelog` copies it to `src/generated/changelog.md` (also runs before every build). Settings →
   About shows it; the app shows a one-time "What's new in X.Y.Z" after an update.
3. Deploy web + backend, rebuild the NAS, run `update-android.bat`. Both scripts end with
   `node scripts/verify-release.mjs` (`--phone` from update-android.bat). It compares the CHANGELOG
   version with package.json, the NAS build folder and the installed app (adb), and fails loudly
   when anything is behind. Don't report a release as done until it passes.
   (1.1.0 was once announced but never deployed: the work stopped at an approval gate before the
   build/deploy steps and nothing checked it. That's why this check exists.)

## Android release procedure

1. Make sure the web part is deployed if it changed (the app loads its screens from the NAS).
   **The NAS builds the web app itself:** `docker-compose.yml` uses `backend/Dockerfile` with
   context `Z:\pocket-archive`, which runs `npm run build` on **`Z:\pocket-archive\frontend`**
   and serves that (not `public/` from `deploy-to-nas.bat`). So every web deploy needs BOTH copies
   below, then a NAS rebuild. If Docker logs `CACHED COPY frontend/`, the source didn't reach the NAS.

   a. Run `deploy-to-nas.bat`: builds, fills the backend's `public/`, and syncs the frontend source to
      `Z:\pocket-archive\frontend` (step c below, built in since 2026-10-16).

   b. Backend, with exactly these exclusions (the NAS keeps its own secrets and config;
      `.git-old-backup` is the backend folder's retired git history and must never be copied).
      Its own `frontend\` folder is an old copy and is excluded: robocopy also copies *older*
      files, so it would overwrite the real frontend on the NAS:

      ```bat
      robocopy C:\Users\sundi\Documents\pocket-archive-backend Z:\pocket-archive /E ^
        /XD node_modules .git .git-old-backup C:\Users\sundi\Documents\pocket-archive-backend\frontend ^
        /XF .env docker-compose.yml config.json *service-account*.json
      ```

      Copy changed root backend files into `pocket-archive-backend\backend\` first; the image
      runs `backend/` (`COPY backend/ ./`), not the root files.

   c. Frontend source (this folder) into the NAS build folder — `deploy-to-nas.bat` does this; by hand:
      `/MIR` removes deleted files; excluded folders are left alone on the NAS:

      ```bat
      robocopy C:\Users\sundi\Documents\pocket-archive Z:\pocket-archive\frontend /MIR ^
        /XD node_modules dist android .git ^
        /XF .env.android C:\Users\sundi\Documents\pocket-archive\branding\preview.png
      ```

      Check: `src\pages` on Z: has the newest pages, e.g. `dir Z:\pocket-archive\frontend\src\pages`.

   d. Rebuild on the NAS: `docker-compose up -d --build` in `/volume1/docker/pocket-archive`.

   All commits go to `C:\Users\sundi\Documents\pocket-archive-monorepo`; the backend
   folder has no git history of its own.
2. From this folder run:

   ```bat
   update-android.bat
   ```

   It builds BOTH the phone app and the Galaxy Watch app (`android/wear`), then:
   - checks the keystore, `android\keystore.properties` and `.env.android` exist (it never creates them)
   - runs `npm run build:android`
   - runs `gradlew assembleRelease`, which **bumps the version automatically**
     (`android/app/version.properties`: `VERSION_CODE` +1, patch of `VERSION_NAME` +1;
     only `assemble|bundle|installRelease` bump it, debug builds and lint don't)
   - verifies the APK is signed with the certificate above
   - copies it to `C:\Users\sundi\Documents\PocketArchive.apk`
   - runs `adb install -r` on every connected phone (USB or Wi-Fi). Emulators are skipped.
3. Commit `android/app/version.properties` with the release.

Tools aren't on PATH. The script sets them, but for manual commands:
`JAVA_HOME=C:\Program Files\Android\Android Studio\jbr`,
`ANDROID_HOME=C:\Users\sundi\AppData\Local\Android\Sdk`,
adb = `%ANDROID_HOME%\platform-tools\adb.exe`.

### Installing over Wi-Fi (no cable)

One-time pairing (Android 11+). Phone and PC must be on the same Wi-Fi:

1. Phone: **Settings → Developer options → Wireless debugging** → on.
2. Tap **Pair device with pairing code**. It shows `IP:pairing-port` and a 6-digit code.
3. PC: `adb pair <IP>:<pairing-port>`, then enter the code.
4. PC: `adb connect <IP>:<port>`. Use the port shown on the main Wireless debugging
   screen, which differs from the pairing port.
5. `adb devices` lists the phone. Then `update-android.bat` installs over Wi-Fi.

The connection port changes when Wireless debugging is toggled or the phone reboots.
Re-run step 4 with the new port; pairing doesn't need repeating.

## Testing

### Devices — RULE (the emulators freeze this PC; two crashes)
- **NEVER start an Android or Wear OS emulator.** Older notes below that mention the emulator are history.
- Test with unit tests (`gradlew :app:testDebugUnitTest`), the web/Puppeteer tests, Gradle build + lint,
  and checks that don't need a device.
- Anything that truly needs a device: only on the REAL devices over adb, and only if they're connected
  (phone `R3GL105L1RV` on USB, the watch on wireless debugging), using a separate debug build
  (`applicationIdSuffix ".debug"`, launcher name "PA Debug") so it never touches the real app's data —
  and uninstall it afterwards. **Never install test builds on Minal's phone (its serial is in local memory, not in git).**
- No device connected → skip device tests and give a short manual test checklist instead.

- Web: `npm run build` (0 errors) and `npx eslint <changed files>`. Known pre-existing lint
  errors: `AppContext.jsx` (react-refresh) and setState-in-effect in `SettingsPage`/`Dashboard`.
- Check dark mode and a 375px-wide viewport for UI changes.
- Android: `cd android && gradlew assembleDebug` and `gradlew :app:lintDebug` (0 errors).
  Plain `gradlew lint` also lints Capacitor's own module in node_modules, which has errors that aren't ours.
- (History — emulators are no longer used, see the rule above.) Emulator against a local backend: after `npm run build:android`, point the generated
  `assets/capacitor.config.json` `server.url` at `http://10.0.2.2:<port>`. Not `localhost`:
  it clashes with Capacitor's local `https://localhost` origin. Plain HTTP needs a temporary
  `app/src/debug/AndroidManifest.xml` with `usesCleartextTraffic="true"`. Delete it afterwards.

## Widget (android/app/src/main/java/com/sanpan003/pocketarchive/quick/)

- `QuickToggleWidget.kt`: size-based RemoteViews (1x1 mic, 2–3x1 mic + status line,
  4x2+ header + 5 recent notes). Layouts: `res/layout/widget_quick|medium|large.xml`.
  `widget_large.xml` is generated (5 fixed rows `lg_row1..5`); edit all rows alike.
- `WidgetData.kt`: cached `GET /api/quick/recent?limit=5` (device token), offline/signed-out flags.
- `WidgetState.kt`: Uploading → Processing → result line (~6 s) → idle.
- `WidgetRefreshWorker.kt`: every 30 min with network, plus after captures and app open.
- Note rows deep-link to `/quick/inbox?note=<id>`. The Inbox expands, scrolls to and highlights that note.

## Errands & Places

- Type `errand` (backend `quickCapture.js`): `items: [{id,text,done}]`, `placeSpec` (what was said),
  `place` (resolved: name, address, lat/lng, `branches[]` ≤ 20 with `key`), `trigger` time|arrival|both,
  `arrival: { activeFrom, triggeredOn }`, `errandDone`. Calendar event only when dated and not arrival-only;
  the description is the ☐/☑ checklist plus a link back (`PUBLIC_URL` env, else the last request's origin).
- `places.js`: home, My Places (aliases) and errand settings live in `config.json` (never in git); lookups
  are cached in `places-cache.json` next to it. Nominatim: real User-Agent, ≤ 1 request/s. Chains: Overpass
  (public servers are flaky; two endpoints, then a Nominatim fallback), cached 30 days.
- Android: `ErrandSync`/`ErrandWorker` fetch `GET /api/errands/active` and register up to 100 geofences
  (150 m, 1-minute dwell), closest to home first. `ArrivalNotifier` shows the list with Open list / Done /
  Snooze 1 hr; it doesn't repeat for the same errand and store within 2 h. The phone never sends its
  location; it only reports "this errand fired" (day only) so the 14-day expiry restarts.
- Emulator arrival test: allow mock locations for the shell (`appops set com.android.shell android:mock_location allow`),
  `cmd location providers add-test-provider gps|network`, then feed `set-test-provider-location` every few
  seconds for > 1 minute at a store. Reset the app-op and remove the providers afterwards.

## Galaxy Watch (Wear OS) app — `android/wear`

- Module `:wear` (Compose for Wear OS, Material 3, Tiles/ProtoLayout, complications). SAME
  applicationId and SAME release key as the phone app — the Data Layer only connects matching apps.
  minSdk 30. Compose libs stay on the AGP-8-compatible line (Wear Compose 1.6.x, BOM 2026.06.x):
  newer ones need AGP 9.1, but Capacitor 8 pins AGP 8.13.
- Protocol (`wear/.../Protocol.kt` ⇄ `app/.../quick/WearBridge.kt`, keep in sync):
  - audio: ChannelClient `/pa/capture/<clientId>/<capturedAt>` → phone `WearListenerService.handOff`
    → the EXISTING pipeline (UploadWorker); phone acks `/pa/capture-ack`
  - results: phone `ResultNotifier` sees `note.clientId` starting with `watch-` → `/pa/result` to the
    watch; the phone notification is then `setLocalOnly` (no duplicate on the wrist)
  - state: DataItem `/pa/state` (recent notes + `GET /api/errands/open`), refreshed by `ErrandWorker`'s
    sync (captures, app open, every 30 min)
  - checklist/done from the watch: DataItems `/pa/toggle/<errand>/<item>`, `/pa/done/<errand>` → phone
    PATCHes the server, then deletes the item (the watch treats deletion as confirmation)
  - token: `/pa/token` (phone's device token, stored Keystore-encrypted on the watch) for the
    direct-upload fallback after 10 min without the phone; revoking the phone stops the watch too
  - arrival: `/pa/arrival` → the watch posts its own notification ("Open list" opens the watch
    checklist); the phone's copy stays local, or bridges normally if the watch can't be reached
- Testing without a paired watch: the Wear emulator can't pair with a phone emulator without the Wear OS
  companion app + a Google account. Test each side on its own with a temporary `src/debug` receiver that
  calls the real handlers (`WatchData.apply`, `WatchTokenStore.set`, `WearListenerService.handOff`,
  `ErrandWorker.toggleItem`), and delete it afterwards.
- Tile/complication on the emulator: `am broadcast -a com.google.android.wearable.app.DEBUG_SURFACE
  --es operation add-tile --ecn component <pkg>/<TileService>`.

### Installing on the watch (wireless debugging)

1. Watch: Settings → About watch → Software → tap *Software version* 5× (Developer options).
2. Developer options → **ADB debugging** on, **Wireless debugging** on → *Pair new device*.
3. PC: `adb pair <watch-ip>:<pairing-port>` (code from the watch), then `adb connect <watch-ip>:<port>`.
4. `update-android.bat` installs the watch APK on every connected watch (detected by
   `ro.build.characteristics` = watch) and the phone APK on phones.

## App icon (`npm run icons`)

- Since 1.3.0: the **Purple Neon Bolt** (`scripts/icons/family.mjs`, design `purpleBolt`, color `neonPurple`
  #A78BFA → #6366F1) on three selectable tiles: dark (default), light (soft purple rim), amoled. `npm run icons`
  (`build.mjs`) writes the sources to `branding/purple/<tile>/` and renders: vector backgrounds per tile
  (`ic_launcher_bg[_light|_amoled]`), glowing foreground PNGs (dark/amoled share one; light has its own) incl.
  Quick Record / Stop Recording badges, adaptive icons `ic_launcher|ic_quick_record|ic_stop_record[_light|_amoled]`,
  the monochrome bolt, `ic_stat_mic` / `ic_bolt_white` (bolt glyph), splash, web favicons per tile
  (`public/icons/favicon-<tile>.svg`, `app-icon-<tile>-192.png`, `apple-touch-icon-<tile>.png`). The watch uses dark.
- Switching (`quick/AppIcon.kt`, plugin `getAppIcon`/`setAppIcon`): MainActivity is NOT a launcher entry; the
  manifest has activity-aliases `.AppIconDark|Light|Amoled`, `.QuickRecordLauncher[Light|Amoled]`,
  `.StopRecordLauncher[Light|Amoled]` — exactly one set enabled (DONT_KILL_APP; new set enabled before the old is
  disabled). The enabled component is the stored choice, so it survives updates. Dark keeps the original
  Quick/Stop names (side keys and Routines set up before keep working). Disabling the alias an activity was started
  from closes that screen once. Web: appearance group `icon` {tile} → favicon swap in AppearanceContext.
- The other 15 designs and 10 colors are not shipped; `branding/family/*.svg` + `family.mjs` keep them
  (`node scripts/icons/preview-icons.mjs` → `branding/preview-icons.png`).
- Older notes below (gold mic, gold bolt) are history.

- Since 1.1.1 the icon is the **neon bolt**: `scripts/icons/design-bolt.mjs` writes `branding/bolt/*.svg`
  (`node scripts/icons/design-bolt.mjs`; preview: `node scripts/icons/preview-bolt.mjs` → `branding/preview-bolt.png`).
  `npm run icons` (`build.mjs`, `ICONS = 'branding/bolt'`) renders everything with `@resvg/resvg-js`:
  web favicons/PWA icons in `public/` (favicon/48px from `icon-small.svg`), Android adaptive icons for
  `app` and `wear` — foregrounds as PNGs per density (`drawable-*/ic_launcher_fg.png`, quick/stop variants),
  because the glow is a blur and vector drawables can't blur; background and monochrome stay vectors
  (radial gradients supported) — plus the splash, `ic_stat_mic` (now the bolt glyph, name kept) and
  `ic_bolt_white` (watch tile/complication). Watch round bitmaps come from `watch-round.svg`.
- Record buttons keep the mic: `ic_mic_white` is built from the old `branding/glyph-mic.svg`
  (the gold-mic set from `design.mjs` stays in `branding/`).
- The web sidebar/login logo is separate and unchanged. Don't hand-edit generated icon files.

## Smart append & projects (backend `quickAppend.js`, `projects.js`)

- The classifier gets CANDIDATES (open errands, active projects, 14-day notes, 30-day events/reminders)
  and returns `action/targetId/confidence/addItems/removeItems/changes/appendText/...`. Thresholds and
  "always ask" toggles live in `config.quickSettings` (`GET/PUT /api/quick/settings`).
- An applied append is a hidden capture (`kind:'append'`, `appliedTo`, `resultLine`) plus an audit entry
  on the target, so Undo/Move reverse it exactly. Asks are `status:'pending_decision'` until
  `POST /api/quick/:id/decide` (yes|new|other) or the 2-minute sweep (→ new note + `possibleMatch`).
- Routes `/api/quick/targets` and `/api/quick/settings` must stay registered before `/api/quick/:id`.
- Combine: `POST /api/quick/combine`, `POST /api/quick/:id/split`. Projects: `/api/projects…`
  (`ARCHIVE/08_Projects/{id}.json`, soft delete).
- Android: notification/widget actions go through `QuickActionReceiver` → `ErrandWorker.captureAction`;
  the watch sends `/pa/decide` `{captureId, choice}`. Widget/notification *Move* opens
  `/quick/inbox?move=<captureId>`.

## Stopping a recording (Part C)

> Since 1.1.0 the key behavior comes from `RecorderPrefs` (Settings → Recording & shortcuts, see below):
> volume up and down both stop & save by default. The `volumeStop`/`launcherToggle` settings below are migrated.

- `QuickRecorderService` holds a `MediaSessionCompat` with a remote `VolumeProviderCompat` only while
  recording (volume down → stop; up ignored), released in `stopRecording`/`onDestroy`.
  `MainActivity.onKeyDown/onKeyUp` handle the keys when the app is on screen.
- `.QuickRecordLauncher` stops when already recording (`TokenStore.launcherToggle`);
  `.StopRecordLauncher` (alias of `RecordTrampolineActivity`) only ever stops.
- Settings (`volumeStop`, `launcherToggle`) are stored in localStorage and pushed to native through
  `QuickRecorder.configure` (`src/native/nativeSession.js`).
- Emulator testing: screen-off key injection is unreliable there (the screen woke and the key arrived
  late). Test the session routing with another app in front (`input keyevent 25` after HOME); keys that
  aren't consumed by a window take the same MediaSessionService path as screen-off keys on a phone.
  `adb emu event send` needs the console auth token. Recordings stop after 4 s of silence, so press quickly.

## Create menu, note view, appearance (2026-10-16)

- **"+" create menu** (`components/create/`): `CreateMenu` (speed dial, shown on /quick, /quick/inbox,
  /projects or everywhere), `NoteComposer` (text + markdown, or checklist with drag reorder),
  `ImageComposer` (web file inputs; app: `native/camera.js` → `@capacitor/camera`, system camera
  intent + photo picker, no extra Android permissions), `DrawingComposer` (canvas → PNG).
- Backend (`quickCapture.js`): `POST /api/quick/text` {title, body | items, aiOrganize, color, pinned}
  and `POST /api/quick/media` (multer, ≤ 20 MB, kind image|drawing) → `runTextPipeline` = the voice
  pipeline without transcription (classify → smart append → errands/calendar → summary). What was typed
  wins over the classifier (title, body, items). `aiOrganize: false` → `saveAsTyped`, no summary.
  Notes carry `source` (voice|text|list|image|drawing), `typed`, `format: 'list'` (checklist on a
  plain note — PATCH /items works for these too, incl. `reorder`), `media {kind,file}`, `mediaText`
  (Gemini `readImage`: photo text/description or handwriting via `POST /:id/handwriting`).
  Files: `07_Quick_Notes/media/`. `GET /:id/media` (media token works in the app).
  Also `PATCH /:id/meta` {pinned, color}, `POST /:id/restore`, `GET /api/quick/search`.
- **Note view**: route `/quick/:id` renders the inbox with `NoteView` on top (styles card | full |
  sheet | side; `auto` = card ≥ 768px, sheet on phones). Legacy `/quick/inbox?note=` redirects there
  (widget/watch/calendar links). Prev/next (swipe, ←/→) use the inbox's current order. "Expand in place"
  keeps the old in-card behavior. Shared pieces: `NoteContent`, `NoteToolbar`, `noteHelpers.js`.
- **Appearance** (`lib/appearance.js`, `context/AppearanceContext.jsx` + `appearanceStore.js`):
  groups opening / inbox / look / theme / behavior; shared on the server (`GET/PUT /api/appearance`,
  `config.appearance`), per-group "This device" overrides in localStorage (`pa_appearance`).
  Applied as `<html data-theme data-accent data-textsize data-density data-motion data-cardstyle>`.
  Tailwind `gold-*` = `--accent-*` CSS variables (rgb triplets), so every gold utility follows the accent;
  the logo uses `bg-brand-gradient` and stays gold. The old `pa_darkMode` is migrated once.
- Tests (scratchpad, not in git): `create-e2e.cjs` (real AI), `fftools/create-ui.cjs` (every opening
  style × phone/desktop, layouts, composers, settings), `voice-default.cjs`.

## Location reminders, maps, capture screen, toolbar (1.1.0)

- **Location reminders** (backend `quickCapture.js` + `places.js`): the classifier returns `geoWhen`
  ('' | arrive | leave), `geoPlace` (what was said) and `geoPlaceId` (from the PLACES block: home, work,
  saved places). `prepareGeo` sets `note.geo` {when, query, placeId, name, address, lat, lng, radiusM
  (home 100, else 150), status active | needs_place | done}. `POST /api/quick/:id/geo-place` (placeId, or
  lat/lng/name/address → saves the place with the spoken words as an alias). `GET /api/location-reminders`.
  `/api/errands/active` prepends them as `kind:'reminder'` with keys `ar|lv:<placeId>:<lat>,<lng>`.
- Radius (1.2.0, `places.js` `radiusFor`): per place `radiusMode` auto|small|medium|large|xl|custom (+ `radiusM`);
  Auto = `autoRadiusM` from the Nominatim bounding box (`areaRadiusFromBox`, 150 m–2 km; home 100 m). Search results carry
  `areaRadiusM`; old saved places get it once in the background (`backfillAreas`). `PUT /api/places/radius/:id`,
  `POST /api/places/work` (current location). A moved pin / new radius updates every active reminder (`places.onChange`
  → `refreshGeoNotes`), and `/api/errands/active` always uses the live place (`liveGeo`).
- Android: `ErrandSync` registers arrive = ENTER (≥ 250 m fire on ENTER) + DWELL for small places (30 s personal,
  60 s stores), leave = ENTER|EXIT; personal places without an initial trigger. `FENCE_VERSION` + permission state are
  in the signature (an update or a permission change re-arms). `LocationCheck` = fallback: low-power location updates
  every ~15 min while anything is armed (`LocationFallbackReceiver`) + last location at each sync; fires on
  outside→inside / inside→outside using `ErrandStore.inside`. `ErrandBootReceiver` also handles PROVIDERS_CHANGED /
  MODE_CHANGED. Events (`ErrandStore.recordEvent`) are queued and uploaded by `ErrandWorker.uploadEvents`.
  Plugin: `getLocationStatus`, `getReminderDistances`, `testLocationReminder`, `getNotificationStatus`,
  `sendTestNotification`, `openNotificationSettings`, `openLocationAccuracy`.
- Emulator geofence test: a temporary `src/debug` receiver with ops suppress (remove fences, keep the signature),
  check (fresh location → `LocationCheck.check`) and sync; WebView DevTools via
  `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` for screenshots. Delete `src/debug` afterwards.
- Address lookup fallback (1.2.1): `lib/placeLookup.js` (`findPlaces`, `findAddress`, `setHomeFromAddress`) tries the
  server (OpenStreetMap / Census / ZIP) first, then — in the app only — Android's Geocoder via the plugin
  (`geocode` / `reverseGeocode` → `quick/DeviceGeocoder.kt`). Home found that way is saved with `source: 'geocoder'`.
  Use these helpers, not `searchPlaces` / `reversePlace` directly. No paid map APIs.
- Web: `components/places/` (GeoPlacePrompt, PlaceAdjust = pin + radius editor, LocationReminders, PlacesMap,
  NoteMap, MapView with `edit` mode and circle size chips), `components/NotificationSettings.jsx`, `lib/radius.js`.
- **Maps**: `maps.js` serves `ARCHIVE/09_Maps/*.pmtiles` with range requests (+ cached fonts/sprites). See
  `docs/maps.md` in the monorepo. Never commit the map file. MapView gotchas: MapLibre 6's worker is a
  separate ES module (`?worker&url` + `setWorkerUrl`, `worker.format: 'es'` in vite.config), and
  `.maplibregl-map { position: relative }` beats Tailwind's `absolute`, so the container uses inline styles.
- **Capture screen**: `components/quick/CaptureStage.jsx` + `VoiceWaveform.jsx` (canvas; neon / gold / bars;
  web uses an AnalyserNode, native sends ~20 levels/s). Appearance group `capture` {micSize, waveform, afterDone}.
- **Note toolbar**: `NoteToolbar.jsx` + `toolbarActions.js` + `ToolbarEditor.jsx`; appearance group `toolbar`
  {order, hidden}. The toolbar is `data-no-swipe`; NoteView only swipes from `[data-note-body]`.
  Edge fades are a CSS mask (they work on any note color). Delete is always in ⋯ More.
- **Recording & shortcuts** (native only): `components/RecordingSettings.jsx` ⇄ `quick/RecorderPrefs.kt`,
  `RecorderGuard.kt` (double-action guards), `RecorderKeys.kt`, `DiscardStore.kt`, `VolumeShortcutService.kt`;
  the watch syncs via `/pa/rec-settings(-watch)`.
- "Done" bug (fixed): the create menu's invisible wrapper covered the result card's Done button. The FAB
  wrapper is `pointer-events-none`; only the button and the open menu take taps.
- Emulator: start it with `-camera-back none -camera-front none -no-snapshot` (the emulated camera crashes
  Vulkan on this PC). Git Bash needs `MSYS_NO_PATHCONV=1` for adb paths. Mock-location walk scripts and
  UI tests live in the session scratchpad, not in git.

## Next up

- ~~Galaxy Watch 9 (Wear OS) app~~ — done (see above).
