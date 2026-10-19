// Phone actions from quick notes: "wake me at 5:30", "timer 10 minutes", "directions to Publix",
// "text Minal I'm on my way", "call Mom", "do not disturb for an hour", "flashlight on", "open Spotify".
//
// The server only classifies and keeps a short ACTION ENTRY (type 'action'); the phone runs the action
// (Android intents) when the capture result arrives and reports back (POST /api/actions/:id/result).
//   - A pure command (or an alarm whose only content is its label) is saved as an action entry only:
//     no note, no AI summary, not in the Inbox (Quick Capture → Actions).
//   - A capture with real content beyond the action keeps a normal note (with summary) plus an action
//     entry; the note gets a small chip (note.actionRef) linking to it.
// Action entries are private (never shared) and deleted after keepDays (7 / 30 / never).

const KINDS = ['alarm', 'timer', 'navigate', 'message', 'call', 'dnd', 'flashlight', 'openApp'];
const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** Classifier output (strict JSON: every field always present) */
const PHONE_ACTION_SCHEMA = {
  type: 'object',
  properties: {
    kind:            { type: 'string', enum: ['', ...KINDS] },
    time:            { type: 'string' },
    label:           { type: 'string' },
    repeat:          { type: 'array', items: { type: 'string', enum: DAYS } },
    seconds:         { type: 'number' },
    place:           { type: 'string' },
    to:              { type: 'string' },
    text:            { type: 'string' },
    on:              { type: 'boolean' },
    durationMinutes: { type: 'number' },
    appName:         { type: 'string' },
    extraContent:    { type: 'boolean' },
  },
  required: ['kind', 'time', 'label', 'repeat', 'seconds', 'place', 'to', 'text', 'on', 'durationMinutes', 'appName', 'extraContent'],
  additionalProperties: false,
};

const PHONE_ACTION_PROMPT = `
Phone actions ("phoneAction"):
Some memos are commands for the phone. Set phoneAction.kind only for a clear, direct command; otherwise kind "" (and the other fields empty: "", [], 0, false).
- "alarm": an alarm clock ("wake me at 5:30", "set an alarm for 6", "alarm at 3pm to call the pharmacy", "every weekday at 6 wake me up"). time = the next occurrence as ISO 8601 with the New York offset; label = what it's for, short ("Call the pharmacy"), "" if none; repeat = days for repeating alarms (weekdays = MO..FR, weekends = SA SU, "every day" = all seven), [] otherwise.
  "Remind me at 3 to …" is a REMINDER (normal note), not an alarm — use alarm only when the memo says alarm / wake me / wake up.
- "timer": "set a timer for 10 minutes", "timer 90 seconds for the eggs". seconds = total length; label = what it's for or "".
- "navigate": "directions to Publix", "navigate home", "take me to Dr. Smith's office". place = the destination as spoken ("Publix", "home").
- "message": "text Minal I'm on my way", "send a message to John saying …". to = the contact as spoken; text = the message, cleaned up.
- "call": "call Mom", "call 555-1234". to = contact name or the number as spoken. "Remind me to call Mom" is a reminder, not a call.
- "dnd": "turn on do not disturb", "do not disturb for an hour", "turn off do not disturb". on = true/false; durationMinutes = how long (0 = until turned off).
- "flashlight": "flashlight on", "turn off the flashlight". on = true/false.
- "openApp": "open Spotify", "launch the camera". appName = the app as spoken.
extraContent: true only when the memo ALSO carries real information beyond the command and its short label — details worth keeping as a note ("alarm at 3 to call the pharmacy about the refill, ask about the copay card" → true; "alarm at 3pm to call the pharmacy" → false; "wake me at 5:30" → false).
When kind is set, still fill the normal fields (type "note" or "reminder", title, content) — they are used when extraContent is true. spokenConfirmation for a pure command: e.g. "Alarm set for 5:30 AM".`;

const ICON = { alarm: '⏰', timer: '⏲', navigate: '📍', message: '💬', call: '📞', dnd: '🔕', flashlight: '🔦', openApp: '📱' };
const DEFAULT_SETTINGS = {
  enabled: { alarm: true, timer: true, navigate: true, message: true, call: true, openApp: true, dnd: false, flashlight: false },
  keepDays: 7,
};
const KEEP = [7, 30, 0]; // 0 = never delete

const str = (v, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const pad = n => String(n).padStart(2, '0');

function settingsOf(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const enabled = { ...DEFAULT_SETTINGS.enabled };
  for (const k of KINDS) if (typeof s.enabled?.[k] === 'boolean') enabled[k] = s.enabled[k];
  return { enabled, keepDays: KEEP.includes(s.keepDays) ? s.keepDays : DEFAULT_SETTINGS.keepDays };
}

/** "5:30 AM" from an ISO time with offset, in New York */
function clockTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: false })
    .formatToParts(d).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return { hour, minute, text: `${hour % 12 || 12}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}` };
}

function durationText(seconds) {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return m ? `${h} hr ${m} min` : `${h} hr`;
  return r ? `${m} min ${r} s` : `${m} min`;
}

