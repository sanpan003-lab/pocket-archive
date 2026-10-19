# Phone actions and accidental recordings (2.3.0)

## Phone actions

Quick notes can be commands for the phone. Three parts are involved:

- **Server** (`phoneActions.js`): classifies the command and keeps an action entry.
- **Phone** (`quick/PhoneActions.kt`): does it when the capture result arrives, then reports back.
- **Watch:** recordings from the watch go through the phone, so their actions run there too.

| Kind | Example | On the phone |
|---|---|---|
| `alarm` | “wake me at 5:30”, “alarm every weekday at 6 for the gym” | Clock app: `AlarmClock.ACTION_SET_ALARM` + `EXTRA_SKIP_UI`, hour/minute, label, repeat days. Samsung Clock syncs alarms to the Galaxy Watch. |
| `timer` | “timer 10 minutes for the pasta” | Clock app: `ACTION_SET_TIMER` + `EXTRA_SKIP_UI`, length, label |
| `navigate` | “directions to Publix”, “navigate home” | Google Maps directions to the place. The server first tries home / saved places / the nearest branch; otherwise Maps gets the words. |
| `message` | “text Minal I’m on my way” | Messages, **filled in, never sent** |
| `call` | “call Mom”, “call 555 0100” | The dialer with the number, **never dialed** |
| `dnd` | “do not disturb for an hour” | Do Not Disturb (needs Notification Policy access), turned back after the duration (AlarmManager) |
| `flashlight` | “flashlight on” | Camera torch |
| `openApp` | “open Spotify” | Launches the installed app whose name matches |

- **Settings → Alarms & phone actions:**
  - A switch per type; all are on except Do Not Disturb and Flashlight.
  - How long to keep entries: 7 days (default), 30 days or never.
  - The phone's status: Clock app found; running actions while the app is closed (“Display over other apps”); Contacts; Do Not Disturb access.
- **Asks only when needed:**
  - Contacts permission: the first time someone is messaged or called by name.
  - Several contacts or apps match: “Which Sam?” — a notification opens Quick Capture → Actions with a chooser.
- **Undo:**
  - Alarm and timer: opens Clock’s list, because a voice-set alarm can only be deleted there; the toast says so.
  - Flashlight: off. DND: back to how it was.
- **From the background:** Android only lets an app open Clock, Maps or Messages when it's on screen or has “Display over other apps”. Otherwise the action becomes a notification to tap. It's a full-screen notification on the lock screen where allowed, so it opens by itself.

### Actions tab (keeps the Inbox clean)

- **A pure command** (or an alarm whose only content is its label) is saved as an **action entry only**: `type: 'action'`, with no note and no AI summary. It lives in Quick Capture → Actions (filters: Alarms, Timers, Messages & calls, Navigation, Other). It's not in the Inbox unless Settings → Appearance → “Show actions in Inbox” is on (off by default).
- **A command with real content** (“alarm at 3 to call the pharmacy about the refill, ask about the copay card”) gives a **normal note** (with summary) plus an action entry (`parentId`). The note gets a chip, `note.actionRef = { id, kind, chip: '⏰ 3 PM', title }`.
- **Entries are private:** they're never shared, and they're left out of search and smart append. They're deleted after `keepDays`; a note keeps its chip, marked `removed`.
- **Web:** the tab is read-only (“Open the Android app to run or undo them”).
- **Widget and watch:** the recent list shows actions with their icon (`icon` in `/api/quick/recent`).

### API

| Route | |
|---|---|
| `POST /api/quick/capture` / `text` | the response has `phoneAction` `{ id, kind, …, noteId? }` while the entry is still pending |
| `GET /api/actions[?filter=alarms\|timers\|messages\|navigation\|other]` | entries, newest first |
| `POST /api/actions/:id/result` | `{ status: done\|tap\|failed\|needs_choice\|needs_permission\|undone, result, detail? }` (from the phone) |
| `DELETE /api/actions/:id` | delete one |
| `GET/PUT /api/actions/settings` | `{ enabled: { alarm, timer, navigate, message, call, openApp, dnd, flashlight }, keepDays: 7\|30\|0 }` |

A retried upload (same `clientId`) never runs an action twice: once the phone reported, `phoneAction` is no longer returned.

Watch captures sent directly to the server (when the phone was unreachable for 10+ minutes) don't pass through the phone. Their action waits in Actions with **Run now**.

## Accidental recordings

Settings → Recording & shortcuts → Accidental recordings. These settings are stored on the phone (`RecorderPrefs`); the watch has its own under Galaxy Watch.

| Setting | Default | What it does |
|---|---|---|
| Pocket detection | on | A start from outside the app (side key, routine, widget, tile…) while the screen is off / locked / just woken, with the proximity sensor reading NEAR: nothing is recorded, one short buzz. |
| Discard if no speech at the start | on, 4 s (3/4/6) | Voice activity detection (`SpeechDetector`): speech needs syllable-like on/off rhythm or an uneven, word-length sound — not just loudness (taps, hums and a quiet pocket don't count). |
| Discard recordings shorter than 2 s | on | |
| Press again to confirm | off | After an outside start: “Record a voice note?” plus a buzz; volume up or a tap within 3 s records, otherwise nothing. |
| Cooldown | always | New start presses are ignored for 3 s after anything was ignored. |

- **Safety net:** everything set aside is kept for **30 seconds** with “Ignored accidental recording · Restore”. Restore uploads it like any recording, so real speech is never silently deleted.
- **Weekly count:** Settings shows “N accidental recordings ignored this week”.
- **Tested:**
  - `SpeechDetectorTest` (JVM): real synthesized speech (two voices, normal and quiet) is always speech, including a single word. Silence, one tap, two taps and hums are not.
  - The side-key list recommends **double press** over press-and-hold.
- **Watch:** the same speech detection and 2-second minimum, with its own Restore notification.
