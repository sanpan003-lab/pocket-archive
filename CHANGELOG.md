# Changelog

What's new in Pocket Archive, newest first. This file is the single source of
truth: the app shows it in Settings → About → "What's new" (copied into
`frontend/src/generated/changelog.md` by `npm run changelog`, which also runs
before every build). Every release bumps the version and adds an entry here.

## 2.11.0 — Oct 26, 2026

### Settings, organized like your phone’s
- Settings opens on a short list: **Account & security**, **Recording & shortcuts**, **Notes & inbox**, **Places & reminders**, **Documents**, **Sharing & notifications**, **Offline & storage**, **Appearance & app icon**, **Watch**, **Admin** and **About & updates**
- Each one shows a live summary, like “App lock on · 2 devices”, “Everything · 2.1 GB” or “2.10.0 · Up to date”
- Tap one to open it. The ← arrow, Android Back and swipe-back take you back to the list
- Settings you rarely need are tucked under **Advanced** at the bottom
- You only see what your account and device can use: no admin settings for family members, no recording or watch settings on the web, and Watch only once a watch has connected
- **Search settings** jumps straight to the right screen and lights up the setting
- On a wide screen the list stays on the left and the settings show on the right
- Settings remembers the screen you last opened on this device. Links from elsewhere in the app (the offline chip, update banner, notifications, errand lists) open the right screen

## 2.10.0 — Oct 26, 2026

### A better widget
- The list **scrolls** and shows up to **50** notes
- The record button is now the **Purple Neon Bolt** in a dark circle, like Scan and Camera. While recording it gets a red ring and a timer — tap to stop
- **✏️ Type** next to Scan and Camera: a quick text note without opening the app
- **Filter chips**: All · Notes · Reminders · Lists · Documents · Shared (and Actions if you want them — they’re hidden by default)
- **Up next** at the top: your next 3 reminders and events with a countdown, like “Call Citibank · 12 PM · in 2 h”
- **Right from the widget**: tick off list items, mark a reminder **Done**, or **Snooze** it an hour — also offline, sent when you’re back online
- A status line: **Offline · 2 waiting to upload**, **Syncing…** or when it last synced

### Each widget your way
- Long-press the widget → **Settings** (it also opens when you add one): which filter it opens on, which chips show, actions on or off, newest first or due soonest, compact or comfortable rows, dark / light / match the phone, how see-through it is, times on or off, and **always hide titles**
- Several widgets can each have their own settings

### New: list widget
- **Pocket Archive · List** shows one list — say Publix — so you can tick items off and **+ Add item** from the home screen

### Privacy
- While the app is locked the widgets show no titles, and taps that would change something open the app to unlock first

### Smaller app
- The phone app is now about half the size

## 2.9.0 — Oct 25, 2026

### Works offline (Android app)
- The app opens and works **without a connection** — in airplane mode, with no signal, or when the NAS is down. No more “can’t reach the server” page
- The phone keeps an **encrypted copy** of everything you can see: notes, AI summaries, transcripts, lists and errands, projects, actions, documents and their details, places, reminders, settings, and what people shared with you (with who shared it). For the archive account also the Hey Pocket recordings, AI notes and summaries
- Photos, scans, PDFs, attachments and audio are kept too, so you can open a receipt or play a recording offline
- **Search works offline** with the same results and filters as online
- **Make changes offline**: new voice, text, list, photo and scan notes, edits, checking off items, combine, move to a project, delete and restore, pin, color. They’re sent **in order** when you’re back online — never twice
- AI work (summaries, sorting, reading documents) shows **“Will be processed when online”** and runs by itself afterwards
- Changed the same note on two devices? You choose: **Keep mine**, **Keep theirs** or **Keep both**. List items still merge item by item

### Syncing
- The first download runs in the background with progress — notes first, then thumbnails, then photos and audio. It picks up where it left off, and photos and audio wait for Wi-Fi unless you change that
- After that only changes are fetched: live while the app is open, and every 15 minutes in the background
- The header shows **Offline · last synced 2 h ago**, **Syncing 12 changes…** or **Up to date**
- The home-screen widget and the watch use the offline copy when there’s no connection

