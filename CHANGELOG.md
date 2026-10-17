# Changelog

What's new in Pocket Archive, newest first. This file is the single source of
truth: the app shows it in Settings → About → "What's new" (copied into
`frontend/src/generated/changelog.md` by `npm run changelog`, which also runs
before every build). Every release bumps the version and adds an entry here.

## 1.3.0 — Oct 17, 2026

### New app icon: Purple Neon Bolt
- The bolt is now violet → indigo with a neon glow, on your choice of tile: **Dark** (default), **Light** (with a soft purple glow) or **AMOLED black**
- Settings → Appearance & layout → **App icon**, with a live home-screen preview
- Quick Record and Stop Recording follow the same tile; notifications, the splash screen, the Galaxy Watch icon, tile and complication use the purple bolt too
- The browser tab icon follows your choice
- After this update your launcher may drop the old home-screen icon once: add Pocket Archive again from the app drawer. If you pick Light or AMOLED and your side key or a Routine opens Quick Record / Stop Recording, choose them again there

Oct 17, 2026

### Finding addresses
- When OpenStreetMap can't find an address or a place (or can't be reached), the Android app now asks the phone's own address lookup (Android Geocoder) instead — free, no map account or API key
- Works for place search ("Where is …?", Add a place / store / Work), your home address, and the street address shown for "use my current location"
- Results from the phone are labeled, and a home found this way shows "Matched by your phone's address lookup"
- Search results that OpenStreetMap knows as a large area (airports, campuses) keep their Auto size even when a store search finds them too

## 1.2.0 — Oct 17, 2026

### Location reminders you can rely on
- Big places work: airports, campuses, malls, parks and hospitals get a circle that fits the place (from OpenStreetMap, up to 2 km), so "when I get to work" at an airport fires when you arrive, not only at one spot
- Reminders fire as soon as you enter a place; only small places (like home) wait a few seconds so driving past doesn't count
- A backup check: while a reminder is active, the phone also looks at its location about every 15 minutes and catches arrivals a geofence missed
- Reminders are set up again after a restart, an app update, a permission change or turning location back on

### Places
- Choose how big each place is: Small 100 m, Medium 250 m, Large 500 m, Extra large 1 km, or Auto (fits the place)
- "Pin & radius": drag the pin to the right spot and size the circle on the map (Settings → Places & errands, or Change on a reminder)
- "Set Work to my current location"
- Maps show the size of each reminder circle

### Checking that it works
- Settings → Notifications: whether notifications are allowed, every notification type with a button to turn it back on, and test notifications for the phone and the watch
- Location reminders: Google Location Accuracy and the backup check, plus for each reminder its size, how far you are from it now, and what last happened (entered, notified…)
- A short event log (armed, entered, left, notified) on your server, with the place only, never where you were

## 1.1.1 — Oct 16, 2026

### New icon
- A neon lightning bolt replaces the gold mic: app icon, round and themed (Android 13+) icons, Quick Record and Stop Recording, notifications, splash screen, browser tab and installed web app
- Galaxy Watch: new app icon, tile and complication
- Record buttons (widget, watch record screen) keep the mic, and the logo inside the web app is unchanged

## 1.1.0 — Oct 16, 2026

### Recording & shortcuts
- New Settings → Recording & shortcuts (Android app)
- Volume up now starts *and* stops: a Samsung routine starts Quick Record, and the next volume-up press stops and saves
- Choose what volume up, volume down and a long press of volume down do while recording: stop & save, discard, or ignore
- Discard asks nothing: a short "Discarded" notification offers Undo for 10 seconds
- Auto-stop after silence (off, 3–10 s), maximum length (1–10 min), start/stop vibration and chime, optional countdown beep
- No more double actions: the press that stops a recording never starts a new one, and the press that starts one never stops it
- Every way to start recording in one list, with setup steps and buttons that open the right Android or Samsung screen
- "Test a key": press a volume key and see what it would do
- Optional double-press volume shortcuts (works while the screen is on), off by default
- Galaxy Watch: the same recording options, editable on the phone or on the watch

### Location reminders
- "Remind me to … when I get home" now works, for any place: home, work, a school, a friend's house, a store
- Reminders when you arrive or when you leave (Done / Snooze 1 hr / Open on the phone and the watch)
- A place it doesn't know yet is asked once ("Where is …?": current location, an address, or a saved place) and remembered by the name you used
- Work and your own saved places in Settings → Places & errands, plus a Location reminders list with permission checks, the last trigger, and "Test this reminder"

### Maps
- A map in Places & errands (home, work, saved places, stores, reminders) and a small map in reminder and errand notes
- Self-hosted OpenStreetMap: map tiles come from your own server, nothing is sent to a map company; Directions still opens Google Maps