function repeatText(days) {
  const set = new Set(days);
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every(d => set.has(d))) return 'Weekdays';
  if (set.size === 2 && set.has('SA') && set.has('SU')) return 'Weekends';
  const names = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };
  return DAYS.filter(d => set.has(d)).map(d => names[d]).join(', ');
}

/** Classifier phoneAction → clean action (or null). Only enabled kinds count. */
function normalize(raw, settings) {
  if (!raw || !KINDS.includes(raw.kind)) return null;
  if (!settings.enabled[raw.kind]) return null;
  const a = { kind: raw.kind, alsoNote: raw.extraContent === true };
  switch (raw.kind) {
    case 'alarm': {
      const t = clockTime(raw.time);
      if (!t) return null;
      Object.assign(a, { time: raw.time, hour: t.hour, minute: t.minute, label: str(raw.label, 80), repeat: [...new Set((raw.repeat || []).filter(d => DAYS.includes(d)))] });
      break;
    }
    case 'timer': {
      const seconds = Math.round(Number(raw.seconds));
      if (!(seconds >= 1 && seconds <= 86400)) return null;
      Object.assign(a, { seconds, label: str(raw.label, 80) });
      break;
    }
    case 'navigate': if (!str(raw.place)) return null; a.place = str(raw.place, 120); break;
    case 'message': if (!str(raw.to)) return null; Object.assign(a, { to: str(raw.to, 80), text: str(raw.text, 1000) }); break;
    case 'call': if (!str(raw.to)) return null; a.to = str(raw.to, 80); break;
    case 'dnd': Object.assign(a, { on: raw.on !== false, durationMinutes: Math.max(0, Math.min(24 * 60, Math.round(Number(raw.durationMinutes) || 0))) }); break;
    case 'flashlight': a.on = raw.on !== false; break;
    case 'openApp': if (!str(raw.appName)) return null; a.appName = str(raw.appName, 60); break;
    default: return null;
  }
  return a;
}

/** "Alarm · 5:30 AM · Weekdays · Call the pharmacy" */
function titleOf(a) {
  const dest = a.destination?.name || a.place;
  switch (a.kind) {
    case 'alarm': return ['Alarm', clockTime(a.time)?.text, a.repeat?.length ? repeatText(a.repeat) : null, a.label || null].filter(Boolean).join(' · ');
    case 'timer': return ['Timer', durationText(a.seconds), a.label || null].filter(Boolean).join(' · ');
    case 'navigate': return `Directions to ${dest}`;
    case 'message': return `Message to ${a.to}${a.text ? `: ${a.text.slice(0, 60)}` : ''}`;
    case 'call': return `Call ${a.to}`;
    case 'dnd': return a.on ? `Do Not Disturb on${a.durationMinutes ? ` · ${durationText(a.durationMinutes * 60)}` : ''}` : 'Do Not Disturb off';
    case 'flashlight': return `Flashlight ${a.on ? 'on' : 'off'}`;
    case 'openApp': return `Open ${a.appName}`;
    default: return 'Action';
  }
}

/** Small chip on a note: "⏰ 3 PM", "⏲ 10 min", "📍 Publix" */
function chipOf(a) {
  const icon = ICON[a.kind];
  switch (a.kind) {
    case 'alarm': return `${icon} ${clockTime(a.time)?.text.replace(':00 ', ' ') || 'Alarm'}`;
    case 'timer': return `${icon} ${durationText(a.seconds)}`;
    case 'navigate': return `${icon} ${a.destination?.name || a.place}`;
    case 'message': return `${icon} ${a.to}`;
    case 'call': return `${icon} ${a.to}`;
    case 'openApp': return `${icon} ${a.appName}`;
    default: return `${icon} ${titleOf(a)}`;
  }
}

const filterOf = kind => (kind === 'alarm' ? 'alarms' : kind === 'timer' ? 'timers' : kind === 'message' || kind === 'call' ? 'messages' : kind === 'navigate' ? 'navigation' : 'other');

/**
 * deps: { store, places, settingsOf: () => user settings, saveSettings(s), newId, blankNote }
 */
