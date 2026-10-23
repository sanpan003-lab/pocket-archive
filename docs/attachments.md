# Attachments on notes (2.5.0; pages, editing and documents in 2.6.0 — see documents.md)

Any note can carry attachments: photos, camera shots, scanned documents (PDF) and any file (PDF, Word, Excel, audio, …),
up to **25 MB each**, 50 per note. Owners and people a note is shared with as **editors** can add, rename and delete;
**viewers** can open and download. Works for Lite accounts.

## Adding (note toolbar → Attach)

| Option | Web | Android app |
|---|---|---|
| Photo library | file picker (images, several at once) | the same picker |
| Camera | `capture` file input on touch devices | system camera (`@capacitor/camera`) |
| Scan document | — | Google ML Kit Document Scanner: on-device, free, auto-crop, several pages → one PDF (+ first-page preview) |
| Files | any file type | any file type |

Photos get a 480 px JPEG preview made in the browser/app. **Read text with AI** (on by default, remembered per device): photos and
PDFs/scans are read by Gemini in the background (15 MB max) so the note can be found by that text; "Read text" on an attachment
does it later.

## Opening

Images: thumbnails → full-screen viewer (swipe / arrows). Files: a card (type, pages, size). Tap → web: a new tab (PDF, images,
audio inline; others download) · app: downloaded with the device token to the cache and opened in the app Android picks
(`NoteFiles.open`, FileProvider). Audio attachments also play in the note.

## Server (`attachments.js`)

Files: `ARCHIVE/07_Quick_Notes/attachments/<noteId>/<attId>.<ext>` (+ `<attId>.thumb.jpg`). Deleted notes keep their files (like audio, so Restore brings everything back); `store.remove` (expired action entries) deletes the folder.
`note.attachments = [{ id, name, ext, mime, size, kind, file, thumb, source, pages?, addedAt, addedBy, text?, textStatus?, textAt? }]`
(field group `attachmentsAt`, so background jobs never overwrite newer changes).

| Route | |
|---|---|
| `POST /api/quick/:id/attachments` | multipart `file` (≤ 25 MB → else 413), `thumb?`, `name?`, `source?` (camera/photos/scan/file), `pages?`, `read=1?` → the note |
| `GET /api/quick/:id/attachments/:aid[?download=1]` | the file (Range), `Content-Disposition` inline for images/PDF/audio/video/text |
| `GET /api/quick/:id/attachments/:aid/thumb` | the preview |
| `PATCH /api/quick/:id/attachments/:aid` `{ name }` | rename (keeps the extension) |
| `DELETE /api/quick/:id/attachments/:aid` | |
| `POST /api/quick/:id/attachments/:aid/read` | AI text (photos, PDFs) |

The app's `<img>`/`<audio>` use the media token (`?mt=`; `accounts.js` `MEDIA_PATH_RE`). Shared notes: `sharing.js` routes
`/attachments…` to the owner (view: GET; edit: POST/PATCH/DELETE). Quick search matches attachment names and read text.

Tests (scratchpad, fake archive): `att-e2e.cjs` (API), `fftools/att-ui.cjs` (web UI, owner + shared viewer).
