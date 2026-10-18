// Per-user data layer. Every signed-in request is routed to that user's own instance of the
// Quick Capture / places / projects modules, which only ever see ARCHIVE/users/<userId>/:
//
//   users/<id>/07_Quick_Notes/   notes, audio, media (incl. location reminders and errands)
//   users/<id>/08_Projects/
//   users/<id>/settings.json     places (home, saved places), appearance, smart-append and errand settings
//   users/<id>/places-cache.json lookups
//   users/<id>/usage.json        AI usage counters per day
//
// Isolation is structural: a request can only reach the routes of req.user's instance, and
// that instance's files live under that user's folder. The Hey Pocket archive (01–05,
// 99_Deleted) stays at the archive root and is admin-only (server.js).

const fs = require('fs');
const path = require('path');
const express = require('express');
const { createQuickCapture } = require('./quickCapture');
const { createPlaces } = require('./places');

const APPEARANCE_GROUPS = ['opening', 'inbox', 'look', 'theme', 'capture', 'behavior', 'toolbar', 'icon'];
const CAPTURE_PATHS = new Set(['/api/quick/capture', '/api/quick/text', '/api/quick/media']);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const todayNY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

function createUserContexts({ archivePath, users, getRecentRecordings, recordingExists, getRecordingTitle }) {
  const contexts = new Map();
  let sharing = null; // set by server.js (sharing needs the contexts, contexts need sharing)
  const userRoot = id => {
    if (!/^u_[a-f0-9]{6,32}$/.test(id)) throw new Error('Invalid user id');
    return path.join(archivePath, 'users', id);
  };

  // ── Usage counters (captures, summaries) per day ─────────────────────────
  function usageFile(id) { return path.join(userRoot(id), 'usage.json'); }
  function countUsage(id, kind) {
    const file = usageFile(id);
    const u = readJson(file, { days: {} });
    const day = todayNY();
    const d = u.days[day] || (u.days[day] = { captures: 0, summaries: 0 });
    d[kind === 'summary' ? 'summaries' : 'captures'] = (d[kind === 'summary' ? 'summaries' : 'captures'] || 0) + 1;
    // keep ~90 days
    for (const k of Object.keys(u.days).sort().slice(0, -90)) delete u.days[k];
    writeJson(file, u);
  }
  function usageSummary(id) {
    const u = readJson(usageFile(id), { days: {} });
    const today = u.days[todayNY()] || { captures: 0, summaries: 0 };
    const last30 = Object.entries(u.days).filter(([d]) => Date.parse(d) > Date.now() - 30 * 86400000)
      .reduce((a, [, v]) => ({ captures: a.captures + (v.captures || 0), summaries: a.summaries + (v.summaries || 0) }), { captures: 0, summaries: 0 });
    return { today, last30 };
  }

  function create(userId) {
    const root = userRoot(userId);
    fs.mkdirSync(root, { recursive: true });
    const settingsFile = path.join(root, 'settings.json');
    const getSettings = () => readJson(settingsFile, {});
    const saveSettings = s => writeJson(settingsFile, s);
    const current = () => users.getUser(userId);
    const isAdmin = () => current()?.role === 'admin';

    const places = createPlaces({ getConfig: getSettings, saveConfig: saveSettings, cacheFile: path.join(root, 'places-cache.json') });
    const quick = createQuickCapture({
      places,
      getConfig: getSettings, saveConfig: saveSettings,
      archivePath: root,
      // Hey Pocket recordings are the admin's: nobody else can link notes to them
      getRecentRecordings: limit => (isAdmin() ? getRecentRecordings(limit) : []),
      recordingExists: id => isAdmin() && recordingExists(id),
      getRecordingTitle: id => (isAdmin() ? getRecordingTitle(id) : null),
      calendarId: () => {
        const u = current();
        return u?.googleCalendarId || (u?.role === 'admin' ? process.env.GOOGLE_CALENDAR_ID : null) || null;
      },
      onUsage: kind => countUsage(userId, kind),
      self: () => { const u = current(); return u ? { id: u.id, name: u.displayName || u.username } : null; },
      // Sharing: lists shared with this user, live events, family calendar, people's notification settings
      foreign: sharing ? sharing.foreignFor(userId) : null,
      onNoteWrite: note => sharing?.noteWritten(userId, note),
      calendarIdFor: note => {
        const u = current();
        const own = u?.googleCalendarId || (u?.role === 'admin' ? process.env.GOOGLE_CALENDAR_ID : null) || null;
        return sharing ? sharing.calendarIdFor(userId, note, own) : own;
      },
      isSharedNote: note => !!sharing?.isShared(userId, note),
      userSettings: id => get(id).getSettings(),
    });

    const router = express.Router();

    // Daily AI cap (off unless the admin sets one) + capture counter
    router.use((req, res, next) => {
      if (req.method !== 'POST' || !CAPTURE_PATHS.has(req.path)) return next();
      const cap = current()?.dailyCap;
      if (Number.isFinite(cap) && cap > 0 && (usageSummary(userId).today.captures || 0) >= cap) {
        return res.status(429).json({ error: `Daily limit reached (${cap} captures). Try again tomorrow.` });
      }
      countUsage(userId, 'capture');
      next();
    });

    // Appearance & layout (per user; per-device overrides stay on the device)
    router.get('/api/appearance', (_req, res) => res.json(getSettings().appearance || {}));
    router.put('/api/appearance', (req, res) => {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Expected an object' });
      if (JSON.stringify(body).length > 20000) return res.status(413).json({ error: 'Settings too large' });
      const clean = {};
      for (const g of APPEARANCE_GROUPS) {
        const v = body[g];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          clean[g] = Object.fromEntries(Object.entries(v)
            .filter(([k, x]) => /^[a-zA-Z]{1,40}$/.test(k) && ['string', 'boolean', 'number'].includes(typeof x))
            .map(([k, x]) => [k, typeof x === 'string' ? x.slice(0, 200) : x]));
        }
      }
      const s = getSettings();
      s.appearance = { ...(s.appearance || {}), ...clean, updatedAt: new Date().toISOString() };
      saveSettings(s);
      res.json(s.appearance);
    });

    // Notifications about other people's changes (phone background check + watch):
    // mode every | summary | off, quiet hours, and "let people on shared lists know when I'm at the store"
    const NOTIFY_DEFAULTS = { mode: 'every', quietStart: '22:00', quietEnd: '07:00', shareLocation: false };
    router.get('/api/notify-settings', (_req, res) => res.json({ ...NOTIFY_DEFAULTS, ...(getSettings().notify || {}) }));
    router.put('/api/notify-settings', (req, res) => {
      const b = req.body || {};
      const cur = { ...NOTIFY_DEFAULTS, ...(getSettings().notify || {}) };
      const time = v => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
      const next = {
        mode: ['every', 'summary', 'off'].includes(b.mode) ? b.mode : cur.mode,
        quietStart: b.quietStart === null ? null : time(b.quietStart) ?? cur.quietStart,
        quietEnd: b.quietEnd === null ? null : time(b.quietEnd) ?? cur.quietEnd,
        shareLocation: typeof b.shareLocation === 'boolean' ? b.shareLocation : cur.shareLocation,
      };
      const st = getSettings();
      st.notify = next;
      saveSettings(st);
      res.json(next);
    });

    places.register(router);
    quick.register(router);
    quick.start();
    return { userId, root, router, quick, places, getSettings, saveSettings };
  }

  function get(userId) {
    let ctx = contexts.get(userId);
    if (!ctx) { ctx = create(userId); contexts.set(userId, ctx); }
    return ctx;
  }

  /** Start every user's background jobs (summary backfill, "Add to …?" sweeps) */
  function startAll() {
    for (const u of users.listUsers()) if (!u.disabled) get(u.id);
  }

  function forget(userId) { contexts.delete(userId); }

  /** Express middleware: hand the request to the signed-in user's own routes (or, for a shared item, the owner's) */
  function route(req, res, next) {
    if (!req.user) return next();
    if (sharing) return sharing.route(req, res, next);
    return get(req.user.id).router(req, res, next);
  }

  function setSharing(s) { sharing = s; }

  return { get, startAll, forget, route, userRoot, usageSummary, setSharing };
}

module.exports = { createUserContexts, APPEARANCE_GROUPS };