function createPhoneActions(deps) {
  const settings = () => settingsOf(deps.getSettings().phoneActions);

  /** Destination for "directions to …": home / saved place / nearest store, else the words (Maps finds it) */
  async function resolveDestination(a) {
    const places = deps.places;
    if (!places) return;
    try {
      const personal = places.personalPlace(a.place, null);
      if (personal) { a.destination = { name: personal.name, address: personal.address, lat: personal.lat, lng: personal.lng }; return; }
      const lookup = (async () => {
        let r = await places.resolve({ query: a.place, kind: 'chain' });
        if (!r?.resolved) r = await places.resolve({ query: a.place, kind: 'specific' });
        return r;
      })();
      const r = await Promise.race([lookup, new Promise(res => setTimeout(() => res(null), 6000))]);
      if (r?.resolved) a.destination = { name: r.name || a.place, address: r.address || null, lat: r.lat, lng: r.lng };
    } catch { /* the phone hands the words to Maps */ }
  }

  function actionFields(a) {
    const { alsoNote, ...action } = a;
    return { ...action, filter: filterOf(a.kind), status: 'pending', result: null, ranAt: null, undoneAt: null };
  }

  /** A pure command: the capture itself becomes the action entry (no note, no summary) */
  async function convert(note, a) {
    if (a.kind === 'navigate') await resolveDestination(a);
    Object.assign(note, {
      type: 'action', status: 'ok', title: titleOf(a), content: note.transcript || note.typed?.body || note.content || '',
      action: actionFields(a), summaryStatus: 'none', spokenConfirmation: `${titleOf(a)}`,
      start: null, end: null, dueDate: null, geo: null, items: undefined, projectId: null,
    });
    return note;
  }

  /** Command + real content: a separate action entry; the note gets a chip */
  async function attach(note, a, now) {
    if (a.kind === 'navigate') await resolveDestination(a);
    const entry = deps.blankNote(deps.newId(), now, {
      type: 'action', source: note.source || 'voice', title: titleOf(a), content: note.transcript || note.content || '',
      action: actionFields(a), parentId: note.id, summaryStatus: 'none', spokenConfirmation: titleOf(a),
    });
    deps.store.write(entry);
    note.actionRef = { id: entry.id, kind: a.kind, chip: chipOf(a), title: titleOf(a) };
    return entry;
  }

  /** What the phone needs to run it (null when it already ran / was cancelled) */
  function pendingFor(note) {
    const entry = note.type === 'action' ? note : note.actionRef ? deps.store.read(note.actionRef.id) : null;
    if (!entry?.action || entry.action.status !== 'pending') return null;
    return { id: entry.id, noteId: entry.parentId || null, icon: ICON[entry.action.kind], title: entry.title, ...entry.action };
  }

  function confirmation(note) {
    const a = note.action;
    return { icon: ICON[a.kind], text: note.title, tone: 'success', actionId: note.id };
  }

  /** Delete entries older than keepDays (0 = keep) */
  function cleanup() {
    const days = settings().keepDays;
    if (!days) return 0;
    const cutoff = Date.now() - days * 86400000;
    let n = 0;
    for (const e of deps.store.list()) {
      if (e.type !== 'action' || Date.parse(e.capturedAt || e.createdAt) > cutoff) continue;
      deps.store.remove(e.id);
      if (e.parentId) {
        const parent = deps.store.read(e.parentId);
        if (parent?.actionRef?.id === e.id) { parent.actionRef = { ...parent.actionRef, removed: true }; deps.store.write(parent); }
      }
      n++;
    }
    return n;
  }

  function register(app) {
    app.get('/api/actions/settings', (_req, res) => res.json(settings()));
    app.put('/api/actions/settings', (req, res) => {
      const next = settingsOf({ ...settings(), ...(req.body || {}), enabled: { ...settings().enabled, ...(req.body?.enabled || {}) } });
      const s = deps.getSettings();
      s.phoneActions = next;
      deps.saveSettings(s);
      res.json(next);
    });

    // Newest first; ?filter=alarms|timers|messages|navigation|other
    app.get('/api/actions', (req, res) => {
      let list = deps.store.list().filter(n => n.type === 'action' && !n.undone);
      if (req.query.filter) list = list.filter(n => n.action?.filter === req.query.filter);
      res.json(list.map(n => ({ id: n.id, title: n.title, icon: ICON[n.action?.kind] || '⚡', capturedAt: n.capturedAt || n.createdAt, parentId: n.parentId || null, transcript: n.transcript || null, action: n.action, clientId: n.clientId || null })));
    });

    // The phone ran it (or couldn't): { status: done|failed|needs_choice|needs_permission|undone|tap, result, detail? }
    app.post('/api/actions/:id/result', (req, res) => {
      const e = deps.store.read(req.params.id);
      if (!e || e.type !== 'action') return res.status(404).json({ error: 'Action not found' });
      const status = ['done', 'failed', 'needs_choice', 'needs_permission', 'undone', 'tap', 'pending'].includes(req.body?.status) ? req.body.status : null;
      if (!status) return res.status(400).json({ error: 'status?' });
      e.action = {
        ...e.action, status, result: str(req.body?.result, 200) || e.action.result,
        detail: req.body?.detail ? str(req.body.detail, 300) : e.action.detail || null,
        ...(status === 'done' ? { ranAt: new Date().toISOString() } : {}),
        ...(status === 'undone' ? { undoneAt: new Date().toISOString() } : {}),
      };
      deps.store.write(e);
      res.json(e);
    });

    app.delete('/api/actions/:id', (req, res) => {
      const e = deps.store.read(req.params.id);
      if (!e || e.type !== 'action') return res.status(404).json({ error: 'Action not found' });
      deps.store.remove(e.id);
      res.json({ success: true });
    });
  }

  return { settings, normalize: raw => normalize(raw, settings()), convert, attach, pendingFor, confirmation, cleanup, register, titleOf, chipOf };
}

module.exports = { createPhoneActions, PHONE_ACTION_SCHEMA, PHONE_ACTION_PROMPT, KINDS, ICON, normalize, settingsOf, titleOf, chipOf, clockTime };