### Settings › Offline & storage
- **What to keep**: Everything (default), Text + thumbnails, Text only, or Pinned + last 30 days — and **Keep offline** on any note or project to keep it in full anyway
- Storage used for text, photos, scans, files, audio and recordings, a **storage limit** with a warning, Photos and audio over Wi-Fi only, **Sync now**, **Free up space** (removes photos and audio, keeps every note) and **Delete offline data**
- Shows how big a full copy of your account is before it downloads
- Optional: keep the map for offline use (large)

### Privacy
- Everything kept offline is encrypted on the phone, with the key in the phone’s secure hardware. With the **app lock** on, the copy only opens after your fingerprint or PIN
- Signing out deletes the copy right away. A device removed in Settings › Security › Where you’re signed in deletes it the next time it connects. Only your own data and what’s shared with you is ever downloaded

## 2.8.1 — Oct 24, 2026

### Search filters fixed
- Each page searches what it shows: the **Inbox tab** you’re on (All, Events, Reminders, Documents…), **Lists**, **Shared with me**, **Projects** and **Actions**. The results match the list exactly
- **Actions** only show up on the Actions page, or in the Inbox when **Show actions in Inbox** is on. Choosing a filter on the Actions page can no longer pull in other notes
- Every page keeps **its own filters** until you clear them — also after you open a note and go Back, or visit another page and come back
- Filters work together (a list that’s open *and* from today…). The ones you picked show as **chips** — tap one to remove it — with the number of results and **Clear filters**
- No results? You see **No matches** with a **Clear filters** button
- Filters saved by an older version are reset once after this update

## 2.8.0 — Oct 23, 2026

### Search your notes
- A **search bar** at the top of Inbox, Lists, Shared with me, Documents, Projects and Actions, and a **search button in the header** (Ctrl+K on a computer) that searches everything
- Finds titles, AI summaries, transcripts, typed text, checklist items, document details (store, total, due date…), attachment names, text read from photos and scans, project names and places
- Results appear as you type, grouped into **Notes, Lists, Documents, Projects** (and Recordings for the archive), with the matching words highlighted
- **Filters:** type, date (today, last 7 or 30 days, this year, or pick dates), project, mine or shared with me, has an attachment, document category (Receipts, Bills…), open or done
- **Recent searches** on each device (clear them any time) and suggestions as you type
- Tap the **mic** to search by voice
- You only ever see your own notes and what people shared with you

### Search settings
- **Search settings…** stays at the top of Settings. Try “fingerprint”, “dark”, “volume”, “update”, “password” or “watch”
- Each result shows where it lives, like *Security › Lock app with fingerprint*. Tap it to jump there; the setting lights up for a moment
- Only settings you can actually use are shown (phone or web, Lite or Full). On a computer, **/** jumps to the box and **Esc** clears it

### Pop-ups you can dismiss
- Every pop-up message has an **✕** in the corner. You can also **swipe it up or sideways**; tapping the message itself no longer closes it by accident
- Pop-ups sit below the top bar, stack neatly when there are several, and never block the rest of the screen
- **Undo** and **Restore** stay available after a pop-up is gone: deleted notes are in **Deleted** with Restore, and a recording set aside for no speech can be restored for 30 seconds from **Settings › Accidental recordings**
- The update banner also has an ✕ (it comes back the next time you open the app; **Later** waits for the next version)
- Follows your animation setting (reduced motion), in light and dark

## 2.7.0 — Oct 23, 2026

### Lock the app with your fingerprint
- Settings → Security → **Lock app with fingerprint** (each phone, off until you turn it on). Uses your fingerprint or face, or your phone’s PIN
- Choose when it asks: every time you open it, or after 1, **5** or 15 minutes away
- Your sign-in key stays locked until you unlock — it’s kept behind your fingerprint on the phone
- **Recording keeps working while it’s locked:** widget, Quick Settings tile, side key, Quick Record, Stop, volume keys, Scan and Camera, and your watch. Notifications and the widget then only say “Saved” and don’t show your notes
- Pocket Archive is hidden in recent apps and screenshots while the lock is on (you can turn that off)
- After you add a new fingerprint, it asks for your password once

### Passkeys on the web
- Settings → Security → **Add a passkey**, then **Sign in with a passkey**: fingerprint, Windows Hello or your phone — no password and no 2FA code
- See, rename and remove your passkeys; your password still works
- Settings → Security shows recent sign-ins and security changes

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
