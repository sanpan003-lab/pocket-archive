// Accounts, sessions and device tokens (multi-user, self-hosted).
//
//   CONFIG_DIR/users.json        { version, migratedAt, migrationId, users: [...] }
//   CONFIG_DIR/sessions.json     browser / app sessions (the JWT carries the session id → revocable)
//   CONFIG_DIR/devices.json      Android phone / watch device tokens (SHA-256 hashes only)
//   CONFIG_DIR/security-log.jsonl  logins, lockouts, 2FA changes (never passwords or codes)
//
// None of these files are ever in git. Passwords: bcrypt. TOTP secrets: AES-256-GCM with a
// key derived from JWT_SECRET. Backup codes: SHA-256 hashes, each usable once.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, 'config.json');
const CONFIG_DIR  = path.dirname(CONFIG_PATH);
const USERS_PATH    = path.join(CONFIG_DIR, 'users.json');
const SESSIONS_PATH = path.join(CONFIG_DIR, 'sessions.json');
const DEVICES_PATH  = path.join(CONFIG_DIR, 'devices.json');
const LOG_PATH      = path.join(CONFIG_DIR, 'security-log.jsonl');
const JWT_SECRET    = process.env.JWT_SECRET || 'change-this-secret-in-production';

const COLORS = ['#8B5CF6', '#0EA5E9', '#10B981', '#F59E0B', '#F43F5E', '#6366F1', '#14B8A6', '#EC4899'];
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;

// ── JSON files (atomic writes) ─────────────────────────────────────────────
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// ── Users ──────────────────────────────────────────────────────────────────
const readUsersFile = () => readJson(USERS_PATH, null);
const writeUsersFile = data => writeJson(USERS_PATH, data);

/** Multi-user mode is on once the migration wrote users.json with migratedAt. */
function isMigrated() {
  const f = readUsersFile();
  return !!(f && f.migratedAt && Array.isArray(f.users) && f.users.some(u => u.role === 'admin'));
}

function listUsers() { return readUsersFile()?.users || []; }
function getUser(id) { return listUsers().find(u => u.id === id) || null; }
const normUsername = s => String(s || '').trim().toLowerCase();
function findByUsername(username) {
  const n = normUsername(username);
  return listUsers().find(u => u.username === n) || null;
}

function updateUsers(fn) {
  const file = readUsersFile() || { version: 1, users: [] };
  file.users = fn(file.users || []);
  writeUsersFile(file);
  return file.users;
}
function patchUser(id, patch) {
  let out = null;
  updateUsers(users => users.map(u => (u.id === id ? (out = { ...u, ...(typeof patch === 'function' ? patch(u) : patch) }) : u)));
  return out;
}

const initialsOf = name => String(name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

function newUser({ username, displayName, role = 'member', plan = 'full', password, mustChangePassword = true, passwordHash = null }) {
  const n = normUsername(username);
  if (!USERNAME_RE.test(n)) throw Object.assign(new Error('Username: 2–32 letters, numbers, dot, dash or underscore'), { status: 400 });
  if (findByUsername(n)) throw Object.assign(new Error('That username is taken'), { status: 409 });
  if (!passwordHash && (!password || String(password).length < 8)) throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
  const count = listUsers().length;
  return {
    id: `u_${crypto.randomBytes(6).toString('hex')}`,
    username: n,
    displayName: String(displayName || n).trim().slice(0, 60) || n,
    role: role === 'admin' ? 'admin' : 'member',
    plan: plan === 'lite' ? 'lite' : 'full',
    passwordHash: passwordHash || bcrypt.hashSync(String(password), 10),
    mustChangePassword: !!mustChangePassword,
    disabled: false,
    createdAt: new Date().toISOString(),
    googleCalendarId: null,
    homeLocation: null,
    initials: initialsOf(displayName || n),
    color: COLORS[count % COLORS.length],
    totpSecret: null,
    backupCodes: [],
    failedLogins: 0,
    lockCount: 0,
    lockedUntil: null,
    dailyCap: null,
  };
}

function createUser(opts) {
  const u = newUser(opts);
  updateUsers(users => [...users, u]);
  return u;
}

/** Safe view of a user (never the password hash, TOTP secret or backup codes) */
function publicUser(u) {
  if (!u) return null;
  const { passwordHash, totpSecret, backupCodes, failedLogins, lockCount, ...rest } = u;
  return { ...rest, twoFactor: !!totpSecret, backupCodesLeft: (backupCodes || []).length, locked: !!(u.lockedUntil && Date.parse(u.lockedUntil) > Date.now()) };
}

function setPassword(id, password, { mustChange = false } = {}) {
  if (!password || String(password).length < 8) throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
  return patchUser(id, { passwordHash: bcrypt.hashSync(String(password), 10), mustChangePassword: mustChange });
}

function deleteUser(id) {
  updateUsers(users => users.filter(u => u.id !== id));
  revokeSessions(id);
  revokeDevices(id);
}

// ── Lockout + rate limiting ────────────────────────────────────────────────
// 5 failed logins → locked 15 min, doubling on each repeat lock. Unknown usernames get the
// same treatment in memory, so responses never reveal whether an account exists.
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const ghostFails = new Map(); // unknown username → { fails, lockCount, lockedUntil }

function lockState(username) {
  const u = findByUsername(username);
  const s = u || ghostFails.get(normUsername(username)) || {};
  return { user: u, lockedUntil: s.lockedUntil ? Date.parse(s.lockedUntil) : 0 };
}

function recordFailure(username, ip) {
  const n = normUsername(username);
  const u = findByUsername(n);
  const apply = s => {
    const fails = (s.failedLogins || 0) + 1;
    if (fails >= MAX_FAILS) {
      const lockCount = (s.lockCount || 0) + 1;
      const until = new Date(Date.now() + LOCK_MS * 2 ** (lockCount - 1)).toISOString();
      logEvent('lockout', { userId: u?.id || null, username: n, ip, until });
      return { failedLogins: 0, lockCount, lockedUntil: until };
    }
    return { failedLogins: fails };
  };
  if (u) patchUser(u.id, apply);
  else ghostFails.set(n, { ...(ghostFails.get(n) || {}), ...apply(ghostFails.get(n) || {}) });
}

function recordSuccess(user) {
  patchUser(user.id, { failedLogins: 0, lockCount: 0, lockedUntil: null, lastLoginAt: new Date().toISOString() });
}

/** Per-IP limiter for the login endpoints: 20 attempts / 15 min */
const ipHits = new Map();
function rateLimited(ip, { max = 20, windowMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter(t => now - t < windowMs);
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) for (const [k, v] of ipHits) if (!v.some(t => now - t < windowMs)) ipHits.delete(k);
  return hits.length > max;
}

// ── TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ─────────────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(s) {
  const clean = String(s).replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}
