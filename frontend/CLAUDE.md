# Pocket Archive frontend: notes for Claude

React + Vite web app. The same code runs in the browser and, through Capacitor,
inside the Android app (`android/`). The backend lives in
`C:\Users\sundi\Documents\pocket-archive-backend` (root files are the source of truth).

## Guardrails

- **Never** print, log or commit secrets: API keys, `docker-compose.yml` with real keys,
  service-account JSON, `.env*`, `android/keystore.properties`, `*.jks`.
- The web build must keep using the same-origin `/api` base URL. Don't change the web
  login cookie (name, httpOnly, SameSite, Secure, expiry) or `/api/auth/login`.
- Don't modify `C:\Users\sundi\Documents\deploy-to-nas.bat` or the Dockerfiles.
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

## Android release procedure

1. Make sure the web part is deployed if it changed: run `deploy-to-nas.bat`, copy the
   backend to the NAS, and rebuild the container (the app loads its screens from there).
2. From this folder run:

   ```bat
   update-android.bat
   ```

   It:
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

- Web: `npm run build` (0 errors) and `npx eslint <changed files>`. Known pre-existing lint
  errors: `AppContext.jsx` (react-refresh) and setState-in-effect in `SettingsPage`/`Dashboard`.
- Check dark mode and a 375px-wide viewport for UI changes.
- Android: `cd android && gradlew assembleDebug` and `gradlew :app:lintDebug` (0 errors).
  Plain `gradlew lint` also lints Capacitor's own module in node_modules, which has errors that aren't ours.
- Emulator against a local backend: after `npm run build:android`, point the generated
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

## Next up

- Galaxy Watch 9 (Wear OS) app: record button, watch tile, watch-face complication, audio relayed via
  phone, errand arrival lists on the watch.
