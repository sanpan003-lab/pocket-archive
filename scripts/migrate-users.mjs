#!/usr/bin/env node
// One-time migration to multi-user accounts. Run it inside the container:
//
//   node scripts/migrate-users.mjs --dry-run --admin-username <name> [--display-name "<Name>"]
//   node scripts/migrate-users.mjs --admin-username <name> [--display-name "<Name>"]
//   node scripts/migrate-users.mjs --rollback <timestamp>
//
// Dry run: prints exactly what would move (counts, sizes, conflicts) — or, after an interrupted
// run, what is already done and what remains — and changes nothing.
// Real run:
//   1. backup  → ARCHIVE/_backups/<timestamp>/ (07_Quick_Notes, 08_Projects, config.json, places-cache.json)
//   2. creates the admin account (your current password and device tokens carry over)
//   3. moves 07_Quick_Notes + 08_Projects → ARCHIVE/users/<adminId>/, settings (home, places,
//      appearance, smart-append, errands) → users/<adminId>/settings.json, the places cache
//   4. verifies every moved file by SHA-256, then switches the server to multi-user mode
//   5. writes ARCHIVE/_backups/<timestamp>/migration.log
// Resumable + idempotent: every step checks whether it's already done. An interrupted run is finished
// with the same admin account and the same backup (never a second admin). A completed run reports
// "already migrated".
// Moves work across Docker volumes (/data/config and /data/archive are different filesystems):
// rename where possible; otherwise copy → fsync → verify size + SHA-256 → delete the source.
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
const BACKUPS = path.join(ARCHIVE, '_backups');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const human = n => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} KB` : `${n} B`);
const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };

const logLines = [];
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

// ── Safe moves (work across filesystems) ───────────────────────────────────
let crossDeviceMoves = 0;

function fsyncPath(p, dir = false) {
  let fd;
  try { fd = fs.openSync(p, dir ? 'r' : 'r+'); fs.fsyncSync(fd); } catch { if (!dir) throw new Error(`fsync failed for ${p}`); } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** Copy one file next to its destination (.part), fsync, verify size + SHA-256, then put it in place. */
function copyVerified(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const part = `${dst}.part`;
  fs.copyFileSync(src, part);
  fsyncPath(part);
  const a = fs.statSync(src), b = fs.statSync(part);
  if (a.size !== b.size || sha(src) !== sha(part)) {
    fs.rmSync(part, { force: true });
    throw new Error(`Copy verification failed: ${src} → ${dst}`);
  }
  fs.utimesSync(part, a.atime, a.mtime);
  fs.renameSync(part, dst);                 // same directory: never crosses a filesystem
  fsyncPath(path.dirname(dst), true);      // best effort (directory fsync isn't supported everywhere)
}

/** Move a file: rename; across filesystems (EXDEV) copy → fsync → verify → delete the source. */
function moveFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    fs.renameSync(src, dst);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    copyVerified(src, dst);
    fs.rmSync(src);
    crossDeviceMoves++;
  }
}

function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) removeEmptyDirs(path.join(dir, e.name));
  if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
}

/**
 * Move a folder's contents into dst. Whole-folder rename when dst doesn't exist and it's the same
 * filesystem; otherwise file by file (identical files already there are dropped from the source,
 * different ones are kept beside them as "<name>.conflict-<tag>"). Returns the conflicts.
 */
function moveTree(srcDir, dstDir, conflictTag) {
  const conflicts = [];
  if (!fs.existsSync(srcDir)) return conflicts;
  if (!fs.existsSync(dstDir)) {
    fs.mkdirSync(path.dirname(dstDir), { recursive: true });
    try { fs.renameSync(srcDir, dstDir); return conflicts; } catch (err) { if (err.code !== 'EXDEV') throw err; }
  }
  for (const f of walk(srcDir)) {
    const t = path.join(dstDir, f.rel);
    if (fs.existsSync(t)) {
      if (sha(t) === sha(f.abs)) { fs.rmSync(f.abs); continue; }
      moveFile(f.abs, `${t}.conflict-${conflictTag}`);
      conflicts.push(f.rel);
    } else {
      moveFile(f.abs, t);
    }
  }
  removeEmptyDirs(srcDir);
  return conflicts;
}

// ── Rollback ───────────────────────────────────────────────────────────────
if (ROLLBACK) {
  const backup = path.join(BACKUPS, ROLLBACK);
  if (!fs.existsSync(path.join(backup, 'manifest.json'))) {
    console.error(`No backup at ${backup}`);
    process.exit(1);
  }
  const aside = path.join(backup, `rolled-back-${stamp()}`);
  const present = [
    fs.existsSync(path.join(ARCHIVE, 'users')) && 'ARCHIVE/users',
    ...MOVED_DIRS.filter(d => fs.existsSync(path.join(ARCHIVE, d))).map(d => `ARCHIVE/${d}`),
    ...['users.json', 'sessions.json', 'devices.json'].filter(f => fs.existsSync(path.join(CONFIG_DIR, f))).map(f => `config/${f}`),
  ].filter(Boolean);
  log(`Rolling back to ${ROLLBACK}.`);
  log(`  keep aside (in ${path.relative(ARCHIVE, aside)}): ${present.join(', ') || 'nothing'}`);
  log(`  restore from the backup: ${MOVED_DIRS.filter(d => fs.existsSync(path.join(backup, d))).join(', ') || '(no folders)'}, config.json${fs.existsSync(path.join(backup, 'config', 'places-cache.json')) ? ', places-cache.json' : ''}`);
  if (DRY) {
    log('(dry run — nothing changed)');
    process.exit(0);
  }
  fs.mkdirSync(path.join(aside, 'config'), { recursive: true });
  moveTree(path.join(ARCHIVE, 'users'), path.join(aside, 'users'), 'rollback');
  for (const d of MOVED_DIRS) {
    moveTree(path.join(ARCHIVE, d), path.join(aside, d), 'rollback');
    if (fs.existsSync(path.join(backup, d))) fs.cpSync(path.join(backup, d), path.join(ARCHIVE, d), { recursive: true, preserveTimestamps: true });
  }
  for (const f of ['users.json', 'sessions.json', 'devices.json']) {
    const p = path.join(CONFIG_DIR, f);
    if (fs.existsSync(p)) moveFile(p, path.join(aside, 'config', f)); // config volume → archive volume
  }
  if (fs.existsSync(path.join(backup, 'config', 'config.json'))) {
    if (fs.existsSync(CONFIG_PATH)) copyVerified(CONFIG_PATH, path.join(aside, 'config', 'config.json'));
    copyVerified(path.join(backup, 'config', 'config.json'), CONFIG_PATH);
  }
  if (fs.existsSync(path.join(backup, 'config', 'places-cache.json'))) copyVerified(path.join(backup, 'config', 'places-cache.json'), PLACES_CACHE);
  log('Rolled back. Now deploy the previous app version (1.3.0); this version stays paused until the migration runs again.');
  fs.writeFileSync(path.join(aside, 'rollback.log'), logLines.join('\n') + '\n');
  process.exit(0);
}

// ── State: what's done, what remains ───────────────────────────────────────
const usersFile = readJson(users.USERS_PATH, null);
const config = readJson(CONFIG_PATH, {});
const existingAdmin = (usersFile?.users || []).find(u => u.role === 'admin') || null;
const legacy = Object.fromEntries(MOVED_DIRS.map(d => [d, walk(path.join(ARCHIVE, d))]));

if (usersFile?.migratedAt) {
  const leftovers = MOVED_DIRS.some(d => legacy[d].length) || REMOVED_CONFIG_KEYS.some(k => config[k] !== undefined) || fs.existsSync(PLACES_CACHE);
  log(`Already migrated (${usersFile.migratedAt}, backup ${usersFile.migrationId}). Nothing to do.`);
  if (leftovers) log('Note: some old files are still in place (new data written by an older version?). Nothing was changed; check before deleting anything.');
  process.exit(0);
}

/** The backup an interrupted run made for this admin (newest first), or the one named with --resume-backup */
function findResumeBackup(adminId) {
  const named = opt('resume-backup');
  if (named) return fs.existsSync(path.join(BACKUPS, named, 'manifest.json')) ? named : null;
  if (!fs.existsSync(BACKUPS)) return null;
  return fs.readdirSync(BACKUPS).filter(n => readJson(path.join(BACKUPS, n, 'manifest.json'), null)?.adminId === adminId).sort().pop() || null;
}

const resuming = !!existingAdmin;
const resumeTs = resuming ? findResumeBackup(existingAdmin.id) : null;
const requestedUsername = users.normUsername(opt('admin-username') || '');
const adminUsername = existingAdmin?.username || requestedUsername;
const displayName = existingAdmin?.displayName || opt('display-name') || adminUsername;
const adminId = existingAdmin?.id || `u_${crypto.randomBytes(6).toString('hex')}`;
const dest = path.join(ARCHIVE, 'users', adminId);
const settingsFile = path.join(dest, 'settings.json');
const settingsNow = readJson(settingsFile, {});
const devicesNow = readJson(users.DEVICES_PATH, []);
const missingTokens = (config.deviceTokens || []).filter(t => !devicesNow.some(d => d.hash === t.hash));
const settingsTodo = SETTINGS_KEYS.filter(k => config[k] !== undefined && settingsNow[k] === undefined);
const configTodo = REMOVED_CONFIG_KEYS.filter(k => config[k] !== undefined);
const cacheTodo = fs.existsSync(PLACES_CACHE);
const backupManifest = resumeTs ? readJson(path.join(BACKUPS, resumeTs, 'manifest.json'), null) : null;
const manifestCount = m => Object.values(m?.dirs || {}).reduce((a, f) => a + Object.keys(f).length, 0);

if (!adminUsername && !DRY) {
  console.error('Choose your username: --admin-username <name> (letters, numbers, . _ -)');
  process.exit(2);
}
if (!existingAdmin && !config.passwordHash && !DRY) {
  console.error('config.json has no password to carry over (fresh install?). Sign in once with the previous version to set a password, then run this again.');
  process.exit(2);
}

log(`Pocket Archive → accounts migration ${DRY ? '(DRY RUN — nothing will change)' : ''}`);
log(`Archive: ${ARCHIVE}`);
log(`Config:  ${CONFIG_DIR}`);
log('');

if (resuming) {
  log('Resuming an interrupted migration.');
  if (requestedUsername && requestedUsername !== existingAdmin.username) log(`  (--admin-username ${requestedUsername} ignored: the admin account "${existingAdmin.username}" already exists and is reused)`);
  log('Already done:');
  log(`  ✓ admin account "${existingAdmin.username}" (${existingAdmin.id}) — reused, no second admin is created`);
  log(resumeTs ? `  ✓ backup ${resumeTs} (${manifestCount(backupManifest)} files hashed) — reused` : '  ✗ no backup found for this admin — a new backup of what is left will be made first');
  for (const d of MOVED_DIRS) {
    if (!legacy[d].length && fs.existsSync(path.join(dest, d))) log(`  ✓ ${d} moved (${walk(path.join(dest, d)).length} files in users/${adminId}/${d})`);
  }
  if (!settingsTodo.length && fs.existsSync(settingsFile)) log(`  ✓ settings → users/${adminId}/settings.json`);
  if (!cacheTodo && fs.existsSync(path.join(dest, 'places-cache.json'))) log('  ✓ places cache moved');
  if (!missingTokens.length && (config.deviceTokens || []).length) log('  ✓ device tokens');
  log('Remaining:');
} else {
  log(`Admin account: ${adminUsername || '<choose with --admin-username>'}${displayName && displayName !== adminUsername ? ` ("${displayName}")` : ''}  id ${adminId} (new)`);
  log(`  password: ${config.passwordHash ? 'your current password carries over' : 'NONE FOUND'}`);
  log('');
  log('Steps:');
  log(`  • backup → ARCHIVE/_backups/<timestamp>/ (${human(MOVED_DIRS.reduce((a, d) => a + summary(legacy[d]).bytes, 0))} + config)`);
  log(`  • create admin account "${adminUsername || '?'}"`);
}
let conflicts = 0;
for (const d of MOVED_DIRS) {
  if (!legacy[d].length) continue;
  const s = summary(legacy[d]);
  const target = path.join(dest, d);
  const conflictFiles = fs.existsSync(target) ? legacy[d].filter(f => { const t = path.join(target, f.rel); return fs.existsSync(t) && sha(t) !== sha(f.abs); }).map(f => f.rel) : [];
  conflicts += conflictFiles.length;
  log(`  • move ${d.padEnd(16)} ${String(s.count).padStart(6)} files  ${human(s.bytes).padStart(9)} → users/${adminId}/${d}${fs.existsSync(target) ? ` (merge${conflictFiles.length ? `, ${conflictFiles.length} CONFLICTS kept as *.conflict` : ''})` : ''}`);
  for (const c of conflictFiles.slice(0, 10)) log(`      conflict: ${c}`);
}
for (const k of settingsTodo) {
  const v = config[k];
  log(`  • settings: ${k}${k === 'places' && v ? ` (home ${v.home ? 'set' : 'not set'}, ${(v.saved || []).length} saved places)` : ''} → users/${adminId}/settings.json`);
}
if (cacheTodo) log(`  • places cache → users/${adminId}/places-cache.json (config volume → archive volume: copy, verify, then delete)`);
if (missingTokens.length) log(`  • ${missingTokens.length} device token(s) → the admin (phone/watch keep working)`);
log(`  • verify ${resumeTs ? manifestCount(backupManifest) : MOVED_DIRS.reduce((a, d) => a + legacy[d].length, 0)} files by SHA-256${resumeTs ? ` against backup ${resumeTs}` : ''}`);
if (configTodo.length) log(`  • clean config.json (${configTodo.join(', ')}; the backup keeps the old copy)`);
log('  • switch on multi-user mode');
log('');
log('Not touched: 01_Original_Notes, 02_Transcripts, 03_Recordings, 04_AI_Notes, 05_Attachments, 99_Deleted, 09_Maps, pocket_sync.py');
log(`Conflicts: ${conflicts}`);

if (DRY) {
  log('');
  log('Dry run finished. Nothing was changed.');
  process.exit(0);
}

// ── Real run ───────────────────────────────────────────────────────────────
const ts = resumeTs || stamp();
const backup = path.join(BACKUPS, ts);
let manifest = backupManifest;
log('');
if (!manifest) {
  log(`Backing up to ${backup} …`);
  fs.mkdirSync(path.join(backup, 'config'), { recursive: true });
  manifest = { createdAt: new Date().toISOString(), adminId, adminUsername, dirs: {} };
  for (const d of MOVED_DIRS) {
    if (!legacy[d].length) continue;
    fs.cpSync(path.join(ARCHIVE, d), path.join(backup, d), { recursive: true, preserveTimestamps: true });
    const copied = walk(path.join(backup, d));
    if (copied.length !== legacy[d].length) { log(`Backup of ${d} incomplete (${copied.length}/${legacy[d].length}). Stopping; nothing moved.`); process.exit(1); }
    manifest.dirs[d] = {};
    for (const f of legacy[d]) manifest.dirs[d][f.rel] = sha(f.abs);
    log(`  ${d}: ${copied.length} files backed up and hashed`);
  }
  if (fs.existsSync(CONFIG_PATH)) copyVerified(CONFIG_PATH, path.join(backup, 'config', 'config.json'));
  if (fs.existsSync(PLACES_CACHE)) copyVerified(PLACES_CACHE, path.join(backup, 'config', 'places-cache.json'));
  fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2));
} else {
  log(`Resuming with backup ${ts}`);
}

// Admin account (users.json without migratedAt: the server stays paused until the end)
let file = readJson(users.USERS_PATH, null) || { version: 1, users: [] };
if (!existingAdmin) {
  const admin = users.newUser({ username: adminUsername, displayName, role: 'admin', plan: 'full', passwordHash: config.passwordHash, mustChangePassword: !!config.mustChangePassword });
  admin.id = adminId;
  file.users.push(admin);
  users.writeUsersFile(file);
  log(`Created admin account "${adminUsername}" (${adminId})`);
} else {
  log(`Using the existing admin account "${existingAdmin.username}" (${existingAdmin.id})`);
}

// Moves (resumable: whatever is still at the old place goes over; identical files are not duplicated)
fs.mkdirSync(dest, { recursive: true });
for (const d of MOVED_DIRS) {
  if (!fs.existsSync(path.join(ARCHIVE, d))) continue;
  const c = moveTree(path.join(ARCHIVE, d), path.join(dest, d), ts);
  for (const x of c) log(`  conflict kept: ${d}/${x}.conflict-${ts}`);
  log(`  moved ${d} → users/${adminId}/${d}`);
}

// Settings (only keys not there yet)
const settings = readJson(settingsFile, {});
let settingsChanged = false;
for (const k of SETTINGS_KEYS) if (config[k] !== undefined && settings[k] === undefined) { settings[k] = config[k]; settingsChanged = true; }
if (settingsChanged || !fs.existsSync(settingsFile)) {
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  log(`  settings → users/${adminId}/settings.json`);
}

// Places cache: config volume → archive volume
if (fs.existsSync(PLACES_CACHE)) {
  const target = path.join(dest, 'places-cache.json');
  if (fs.existsSync(target) && sha(target) !== sha(PLACES_CACHE)) {
    moveFile(PLACES_CACHE, `${target}.conflict-${ts}`);
    log('  places cache: a different one is already there — kept both (.conflict)');
  } else if (fs.existsSync(target)) {
    fs.rmSync(PLACES_CACHE);
    log('  places cache already there (identical) — old copy removed');
  } else {
    moveFile(PLACES_CACHE, target);
    log('  places cache moved');
  }
}

// Device tokens → devices.json (same hashes: the phone and watch stay signed in)
const devices = readJson(users.DEVICES_PATH, []);
let added = 0;
for (const t of config.deviceTokens || []) {
  if (devices.some(d => d.hash === t.hash)) continue;
  devices.push({ ...t, userId: existingAdmin?.id || adminId });
  added++;
}
if (added || !fs.existsSync(users.DEVICES_PATH)) fs.writeFileSync(users.DEVICES_PATH, JSON.stringify(devices, null, 2), { mode: 0o600 });
log(`  ${added} device token(s) → the admin${added ? '' : ' (already there)'}`);

// Verify every file from the backup manifest
let bad = 0;
for (const [d, files] of Object.entries(manifest.dirs || {})) {
  for (const [rel, hash] of Object.entries(files)) {
    const t = path.join(dest, d, rel);
    const candidates = [t, ...(fs.existsSync(path.dirname(t)) ? fs.readdirSync(path.dirname(t)).filter(n => n.startsWith(`${path.basename(t)}.conflict-`)).map(n => path.join(path.dirname(t), n)) : [])];
    if (!candidates.some(c => fs.existsSync(c) && sha(c) === hash)) { bad++; if (bad <= 20) log(`  VERIFY FAILED: ${d}/${rel}`); }
  }
}
if (bad) {
  log(`Verification failed for ${bad} file(s). The server stays paused. Roll back with: node scripts/migrate-users.mjs --rollback ${ts}`);
  fs.appendFileSync(path.join(backup, 'migration.log'), logLines.join('\n') + '\n');
  process.exit(1);
}
log(`  verified ${manifestCount(manifest)} files (SHA-256)${crossDeviceMoves ? `; ${crossDeviceMoves} file(s) copied across volumes and verified` : ''}`);

// Clean config.json (the backup keeps the old copy) and switch on multi-user mode
const cleaned = { ...readJson(CONFIG_PATH, {}) };
for (const k of REMOVED_CONFIG_KEYS) delete cleaned[k];
fs.writeFileSync(CONFIG_PATH, JSON.stringify(cleaned, null, 2));
file = readJson(users.USERS_PATH, file);
file.migratedAt = new Date().toISOString();
file.migrationId = ts;
users.writeUsersFile(file);
users.logEvent('migration', { userId: existingAdmin?.id || adminId, backup: ts, resumed: resuming });

log('');
log(`Done. Multi-user mode is on. Sign in as "${adminUsername}" with your current password.`);
log(`Backup + log: ARCHIVE/_backups/${ts}/  ·  Undo: node scripts/migrate-users.mjs --rollback ${ts}`);
fs.appendFileSync(path.join(backup, 'migration.log'), `${resuming ? `\n--- resumed ${new Date().toISOString()} ---\n` : ''}${logLines.join('\n')}\n`);
