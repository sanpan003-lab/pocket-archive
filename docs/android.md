# Pocket Archive for Android

The Android app wraps the existing React frontend with [Capacitor](https://capacitorjs.com/)
and adds a native **Quick Recorder**, so voice notes can be captured with one tap,
with the screen off, from a home-screen widget, a Quick Settings tile, or an app
shortcut. The web app is unchanged and keeps working as before.

- **Package:** `com.sanpan003.pocketarchive` · **minSdk** 26 (Android 8) · **targetSdk** 37
- **Server:** set at build time in `.env.android` (`VITE_API_BASE_URL`), e.g.
  `https://your-nas.example.com:8443`

## Architecture

```
frontend/ (React, Vite)
├── src/lib/platform.js        isNative + API base URL (web: "/api", app: VITE_API_BASE_URL + "/api")
├── src/native/                app-only glue (no effect in a browser)
│   ├── quickRecorder.js       registerPlugin('QuickRecorder')
│   ├── nativeSession.js       device token (Keystore-backed) + media tokens
│   ├── NativeBridge.jsx       Android back button, shortcut/notification routes
│   └── PermissionGate.jsx     first-launch microphone + notification explanation
├── src/hooks/useNativeRecorder.js   QuickCapturePage uses this in the app, the web recorder otherwise
└── android/                   Capacitor Android project (Kotlin)
    └── app/src/main/java/com/sanpan003/pocketarchive/
        ├── MainActivity.kt                START_RECORDING / OPEN_INBOX intents
        └── quick/
            ├── QuickRecorderPlugin.kt     JS ⇄ native bridge (start/stop, token, permissions, events)
            ├── QuickRecorderService.kt    foreground service (type=microphone), MediaRecorder AAC/.m4a,
            │                              4 s silence / 2 min auto-stop, uploads right after stopping
            ├── Uploader.kt                OkHttp multipart POST /api/quick/capture with the Bearer token
            ├── UploadWorker.kt            WorkManager retries (network required, exponential backoff)
            ├── PendingStore.kt            recordings waiting to upload (app-private storage)
            ├── ResultNotifier.kt          auto-dismissing result notification + vibration
            ├── TokenStore.kt              device token encrypted with an Android Keystore AES key
            ├── QuickToggleWidget.kt       1×1 home-screen widget (tap = start/stop)
            ├── QuickCaptureTileService.kt Quick Settings tile (also on the lock screen)
            └── RecordTrampolineActivity.kt invisible activity used by widget/tile to start recording
```

### How a capture flows

1. **Start** from the app, widget, tile, shortcut, or the "Quick Record" launcher icon.
   Android only lets a *microphone* foreground service start while the app is in the
   foreground, so the widget and tile go through an invisible, instant activity
   (`RecordTrampolineActivity`) that starts the service and closes. The app UI never opens.
2. The **foreground service** records AAC/.m4a and shows *"Recording… tap to stop"*.
   It keeps recording with the screen off or the phone locked. It stops on tap, after
   4 seconds of silence, or at 2 minutes.
3. It **uploads immediately** to `POST /api/quick/capture` with
   `Authorization: Bearer <device token>`. Each recording carries a `clientId`, so
   retries never create duplicates.
4. **Offline or server error:** the file moves to the retry queue and **WorkManager**
   sends it when there's a network connection, with backoff, until it succeeds. The queue
   survives reboots.
5. **Result:** if the app is open on screen it shows its normal toast. Otherwise a short
   notification appears (e.g. *"📅 Added: Dentist · Tue 3 PM"*), using the server's
   `confirmation` field, with a double vibration. *Needs review* is amber with one long
   vibration. Notifications auto-dismiss after 4 s. The lock screen shows only a generic
   line ("✓ Voice note saved").

### Authentication

| | Web browser | Android app |
|---|---|---|
| Sign-in | `POST /api/auth/login` → session cookie (unchanged) | `POST /api/auth/device-token` → 90-day device token |
| Requests | cookie | `Authorization: Bearer <token>` |
| Storage | browser cookie (HttpOnly) | AES-256-GCM ciphertext; key in the Android Keystore |
| Audio / attachments | cookie | short-lived (12 h) read-only **media token** in `?mt=` |
| Sign out | clears the cookie | revokes the token on the server and deletes it locally |

The server stores **only a SHA-256 hash** of each device token. Manage signed-in phones
under **Settings → Devices** (in the web app or in the app); **Revoke** signs that phone
out immediately. Media tokens are signed with a separate key, work only for `GET` on
quick-note audio and attachment files, and can't be used as a session.

CORS allows the app's WebView origins (`https://localhost`, `capacitor://localhost`)
in addition to the existing development origins; everything else stays blocked.

## Entry points

| Entry point | What it does |
|---|---|
| App → Quick Capture | Big mic button (native recorder) |
| **Home-screen widget** (1×1 gold mic) | Tap = start, tap again = stop + upload. Turns red/orange while recording. Doesn't open the app. |
| **Quick Settings tile** "Quick Capture" | Same toggle; also from the lock screen |
| **App shortcuts** (long-press the icon) | *Quick Capture* (starts recording) · *Inbox* |
| **"Quick Record" launcher icon** | Opens the app and starts recording. Choose it for the Samsung side key: *Settings → Advanced features → Side button → Double press → Open app → Quick Record*. Hide the extra icon from your launcher if you don't want it in the app drawer. |
| Intent `com.sanpan003.pocketarchive.START_RECORDING` | For automations (Bixby Routines, Tasker) |
| Intent `com.sanpan003.pocketarchive.OPEN_INBOX` | Opens the Quick Capture inbox |

## Permissions

| Permission | Why |
|---|---|
| `RECORD_AUDIO` | Recording voice notes (asked on first launch) |
| `POST_NOTIFICATIONS` (Android 13+) | "Recording… tap to stop" and the saved/queued confirmations (asked on first launch) |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE` (Android 14+) | Keep recording with the screen off |
| `INTERNET` | Talk to your server |
| `VIBRATE` | Start / saved / needs-review vibrations |
| `WAKE_LOCK`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED` | Added by WorkManager so queued uploads run when the network returns, even after a reboot |

On first launch the app explains both permissions before asking. If you decline, Quick
Capture asks again when you first tap the mic, and the widget/tile opens the app instead.

## Build

Prerequisites (already on the build PC): Node 22+, Android Studio (bundled JDK 21),
Android SDK platform 37. Android Studio's tools aren't on `PATH`, so set them per shell:

```bash
# Git Bash
export JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
export ANDROID_HOME='C:\Users\sundi\AppData\Local\Android\Sdk'
```

1. **Configure the server** (once):

   ```bash
   cd frontend            # C:\Users\sundi\Documents\pocket-archive
   cp .env.android.example .env.android   # then set VITE_API_BASE_URL
   ```

2. **Bundle the web app into the Android project:**

   ```bash
   npm install
   npm run build:android  # vite build --mode android && cap sync android
   ```

   The plain web build (`npm run build`, used by `deploy-to-nas.bat`) does **not** read
   `.env.android` and keeps using `/api`.

3. **Build the APK:**

   ```bash
   cd android
   ./gradlew assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk
   ./gradlew assembleRelease   # → app/build/outputs/apk/release/app-release.apk (signed)
   ```

### Release signing

- Keystore: `C:\Users\sundi\keys\pocketarchive.jks` (outside the repo), alias `pocketarchive`.
- Credentials: `android/keystore.properties` (gitignored):

  ```properties
  storeFile=C:/Users/sundi/keys/pocketarchive.jks
  storePassword=…
  keyAlias=pocketarchive
  keyPassword=…
  ```

- Certificate SHA-256:
  `F4:41:B0:E3:7B:F5:10:40:73:9B:96:31:70:61:D1:71:F2:E1:C4:49:7F:79:D5:25:33:F3:12:06:5C:35:C7:21`

> **Back up the keystore *and* `keystore.properties` together** (password manager plus an
> offline copy). Android only installs updates signed with the same key. If you lose it,
> you must uninstall the app (losing any unsent recordings) to install a newly signed
> version.

Without `keystore.properties`, `assembleRelease` produces an unsigned APK.

## Install

1. Copy `PocketArchive.apk` to the phone (USB, Google Drive, email…).
2. Open it. Android asks to allow installs from that app (Files, Drive, …) once.
3. Open **Pocket Archive** → allow microphone and notifications → sign in with your
   Pocket Archive password.
4. Optional:
   - **Widget:** long-press the home screen → Widgets → Pocket Archive → *Quick Capture* (1×1).
   - **Tile:** pull down Quick Settings → edit (pencil) → drag *Quick Capture* into your tiles.
   - **Side key:** see "Quick Record" above.

Via USB with adb: `adb install -r PocketArchive.apk`.

**Updating:** install a newer APK signed with the same key; your sign-in and queued
recordings are kept.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Widget/tile opens the app instead of recording | Microphone permission is off or you're signed out — the app opens so you can fix it. |
| "Queued — will send when online" never clears | The phone can't reach `VITE_API_BASE_URL`, or the device was revoked (sign in again; queued notes send right away). |
| No notification after recording | Notifications are off for the app, or the "Saved notes" channel is muted (Android settings → Apps → Pocket Archive → Notifications). |
| Samsung stops recording in the background | Settings → Apps → Pocket Archive → Battery → **Unrestricted**. |
| Sign-in fails with "Network Error" | Check the server URL in `.env.android` is reachable from the phone (HTTPS, valid certificate), then rebuild. |