function totpNow(secret, at = Date.now()) { return hotp(secret, Math.floor(at / 30000)); }
function verifyTotp(secret, code, at = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor(at / 30000);
  return [-1, 0, 1].some(d => crypto.timingSafeEqual(Buffer.from(hotp(secret, step + d)), Buffer.from(c)));
}

const encKey = crypto.createHash('sha256').update(`${JWT_SECRET}:totp`).digest();
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
function decrypt(blob) {
  const [v, iv, tag, data] = String(blob || '').split(':');
  if (v !== 'v1') return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', encKey, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch { return null; }
}

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const totpSecretOf = u => (u?.totpSecret ? decrypt(u.totpSecret) : null);

/** Start 2FA setup: a new secret (not active until confirmed with a code) */
function beginTotp(userId) {
  const secret = base32(crypto.randomBytes(20));
  patchUser(userId, { pendingTotp: encrypt(secret) });
  const u = getUser(userId);
  const issuer = 'Pocket Archive';
  const uri = `otpauth://totp/${encodeURIComponent(`${issuer}:${u.username}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri };
}

/** Confirm 2FA with a code → active; returns 8 one-time backup codes (shown once) */
function confirmTotp(userId, code) {
  const u = getUser(userId);
  const secret = u?.pendingTotp ? decrypt(u.pendingTotp) : null;
  if (!secret || !verifyTotp(secret, code)) return null;
  const codes = Array.from({ length: 8 }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  patchUser(userId, { totpSecret: encrypt(secret), pendingTotp: null, backupCodes: codes.map(c => sha(c.replace('-', ''))) });
  return codes;
}

function disableTotp(userId) {
  patchUser(userId, { totpSecret: null, pendingTotp: null, backupCodes: [] });
}

/** A TOTP code or an unused backup code (consumed) */
function checkSecondFactor(user, code) {
  const secret = totpSecretOf(user);
  if (!secret) return true;
  if (verifyTotp(secret, code)) return true;
  const h = sha(String(code || '').toUpperCase().replace(/[\s-]/g, ''));
  if ((user.backupCodes || []).includes(h)) {
    patchUser(user.id, u => ({ backupCodes: (u.backupCodes || []).filter(x => x !== h) }));
    logEvent('backup_code_used', { userId: user.id });
    return true;
  }
  return false;
}

// ── Sessions (web + app) ───────────────────────────────────────────────────
const SESSION_DAYS = { browser: 7, app: 30 };
const readSessions = () => readJson(SESSIONS_PATH, []);
const writeSessions = s => writeJson(SESSIONS_PATH, s);

function createSession(userId, kind, meta = {}) {
  const now = Date.now();
  const s = {
    id: crypto.randomUUID(), userId, kind: SESSION_DAYS[kind] ? kind : 'browser',
    createdAt: new Date(now).toISOString(), lastSeenAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_DAYS[kind === 'app' ? 'app' : 'browser'] * 86400000).toISOString(),
    userAgent: String(meta.userAgent || '').slice(0, 200), ip: meta.ip || null,
  };
  writeSessions([...readSessions().filter(x => Date.parse(x.expiresAt) > now), s]);
  return s;
}
function getSession(id) {
  const s = readSessions().find(x => x.id === id);
  return s && Date.parse(s.expiresAt) > Date.now() ? s : null;
}
function touchSession(id, extendDays = 0) {
  const list = readSessions();
  const s = list.find(x => x.id === id);
  if (!s) return;
  const now = Date.now();
  if (now - Date.parse(s.lastSeenAt) < 3600000 && !extendDays) return;
  s.lastSeenAt = new Date(now).toISOString();
  if (extendDays) s.expiresAt = new Date(now + extendDays * 86400000).toISOString();
  writeSessions(list);
}
function listSessions(userId) { return readSessions().filter(s => s.userId === userId && Date.parse(s.expiresAt) > Date.now()); }
function revokeSession(id, userId) {
  const list = readSessions();
  const next = list.filter(s => !(s.id === id && (!userId || s.userId === userId)));
  writeSessions(next);
  return next.length !== list.length;
}
function revokeSessions(userId, exceptId = null) { writeSessions(readSessions().filter(s => s.userId !== userId || s.id === exceptId)); }

