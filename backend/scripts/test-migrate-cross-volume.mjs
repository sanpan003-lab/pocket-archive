#!/usr/bin/env node
// Migration test with the config folder and the archive on DIFFERENT filesystems (like the two Docker
// volumes /data/config and /data/archive on the NAS). Fake data only.
//
//   node scripts/test-migrate-cross-volume.mjs [<configVolumeDir> <archiveVolumeDir>]
//
// Given two directories on different devices (e.g. two tmpfs mounts), they are used as they are.
// Otherwise two folders under the OS temp dir are used and scripts/exdev-shim.mjs makes renames between
// them fail with EXDEV exactly like the kernel does across mount points.
//
// Covers: a fresh migration across volumes; the interrupted state seen on the NAS (stopped at the
// places-cache move) → dry-run resume plan → resumed run (same admin, same backup); rollback from that
// partial state; rollback after a completed migration.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'migrate-users.mjs');
const shim = pathToFileURL(path.join(here, 'exdev-shim.mjs')).href;
let fails = 0;
const check = (label, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  -- ${extra}` : ''}`); };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

const [cfgArg, arcArg] = process.argv.slice(2);
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-xvol-'));
const realDevices = cfgArg && arcArg && fs.statSync(cfgArg).dev !== fs.statSync(arcArg).dev;
console.log(realDevices ? `Using two real filesystems: ${cfgArg} | ${arcArg}` : 'One filesystem here: EXDEV is simulated between the two volume folders');

let n = 0;
function volumes() {
  n++;
  const cfg = realDevices ? fs.mkdtempSync(path.join(cfgArg, `xv${n}-`)) : path.join(base, `case${n}`, 'config-volume');
  const arc = realDevices ? fs.mkdtempSync(path.join(arcArg, `xv${n}-`)) : path.join(base, `case${n}`, 'archive-volume');
  fs.mkdirSync(cfg, { recursive: true });
  fs.mkdirSync(arc, { recursive: true });
  return { cfg, arc };
}

