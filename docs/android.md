# Pocket Archive for Android

The Android app wraps the existing React frontend with [Capacitor](https://capacitorjs.com/)
and adds a native **Quick Recorder**, so voice notes can be captured with one tap,
with the screen off, from a home-screen widget, a Quick Settings tile, or an app
shortcut. The web app is unchanged and keeps working as before.

- **Package:** `com.sanpan003.pocketarchive` · **minSdk** 26 (Android 8) · **targetSdk** 37
- **Server:** set at build time in `.env.android` (`VITE_API_BASE_URL`), e.g.
  `https://your-nas.example.com:8443`
- **Screens load from the server** (Capacitor `server.url`), so deploying the web app
  updates the app's UI too. A new APK is only needed for native changes. If the server
  can't be reached, a built-in offline page with a Retry button is shown.

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
            ├── QuickToggleWidget.kt       resizable home-screen widget (1×1 … 4×2+)
            ├── WidgetData.kt              cached list of recent quick notes (GET /api/quick/recent)
            ├── WidgetState.kt             Uploading → Processing → result line
            ├── WidgetRefreshWorker.kt     refresh every 30 min (network only)
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
| App → Quick Capture | Big mic button (native recorder); the **+** menu adds text, list, photo and drawing notes |
| **Home-screen widget** (resizable) | **1×1:** gold mic. Tap = start, tap again = stop + upload; doesn't open the app. **2×1 / 3×1:** mic + status line ("Last: Dentist · 2h ago" / "● 0:12 Tap to stop"). **4×2+:** header (tap → Inbox) with mic and a "pending" badge for offline recordings, the 5 most recent quick notes (tap one → it opens expanded in the Inbox; amber dot = needs review), a big Stop button with a live timer while recording, and "Uploading… → Processing… → result" after stopping. The list is cached, so it shows offline (with an "Offline" hint). It refreshes after every capture, when the app opens, and every 30 min with a network connection. |
| **Quick Settings tile** "Quick Capture" | Same toggle; also from the lock screen |
| **App shortcuts** (long-press the icon) | *Quick Capture* (starts recording) · *Inbox* |
| **"Quick Record" launcher icon** | Opens the app and starts recording. Opened again **while recording**, it stops and uploads instead (setting *Quick Record stops a recording*, default on). Choose it for the Samsung side key: *Settings → Advanced features → Side button → Double press → Open app → Quick Record*. |
| **"Stop Recording" launcher icon** | No screen at all: stops and uploads if a recording is running, does nothing otherwise (never starts one). Icon: the app icon with a small stop square. For Samsung Routines or the side key (see *Stopping a recording*). |
| **Volume keys** | While recording (screen on or off): volume up or down stops and saves by default. Each key can also discard or do nothing; see *Recording & shortcuts*. |
| Intent `com.sanpan003.pocketarchive.START_RECORDING` | For automations (Bixby Routines, Tasker) |
| Intent `com.sanpan003.pocketarchive.OPEN_INBOX` | Opens the Quick Capture inbox |

## Stopping a recording

All options live in **Settings → Recording & shortcuts** (Android app; per device, not shared with the
web). Presets at the top set everything at once.

| Option | Choices (default first) |
|---|---|
| Volume up while recording | Stop & save · Ignore |
| Volume down while recording | Stop & save · Discard · Ignore |
| Long-press volume down | Off · Discard |
| Opening Quick Record while recording | Stop & save · Ignore · Start a new note |
| Auto-stop after silence | 4 s · Off · 3 · 6 · 10 s |
| Maximum length | 2 min · 1 · 5 · 10 min |
| Start/stop feedback | Vibrate + chime · Vibrate only · Chime only · None |
| Countdown beep before recording | Off · On |

- **Discard** asks nothing: a "Discarded" notification offers **Undo** for 10 seconds.
- **No double actions:** the press that stops a recording never starts a new one (starts are ignored for
  3 s after a stop, configurable 2–5 s, and a Quick Record launch right after a key stop counts as the
  same press), and stop keys are ignored for 1.5 s after a start.
- **Start methods** are listed with setup steps and buttons that open the right screen (Samsung side
  key, Routines, Galaxy Wearable, battery, assistant, widget, Quick Settings tile).
  *Test a key* shows what a key press would do.
- **Double-press volume shortcuts** (optional, off by default) use an accessibility service and work
  only while the screen is on. The screen explains this and has a *Turn off* button.
- Galaxy Watch: the same options on the watch's settings page (swipe left), synced both ways.

How it works: while (and only while) recording, the recorder service holds a media session with a
"remote" volume control, so Android sends the volume keys to it instead of changing the volume. It's
released the moment recording stops, so the keys go back to normal and a stray press can never start a
recording. With the app on screen, the activity handles the keys first (no double stop).

**Samsung settings**

- *Settings → Apps → Pocket Archive → Battery → Unrestricted*, so the recorder isn't paused with the screen off.
- *Settings → Sounds and vibration → Volume → Use Volume keys for media* can stay either way; the
  recording session takes the keys while it's active.
- Side key: *Settings → Advanced features → Side button → Double press → Open app → Quick Record*
  (starts, and stops when pressed again) or *Stop Recording* (stops only).
- Routines (*Modes and Routines → Routines → +*): add the action *Apps → Open an app → Stop Recording*
  (or *Quick Record*) to stop/start from any trigger.
- Android has no way to hide a launcher entry from the app drawer and still offer it to the side key and
  Routines, so *Quick Record* and *Stop Recording* both appear there. Put them in a folder if you like.

## Create menu, opening notes, appearance

The gold **+** button (Quick Capture, Inbox, Projects — or everywhere, in Settings) opens:

| | |
|---|---|
| Voice | The recorder, as before. |
| Text | Title + note (markdown). |
| List | Checklist: type + Enter adds, drag the handle to reorder, tick items off. |
| Image | *Take photo* (the phone's camera app) or *From gallery* (Android's photo picker — the app only sees the photo you pick; no storage permission). Optional caption. |
| Drawing | Full screen: pen, highlighter, eraser, 6 colors, 3 sizes, undo/redo, clear. *Convert handwriting* in the note turns writing into text. |

**✨ Let AI organize** (on by default) sends typed notes and photos through the same AI as voice notes:
lists, reminders, calendar events, adding to an existing list or project (with Undo / Move / "Add to …?"),
and a summary. Photos are read by Gemini first (receipts, whiteboards, labels), so their text is
searchable. Off = saved exactly as typed.

Tapping a note opens just that note — floating card (wide screens), bottom sheet that expands to full
screen (phones), full screen, side panel, or expand in place (Settings → *Appearance & layout*). The
Android Back button closes it; swipe left/right for the previous/next note. Widget and watch links open
the note the same way.

*Appearance & layout* also has the Inbox layout (Keep-style grid, list, compact), card preview, pinned
notes, sort, card style, note colors, theme (System/Light/Dark/Black), accent color, text size, density,
animations, default screen and haptics. Each group can apply to all devices or just this phone.

## Smart append, projects & combining notes

A new capture can be added to something that already exists instead of becoming a new note:
*"Also need eggs and bread"* → *"+2 → Publix list"*; *"Move the dentist to 4 PM"* → the event changes;
*"I want to add to Pocket Archive: …"* → a dated update on that project.

| | |
|---|---|
| Sure (≥ 85 %) | Applied right away. Toast/notification/widget/watch: *Undo* (and *Move* on phone and web) for 30 s. |
| Unsure (60–85 %) | *"Add to Publix list?"* → **Yes / New note / Other…** in the app, as notification actions, on the widget (Yes / New note) and on the watch (Yes / New). No answer in 2 minutes → saved as a new note with a *Possible match* chip and a one-tap *Merge*. |
| Cancelling an event | Always asks (unless turned off and ≥ 90 % sure). |
| Explicit "add to X" | Always appends. Several notes share that name and there's no project yet → a project is created with them (*"📁 Created project Pocket Archive with 4 notes · Undo"*). |
| Projects | Sidebar → Projects: living AI summary, timeline of updates, rename/merge/delete (restorable from Trash). |
| Cards | *Merge into…*, *Add to project…*, *Updated N×* chip with the update timeline. |
| Select & combine | Inbox → *Select* (or long-press a card) → **Combine (N)** / Add to project… / Delete. Choose the main note and title; the others become dated updates with their audio and transcripts kept; checklists merge without duplicates. *Undo* or *Split back* later. |
| Settings | Settings → *Smart append*: confidence slider, *Always ask before changing events*. |

Everything is undone exactly from an audit log (items restored in place, events restored on Google Calendar).

## Errands & arrival reminders

Say things like *"Tomorrow I need to go to Publix for milk, ketchup and yogurt"* or *"Remind me
when I get to Publix to buy milk and soda"*. The note becomes an **errand**: a checklist, a store, and
a reminder.

| | |
|---|---|
| Checklist | Tap items in the Inbox (web or app). Checked items move to the bottom. The errand is done when every item is checked, or with **Mark done**. |
| Store | Settings → *Places & errands*: set your **home location** once. Chains (Publix, Target…) are matched to stores within 15 miles of home (OpenStreetMap). Under **My Places** you can pin your usual store for an alias; its address goes on the calendar event. |
| Calendar | A dated errand gets an all-day event (timed if you said a time) with the store address as the location and the checklist (☐/☑) in the description. It updates as you tick items. Arrival-only errands have no event. |
| Arrival | The app registers geofences (150 m) around the nearby stores of active errands, up to 100, closest to home first. After about a minute inside one: **"🛒 You're at Publix — 3 items"** with Open list / Done / Snooze 1 hr. It doesn't repeat for the same store within 2 hours, and it shows on a paired Galaxy Watch too. |
| Privacy | Your location never leaves the phone; only store coordinates come from your server. The phone tells the server only that a reminder fired (the day), never where you were. |
| Setting | *Remind me on arrival for store errands* (default on) adds arrival to dated store trips. Arrival reminders expire after 14 days (configurable) unless they fired. |

Arrival reminders need location **"Allow all the time"**. The app explains this and asks when your first
arrival errand exists. Until it's allowed, the Inbox shows a banner.

## Location reminders (any place)

*"Remind me to put clothes in the dryer when I get home"*, *"When I leave work, call mom"*,
*"Next time I'm at my son's school, ask about the field trip"*: any reminder tied to arriving at or
leaving a place.

| | |
|---|---|
| Places | **Home** (always available once set), **Work**, and your own saved places in Settings → *Places & errands* (name + address or *Use my current location*, plus aliases like "the office"). |
| Unknown place | The note asks once: **Where is "my son's school"?** (current location, search an address, or a saved place). The place is saved with the words you used, so next time it's known. |
| Size | Auto (default) fits the place: its OpenStreetMap area for big places (airport, campus, mall, park, hospital), at least 150 m (home 100 m), at most 2 km. Or pick Small 100 m / Medium 250 m / Large 500 m / Extra large 1 km per place, or drag the slider. **Pin & radius** (Settings → Places & errands, or Change → Adjust on the map on a reminder) moves the pin on the map. |
| Trigger | Arrive = on entering the circle; places under 250 m wait ~30 s inside (stores 1 min) so driving past doesn't count. Leave = when you exit. |
| Backup | While a reminder is active the phone asks for a low-power location about every 15 minutes (and checks at every 30-minute sync and when you open Location reminders). Outside → inside fires an arrival the geofence missed; inside → outside fires a "when I leave". The location stays on the phone. |
| Re-arming | After a restart, an app update, a location permission change, or turning location back on. |
| Notification | 🏠 *You're home — Put clothes in the dryer* / 🚪 *Leaving Work — …* / 📍 *You're at …*, with **Done / Snooze 1 hr / Open**, also on the watch. |
| Settings | *Places & errands → Location reminders*: every reminder with its size, distance from you now (computed on the phone) and last event; checks with fix-it buttons (location all the time, precise location, Google Location Accuracy, notifications and the "Arrival reminders" category, battery Unrestricted), the backup check, and **Test**. *Settings → Notifications*: every notification category with a button to turn it back on, and test notifications for the phone and the watch. |
| Event log | The phone reports armed / entered / left / stayed / backup check / notified with the time and the place id — never coordinates (`POST /api/location-reminders/events`; shown per reminder). |

Why "lock my car when I get to work" (Work = St. Pete–Clearwater airport) didn't fire before 1.2.0: the airport
was saved as a point (where OpenStreetMap puts it) with a 150 m circle, and arriving needed a full minute inside
that circle. The airport is ~3 km across, so arriving at the terminal or a parking lot never came that close.
Now the circle comes from the airport's area (2 km) and entering it is enough.

Why "when I get home" didn't work before 1.1.0: the note was saved as a plain reminder without a
place, because arrival reminders only existed for store errands. The phone registered no geofence for it.

## Map

Places & errands has a **Map** (home, work, saved places, stores, reminder areas), and reminder and
errand notes show a small map. The map is **self-hosted OpenStreetMap** (Protomaps): tiles come from
your own server (`ARCHIVE/09_Maps/florida.pmtiles`), so nothing goes to a map company. *Directions*
still opens Google Maps. To update or change the map area see [maps.md](maps.md).

## Galaxy Watch app

A Wear OS companion app (`android/wear`, same package and signing key as the phone app).

| | |
|---|---|
| Record | Big gold mic → recording screen with a red pulsing ring, timer and Stop. Stops after 4 s of silence or 2 min, like the phone. Short buzz on start, double buzz on stop. |
| Quick Record | A second launcher entry that starts recording right away. Galaxy Watch: *Settings → Advanced features → Customize keys → Double press Home key → Quick Record*. |
| Sending | The watch sends the audio to the phone over Bluetooth/Wi-Fi (Wearable Data Layer). The phone uploads it with its normal queue and retries. No phone nearby: *"Queued — will send when your phone is nearby"*. If the phone stays away 10+ minutes and the watch has its own Wi-Fi/LTE, the watch uploads directly with the phone's device token (stored encrypted on the watch). |
| Result | The server's confirmation shows on the watch for 4 s (e.g. "🛒 Publix list · 3 items"), with a double buzz, or amber with a long buzz for needs-review. The phone's own notification then stays on the phone. Smart append: *"+2 → Publix list"* with **Undo** (8 s), or *"Add to …?"* with **Yes / New** (30 s). |
| Tile | Mic button, last note + time, "🛒 N open errands". |
| Complication | Mic icon for any watch face (short text, small image, monochrome); tap to record. |
| Recent / Errands | Swipe left from the record screen. Recent: tap a note for its AI summary (scroll with the bezel/crown). Errands: tap an item to check it off; works offline and syncs through the phone. |
| Arrival | When the phone detects you at a store, the watch shows the list itself; *Open list* opens the checklist on the watch. Location reminders (home, work, any place) show there too. |
| Settings | Swipe to the last page: the same recording options as the phone, synced both ways. |

Revoking the phone in Settings → Devices also stops the watch (it uses the phone's token).
Install: `update-android.bat` (see *Releasing*), or `adb -s <watch> install -r PocketArchiveWatch.apk`
after pairing the watch for wireless debugging (Developer options → Wireless debugging → Pair new device;
`adb pair <ip>:<pairing-port>`, then `adb connect <ip>:<port>`).

## Permissions

| Permission | Why |
|---|---|
| `RECORD_AUDIO` | Recording voice notes (asked on first launch) |
| `POST_NOTIFICATIONS` (Android 13+) | "Recording… tap to stop" and the saved/queued confirmations (asked on first launch) |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE` (Android 14+) | Keep recording with the screen off |
| `INTERNET` | Talk to your server |
| `VIBRATE` | Start / saved / needs-review vibrations |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION` | Errand and location reminders (geofences). Asked only when you create your first one. |
| Accessibility service (optional) | Double-press volume shortcuts. Off unless you turn it on in Recording & shortcuts. |
| `RECEIVE_BOOT_COMPLETED` | Re-register store geofences after a reboot |
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

3. **Build the APK** (or just run `update-android.bat`, see "Releasing" below):

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

## Releasing

`update-android.bat` in the frontend folder does everything:

1. checks the keystore and `keystore.properties` exist (never creates a key)
2. `npm run build:android` (bundles the app and points it at the server from `.env.android`)
3. `gradlew assembleRelease`, which bumps `versionCode` +1 and the patch of `versionName`
   (`android/app/version.properties`)
4. verifies the signing certificate, copies the APK to `Documents\PocketArchive.apk`
5. `adb install -r` on every connected phone (USB or Wi-Fi)

**Wireless installs:** on the phone go to *Developer options → Wireless debugging →
Pair device with pairing code*. On the PC run `adb pair <ip>:<pairing-port>` (enter the
code), then `adb connect <ip>:<port>` using the port from the main Wireless debugging screen.

## Install

1. Copy `PocketArchive.apk` to the phone (USB, Google Drive, email…).
2. Open it. Android asks to allow installs from that app (Files, Drive, …) once.
3. Open **Pocket Archive** → allow microphone and notifications → sign in with your
   Pocket Archive password.
4. Optional:
   - **Widget:** long-press the home screen → Widgets → Pocket Archive → *Quick Capture*. Long-press it and drag the handles to resize (1×1 up to 4×2 or larger).
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
