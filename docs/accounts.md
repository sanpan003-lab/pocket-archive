# Accounts (multi-user)

Since 2.0.0 Pocket Archive has accounts. Everything is self-hosted on the NAS: no sign-up page, no
third-party sign-in or push service. The admin creates accounts in **Settings → Users**.

## What belongs to whom

| | Where | Who |
|---|---|---|
| Quick notes, lists/errands, location reminders, photos, drawings | `ARCHIVE/users/<userId>/07_Quick_Notes/` | that user |
| Projects | `ARCHIVE/users/<userId>/08_Projects/` | that user |
| Home, saved places, appearance, smart-append and errand settings | `ARCHIVE/users/<userId>/settings.json` | that user |
| AI usage counters (captures, summaries per day) | `ARCHIVE/users/<userId>/usage.json` | that user (admin sees numbers only) |
| Hey Pocket archive: 01_Original_Notes … 05_Attachments, 99_Deleted, sync | archive root (unchanged) | **admin only** |
| Map (`09_Maps`) | archive root | everyone, read-only |
| Accounts, sessions, device tokens, security log | `/data/config/users.json`, `sessions.json`, `devices.json`, `security-log.jsonl` | server (never in git) |

Every signed-in request goes to the signed-in user's own instance of the notes / places /
projects code, which only sees that user's folder. Another user's notes return 404. The
archive endpoints (`/api/recordings…`, `/api/search`, `/api/stats`, `/api/sync…`, `/api/audio…`)
return 403 for everyone but the admin. Recording audio (`/api/audio/…`) needs sign-in now; it
used to be reachable without it.

Plans: **Full** and **Lite** (Lite = note-taking layout, see CHANGELOG). Neither can reach the
Hey Pocket archive; that is the admin's.

## Sign-in and security

- Username + password. Passwords: bcrypt. A new account gets a temporary password from the
  admin and must set its own at first sign-in (until then the API answers 403).
- **Lockout:** 5 wrong passwords → the account is locked for 15 minutes, doubling on each repeat.
  Unknown usernames are locked the same way and get the same messages, so nobody can find out
  which usernames exist. The admin can unlock in Settings → Users.
- **Rate limit:** 20 sign-in attempts per IP per 15 minutes.
- **Two-step verification (optional, per user):** any authenticator app (TOTP). Setup with a QR
  code; 8 one-time backup codes. The secret is stored encrypted (AES-256-GCM, key from
  `JWT_SECRET`). The admin can reset a user's 2FA.
- **Sessions & devices:** Settings → Security lists browser sessions and phone/watch device tokens,
  with Sign out per item and Sign out everywhere. Changing your password signs out your other
  browsers (the phone stays signed in).
- **Security log** (`/data/config/security-log.jsonl`): sign-ins, failures, lockouts, 2FA
  changes, password resets, user changes. Never passwords or codes. Admin: Settings → Users API
  `GET /api/admin/security-log`.

### Reverse proxy note (client IP)

The server trusts `X-Forwarded-For` from private-network peers (the Synology reverse proxy runs
on the NAS) so the per-IP limit sees the real client. Someone on your LAN who connects to port
3001 directly could fake that header to get around the per-IP limit; the per-account lockout
still applies. Don't expose port 3001 to the internet; only the reverse proxy.

## Migration (one time, on the NAS)

After deploying 2.0.0 and rebuilding, the API answers **503 "migration required"** until the
migration ran (the container stays up so you can run it). Run inside the container:

```sh
# 1. Dry run: what would move, sizes, conflicts. Changes nothing.
docker exec pocket-archive node scripts/migrate-users.mjs --dry-run --admin-username <you>

# 2. Real run (backup → move → verify by SHA-256 → switch on). Same username.
docker exec pocket-archive node scripts/migrate-users.mjs --admin-username <you> --display-name "<Your Name>"

# Undo (restores the backup; anything created since is kept aside in the backup folder)
docker exec pocket-archive node scripts/migrate-users.mjs --rollback <timestamp>
```

(`pocket-archive` = the container name; `docker ps` shows it.) No restart is needed: the server
notices the migration within a few seconds. Your password, phone and watch carry over (the
phone/watch device tokens move to your account). After a rollback, deploy the previous version.

Backups: `ARCHIVE/_backups/<timestamp>/` (07_Quick_Notes, 08_Projects, config.json,
places-cache.json, manifest with SHA-256 of every file, migration.log).

## Emergency password reset

```sh
docker exec -it pocket-archive node setup-password.js <username>
```

Sets a temporary password (must be changed at next sign-in) and clears the lockout.

## Android app

- Sign in with username + password (+ 2FA code). Each phone gets its own device token for that user.
- Another user signs in on the same phone: the previous user's widget list, errands and geofences
  are cleared; their queued recordings are kept aside (`files/quick_held/<userId>/`) and upload
  only when they sign in again. Recordings made while signed out belong to the last signed-in user.
- The watch follows the phone's user. Its recordings are tagged with the user they were made under;
  the phone holds a watch recording for a user who isn't signed in, and the watch never uploads one
  user's recording with another user's token.
- App icon choice and Recording & shortcuts stay per device.

## Sharing

Since 2.1.0 people can share lists, notes and projects with each other (Can edit / Can view), with
live updates and background notifications. See [sharing.md](sharing.md).

## Lite (Pocket Notes) and the welcome tour (2.2.0)

- **Lite layout** (`plan: 'lite'`, app name "Pocket Notes"): Capture, Inbox, Lists, Projects, Shared with me,
  Calendar (own + shared events), Search (notes only), Settings (Appearance + app icon, Recording &
  shortcuts, Places & location reminders, Notifications, Shared lists, Google Calendar, Security, Welcome
  tour, About). Home = Capture (or Inbox / Projects in Settings → Appearance).
- Hidden for Lite (and, apart from the menu items, for every non-admin): Dashboard stats, Recordings,
  AI Notes, Hey Pocket, Favorites, Sync Now, recording Trash, archive search, server status, Users /
  admin settings. Archive URLs redirect to Capture, and the server answers 403 for the archive endpoints
  anyway. The widget, tile and watch only ever show quick notes.
- **Admin:** Settings → Layout on this device → "Use Lite layout on this device" (localStorage
  `pa_liteLayout`, this device only).
- **Welcome tour**: new accounts (`welcomePending`) see it after setting their password: password →
  optional 2FA → home (address or current location) → phone permissions (microphone, notifications,
  location all the time, precise, battery unrestricted; the web shows what the phone will ask) →
  optional Google Calendar (service account email + Test) → 4-card tour. Skip or Done →
  `PATCH /api/auth/me {welcomeDone: true}`. Settings → Welcome tour opens it again. The migrated admin
  doesn't get it automatically.
