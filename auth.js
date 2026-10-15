const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const CONFIG_PATH = process.env.CONFIG_PATH
  || path.join(__dirname, 'config.json');

const JWT_SECRET = process.env.JWT_SECRET
  || 'change-this-secret-in-production';

function getConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    const defaultConfig = {
      passwordHash: bcrypt.hashSync('admin123', 10),
      mustChangePassword: true,
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
}

function verifyPassword(password) {
  const config = getConfig();
  return bcrypt.compareSync(password, config.passwordHash);
}

// kind: 'browser' (7-day session) or 'app' (installed app, 30 days)
function generateToken(kind = 'browser') {
  const expiresIn = kind === 'app' ? '30d' : '7d';
  return jwt.sign({ user: 'admin', kind }, JWT_SECRET, { expiresIn });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function savePassword(newHash) {
  const config = getConfig();
  config.passwordHash = newHash;
  config.mustChangePassword = false;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function mustChangePassword() {
  return getConfig().mustChangePassword === true;
}

// ── Device tokens (Android app) ─────────────────────────────────────────────
// Long-lived bearer tokens. Only a SHA-256 hash is stored in the config; the
// token itself is shown once to the device that requested it.

const DEVICE_TOKEN_DAYS   = 90;
const DEVICE_TOKEN_PREFIX = 'pad_';

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function publicDevice(entry) {
  const { hash, ...rest } = entry; // never expose the hash
  return rest;
}

function activeDevices(config, now = Date.now()) {
  return (config.deviceTokens || []).filter(t => new Date(t.expiresAt).getTime() > now);
}

function createDeviceToken(name) {
  const token = DEVICE_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const entry = {
    id:         crypto.randomUUID(),
    name:       String(name || 'Android device').trim().slice(0, 60) || 'Android device',
    hash:       hashToken(token),
    createdAt:  now.toISOString(),
    expiresAt:  new Date(now.getTime() + DEVICE_TOKEN_DAYS * 86400000).toISOString(),
    lastUsedAt: null,
  };
  const config = getConfig();
  config.deviceTokens = [...activeDevices(config), entry]; // also drops expired ones
  saveConfig(config);
  return { token, device: publicDevice(entry) };
}

// Returns the device (without hash) or null. Records last use at most hourly.
function verifyDeviceToken(token) {
  if (typeof token !== 'string' || !token.startsWith(DEVICE_TOKEN_PREFIX)) return null;
  const hash = hashToken(token);
  const config = getConfig();
  const entry = activeDevices(config).find(t => t.hash === hash);
  if (!entry) return null;
  if (!entry.lastUsedAt || Date.now() - new Date(entry.lastUsedAt).getTime() > 3600000) {
    entry.lastUsedAt = new Date().toISOString();
    try { saveConfig(config); } catch { /* best effort */ }
  }
  return publicDevice(entry);
}

function listDeviceTokens() {
  return activeDevices(getConfig())
    .map(publicDevice)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function revokeDeviceToken(id) {
  const config = getConfig();
  const before = (config.deviceTokens || []).length;
  config.deviceTokens = (config.deviceTokens || []).filter(t => t.id !== id);
  if (config.deviceTokens.length === before) return false;
  saveConfig(config);
  return true;
}

// ── Media tokens ────────────────────────────────────────────────────────────
// Short-lived, read-only tokens the app appends to <audio>/attachment URLs
// (which can't send an Authorization header). Signed with a separate key so
// they can never be used as a session cookie.

const MEDIA_SECRET = `${JWT_SECRET}:media`;

function generateMediaToken() {
  return jwt.sign({ kind: 'media' }, MEDIA_SECRET, { expiresIn: '12h' });
}

function verifyMediaToken(token) {
  try {
    return jwt.verify(token, MEDIA_SECRET)?.kind === 'media';
  } catch {
    return false;
  }
}

module.exports = {
  verifyPassword, generateToken, verifyToken,
  hashPassword, savePassword, mustChangePassword,
  createDeviceToken, verifyDeviceToken, listDeviceTokens, revokeDeviceToken,
  generateMediaToken, verifyMediaToken, DEVICE_TOKEN_DAYS,
  getConfig, saveConfig, CONFIG_PATH,
};