// Fake legacy data: notes (+ audio), a project, Hey Pocket files, config with password/tokens/places, places cache
function seed({ cfg, arc }) {
  const notes = path.join(arc, '07_Quick_Notes');
  fs.mkdirSync(path.join(notes, 'audio'), { recursive: true });
  for (let i = 0; i < 25; i++) fs.writeFileSync(path.join(notes, `qn_17${String(i).padStart(11, '0')}_x${i}.json`), JSON.stringify({ id: `qn_${i}`, title: `Fake ${i}` }));
  fs.writeFileSync(path.join(notes, 'audio', 'qn_1700000000000_x0.m4a'), crypto.randomBytes(200_000));
  fs.mkdirSync(path.join(arc, '08_Projects'), { recursive: true });
  fs.writeFileSync(path.join(arc, '08_Projects', 'pj_1_a.json'), JSON.stringify({ id: 'pj_1_a', name: 'Fake project' }));
  fs.mkdirSync(path.join(arc, '03_Recordings'), { recursive: true });
  fs.writeFileSync(path.join(arc, '03_Recordings', 'rec.mp3'), 'not touched');
  fs.writeFileSync(path.join(cfg, 'config.json'), JSON.stringify({
    passwordHash: '$2a$04$abcdefghijklmnopqrstuuFakeHashForTestsOnly000000000000', mustChangePassword: false,
    deviceTokens: [{ id: 'd1', name: 'Phone', hash: 'a'.repeat(64), createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', lastUsedAt: null }],
    places: { home: { address: 'Test home', lat: 1, lng: 2 }, saved: [] }, appearance: { theme: { accent: 'purple' } },
  }));
  fs.writeFileSync(path.join(cfg, 'places-cache.json'), JSON.stringify({ q: { at: 1, v: [] } }));
  const hashes = {};
  for (const d of ['07_Quick_Notes', '08_Projects']) for (const f of walk(path.join(arc, d))) hashes[`${d}/${f}`] = sha(path.join(arc, d, f));
  return hashes;
}
function walk(dir, b = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name), b) : [path.relative(b, path.join(dir, e.name)).split(path.sep).join('/')]));
}
function run(v, args, extraEnv = {}) {
  const env = { ...process.env, ARCHIVE_PATH: v.arc, CONFIG_PATH: path.join(v.cfg, 'config.json'), ...extraEnv };
  if (!realDevices) Object.assign(env, { EXDEV_ROOTS: [v.cfg, v.arc].join(path.delimiter) });
  try {
    return { code: 0, out: execFileSync(process.execPath, [...(realDevices && !extraEnv.EXDEV_FAIL_NAME ? [] : ['--import', shim]), script, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}
const usersOf = v => (fs.existsSync(path.join(v.cfg, 'users.json')) ? readJson(path.join(v.cfg, 'users.json')) : null);
function migratedOk(v, hashes, label) {
  const u = usersOf(v);
  const admins = (u?.users || []).filter(x => x.role === 'admin');
  check(`${label}: exactly one admin, multi-user mode on`, admins.length === 1 && !!u.migratedAt, `${admins.length} admin(s), migratedAt ${u?.migratedAt}`);
  const dest = path.join(v.arc, 'users', admins[0]?.id || 'none');
  const missing = Object.entries(hashes).filter(([rel, h]) => !fs.existsSync(path.join(dest, rel)) || sha(path.join(dest, rel)) !== h);
  check(`${label}: every note/project file moved byte-for-byte`, missing.length === 0, `${missing.length} missing/different`);
  check(`${label}: places cache moved to the archive volume, gone from the config volume`, fs.existsSync(path.join(dest, 'places-cache.json')) && !fs.existsSync(path.join(v.cfg, 'places-cache.json')));
  check(`${label}: no leftover .part files`, !walk(v.arc).some(f => f.endsWith('.part')));
  const devices = fs.existsSync(path.join(v.cfg, 'devices.json')) ? readJson(path.join(v.cfg, 'devices.json')) : [];
  check(`${label}: device token belongs to the admin`, devices.length === 1 && devices[0].userId === admins[0]?.id);
  const cfg = readJson(path.join(v.cfg, 'config.json'));
  check(`${label}: config.json cleaned`, !cfg.passwordHash && !cfg.deviceTokens && !cfg.places);
  check(`${label}: settings in the user folder`, readJson(path.join(dest, 'settings.json')).appearance?.theme?.accent === 'purple');
  check(`${label}: Hey Pocket files untouched`, fs.readFileSync(path.join(v.arc, '03_Recordings', 'rec.mp3'), 'utf8') === 'not touched');
  return admins[0];
}

// ── 1. Fresh migration across the two volumes ──
{
  const v = volumes();
  const hashes = seed(v);
  const r = run(v, ['--admin-username', 'tester']);
  check('fresh: migration completes across volumes (no EXDEV crash)', r.code === 0 && /Done\. Multi-user mode is on/.test(r.out), r.out.split('\n').slice(-4).join(' | '));
  check('fresh: cross-volume copies were verified', /copied across volumes and verified/.test(r.out) || realDevices);
  migratedOk(v, hashes, 'fresh');
  const again = run(v, ['--admin-username', 'tester']);
  check('fresh: second run = already migrated', again.code === 0 && /Already migrated/.test(again.out));
}

// ── 2. The NAS failure: interrupted at the places-cache move → dry run → resume ──
let partialVolumes;
function makePartial() {
  const v = volumes();
  const hashes = seed(v);
  const r = run(v, ['--admin-username', 'tester'], { EXDEV_FAIL_NAME: 'places-cache.json' });
  return { v, hashes, r };
}
{
  const { v, hashes, r } = makePartial();
  partialVolumes = v;
  const u = usersOf(v);
  const admin = u?.users?.find(x => x.role === 'admin');
  const backupTs = fs.readdirSync(path.join(v.arc, '_backups'))[0];
  check('partial state reproduced (stopped at the places cache; folders + settings moved; mode still off)',
    r.code !== 0 && !!admin && !u.migratedAt && !fs.existsSync(path.join(v.arc, '07_Quick_Notes')) && fs.existsSync(path.join(v.cfg, 'places-cache.json')) && !fs.existsSync(path.join(v.cfg, 'devices.json')),
    r.out.split('\n').filter(l => /Error|EIO/.test(l)).slice(0, 1).join(''));

  const dry = run(v, ['--dry-run', '--admin-username', 'someone-else']);
  check('dry run: says it is resuming', /Resuming an interrupted migration/.test(dry.out));
  check('dry run: lists already-done steps (admin reused, backup reused, folders + settings moved)',
    dry.out.includes(`admin account "tester" (${admin.id}) — reused`) && dry.out.includes(`backup ${backupTs}`) && /✓ 07_Quick_Notes moved/.test(dry.out) && /✓ 08_Projects moved/.test(dry.out) && /✓ settings/.test(dry.out));
  check('dry run: lists the remaining steps (places cache, device tokens, verify, clean, switch on)',
    /Remaining:/.test(dry.out) && /places cache → users\//.test(dry.out) && /1 device token/.test(dry.out) && /verify \d+ files by SHA-256 against backup/.test(dry.out) && /clean config\.json/.test(dry.out) && /switch on multi-user mode/.test(dry.out));
  check('dry run: a different --admin-username is ignored (no second admin)', /ignored: the admin account "tester" already exists/.test(dry.out));
  check('dry run: changed nothing', !usersOf(v).migratedAt && fs.existsSync(path.join(v.cfg, 'places-cache.json')));

  const res = run(v, ['--admin-username', 'tester']);
  check('resume: completes', res.code === 0 && /Done\. Multi-user mode is on/.test(res.out), res.out.split('\n').slice(-3).join(' | '));
  const a = migratedOk(v, hashes, 'resume');
  check('resume: same admin id as the interrupted run', a?.id === admin.id);
  check('resume: same backup reused (no second backup)', usersOf(v).migrationId === backupTs && fs.readdirSync(path.join(v.arc, '_backups')).length === 1);
  check('resume: log appended in the original backup', /resumed/.test(fs.readFileSync(path.join(v.arc, '_backups', backupTs, 'migration.log'), 'utf8')));
}

// ── 3. Rollback from the partial state ──
{
  const { v, hashes } = makePartial();
  const backupTs = fs.readdirSync(path.join(v.arc, '_backups'))[0];
  const dry = run(v, ['--rollback', backupTs, '--dry-run']);
  check('rollback dry run (partial state): plan shown, nothing changed', dry.code === 0 && /keep aside/.test(dry.out) && fs.existsSync(path.join(v.cfg, 'users.json')));
  const rb = run(v, ['--rollback', backupTs]);
  check('rollback (partial state): completes across volumes', rb.code === 0 && /Rolled back/.test(rb.out), rb.out.split('\n').slice(-2).join(' | '));
  const restored = Object.entries(hashes).filter(([rel, h]) => fs.existsSync(path.join(v.arc, rel)) && sha(path.join(v.arc, rel)) === h).length;
  check('rollback: notes + projects back at the archive root, byte-for-byte', restored === Object.keys(hashes).length, `${restored}/${Object.keys(hashes).length}`);
  const cfg = readJson(path.join(v.cfg, 'config.json'));
  check('rollback: config.json restored (password, tokens, places)', !!cfg.passwordHash && cfg.deviceTokens?.length === 1 && !!cfg.places);
  check('rollback: users.json moved aside, places cache in the config volume', !fs.existsSync(path.join(v.cfg, 'users.json')) && fs.existsSync(path.join(v.cfg, 'places-cache.json')));
  check('rollback: the moved data is kept aside', walk(path.join(v.arc, '_backups', backupTs)).some(f => /rolled-back-.*\/users\//.test(f) || /rolled-back-.*users\.json$/.test(f)));
  const again = run(v, ['--admin-username', 'tester']);
  check('after rollback: migration runs again cleanly', again.code === 0 && /Done\./.test(again.out));
  migratedOk(v, hashes, 'after rollback');
}

// ── 4. Rollback after a completed migration ──
{
  const v = volumes();
  const hashes = seed(v);
  run(v, ['--admin-username', 'tester']);
  const backupTs = usersOf(v).migrationId;
  const rb = run(v, ['--rollback', backupTs]);
  const restored = Object.entries(hashes).filter(([rel, h]) => fs.existsSync(path.join(v.arc, rel)) && sha(path.join(v.arc, rel)) === h).length;
  check('rollback after a full migration: completes and restores everything', rb.code === 0 && restored === Object.keys(hashes).length && !!readJson(path.join(v.cfg, 'config.json')).passwordHash);
}

if (!realDevices) fs.rmSync(base, { recursive: true, force: true });
void partialVolumes;
console.log(fails ? `${fails} FAILED` : 'ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
