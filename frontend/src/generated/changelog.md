# Changelog

What's new in Pocket Archive, newest first. This file is the single source of
truth: the app shows it in Settings → About → "What's new" (copied into
`frontend/src/generated/changelog.md` by `npm run changelog`, which also runs
before every build). Every release bumps the version and adds an entry here.

## 2.6.1 — Oct 23, 2026

### Fixes
- **Update watch** works again: the phone downloads the watch update first (with progress), checks it, then sends it — no more “open failed” errors
- Settings → About shows each step: **Downloading… → Sending to watch… → Confirm on your watch → Updated to 2.6.1**, and a clear reason when something stops it (no connection, Wi-Fi only, signed out, damaged download)
- The watch tries its own connection first (Wi-Fi, LTE or through the phone) and only asks the phone when it can’t
- What’s new shows **bold** text properly (no stray asterisks)

## 2.6.0 — Oct 23, 2026

### Scan and Camera
- The **+** menu has **Camera** and **Scan document** (the scanner finds the edges, crops and takes several pages) — each makes a new note
- **Widget:** Scan and Camera buttons next to the mic (2x1 and larger), plus an optional **1x1 Quick Scan** widget
- Long-press the app icon for **Scan document** and **Camera**, and add the **Quick Scan** tile to Quick Settings
- From the widget, shortcuts and tile only the scanner or camera opens; the note is saved in the background with a result on the widget like “🧾 Receipt · Publix · $43.18”. Offline it waits and uploads later

### Documents read for you
- Photos, scans and PDFs are recognized — **receipts, bills, medical, school, warranties, letters, business cards, handwritten notes** — with a **Details** card: store, total, tax, items, due dates, provider, warranty end, contact info…
- Edit any detail; your edits are never overwritten (if something different is found later, it asks)
- **Remind me** for a bill’s due date or 30 days before a warranty ends, **Save to contacts** for business cards — only when you tap
- Files into a matching project (with Undo), or asks first when it isn’t sure
- **Inbox → Documents** with Receipts, Bills, Medical… chips, and everything is searchable
- Card, bank account and ID numbers keep only their last 4 digits
- Settings → **Documents**: turn it off, or choose which kinds to organize. **Reprocess** on any note reads it again

### Edit photo and scan notes
- Add a title and text (above or below the images), more photos, camera shots, scan pages or files
- **Pages:** drag to reorder, rotate, crop, mark up (pen, highlighter, arrow, text), retake, delete, choose the cover, split or merge scans
- Every edit keeps the original — **Restore original** any time. The details are read again after changes (“Details updated”)
- Works on the web (except scanning), on shared notes for editors, and for Lite accounts

## 2.5.0 — Oct 22, 2026

### Attachments on notes
- **Attach** in the note toolbar: **Photo library**, **Camera**, **Scan document** and **Files** — PDF, Word, Excel, audio, any file, up to 25 MB each
- **Scan document** (app): Google’s on-device scanner finds the page edges, crops them and takes several pages into one PDF
- Photos show as thumbnails — tap for full screen and swipe between them. Files show as cards; tap to open them in the right app (or a new tab on the web). Audio files play right in the note
- Rename or delete any attachment from its ⋯ menu
- **Read text with AI** (optional): the text in photos and scans is read so you can search for it
- Works on the web too, for Lite accounts, and on shared notes (editors can add; viewers can open)

### Fewer accidental recordings
- **Better voice detection:** it now listens for a real voice — syllables with a moving pitch — so steady road noise, a fan or music no longer count as speech
- **Recent recording starts** (Settings → Accidental recordings): the last 20 starts from the phone and watch — what started each one (side key, Quick Record, routine, volume keys, widget, tile, watch), whether the screen was off or locked, the proximity sensor, what was heard, and what happened
- Voice notes show what started them (“Started from: Side key”)
- **Press again to confirm** is now one tap at the top of the section
- New strict option: **Side key & volume keys only when unlocked** — a press that wakes the phone or comes from the lock screen won’t record

## 2.4.0 — Oct 19, 2026

### Updates without a cable
- The phone app and the watch app now **update themselves from your NAS**: no more USB or adb for new versions
- When a new version is out you get a notification and a banner: **Update 2.4.x available · What’s new**, with **Update** or **Later**
- **Settings → About** shows your version, **Check for updates** and when it last checked. Checks run when you open the app and once a day — on Wi-Fi only, or on any network if you prefer
- Downloads show progress and pick up where they left off
- Only real Pocket Archive builds are installed: every download is checked against its fingerprint and must be signed with the same key as the app you have
- An update never interrupts a recording — it waits until you’re done
- First time only: Android asks you to allow **Install unknown apps** for Pocket Archive (the app shows you where)

### Watch
- The watch checks for updates itself, or gets them through your phone when it has no network of its own
- Watch Settings → **Check for updates**; the phone shows the watch’s version and has **Update watch**

### For the admin
- **Settings → Users → App updates**: what’s published, a held-back draft to **Publish** when you’re ready, and older versions to **Roll back** to
- Every device shows its app version and **Up to date / Update available** (Settings → Users and Settings → Security → Devices)
- Android can’t go back to an older version without uninstalling, so a rollback only stops devices that haven’t updated yet — the fix for a bad release is a newer build

## 2.3.0 — Oct 19, 2026

