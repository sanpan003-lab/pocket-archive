# Sharing and live updates (2.1.0)

Lists (errands), notes and projects can be shared with other people on the same server. Everything
is self-hosted: no push service, no third-party sign-in.

## How it works

- **The item stays in the owner's folder.** Sharing adds an entry to `/data/config/shares.json`
  (`{ ownerId, kind: note|project, itemId, userId, role: edit|view, addedAt, addedBy }`) and a copy of
  who has access on the item (`sharedWith: [{ userId, role, addedAt }]`) for display.
- **Sharing a project shares its notes** with the same role.
- **Roles**
  - *Can view*: open it, its audio and photos.
  - *Can edit*: also add, check off, edit and remove items, edit the title and text, mark an errand done,
    summarize.
  - *Owner only*: delete, combine, move, merge, add to a project, pin, color, change sharing.
- **Leave**: the recipient can remove themselves (share sheet → Leave).
- Requests for someone else's note go through `sharing.js`, which checks the role and then hands the
  request to the **owner's** routes. Responses carry `sharedFrom { ownerId, name, initials, color, role }`.

## Item-level changes (no lost edits)

Checklists are changed with operations, never by saving the whole list:

```
POST /api/quick/:id/ops  { ops: [{ op, … }] }  →  { note, applied, skipped }
  addItem    { itemId, text, index? }   (the client makes the id, so a retry is harmless)
  removeItem { itemId }
  toggleItem { itemId, done }
  editItem   { itemId, text }
  editText   { text }
  rename     { title }
```

- Two people changing different items at the same time: both changes survive. The same field: last
  write wins.
- Items carry `v`, `addedBy/addedAt`, `checkedBy/checkedAt`, `updatedBy/updatedAt`.
- Each change is written to the note's `activity` (last 50), shown as "Jane added Eggs · 2 min ago".
- **Offline**: the app and web keep changes in a local queue (`pa_opsQueue:<userId>`), show them at
  once ("Saved on this device"), and send them when the connection is back.

## Live updates (Server-Sent Events)

`GET /api/events` is one stream per signed-in user (cookie, device token, or `?mt=` media token
in the app, because `EventSource` can't send headers).

- Events:
  - `hello` on connect.
  - `note` {id, ownerId, title, by, byName, action, text}: a note you own or can see was saved.
  - `share`: something was shared with you or access was removed.
- A `: ping` heartbeat every 25 s, and `retry: 3000`. The browser reconnects by itself; the app
  reopens the stream with a fresh token if it closed for good.
- Open lists reload. While the app is open it also redraws the widget and re-arms the geofences.

### Synology reverse proxy

The server sends `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`, which tell the
DSM reverse proxy (nginx) not to buffer the stream. The 25-second heartbeat stays under DSM's
default 60-second proxy read timeout, so **no DSM setting is needed**.

If changes from the other phone only show up after a minute or two:

- **Timeout setting:** in DSM, open Control Panel → Login Portal → Advanced → Reverse Proxy → your
  rule → Edit → Advanced Settings. Check that the *proxy read timeout* is at least 60 seconds.
- **Header test:** `curl -N -H "Authorization: Bearer <device token>" https://<your-host>/api/events`
  should print `event: hello` at once and `: ping` every 25 s.

(Tested here through a plain pass-through proxy. It has not been tested through the real Synology
proxy, which only the NAS can do.)

## Background notifications (Android, no push service)

`ChangesWorker` runs every 15 minutes (WorkManager, with a network). It calls
`GET /api/changes?since=<last check>`, which returns other people's changes to items you own or can
see, plus your notification settings. Then it:

- refreshes the widget and the errand sync (geofences, watch state) when something changed;
- notifies according to Settings → Shared lists:
  - **Every change**: up to 4 single notifications ("testadmin added Cherries", list title below),
    else one summary.
  - **Summary**: one "N changes on shared lists".
  - **Off**: nothing.
  - **Quiet hours**: nothing during them; the count is kept, and one summary comes afterwards.
- stays quiet while the app is on screen (the app shows changes live);
- never notifies about your own changes. The first check after signing in only sets the starting
  point.

Notifications use the "Shared lists" channel and aren't local-only, so the watch shows them too.

## Location reminders on shared errands

Shared errands are in both people's `/api/errands/active`, so **both phones** set up geofences. When
one fires, the phone reports it to the owner's copy.

Optional, per person, off by default: Settings → Shared lists → "Let people on shared lists know
when I'm at the store". With it on, the others see "Jane is at Publix". That is only the store name,
never a location.

## Smart append and voice

Candidates include lists shared with you that you can edit, labeled "(Jane's, shared)". If two open
lists match (your Publix list and one shared with you), the capture asks **"Add to which list?"**
with one button per list. The answer goes to `POST /api/quick/:id/decide {choice:'yes', targetId}`.

## Calendar

Admin setting **Family calendar ID**: Settings → Google Calendar → Family calendar. It's empty by
default.

- **Empty**: events on shared items go to the calendar of whoever created them.
- **Set**: events on shared items go to that calendar. Share the calendar with the service account,
  like your own.

## API summary

| Route | Who |
|---|---|
| `GET /api/share/people` | everyone (other active accounts: name, initials, color) |
| `GET /api/share/:kind/:id` | owner or recipient (owner, people + roles) |
| `POST /api/share/:kind/:id {userId, role}` | owner (share or change role) |
| `DELETE /api/share/:kind/:id/:userId` | owner (remove) or that recipient (leave) |
| `GET /api/shared` | notes + projects shared with me |
| `POST /api/quick/:id/ops` | owner or editor |
| `GET /api/changes?since=` | everyone (others' changes + notify settings) |
| `GET/PUT /api/notify-settings` | everyone (`mode` every/summary/off, `quietStart/End` "HH:MM" or null, `shareLocation`) |
| `GET /api/events` | everyone (SSE) |
| `GET/PUT /api/admin/family-calendar` | admin |
