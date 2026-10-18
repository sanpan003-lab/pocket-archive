#!/usr/bin/env node
// One-time migration to multi-user accounts. Run it inside the container:
//
//   node scripts/migrate-users.mjs --dry-run --admin-username <name> [--display-name "<Name>"]
//   node scripts/migrate-users.mjs --admin-username <name> [--display-name "<Name>"]
//   node scripts/migrate-users.mjs --rollback <timestamp>
//
// Dry run: prints exactly what would move (counts, sizes, conflicts) and changes nothing.
// Real run:
//   1. backup  → ARCHIVE/_backups/<timestamp>/ (07_Quick_Notes, 08_Projects, config.json, places-cache.json)
//   2. creates the admin account (your current password and device tokens carry over)
//   3. moves 07_Quick_Notes + 08_Projects → ARCHIVE/users/<adminId>/, settings (home, places,
//      appearance, smart-append, errands) → users/<adminId>/settings.json
//   4. verifies every moved file by SHA-256, then switches the server to multi-user mode
//   5. writes ARCHIVE/_backups/<timestamp>/migration.log
// Idempotent: a second run reports "already migrated" (or finishes an interrupted run).
// Rollback: restores the backup; everything created since is kept in _backups/<ts>/rolled-back-<now>/.
//
// Hey Pocket folders (01–05, 99_Deleted) and 09_Maps are not touched.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };

const ARCHIVE = process.env.ARCHIVE_PATH;
const CONFIG_PATH = process.env.CONFIG_PATH;
if (!ARCHIVE || !CONFIG_PATH) {
  console.error('ARCHIVE_PATH and CONFIG_PATH must be set (they are inside the container). Refusing to guess paths.');
  process.exit(2);
}
const CONFIG_DIR = path.dirname(CONFIG_PATH);
const users = require('../users.js');

