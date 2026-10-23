# Smart documents, Scan & Camera, editing photo notes (2.6.0)

## Creating

- **Create menu (+) → Camera / Scan document** (Scan only in the app) and **Image** all make a new note through
  `POST /api/quick/document` (multipart `page[]` + `pthumb[]` for a scan, or `file` + `thumb`; `kind` scan|camera|image;
  `clientId` for safe retries). The note has `docFirst: true` and the photo / scan as an attachment.
- **App: widget, shortcuts, tile.** The widget's Scan and Camera buttons (2x1 and larger), the optional 1x1 **Quick Scan**
  widget, the app shortcuts (long-press the icon) "Scan document" / "Camera" and the Quick Settings tile **Quick Scan**
  open `CaptureActivity`: a transparent activity that starts the ML Kit scanner or the system camera, nothing else.
  The capture goes into `files/doc_queue/<userId>/<clientId>/` and `DocUploadWorker` uploads it (now or when there's a
  network). The widget shows "Uploading… → 🧾 Receipt · Publix · $43.18" and a short notification.
- **Accounts:** a queued capture belongs to the user who made it and is only ever uploaded with that user's token;
  if someone else signs in it waits. Not signed in → the app opens to sign in (nothing is captured).

## Document processing (`documents.js`)

Gemini (vision) reads every photo, scan page and PDF of a note (≤ 12 inputs, ≤ 18 MB) with a JSON schema:

| Type | Fields |
|---|---|
| receipt | merchant, date, total, tax, currency, items [{name, qty, price}], paymentMethod (last 4) |
| bill | company, account (last 4), amountDue, currency, dueDate, period |
| medical | provider, date, visitType, instructions |
| school | school, student, date, subject, actionNeeded |
| warranty | product, store, purchaseDate, expiryDate |
| letter | sender, date, subject, actionNeeded |
| business_card | name, jobTitle, company, phone, email, website, address |
| whiteboard (notes) | topic |
| other | — |

Plus a title, a short summary, all the text (searchable) and a project suggestion. Stored as `note.document`
(`type, category, fields, edited, conflicts, text, summary, status, project`). Notes made from a photo/scan take their
title (unless you changed it) and summary from it; on other notes the Details card is added and nothing else changes.

- **Privacy** (`privacy.js`): card, bank account, routing, SSN and other ID numbers (8+ digits, not phone numbers, dates
  or ZIP+4) keep only their last 4 digits in fields, text, summary and title — before anything is stored.
- **Manual edits** (`PATCH /api/quick/:id/document`) are marked `edited` and never overwritten: a different value found
  later becomes a conflict ("Found a different store: … — Use it / Keep mine", `POST …/document/resolve`).
- **Re-run:** adding/editing/deleting photos or pages schedules processing again (3.5 s debounce, one run per note);
  "Reprocess" forces it. The card shows "Reading the document…" and "Details updated" when something changed.
- **Projects:** a matching project above the smart-append *auto* threshold is filed (Undo); between *ask* and *auto*
  the card asks "Add to project X? Yes / No" (`POST …/document/project`; the owner's decision only).
- **Actions** (nothing automatic): bill due date → "Remind me", warranty end → "Remind me 30 days before"
  (`POST /api/documents/reminder` makes your own reminder note + calendar event); business card → "Save to contacts"
  (app: Android's Contacts editor prefilled, you tap Save; web: a .vcf file).
- **Settings → Documents** (`GET/PUT /api/documents/settings`, stored in the user's settings.json): "Organize documents
  automatically" (on) and one switch per type (a type that's off is kept as "other": text only).
- **Inbox → Documents** with category chips (Receipts, Bills, Medical, School, Warranty, Documents, Contacts, Notes).
- **Models:** `GEMINI_MODEL` first; after a 429/503/timeout it uses `GEMINI_FALLBACK_MODEL` for 5 minutes.

## Editing photo and scan notes

Notes made from photos/scans are ordinary notes: Edit (title, text, **Text position** above/below the images), Attach
(more photos, camera, scan, files) and **Pages** (toolbar / "Pages & photos"):

- reorder photos and scans (drag, or ↑/↓), reorder pages inside a scan (drag)
- **Edit** (rotate, crop, pen, highlighter, arrow, text label) → a new version; the original is kept → **Restore original**
- retake a photo or a page, delete, set the cover (cards show it), add pages, split a scan before a page, merge with the next scan
- scans are stored as page images (`pageList`); the PDF is rebuilt with `pdf-lib` after every change
- older photo notes (`note.media`) become an attachment the first time they're edited (`adopt-media`)
- web: everything except scanning (pages are added from files there). Shared notes: editors can do all of this; viewers
  see and open. Lite: the same.

## Tests (scratchpad, fake archive; never the real archive)

`fftools/doc-samples.cjs` renders fake samples (receipt with a full test card number, 2-page bill, business card,
handwritten note, warranty card). `doc-e2e.cjs` (API, real Gemini), `fftools/doc-ui.cjs` (web UI, real Gemini),
`att-e2e.cjs` (attachments regression, no AI).