// ── Device tokens (Android phone / watch) ──────────────────────────────────
const DEVICE_TOKEN_DAYS = 90;
const DEVICE_TOKEN_PREFIX = 'pad_';
const readDevices = () => readJson(DEVICES_PATH, []);
const writeDevices = d => writeJson(DEVICES_PATH, d);
const activeDevices = (list, now = Date.now()) => list.filter(t => Date.parse(t.expiresAt) > now);
const publicDevice = ({ hash, ...rest }) => rest;

function createDeviceToken(userId, name) {
  const token = DEVICE_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const entry = {
    id: crypto.randomUUID(), userId,
    name: String(name || 'Android device').trim().slice(0, 60) || 'Android device',
    hash: sha(token), createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DEVICE_TOKEN_DAYS * 86400000).toISOString(), lastUsedAt: null,
  };
  writeDevices([...activeDevices(readDevices()), entry]);
  return { token, device: publicDevice(entry) };
}
function verifyDeviceToken(token) {
  if (typeof token !== 'string' || !token.startsWith(DEVICE_TOKEN_PREFIX)) return null;
  const hash = sha(token);
  const list = readDevices();
  const entry = activeDevices(list).find(t => t.hash === hash);
  if (!entry) return null;
  if (!entry.lastUsedAt || Date.now() - Date.parse(entry.lastUsedAt) > 3600000) {
    entry.lastUsedAt = new Date().toISOString();
    try { writeDevices(list); } catch { /* best effort */ }
  }
  return publicDevice(entry);
}
function listDeviceTokens(userId) {
  return activeDevices(readDevices()).filter(d => d.userId === userId).map(publicDevice).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function revokeDeviceToken(id, userId) {
  const list = readDevices();
  const next = list.filter(t => !(t.id === id && (!userId || t.userId === userId)));
  if (next.length === list.length) return false;
  writeDevices(next);
  return true;
}
function revokeDevices(userId) { writeDevices(readDevices().filter(t => t.userId !== userId)); }

// ── Security log (no passwords, no codes) ──────────────────────────────────
function logEvent(type, data = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), type, ...data });
  try { fs.appendFileSync(LOG_PATH, `${line}\n`, { mode: 0o600 }); } catch { /* best effort */ }
}
function readLog({ userId = null, limit = 200 } = {}) {
  let lines = [];
  try { lines = fs.readFileSync(LOG_PATH, 'utf8').trim().split('\n'); } catch { return []; }
  return lines.slice(-2000).map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(e => e && (!userId || e.userId === userId)).slice(-limit).reverse();
}

module.exports = {
  USERS_PATH, SESSIONS_PATH, DEVICES_PATH, LOG_PATH, CONFIG_DIR, SESSION_DAYS, DEVICE_TOKEN_DAYS,
  isMigrated, readUsersFile, writeUsersFile, listUsers, getUser, findByUsername, normUsername, newUser, createUser, patchUser,
  publicUser, setPassword, deleteUser, initialsOf,
  lockState, recordFailure, recordSuccess, rateLimited,
  beginTotp, confirmTotp, disableTotp, checkSecondFactor, totpNow, verifyTotp, base32,
  createSession, getSession, touchSession, listSessions, revokeSession, revokeSessions,
  createDeviceToken, verifyDeviceToken, listDeviceTokens, revokeDeviceToken, revokeDevices,
  logEvent, readLog,
  _internal: { encrypt, decrypt, hotp, unbase32, ghostFails, ipHits },
};
