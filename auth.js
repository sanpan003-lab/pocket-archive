// Session JWTs, media tokens and the global config file.
// Accounts, sessions, device tokens, 2FA and lockout live in users.js.

const jwt  = require('jsonwebtoken');
const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.CONFIG_PATH
  || path.join(__dirname, 'config.json');

const JWT_SECRET = process.env.JWT_SECRET
  || 'change-this-secret-in-production';

/** Global (not per-user) settings, e.g. the family calendar. Missing file = empty. */
function getConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Session token: { uid, sid, kind } — the session id makes it revocable (users.js sessions)
function generateToken({ userId, sessionId, kind = 'browser' }) {
  const expiresIn = kind === 'app' ? '30d' : '7d';
  return jwt.sign({ uid: userId, sid: sessionId, kind }, JWT_SECRET, { expiresIn });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ── Media tokens ────────────────────────────────────────────────────────────
// Short-lived, read-only tokens the app appends to <audio>/attachment URLs
// (which can't send an Authorization header). Signed with a separate key so
// they can never be used as a session cookie. They name the user, so a media
// URL only ever opens that user's files.

const MEDIA_SECRET = `${JWT_SECRET}:media`;

function generateMediaToken(userId) {
  return jwt.sign({ kind: 'media', uid: userId }, MEDIA_SECRET, { expiresIn: '12h' });
}

/** → userId or null */
function verifyMediaToken(token) {
  try {
    const p = jwt.verify(token, MEDIA_SECRET);
    return p?.kind === 'media' && p.uid ? p.uid : null;
  } catch {
    return null;
  }
}

module.exports = {
  generateToken, verifyToken,
  generateMediaToken, verifyMediaToken,
  getConfig, saveConfig, CONFIG_PATH, JWT_SECRET,
};
