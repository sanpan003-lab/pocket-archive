// Accounts: the auth guard, login (username + password + optional 2FA), sessions & devices,
// 2FA setup, calendar setup and the admin's Users screen. Account data: users.js.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const users = require('./users');
const { generateToken, verifyToken, generateMediaToken, verifyMediaToken } = require('./auth');
const gcal = require('./googleCalendar');
const { zipFolder } = require('./zip');

// Media URLs the Android app loads in <audio>/links (no Authorization header possible)
// (+ the live event stream: EventSource can't send headers either)
const MEDIA_PATH_RE = /^\/(events|quick\/qn_[\w-]+\/(audio|media)|recordings\/[^/]+\/attachments\/[^/]+|maps\/(tiles|fonts|sprites)\/.+|audio\/.+)$/;
const GENERIC_LOGIN_ERROR = 'Invalid username or password';
const TOO_MANY = 'Too many sign-in attempts. Try again later.';
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // same cost as real checks

function createAccounts({ archivePath, contexts }) {
  const clientIp = req => req.ip || req.socket?.remoteAddress || 'unknown';
  const bearerToken = req => {
    const header = req.headers.authorization || '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  };
  const activeUser = id => {
    const u = id && users.getUser(id);
    return u && !u.disabled ? u : null;
  };

  // ── Sessions ─────────────────────────────────────────────────────────────
  function setCookie(res, token, kind) {
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: users.SESSION_DAYS[kind === 'app' ? 'app' : 'browser'] * 24 * 60 * 60 * 1000,
    });
  }
  function issueSession(req, res, user, kind) {
    const k = kind === 'app' ? 'app' : 'browser';
    const s = users.createSession(user.id, k, { userAgent: req.get('user-agent'), ip: clientIp(req) });
    setCookie(res, generateToken({ userId: user.id, sessionId: s.id, kind: k }), k);
    return s;
  }
  // Installed-app sessions slide: renewed at most once a day while in use
  function renewAppSession(payload, res) {
    if (payload?.kind === 'app' && Date.now() / 1000 - payload.iat > 24 * 60 * 60) {
      users.touchSession(payload.sid, users.SESSION_DAYS.app);
      setCookie(res, generateToken({ userId: payload.uid, sessionId: payload.sid, kind: 'app' }), 'app');
    }
  }
  /** Cookie → { user, session, payload } or null */
  function fromCookie(req) {
    const payload = req.cookies?.token && verifyToken(req.cookies.token);
    if (!payload?.sid || !payload.uid) return null; // tokens from before accounts don't count
    const session = users.getSession(payload.sid);
    if (!session || session.userId !== payload.uid) return null;
    const user = activeUser(payload.uid);
    return user ? { user, session, payload } : null;
  }

  // ── The guard: every /api route after the public ones ────────────────────
  function requireAuth(req, res, next) {
    let user = null;
    const bearer = bearerToken(req);
    if (bearer) {
      const device = users.verifyDeviceToken(bearer);
      user = device && activeUser(device.userId);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      req.device = device;
    } else if (req.method === 'GET' && typeof req.query.mt === 'string' && MEDIA_PATH_RE.test(req.path)) {
      // Android media URLs: short-lived read-only token naming the user
      user = activeUser(verifyMediaToken(req.query.mt));
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
    } else {
      const c = fromCookie(req);
      if (!c) return res.status(401).json({ error: 'Unauthorized' });
      user = c.user;
      req.session = c.session;
      users.touchSession(c.session.id);
      renewAppSession(c.payload, res);
    }
    req.user = user;
    // A temporary password must be changed before anything else
    if (user.mustChangePassword && !req.path.startsWith('/auth/')) {
      return res.status(403).json({ error: 'Set your password first', mustChangePassword: true });
    }
    next();
  }

  function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Not available for this account' });
    next();
  }

  // ── Login checks (shared by the web login and the app's device token) ────
  async function checkLogin(req, { username, password, code }) {
    const ip = clientIp(req);
    if (users.rateLimited(ip)) {
      users.logEvent('rate_limited', { ip });
      return { status: 429, body: { error: TOO_MANY } };
    }
    const n = users.normUsername(username);
    const { user, lockedUntil } = users.lockState(n);
    if (lockedUntil > Date.now()) return { status: 429, body: { error: TOO_MANY } };
    // Compare against a dummy hash for unknown users so timing doesn't reveal them
    const hash = user?.passwordHash || DUMMY_HASH;
    const ok = await bcrypt.compare(String(password || ''), hash);
    if (!user || !ok || user.disabled) {
      users.recordFailure(n, ip);
      users.logEvent('login_failed', { userId: user?.id || null, username: n, ip });
      return { status: 401, body: { error: GENERIC_LOGIN_ERROR } };
    }
    if (user.totpSecret) {
      if (!code) return { status: 200, body: { twoFactorRequired: true } };
      if (!users.checkSecondFactor(user, code)) {
        users.recordFailure(n, ip);
        users.logEvent('2fa_failed', { userId: user.id, ip });
        return { status: 401, body: { error: 'That code didn’t work', twoFactorRequired: true } };
      }
    }
    users.recordSuccess(user);
    return { user: users.getUser(user.id) };
  }

  // ── Routes ───────────────────────────────────────────────────────────────
  function registerPublic(app) {
    app.post('/api/auth/login', async (req, res) => {
      const { username, password, code, installed } = req.body || {};
      const r = await checkLogin(req, { username, password, code });
      if (!r.user) return res.status(r.status).json(r.body);
      issueSession(req, res, r.user, installed === true ? 'app' : 'browser');
      users.logEvent('login', { userId: r.user.id, ip: clientIp(req), kind: installed === true ? 'app' : 'browser' });
      res.json({ success: true, mustChangePassword: !!r.user.mustChangePassword, user: users.publicUser(r.user) });
    });

    app.post('/api/auth/logout', (req, res) => {
      const c = fromCookie(req);
      if (c) { users.revokeSession(c.session.id); users.logEvent('logout', { userId: c.user.id }); }
      res.clearCookie('token');
      res.json({ success: true });
    });

    app.get('/api/auth/status', (req, res) => {
      const bearer = bearerToken(req);
      if (bearer) {
        const d = users.verifyDeviceToken(bearer);
        const u = d && activeUser(d.userId);
        return res.json({ authenticated: !!u, user: users.publicUser(u), mustChangePassword: !!u?.mustChangePassword });
      }
      const c = fromCookie(req);
      if (c) renewAppSession(c.payload, res);
      res.json({ authenticated: !!c, user: users.publicUser(c?.user), mustChangePassword: !!c?.user.mustChangePassword });
    });

    // Android app sign-in → 90-day device token for this user
    app.post('/api/auth/device-token', async (req, res) => {
      const { username, password, code, deviceName } = req.body || {};
      const r = await checkLogin(req, { username, password, code });
      if (!r.user) return res.status(r.status).json(r.body);
      const { token, device } = users.createDeviceToken(r.user.id, deviceName);
      users.logEvent('device_signed_in', { userId: r.user.id, device: device.name, ip: clientIp(req) });
      res.json({ token, device, userId: r.user.id, user: users.publicUser(r.user), mustChangePassword: !!r.user.mustChangePassword });
    });
  }

  function registerPrivate(app) {
    app.get('/api/auth/me', (req, res) => {
      res.json({ ...users.publicUser(req.user), calendar: calendarInfo(req.user) });
    });

    app.patch('/api/auth/me', (req, res) => {
      const b = req.body || {};
      const patch = {};
      if (typeof b.displayName === 'string' && b.displayName.trim()) {
        patch.displayName = b.displayName.trim().slice(0, 60);
        patch.initials = users.initialsOf(patch.displayName);
      }
      if (b.googleCalendarId !== undefined) {
        const id = String(b.googleCalendarId || '').trim();
        if (id && !/^[\w.@+-]{3,200}$/.test(id)) return res.status(400).json({ error: 'That doesn’t look like a calendar ID' });
        patch.googleCalendarId = id || null;
      }
      // Welcome walkthrough finished or skipped
      if (b.welcomeDone === true) { patch.welcomePending = false; patch.welcomeDoneAt = new Date().toISOString(); }
      res.json(users.publicUser(users.patchUser(req.user.id, patch)));
    });

    app.post('/api/auth/change-password', async (req, res) => {
      const { currentPassword, newPassword } = req.body || {};
      if (!(await bcrypt.compare(String(currentPassword || ''), req.user.passwordHash))) {
        return res.status(401).json({ error: 'Current password incorrect' });
      }
      if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      if (newPassword === currentPassword) return res.status(400).json({ error: 'Choose a new password' });
      users.setPassword(req.user.id, newPassword);
      // Other browsers sign out; this one and the app's device tokens stay
      users.revokeSessions(req.user.id, req.session?.id || null);
      users.logEvent('password_changed', { userId: req.user.id });
      res.json({ success: true });
    });

    // 2FA (TOTP)
    app.post('/api/auth/2fa/setup', (req, res) => {
      if (req.user.totpSecret) return res.status(409).json({ error: 'Two-step verification is already on' });
      res.json(users.beginTotp(req.user.id));
    });
    app.post('/api/auth/2fa/confirm', (req, res) => {
      const codes = users.confirmTotp(req.user.id, req.body?.code);
      if (!codes) return res.status(400).json({ error: 'That code didn’t work — check the time on your phone and try again' });
      users.logEvent('2fa_enabled', { userId: req.user.id });
      res.json({ backupCodes: codes });
    });
    app.post('/api/auth/2fa/disable', async (req, res) => {
      if (!(await bcrypt.compare(String(req.body?.password || ''), req.user.passwordHash))) {
        return res.status(401).json({ error: 'Password incorrect' });
      }
      users.disableTotp(req.user.id);
      users.logEvent('2fa_disabled', { userId: req.user.id });
      res.json({ success: true });
    });

    // Sessions & devices
    app.get('/api/auth/sessions', (req, res) => {
      res.json({
        sessions: users.listSessions(req.user.id).map(({ ip, ...s }) => ({ ...s, current: s.id === req.session?.id })),
        devices: users.listDeviceTokens(req.user.id).map(d => ({ ...d, current: req.device?.id === d.id })),
      });
    });
    app.delete('/api/auth/sessions/:id', (req, res) => {
      if (!users.revokeSession(req.params.id, req.user.id)) return res.status(404).json({ error: 'Session not found' });
      users.logEvent('session_revoked', { userId: req.user.id });
      res.json({ success: true });
    });
    app.post('/api/auth/sign-out-everywhere', (req, res) => {
      users.revokeSessions(req.user.id);
      users.revokeDevices(req.user.id);
      users.logEvent('signed_out_everywhere', { userId: req.user.id });
      res.clearCookie('token');
      res.json({ success: true });
    });
    app.get('/api/auth/devices', (req, res) => {
      res.json(users.listDeviceTokens(req.user.id).map(d => ({ ...d, current: req.device?.id === d.id })));
    });
    app.delete('/api/auth/devices/current', (req, res) => {
      if (!req.device) return res.status(400).json({ error: 'Not signed in with a device token' });
      users.revokeDeviceToken(req.device.id, req.user.id);
      res.json({ success: true });
    });
    app.delete('/api/auth/devices/:id', (req, res) => {
      if (!users.revokeDeviceToken(req.params.id, req.user.id)) return res.status(404).json({ error: 'Device not found' });
      users.logEvent('device_revoked', { userId: req.user.id });
      res.json({ success: true });
    });
    app.get('/api/auth/media-token', (req, res) => {
      res.json({ token: generateMediaToken(req.user.id), expiresInSec: 12 * 60 * 60 });
    });
    app.get('/api/auth/security-log', (req, res) => {
      res.json(users.readLog({ userId: req.user.id, limit: 50 }).map(({ ip, ...e }) => e));
    });

    // Google Calendar (per user)
    app.get('/api/calendar/setup', (req, res) => res.json(calendarInfo(req.user)));
    app.post('/api/calendar/test', async (req, res) => {
      const id = String(req.body?.calendarId || req.user.googleCalendarId || '').trim()
        || (req.user.role === 'admin' ? process.env.GOOGLE_CALENDAR_ID : '');
      if (!id) return res.status(400).json({ error: 'Enter a calendar ID first' });
      res.json(await gcal.testCalendar(id));
    });

    // ── Admin: Settings → Users ────────────────────────────────────────────
    const admin = [requireAdmin];
    const target = (req, res) => {
      const u = users.getUser(req.params.id);
      if (!u) { res.status(404).json({ error: 'User not found' }); return null; }
      return u;
    };
    const adminView = u => ({
      ...users.publicUser(u),
      usage: safeUsage(u.id),
      devices: users.listDeviceTokens(u.id).length,
      // Phone / watch app versions per device (over-the-air updates)
      deviceList: users.listDeviceTokens(u.id).map(d => ({ id: d.id, name: d.name, lastUsedAt: d.lastUsedAt, apps: d.apps || {}, updateStatus: d.updateStatus || {} })),
    });
    const safeUsage = id => { try { return contexts.usageSummary(id); } catch { return null; } };

    app.get('/api/admin/users', admin, (_req, res) => res.json(users.listUsers().map(adminView)));
    app.post('/api/admin/users', admin, (req, res) => {
      try {
        const b = req.body || {};
        const u = users.createUser({ username: b.username, displayName: b.displayName, plan: b.plan, password: b.password, mustChangePassword: true });
        users.logEvent('user_created', { userId: u.id, by: req.user.id });
        res.json(adminView(u));
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });
    app.patch('/api/admin/users/:id', admin, (req, res) => {
      const u = target(req, res);
      if (!u) return;
      const b = req.body || {};
      const patch = {};
      if (b.plan === 'lite' || b.plan === 'full') patch.plan = b.plan;
      if (typeof b.displayName === 'string' && b.displayName.trim()) { patch.displayName = b.displayName.trim().slice(0, 60); patch.initials = users.initialsOf(patch.displayName); }
      if (b.dailyCap === null || (Number.isInteger(b.dailyCap) && b.dailyCap >= 0 && b.dailyCap <= 10000)) patch.dailyCap = b.dailyCap || null;
      if (typeof b.disabled === 'boolean') {
        if (u.id === req.user.id) return res.status(400).json({ error: 'You can’t disable your own account' });
        patch.disabled = b.disabled;
      }
      const next = users.patchUser(u.id, patch);
      if (patch.disabled) { users.revokeSessions(u.id); users.revokeDevices(u.id); }
      users.logEvent('user_updated', { userId: u.id, by: req.user.id, fields: Object.keys(patch) });
      res.json(adminView(next));
    });
    app.post('/api/admin/users/:id/reset-password', admin, (req, res) => {
      const u = target(req, res);
      if (!u) return;
      try {
        users.setPassword(u.id, req.body?.password, { mustChange: true });
        users.patchUser(u.id, { failedLogins: 0, lockCount: 0, lockedUntil: null });
        if (u.id !== req.user.id) { users.revokeSessions(u.id); users.revokeDevices(u.id); }
        users.logEvent('password_reset', { userId: u.id, by: req.user.id });
        res.json({ success: true });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });
    app.post('/api/admin/users/:id/reset-2fa', admin, (req, res) => {
      const u = target(req, res);
      if (!u) return;
      users.disableTotp(u.id);
      users.logEvent('2fa_reset', { userId: u.id, by: req.user.id });
      res.json({ success: true });
    });
    app.post('/api/admin/users/:id/unlock', admin, (req, res) => {
      const u = target(req, res);
      if (!u) return;
      users.patchUser(u.id, { failedLogins: 0, lockCount: 0, lockedUntil: null });
      res.json({ success: true });
    });
    function exportUser(u) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(archivePath, '_exports', `${u.username}-${stamp}.zip`);
      const r = zipFolder(contexts.userRoot(u.id), file, `${u.username}/`);
      return { file: path.relative(archivePath, file).split(path.sep).join('/'), ...r };
    }
    app.post('/api/admin/users/:id/export', admin, (req, res) => {
      const u = target(req, res);
      if (!u) return;
      try { res.json(exportUser(u)); } catch (err) { res.status(500).json({ error: `Export failed: ${err.message}` }); }
    });
    // Delete: always exports to ARCHIVE/_exports/ first; the body must repeat the username
    app.delete('/api/admin/users/:id', admin, (req, res) => {
      const u = target(req, res);
      if (!u) return;
      if (u.id === req.user.id) return res.status(400).json({ error: 'You can’t delete your own account' });
      if (users.normUsername(req.body?.confirm) !== u.username) return res.status(400).json({ error: 'Type the username to confirm' });
      let exported;
      try { exported = exportUser(u); } catch (err) { return res.status(500).json({ error: `Export failed, nothing deleted: ${err.message}` }); }
      users.deleteUser(u.id);
      contexts.forget(u.id);
      fs.rmSync(contexts.userRoot(u.id), { recursive: true, force: true });
      users.logEvent('user_deleted', { userId: u.id, by: req.user.id, export: exported.file });
      res.json({ success: true, export: exported });
    });
    app.get('/api/admin/security-log', admin, (_req, res) => res.json(users.readLog({ limit: 200 })));
  }

  function calendarInfo(user) {
    const fallback = user.role === 'admin' && !!process.env.GOOGLE_CALENDAR_ID;
    return {
      serviceAccountEmail: gcal.serviceAccountEmail(),
      calendarId: user.googleCalendarId || null,
      usingDefault: !user.googleCalendarId && fallback,
      configured: !!process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
    };
  }

  return { requireAuth, requireAdmin, registerPublic, registerPrivate, MEDIA_PATH_RE };
}

module.exports = { createAccounts, MEDIA_PATH_RE };