const DRY = flag('dry-run');
const ROLLBACK = opt('rollback');
const MOVED_DIRS = ['07_Quick_Notes', '08_Projects'];
const SETTINGS_KEYS = ['places', 'appearance', 'quickSettings', 'errandSettings'];
const REMOVED_CONFIG_KEYS = ['passwordHash', 'mustChangePassword', 'deviceTokens', ...SETTINGS_KEYS];
const PLACES_CACHE = path.join(CONFIG_DIR, 'places-cache.json');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const human = n => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} KB` : `${n} B`);
const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };

let logLines = [];
const log = (...a) => { const line = a.join(' '); logLines.push(line); console.log(line); };

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else if (e.isFile()) out.push({ abs: p, rel: path.relative(base, p), size: fs.statSync(p).size });
  }
  return out;
}
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const summary = files => ({ count: files.length, bytes: files.reduce((a, f) => a + f.size, 0) });

// ── Rollback ───────────────────────────────────────────────────────────────
if (ROLLBACK) {
  const backup = path.join(ARCHIVE, '_backups', ROLLBACK);
  if (!fs.existsSync(path.join(backup, 'manifest.json'))) {
    console.error(`No backup at ${backup}`);
    process.exit(1);
  }
  const aside = path.join(backup, `rolled-back-${stamp()}`);
  log(`Rolling back to ${ROLLBACK}. Current data is kept in ${aside}`);
  if (DRY) {
    log('(dry run — nothing changed)');
    log(`Would move ARCHIVE/users, ${MOVED_DIRS.join(', ')} (if present) and users.json/sessions.json/devices.json aside, then restore the backup.`);
    process.exit(0);
  }
  fs.mkdirSync(path.join(aside, 'config'), { recursive: true });
  if (fs.existsSync(path.join(ARCHIVE, 'users'))) fs.renameSync(path.join(ARCHIVE, 'users'), path.join(aside, 'users'));
  for (const d of MOVED_DIRS) {
    if (fs.existsSync(path.join(ARCHIVE, d))) fs.renameSync(path.join(ARCHIVE, d), path.join(aside, d));
    if (fs.existsSync(path.join(backup, d))) fs.cpSync(path.join(backup, d), path.join(ARCHIVE, d), { recursive: true });
  }
  for (const f of ['users.json', 'sessions.json', 'devices.json']) {
    const p = path.join(CONFIG_DIR, f);
    if (fs.existsSync(p)) fs.renameSync(p, path.join(aside, 'config', f));
  }
  if (fs.existsSync(path.join(backup, 'config', 'config.json'))) {
    if (fs.existsSync(CONFIG_PATH)) fs.copyFileSync(CONFIG_PATH, path.join(aside, 'config', 'config.json'));
    fs.copyFileSync(path.join(backup, 'config', 'config.json'), CONFIG_PATH);
  }
  if (fs.existsSync(path.join(backup, 'config', 'places-cache.json'))) fs.copyFileSync(path.join(backup, 'config', 'places-cache.json'), PLACES_CACHE);
  log('Rolled back. Now deploy the previous app version (1.3.0); this version stays paused until the migration runs again.');
  fs.writeFileSync(path.join(aside, 'rollback.log'), logLines.join('\n') + '\n');
  process.exit(0);
}

// ── Plan ───────────────────────────────────────────────────────────────────
const usersFile = readJson(users.USERS_PATH, null);
const config = readJson(CONFIG_PATH, {});
const existingAdmin = (usersFile?.users || []).find(u => u.role === 'admin');
const legacy = Object.fromEntries(MOVED_DIRS.map(d => [d, walk(path.join(ARCHIVE, d))]));
const hasLegacyData = MOVED_DIRS.some(d => legacy[d].length) || REMOVED_CONFIG_KEYS.some(k => config[k] !== undefined) || fs.existsSync(PLACES_CACHE);

if (usersFile?.migratedAt && !hasLegacyData) {
  log(`Already migrated (${usersFile.migratedAt}, backup ${usersFile.migrationId}). Nothing to do.`);
  process.exit(0);
}

const adminUsername = users.normUsername(opt('admin-username') || existingAdmin?.username || '');
const displayName = opt('display-name') || existingAdmin?.displayName || adminUsername;
if (!adminUsername && !DRY) {
  console.error('Choose your username: --admin-username <name> (letters, numbers, . _ -)');
  process.exit(2);
}
if (!existingAdmin && !config.passwordHash && !DRY) {
  console.error('config.json has no password to carry over (fresh install?). Sign in once with the previous version to set a password, then run this again.');
  process.exit(2);
}
const adminId = existingAdmin?.id || `u_${crypto.randomBytes(6).toString('hex')}`;
const dest = path.join(ARCHIVE, 'users', adminId);

log(`Pocket Archive → accounts migration ${DRY ? '(DRY RUN — nothing will change)' : ''}`);
log(`Archive: ${ARCHIVE}`);
log(`Config:  ${CONFIG_DIR}`);
log('');
log(`Admin account: ${adminUsername || '<choose with --admin-username>'}${displayName && displayName !== adminUsername ? ` ("${displayName}")` : ''}  id ${adminId}${existingAdmin ? ' (existing)' : ' (new)'}`);
log(`  password: ${config.passwordHash ? 'your current password carries over' : existingAdmin ? 'unchanged' : 'NONE FOUND'}`);
log('');
log('Moves (into ARCHIVE/users/<adminId>/):');
let conflicts = 0;
for (const d of MOVED_DIRS) {
  const s = summary(legacy[d]);
  const target = path.join(dest, d);
  let conflictFiles = [];
  if (fs.existsSync(target)) {
    for (const f of legacy[d]) {
      const t = path.join(target, f.rel);
      if (fs.existsSync(t) && sha(t) !== sha(f.abs)) conflictFiles.push(f.rel);
    }
  }
  conflicts += conflictFiles.length;
  log(`  ${d.padEnd(16)} ${String(s.count).padStart(6)} files  ${human(s.bytes).padStart(9)}${fs.existsSync(target) ? `  (target exists${conflictFiles.length ? `, ${conflictFiles.length} CONFLICTS — kept as *.conflict` : ', will merge'})` : ''}`);
  for (const c of conflictFiles.slice(0, 10)) log(`      conflict: ${c}`);
}
log('');
log('Settings (config.json → users/<adminId>/settings.json):');
for (const k of SETTINGS_KEYS) {
  const v = config[k];
  const detail = k === 'places' && v ? `home ${v.home ? 'set' : 'not set'}, ${(v.saved || []).length} saved places` : v ? 'yes' : 'none';
  log(`  ${k.padEnd(16)} ${detail}`);
}
log(`  device tokens    ${(config.deviceTokens || []).length} (phone/watch keep working, now signed in as ${adminUsername || 'the admin'})`);
log(`  places cache     ${fs.existsSync(PLACES_CACHE) ? 'yes' : 'none'}`);
log('');
const backupBytes = MOVED_DIRS.reduce((a, d) => a + summary(legacy[d]).bytes, 0);
log(`Backup first: ARCHIVE/_backups/<timestamp>/ (${human(backupBytes)} + config)`);
log('Not touched: 01_Original_Notes, 02_Transcripts, 03_Recordings, 04_AI_Notes, 05_Attachments, 99_Deleted, 09_Maps, pocket_sync.py');
log(`Conflicts: ${conflicts}`);

if (DRY) {
  log('');
  log('Dry run finished. Nothing was changed.');
  process.exit(0);
}

// ── Real run ───────────────────────────────────────────────────────────────
const ts = stamp();
const backup = path.join(ARCHIVE, '_backups', ts);
log('');
log(`Backing up to ${backup} …`);
fs.mkdirSync(path.join(backup, 'config'), { recursive: true });
const manifest = { createdAt: new Date().toISOString(), adminId, adminUsername, dirs: {} };
for (const d of MOVED_DIRS) {
  if (!legacy[d].length) continue;
  fs.cpSync(path.join(ARCHIVE, d), path.join(backup, d), { recursive: true, preserveTimestamps: true });
  const copied = walk(path.join(backup, d));
  if (copied.length !== legacy[d].length) { log(`Backup of ${d} incomplete (${copied.length}/${legacy[d].length}). Stopping; nothing moved.`); process.exit(1); }
  manifest.dirs[d] = {};
  for (const f of legacy[d]) manifest.dirs[d][f.rel] = sha(f.abs);
  log(`  ${d}: ${copied.length} files backed up and hashed`);
}
if (fs.existsSync(CONFIG_PATH)) fs.copyFileSync(CONFIG_PATH, path.join(backup, 'config', 'config.json'));
if (fs.existsSync(PLACES_CACHE)) fs.copyFileSync(PLACES_CACHE, path.join(backup, 'config', 'places-cache.json'));
fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Admin account (users.json without migratedAt: the server stays paused until the end)
let file = readJson(users.USERS_PATH, null) || { version: 1, users: [] };
if (!existingAdmin) {
  const admin = users.newUser({ username: adminUsername, displayName, role: 'admin', plan: 'full', passwordHash: config.passwordHash, mustChangePassword: !!config.mustChangePassword });
  admin.id = adminId;
  file.users.push(admin);
  users.writeUsersFile(file);
  log(`Created admin account "${adminUsername}"`);
}

// Moves
fs.mkdirSync(dest, { recursive: true });
for (const d of MOVED_DIRS) {
  const src = path.join(ARCHIVE, d);
  const target = path.join(dest, d);
  if (!fs.existsSync(src)) continue;
  if (!fs.existsSync(target)) {
    fs.renameSync(src, target);
  } else {
    for (const f of walk(src)) {
      const t = path.join(target, f.rel);
      fs.mkdirSync(path.dirname(t), { recursive: true });
      if (fs.existsSync(t)) {
        if (sha(t) === sha(f.abs)) { fs.rmSync(f.abs); continue; }
        fs.renameSync(f.abs, `${t}.conflict-${ts}`);
        log(`  conflict kept: ${d}/${f.rel}.conflict-${ts}`);
      } else {
        fs.renameSync(f.abs, t);
      }
    }
    fs.rmSync(src, { recursive: true, force: true });
  }
  log(`  moved ${d} → users/${adminId}/${d}`);
}

// Settings
const settingsFile = path.join(dest, 'settings.json');
const settings = readJson(settingsFile, {});
for (const k of SETTINGS_KEYS) if (config[k] !== undefined && settings[k] === undefined) settings[k] = config[k];
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
log(`  settings → users/${adminId}/settings.json`);
if (fs.existsSync(PLACES_CACHE)) { fs.renameSync(PLACES_CACHE, path.join(dest, 'places-cache.json')); log('  places cache moved'); }

// Device tokens → devices.json (same hashes: the phone and watch stay signed in)
const devices = readJson(users.DEVICES_PATH, []);
let added = 0;
for (const t of config.deviceTokens || []) {
  if (devices.some(d => d.hash === t.hash)) continue;
  devices.push({ ...t, userId: adminId });
  added++;
}
fs.writeFileSync(users.DEVICES_PATH, JSON.stringify(devices, null, 2), { mode: 0o600 });
log(`  ${added} device token(s) → the admin`);

// Verify every moved file
let bad = 0;
for (const [d, files] of Object.entries(manifest.dirs)) {
  for (const [rel, hash] of Object.entries(files)) {
    const t = path.join(dest, d, rel);
    const ok = fs.existsSync(t) ? sha(t) === hash : fs.existsSync(`${t}.conflict-${ts}`) && sha(`${t}.conflict-${ts}`) === hash;
    if (!ok) { bad++; if (bad <= 20) log(`  VERIFY FAILED: ${d}/${rel}`); }
  }
}
if (bad) {
  log(`Verification failed for ${bad} file(s). The server stays paused. Roll back with: node scripts/migrate-users.mjs --rollback ${ts}`);
  fs.writeFileSync(path.join(backup, 'migration.log'), logLines.join('\n') + '\n');
  process.exit(1);
}
log(`  verified ${Object.values(manifest.dirs).reduce((a, f) => a + Object.keys(f).length, 0)} files (SHA-256)`);

// Clean config.json (the backup keeps the old copy) and switch on multi-user mode
const cleaned = { ...config };
for (const k of REMOVED_CONFIG_KEYS) delete cleaned[k];
fs.writeFileSync(CONFIG_PATH, JSON.stringify(cleaned, null, 2));
file = readJson(users.USERS_PATH, file);
file.migratedAt = new Date().toISOString();
file.migrationId = ts;
users.writeUsersFile(file);
users.logEvent('migration', { userId: adminId, backup: ts });

log('');
log(`Done. Multi-user mode is on. Sign in as "${adminUsername}" with your current password.`);
log(`Backup + log: ARCHIVE/_backups/${ts}/  ·  Undo: node scripts/migrate-users.mjs --rollback ${ts}`);
fs.writeFileSync(path.join(backup, 'migration.log'), logLines.join('\n') + '\n');
