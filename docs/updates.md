# App updates over the air (2.4.0)

The phone app and the Galaxy Watch app update themselves from the NAS. There's no Play Store, no Firebase
and no third-party service: the NAS serves the APKs, and only devices that are signed in can download them.

## How it fits together

```
update-android.bat ──► builds + signs both APKs (pocketarchive.jks)
                   ──► scripts/publish-update.mjs ──► P:\_updates\phone|watch\   (= ARCHIVE/_updates on the NAS)
                   ──► adb install (only if a phone/watch is connected — optional now)
                   ──► scripts/verify-release.mjs --phone --published

phone app ──(device token)──► GET /api/updates/phone/latest?versionCode=…   (daily + on app open)
          ──(device token)──► GET /api/updates/phone/apk   (Range / resume)
          ──► SHA-256 ✓, same package ✓, higher versionCode ✓, same signing certificate ✓
          ──► PackageInstaller session (never during a recording)

watch app ──► GET /api/updates/watch/latest itself (when it has Wi-Fi / LTE + its token)
          └─► otherwise asks the phone: the phone downloads, checks, and sends the APK over the Data Layer
```

## Server (`updates.js`)

Folder `ARCHIVE/_updates/<phone|watch>/`:

| File | What |
|---|---|
| `pocket-archive-<target>-<versionName>-<versionCode>.apk` | the APK (newest 3 kept: current + 2 for rollback) |
| `….json` next to it | its details |
| `latest.json` | what devices are offered: `{ versionName, versionCode, sha256, size, minVersionCode, releaseNotes, publishedAt, file }` |
| `draft.json` | a build held back until the admin publishes it |

Routes (all need a **device token** — the phone/watch sign-in; a browser session gets 403, no token 401;
there is no public download link). Every user can update, Lite included.

| Route | |
|---|---|
| `GET /api/updates/:target/latest?versionCode=&versionName=` | records the device's version; the phone also sends `watchVersionCode/Name`. Answers `{…latest, available, required, rolledBack}` |
| `GET /api/updates/:target/apk` | streams the APK with Range support (resumable) |
| `POST /api/updates/:target/report` | `{ event: installed \| failed \| declined \| deferred \| rejected, versionCode, detail }` |
| `GET /api/admin/updates` | admin: latest, draft, kept versions per app |
| `POST /api/admin/updates/:target/publish` | admin: draft → latest |
| `DELETE /api/admin/updates/:target/draft` | admin: discard the draft |
| `POST /api/admin/updates/:target/rollback {versionCode}` | admin: offer a kept older version again |

Each device-token entry (`devices.json`) gets `apps.phone` / `apps.watch` = `{ versionCode, versionName, checkedAt }`.
Settings → Security → Devices and Settings → Users show the version and **Up to date / Update available**.
Checks, downloads, installs, rejections, publishes and rollbacks go to the security log with the device id and
version numbers only (no IP, names or content).

## Publishing

- `update-android.bat` — builds, publishes to `P:\_updates`, installs over adb if anything is connected, verifies.
- `update-android.bat draft` — same, but held back: **Settings → Users → App updates → Publish** when you're ready.
- By hand: `node scripts/publish-update.mjs [--draft] [--dir=<folder>] [--min=<minVersionCode>]`.
  `--min` makes older versions "Update required".
- Release notes are taken from that version's entry in `CHANGELOG.md`.

## Rolling back

Settings → Users → App updates → **Roll back** points `latest.json` at a kept older APK.
**Android never installs an older version over a newer one** (only after uninstalling, which wipes the app's
data). So a rollback only stops devices that haven't updated yet from getting the bad build; devices already on
it see "A newer build is on the way". The real fix for a bad release is to publish a fixed build with a
**higher** version — `update-android.bat` always bumps it.

## Phone app (`quick/AppUpdater.kt`, `quick/WatchUpdates.kt`)

- Checks on app open and once a day (WorkManager; **Wi-Fi only** by default, or any network — Settings → About).
- Notification + in-app banner "Update X available · What's new" with **Update / Later**.
- Settings → About: current version, **Check for updates**, last check time, progress, Wi-Fi only, watch version +
  **Update watch**.
- Download resumes (Range). Before installing it checks the SHA-256, the package name, that the version is
  higher, and that the APK is signed with the **same certificate** as the installed app. Anything else is
  rejected and reported.
- Installs with a PackageInstaller session. `USER_ACTION_NOT_REQUIRED` (Android 12+) makes later updates silent
  once the app itself installed the previous one; otherwise Android shows its confirm dialog. Google Play
  Protect may scan a new build first ("Scanning…") and can ask once — choose **Install anyway** or **Scan app**.
- Never during a recording: the install waits until the recording ends.
- After the update, the usual "What's new in X" sheet.

First time only: Android asks to allow **Install unknown apps** for Pocket Archive (Settings → Apps →
Pocket Archive → Install unknown apps → Allow). The app shows a button that opens that screen.

## Watch app (`wear/WatchUpdater.kt`)

- Checks once a day and from Settings → **Check for updates**. With its own network and token it asks the NAS
  directly; otherwise it asks the phone (`/pa/update-request`), which downloads the watch APK, checks it, and sends it
  over the Data Layer channel `/pa/update-apk/<versionCode>/<sha256>`.
- The watch checks the SHA-256 and signature again and installs with one confirm tap. Never during a recording.
- It publishes its version as the DataItem `/pa/watch-info`; the phone reports it to the NAS with its own check.

## Testing (no emulators)

Scratchpad scripts (not in git): `ota-e2e.cjs` (server, fake archive), `fftools/ota-ui.cjs` (admin UI),
`fftools/ota-device.cjs` (real phone, **PA Debug** build only: wrong key, tampered file, deferral while recording,
install, version report), `fftools/ota-wifi.cjs`, `fftools/ota-unknown.cjs`.