### Capture screen
- A bigger mic with a greeting, a gentle glow and example ideas to say
- Live neon waveform while you talk (or Gold, or Minimal bars), which settles into a pulse while the note is processed
- Mic size and waveform style in Settings → Appearance & layout → Capture screen; follows the Animations setting

### Note toolbar
- Scrolling the toolbar sideways no longer jumps to the next note; only swiping the note itself does
- Fades show there are more buttons, and a ⋯ More menu always has every action, including Delete
- Reorder or hide buttons: Settings → Appearance & layout → Note toolbar, or long-press the toolbar

### Fixes
- "Done" after a recording works again (the + button's hidden menu was covering it), and returns to Capture (or the Inbox, your choice)
- Project summaries no longer show empty "None" sections

### Also new
- What's new: this list, in Settings → About, plus a one-time summary after each update
- Release check: deploys now verify that the server, the app and the changelog are all on the same version

## 1.0.5 — Oct 16, 2026

### Create menu
- New + button with Voice, Text, List, Image and Drawing notes
- Typed notes, lists and photos go through the same AI as voice notes: events, reminders, shopping lists, adding to existing notes and projects, summaries
- Photos are read by AI (receipts, whiteboards, labels) so their text is searchable; drawings can convert handwriting to text

### Opening notes
- Notes open on their own: floating card, full screen, bottom sheet, side panel, expand in place, or Auto
- Swipe or use the arrow keys for the next note; Edit, Pin, Color, Add to project, Merge, Share, Delete and Restore in every note

### Appearance & layout
- Grid, list or compact Inbox; card preview length, sorting, pinned notes, day groups
- Card styles, Keep-style note colors, themes (including Black), accent colors, text size, density and animations
- Default screen when the app opens; settings shared across devices or kept on one device

### Search
- Search now finds quick notes too, including list items and text read from photos

## 1.0.4 — Oct 15, 2026

### Smart append & projects
- Projects with a living AI summary
- Add to, update or cancel existing notes, lists, events and projects by voice ("also need milk", "move the dentist to 4"), with Ask, Undo and Move
- Select several notes to combine them; split them back any time
- Undo, Move and Yes / New note on the widget, notifications and the watch

### Recording
- Volume down stops a recording (also with the screen off)
- Opening Quick Record again stops the recording; new "Stop Recording" shortcut

### Look
- New high-quality microphone app icon

## 1.0.3 — Oct 15, 2026

### Galaxy Watch
- Galaxy Watch app: record on the watch, results on your wrist
- Watch tile and watch-face complication
- Recent notes with their AI summaries and errand checklists on the watch

## 1.0.2 — Oct 15, 2026

### Errands & places
- Shopping lists and errands from voice, with real store locations
- Checklists in Google Calendar that update as you tick items
- Arrival reminders when you reach the store
- Home location with address fallbacks and "Use my current location"

## 1.0.1 — Oct 14, 2026

### Android
- Resizable home-screen widget with recent notes and a live recording timer
- Clearer Inbox cards: collapsed cards, color bars, day groups
- The app loads its screens from your server, so web updates reach the app without reinstalling; one-step Android updates

## 1.0.0 — Oct 14, 2026

### Android app
- Android app with lock-screen recording, home-screen widget, Quick Settings tile and app shortcuts
- Secure device sign-in; see and sign out devices in Settings → Devices

## 0.9 — Oct 14, 2026 (web)

### Quick Capture
- Voice notes → AI → calendar events, reminders, notes linked to recordings, or quick notes
- Inbox with Undo; recordings wait in an offline queue until you're back online
- Instant recording when Quick Capture is launched from the home screen
- On-screen confirmation toasts
- AI summaries for quick notes and correct audio length
- Google Calendar sync; installable as an app

## 0.8 — Oct 14, 2026 (web)

### AI notes
- AI notes back online on the current Claude model
- Hey Pocket Summary tab as the default fallback, with a Generate AI Notes button
- Hey Pocket timelines and flowcharts render as charts

## 0.7 — May 6–7, 2026 (web)

### AI notes
- Gemini AI notes by default, with Claude as an option to choose per recording
- Transcript tab on recordings
- Flowchart diagrams and charts inside AI notes, in one shared color palette
- "Install App" button
- The web app is built on the NAS with Docker

## 0.6 — May 1, 2026 (web)

### Recordings
- Create recordings (typed or by uploading audio)
- Edit title, date and notes
- Trash with restore

## 0.4 — May 1, 2026

- Portfolio screenshots in the GitHub repository

## 0.3 — Before May 1, 2026 (web)

### First version
- Self-hosted on the Synology NAS with Docker and a password login
- Dashboard, timeline, calendar, favorites, search and attachments
- Editable AI notes with charts; original notes show date, duration and recording ID
- Dark mode, mobile layout and Sync Now