### Phone actions
- Say a command and your phone does it: **“wake me at 5:30”**, **“alarm every weekday at 6”**, **“set a timer for 10 minutes”**, **“directions to Publix”**, **“text Minal I’m on my way”**, **“call Mom”**, **“do not disturb for an hour”**, **“flashlight on”**, **“open Spotify”**
- Alarms and timers go to your Clock app (Samsung Clock shows them on your Galaxy Watch too). Undo opens Clock’s alarm list so you can delete the alarm there
- Messages and calls open **filled in** — nothing is ever sent or dialed for you. If several contacts or apps match, it asks which
- Do Not Disturb turns itself back off after the time you said; Do Not Disturb and the flashlight are off until you turn them on in Settings → **Alarms & phone actions**
- Commands from your watch run on your phone. Works for Lite (Pocket Notes) accounts too

### Actions tab
- Commands are kept in **Quick Capture → Actions** (Alarms, Timers, Messages & calls, Navigation, Other), not in your Inbox — no note, no AI summary. Kept 7 days (or 30, or forever)
- If you also said something worth keeping (“alarm at 3 to call the pharmacy about the refill, ask about the copay card”), you get a normal note with a small chip like **⏰ 3 PM**
- Settings → Appearance → “Show actions in Inbox” if you want them there. On the web the Actions tab is read-only

### Accidental recordings
- **Pocket detection** (on): a key press with the screen off and the phone in a pocket or bag doesn’t record — just one short buzz
- **No speech at the start** (on, 4 s): a recording without speech is set aside. It listens for speech, not just noise
- **Shorter than 2 seconds** (on): set aside too
- **Press again to confirm** (off): after a key press, press volume up or tap within 3 seconds to record
- Anything set aside is kept for 30 seconds with **Restore** — real speech is never lost. Settings shows how many were ignored this week
- After an ignored recording, new key presses are ignored for 3 seconds
- Tip in Settings: use the side key’s **double press** instead of press-and-hold
- The watch also sets aside recordings without speech or under 2 seconds (with Restore)

## 2.2.0 — Oct 18, 2026

### Pocket Notes (Lite)
- Lite accounts get a simpler app called **Pocket Notes**: Capture, Inbox, Lists, Projects, Shared with me, Calendar and Search. They keep AI summaries, smart append, errands, location reminders, sharing, the + menu and all appearance settings
- Lite opens on Capture (or Inbox, in Settings → Appearance). The Hey Pocket archive, recordings, sync and server settings aren't shown
- Admins: Settings → **Layout on this device** → "Use Lite layout on this device" to see exactly what Lite people see

### Welcome tour
- New accounts get a short walkthrough at first sign-in: password, optional two-step verification, home location, phone permissions (microphone, notifications, location all the time, precise location, battery), optional Google Calendar, and a 4-card tour. Skip any step; Settings → **Welcome tour** opens it again

### Also
- New **Lists** page with all your errands and checklists
- Search and the Calendar include notes and events shared with you
- Members without the archive no longer see Dashboard, Recordings or Sync in the menu

## 2.1.0 — Oct 18, 2026

### Sharing
- Share a list, note or project with someone on your server: open it → **Share with…** → pick a person → **Can edit** or **Can view**. Change or remove access any time; the other person can **Leave**
- People with *Can edit* can add, check off, edit and remove items and change the text; only you can delete, combine, move it or change who it's shared with. Sharing a project shares its notes
- New **Shared with me** page, a **Shared** filter in the Inbox, and a badge with the owner's initials on shared notes
- See who did what: initials next to items someone else added, and an **Activity** list on shared notes ("Jane added Eggs · 2 min ago")

### Live updates
- Changes show up on everyone's screen right away: lists, the Inbox, projects, and the widget while the app is open, with a short "Jane added Eggs" message
- Two people can edit the same list at the same time without losing anything
- Offline? Checking, adding or editing items still works; the changes are kept on the device ("Saved on this device") and sent when you're back online

### Notifications
- Settings → **Shared lists**: get a notification for every change, a summary, or nothing, with quiet hours. The phone checks every 15 minutes in the background, and the watch shows them too
- Optional (off by default): **let people on shared lists know when you're at the store** — they see "Jane is at Publix", never your location

### Also
- Location reminders on shared errands go off on both phones
- Saying "add yogurt to the Publix list" when you have your own Publix list and one shared with you asks **Add to which list?**
- Admins can set a **Family calendar** (Settings → Google Calendar). Leave it empty and events on shared lists go to the calendar of whoever created them

## 2.0.0 — Oct 18, 2026

### Accounts
- Pocket Archive now has accounts: sign in with a username and password. Your current password and data carry over to your (admin) account after a one-time upgrade on the server
- Everyone has their own private notes, lists, projects, places, location reminders, settings and Google Calendar
- The Hey Pocket archive (recordings, transcripts, AI notes, sync) stays yours only
- Settings → Users (admin): create accounts with a temporary password, choose Lite or Full, reset a password or two-step verification, unlock, disable, set a daily limit, export or delete an account (exported to a zip first). You see usage numbers, never anyone's notes
- New accounts set their own password at first sign-in

### Security
- Settings → Security: change your password, two-step verification with any authenticator app (QR code + 8 backup codes), and every browser, phone and watch you're signed in on, with Sign out per device or everywhere
- Too many wrong passwords lock the account for a while; sign-in attempts are limited per network address; error messages never reveal whether a username exists
- Recording audio now needs sign-in (it used to be reachable with just the link)
- A security log of sign-ins, lockouts and changes (never passwords or codes)

### Android app and watch
- Sign in with your username (and 2FA code if it's on)
- If someone else signs in on the same phone, your lists, widget and geofences are cleared and your queued recordings wait for you; they're never uploaded to someone else's account. Watch recordings follow the account they were made under

### Also
- Settings → Google Calendar: each person picks their own calendar, shares it with the server, and taps Test
- The sign-in page works in dark mode

Oct 17, 2026

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
