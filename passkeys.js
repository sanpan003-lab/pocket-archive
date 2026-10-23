// Passkeys (2.7.0): sign in on the web with a fingerprint, Windows Hello or a phone — WebAuthn, verified here on
// the NAS (@simplewebauthn/server, a library; no outside service). The password stays as the fallback; signing in
// with a passkey doesn't ask for the 2FA code (a passkey is already two factors: the device + its unlock).
//
//   CONFIG_DIR/passkeys.json  [{ id, userId, publicKey, counter, transports, rpID, name, deviceType, backedUp,
//                                createdAt, lastUsedAt }]
//
// The RP ID is the domain the browser shows (from the request's Origin) and is stored with each passkey, so it
// works behind the reverse proxy whatever Host header it forwards. A passkey only signs in on its own domain.

const fs = require('fs');
const path = require('path');

const CHALLENGE_MS = 5 * 60 * 1000;
const MAX_PER_USER = 20;

function createPasskeys({ users, issueSession, clientIp, activeUser }) {
  const FILE = path.join(users.CONFIG_DIR, 'passkeys.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } };
  const write = list => {
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  };
  const lib = () => import('@simplewebauthn/server');

  // Pending challenges: registration per user, sign-in per challenge (one use each)
  const regChallenges = new Map();     // userId → { challenge, rpID, origin, at }
  const loginChallenges = new Map();   // challenge → { rpID, origin, at }
  const sweep = () => {
    const old = Date.now() - CHALLENGE_MS;
    for (const [k, v] of regChallenges) if (v.at < old) regChallenges.delete(k);
    for (const [k, v] of loginChallenges) if (v.at < old) loginChallenges.delete(k);
  };

  /** The page's origin and domain (WebAuthn needs both). Only https (or localhost). */
  function originOf(req) {
    const origin = String(req.get('origin') || '');
    let url;
    try { url = new URL(origin); } catch { throw Object.assign(new Error('Passkeys need the page’s address (Origin)'), { status: 400 }); }
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !local) throw Object.assign(new Error('Passkeys only work over https'), { status: 400 });
    return { origin: url.origin, rpID: url.hostname };
  }

  const publicKey = p => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt || null, backedUp: !!p.backedUp, deviceType: p.deviceType || null });
  const fail = (res, err, status = 400) => res.status(err.status || status).json({ error: err.message || 'Passkey failed' });

  // ── Public: sign in ──────────────────────────────────────────────────────
  function registerPublic(app) {
    // POST /api/auth/passkey/options → WebAuthn request options (any passkey of this domain)
    app.post('/api/auth/passkey/options', async (req, res) => {
      try {
        const { origin, rpID } = originOf(req);
        if (users.rateLimited(clientIp(req))) return res.status(429).json({ error: 'Too many attempts — try again later' });
        sweep();
        const { generateAuthenticationOptions } = await lib();
        const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred', allowCredentials: [] });
        loginChallenges.set(options.challenge, { rpID, origin, at: Date.now() });
        res.json(options);
      } catch (err) { fail(res, err); }
    });

    // POST /api/auth/passkey/verify { response, installed? } → session cookie (no 2FA step)
    app.post('/api/auth/passkey/verify', async (req, res) => {
      const ip = clientIp(req);
      try {
        const { origin, rpID } = originOf(req);
        if (users.rateLimited(ip)) return res.status(429).json({ error: 'Too many attempts — try again later' });
        const response = req.body?.response;
        const pk = read().find(p => p.id === response?.id);
        if (!pk || pk.rpID !== rpID) {
          users.recordFailure('', ip);
          users.logEvent('passkey_login_failed', { reason: 'unknown passkey', ip });
          return res.status(401).json({ error: 'That passkey isn’t registered here — sign in with your password' });
        }
        const user = activeUser(pk.userId);
        if (!user) return res.status(401).json({ error: 'This account can’t sign in' });
        const { verifyAuthenticationResponse } = await lib();
        let pending = null;
        const verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge: c => { pending = loginChallenges.get(c); return !!pending && pending.rpID === rpID; },
          expectedOrigin: origin,
          expectedRPID: rpID,
          credential: { id: pk.id, publicKey: Buffer.from(pk.publicKey, 'base64url'), counter: pk.counter || 0, transports: pk.transports || [] },
          requireUserVerification: false,
        });
        if (!verification.verified) throw new Error('not verified');
        for (const [c, v] of loginChallenges) if (v === pending) loginChallenges.delete(c);
        const list = read();
        const entry = list.find(p => p.id === pk.id);
        entry.counter = verification.authenticationInfo.newCounter;
        entry.lastUsedAt = new Date().toISOString();
        write(list);
        users.recordSuccess(user);
        const kind = req.body?.installed === true ? 'app' : 'browser';
        issueSession(req, res, user, kind);
        users.logEvent('login', { userId: user.id, ip, kind, method: 'passkey', passkey: entry.name });
        res.json({ success: true, mustChangePassword: !!user.mustChangePassword, user: users.publicUser(users.getUser(user.id)) });
      } catch (err) {
        users.recordFailure('', ip);
        users.logEvent('passkey_login_failed', { reason: String(err.message || err).slice(0, 80), ip });
        res.status(err.status || 401).json({ error: err.status ? err.message : 'The passkey didn’t work — try again or use your password' });
      }
    });
  }

  // ── Signed in: add, list, remove ─────────────────────────────────────────
  function registerPrivate(app) {
    // Only from a browser session (not the app's device token — WebView has no passkeys)
    const webOnly = (req, res) => {
      if (req.device) { res.status(403).json({ error: 'Add passkeys from a browser' }); return false; }
      return true;
    };

    app.get('/api/auth/passkeys', (req, res) => {
      res.json(read().filter(p => p.userId === req.user.id).map(publicKey));
    });

    // POST /api/auth/passkeys/options → registration options for this account
    app.post('/api/auth/passkeys/options', async (req, res) => {
      if (!webOnly(req, res)) return;
      try {
        const { origin, rpID } = originOf(req);
        const mine = read().filter(p => p.userId === req.user.id);
        if (mine.length >= MAX_PER_USER) return res.status(409).json({ error: `Up to ${MAX_PER_USER} passkeys per account` });
        sweep();
        const { generateRegistrationOptions } = await lib();
        const options = await generateRegistrationOptions({
          rpName: 'Pocket Archive', rpID,
          userName: req.user.username, userDisplayName: req.user.displayName || req.user.username,
          userID: Buffer.from(req.user.id, 'utf8'),
          attestationType: 'none',
          excludeCredentials: mine.filter(p => p.rpID === rpID).map(p => ({ id: p.id, transports: p.transports || [] })),
          authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
        });
        regChallenges.set(req.user.id, { challenge: options.challenge, rpID, origin, at: Date.now() });
        res.json(options);
      } catch (err) { fail(res, err); }
    });

    // POST /api/auth/passkeys { response, name } → saved passkey
    app.post('/api/auth/passkeys', async (req, res) => {
      if (!webOnly(req, res)) return;
      try {
        const { origin, rpID } = originOf(req);
        const pending = regChallenges.get(req.user.id);
        if (!pending || pending.rpID !== rpID) return res.status(400).json({ error: 'Start again — that took too long' });
        const { verifyRegistrationResponse } = await lib();
        const v = await verifyRegistrationResponse({
          response: req.body?.response, expectedChallenge: pending.challenge, expectedOrigin: origin, expectedRPID: rpID,
          requireUserVerification: false,
        });
        regChallenges.delete(req.user.id);
        if (!v.verified || !v.registrationInfo) throw new Error('The passkey couldn’t be verified');
        const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
        const list = read();
        if (list.some(p => p.id === credential.id)) return res.status(409).json({ error: 'That passkey is already added' });
        const name = String(req.body?.name || '').trim().slice(0, 60) || 'Passkey';
        const entry = {
          id: credential.id, userId: req.user.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'),
          counter: credential.counter || 0, transports: credential.transports || req.body?.response?.response?.transports || [],
          rpID, name, deviceType: credentialDeviceType, backedUp: !!credentialBackedUp,
          createdAt: new Date().toISOString(), lastUsedAt: null,
        };
        write([...list, entry]);
        users.logEvent('passkey_added', { userId: req.user.id, name, ip: clientIp(req) });
        res.json(publicKey(entry));
      } catch (err) { fail(res, err); }
    });

    // PATCH /api/auth/passkeys/:id { name }
    app.patch('/api/auth/passkeys/:id', (req, res) => {
      const list = read();
      const p = list.find(x => x.id === req.params.id && x.userId === req.user.id);
      if (!p) return res.status(404).json({ error: 'Passkey not found' });
      p.name = String(req.body?.name || '').trim().slice(0, 60) || p.name;
      write(list);
      res.json(publicKey(p));
    });

    // DELETE /api/auth/passkeys/:id
    app.delete('/api/auth/passkeys/:id', (req, res) => {
      const list = read();
      const p = list.find(x => x.id === req.params.id && x.userId === req.user.id);
      if (!p) return res.status(404).json({ error: 'Passkey not found' });
      write(list.filter(x => x !== p));
      users.logEvent('passkey_removed', { userId: req.user.id, name: p.name, ip: clientIp(req) });
      res.json({ success: true });
    });
  }

  /** An account is deleted → its passkeys too */
  function removeUser(userId) { write(read().filter(p => p.userId !== userId)); }

  return { registerPublic, registerPrivate, removeUser };
}

module.exports = { createPasskeys };
