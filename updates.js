// Over-the-air updates for the Android phone and Wear OS apps, served from the NAS (no Play Store).
//
//   ARCHIVE/_updates/{phone|watch}/
//     pocket-archive-<target>-<versionName>-<versionCode>.apk   (+ .json with its details)
//     latest.json   what devices are offered   { versionName, versionCode, sha256, size, minVersionCode,
//                                                 releaseNotes, publishedAt, file }
//     draft.json    a release held back until the admin publishes it (update-android.bat --draft)
//   Only the newest 3 APKs are kept (the current one + 2 for rollback).
//
// Devices (device token, any user incl. Lite) report their version on every check; it's stored on the
// device-token entry (devices.json → apps.phone / apps.watch) and shown in Settings → Security → Devices
// and Settings → Users. Checks, downloads and installs are written to the security log (device id and
// versions only).
//
// Rollback: Android never installs an older versionCode over a newer one (only after an uninstall), so
// "Roll back" re-points latest.json to an older APK: devices that haven't updated yet stay on the good
// version, and devices already on the bad one are told to wait for a fixed, newer build.

const fs = require('fs');
const path = require('path');

const TARGETS = ['phone', 'watch'];
const KEEP = 3;
const FILE_RE = /^pocket-archive-(phone|watch)-[\w.-]+-\d+\.apk$/;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function createUpdates({ archivePath, users }) {
  const root = path.join(archivePath, '_updates');
  const dirOf = t => path.join(root, t);
  const latest = t => {
    const l = readJson(path.join(dirOf(t), 'latest.json'));
    return l && FILE_RE.test(l.file || '') && fs.existsSync(path.join(dirOf(t), l.file)) ? l : null;
  };
  const draft = t => {
    const d = readJson(path.join(dirOf(t), 'draft.json'));
    return d && FILE_RE.test(d.file || '') && fs.existsSync(path.join(dirOf(t), d.file)) ? d : null;
  };
  /** The kept APKs, newest first (their .json details) */
  function history(t) {
    if (!fs.existsSync(dirOf(t))) return [];
    return fs.readdirSync(dirOf(t)).filter(f => FILE_RE.test(f))
      .map(f => readJson(path.join(dirOf(t), f.replace(/\.apk$/, '.json'))) || null)
      .filter(Boolean).sort((a, b) => b.versionCode - a.versionCode);
  }
  const pub = l => (l ? (({ file, ...rest }) => rest)(l) : null);

  /** For Settings → Devices / Users: version + "Up to date / Update available" */
  function annotate(device) {
    const apps = device.apps || {};
    const status = {};
    for (const t of TARGETS) {
      const a = apps[t];
      const l = latest(t);
      if (!a) continue;
      status[t] = !l ? 'unknown' : a.versionCode >= l.versionCode ? 'current' : a.versionCode < (l.minVersionCode || 0) ? 'required' : 'available';
    }
    return { ...device, updateStatus: status, latest: Object.fromEntries(TARGETS.map(t => [t, latest(t)?.versionName || null])) };
  }

  function register(app, { requireAdmin }) {
    const target = (req, res) => {
      if (!TARGETS.includes(req.params.target)) { res.status(404).json({ error: 'Unknown app' }); return null; }
      if (!req.device) { res.status(403).json({ error: 'Updates are for the phone and watch apps (device sign-in)' }); return null; }
      return req.params.target;
    };
    const num = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : null);

    // GET /api/updates/:target/latest?versionCode=&versionName=[&watchVersionCode=&watchVersionName=]
    app.get('/api/updates/:target/latest', (req, res) => {
      const t = target(req, res);
      if (!t) return;
      const code = num(req.query.versionCode);
      if (code) users.setDeviceApp(req.device.id, t, { versionCode: code, versionName: String(req.query.versionName || '').slice(0, 30) });
      // The phone also reports its watch (for watches that only update through the phone)
      const wcode = num(req.query.watchVersionCode);
      if (t === 'phone' && wcode) users.setDeviceApp(req.device.id, 'watch', { versionCode: wcode, versionName: String(req.query.watchVersionName || '').slice(0, 30), via: 'phone' });
      const l = latest(t);
      users.logEvent('update_check', { deviceId: req.device.id, target: t, versionCode: code, latest: l?.versionCode || null });
      if (!l) return res.json({ available: false, latest: null });
      res.json({
        ...pub(l),
        available: !!code && l.versionCode > code,
        required: !!code && code < (l.minVersionCode || 0),
        // An older build is the published one (rollback): Android can't install it over this one
        rolledBack: !!code && l.versionCode < code,
      });
    });

    // GET /api/updates/:target/apk — streaming with Range (resumable downloads)
    app.get('/api/updates/:target/apk', (req, res) => {
      const t = target(req, res);
      if (!t) return;
      const l = latest(t);
      if (!l) return res.status(404).json({ error: 'No update published' });
      if (!req.headers.range || /^bytes=0-/.test(req.headers.range)) {
        users.logEvent('update_download', { deviceId: req.device.id, target: t, versionCode: l.versionCode });
      }
      res.sendFile(path.join(dirOf(t), l.file), {
        headers: { 'Content-Type': 'application/vnd.android.package-archive', 'X-Version-Code': String(l.versionCode), 'X-Sha256': l.sha256 },
        acceptRanges: true, cacheControl: false,
      });
    });

    // POST /api/updates/:target/report { event: installed|failed|declined|deferred, versionCode, versionName, detail? }
    app.post('/api/updates/:target/report', (req, res) => {
      const t = target(req, res);
      if (!t) return;
      const b = req.body || {};
      const event = ['installed', 'failed', 'declined', 'deferred', 'rejected'].includes(b.event) ? b.event : null;
      if (!event) return res.status(400).json({ error: 'event?' });
      const code = num(b.versionCode);
      if (event === 'installed' && code) users.setDeviceApp(req.device.id, t, { versionCode: code, versionName: String(b.versionName || '').slice(0, 30) });
      users.logEvent(`update_${event}`, { deviceId: req.device.id, target: t, versionCode: code, detail: b.detail ? String(b.detail).slice(0, 120) : undefined });
      res.json({ ok: true });
    });

    // ── Admin: drafts, publish, roll back ──
    app.get('/api/admin/updates', requireAdmin, (_req, res) => {
      res.json(Object.fromEntries(TARGETS.map(t => [t, { latest: pub(latest(t)), draft: pub(draft(t)), history: history(t).map(pub) }])));
    });
    app.post('/api/admin/updates/:target/publish', requireAdmin, (req, res) => {
      if (!TARGETS.includes(req.params.target)) return res.status(404).json({ error: 'Unknown app' });
      const t = req.params.target;
      const d = draft(t);
      if (!d) return res.status(404).json({ error: 'No draft to publish' });
      const next = { ...d, publishedAt: new Date().toISOString() };
      writeJson(path.join(dirOf(t), 'latest.json'), next);
      fs.unlinkSync(path.join(dirOf(t), 'draft.json'));
      users.logEvent('update_published', { by: req.user.id, target: t, versionCode: next.versionCode });
      res.json(pub(next));
    });
    app.delete('/api/admin/updates/:target/draft', requireAdmin, (req, res) => {
      if (!TARGETS.includes(req.params.target)) return res.status(404).json({ error: 'Unknown app' });
      const f = path.join(dirOf(req.params.target), 'draft.json');
      if (fs.existsSync(f)) fs.unlinkSync(f);
      res.json({ ok: true });
    });
    // POST /api/admin/updates/:target/rollback { versionCode } — offer an older kept APK again
    app.post('/api/admin/updates/:target/rollback', requireAdmin, (req, res) => {
      if (!TARGETS.includes(req.params.target)) return res.status(404).json({ error: 'Unknown app' });
      const t = req.params.target;
      const h = history(t).find(x => x.versionCode === Number(req.body?.versionCode));
      if (!h || !fs.existsSync(path.join(dirOf(t), h.file))) return res.status(404).json({ error: 'That version isn’t kept any more' });
      const next = { ...h, publishedAt: new Date().toISOString(), rolledBackFrom: latest(t)?.versionCode || null };
      writeJson(path.join(dirOf(t), 'latest.json'), next);
      users.logEvent('update_rollback', { by: req.user.id, target: t, versionCode: h.versionCode, from: next.rolledBackFrom });
      res.json(pub(next));
    });
  }

  return { register, annotate, latest, draft, history, root, TARGETS, KEEP };
}

module.exports = { createUpdates, TARGETS, KEEP, FILE_RE };
