#!/usr/bin/env node
// Offline regression test on a REAL phone over adb (no emulators). Run it before publishing any release that touches
// the app shell (ShellClient, MainActivity, offline/*), sync, or the API client (src/lib/api.js, src/lib/offline/*):
//
//   node scripts/test-offline-device.mjs [--serial R3GL105L1RV] [--package com.sanpan003.pocketarchive] [--out DIR]
//
// What it does: checks the offline copy while online (Settings → Offline & storage must show a status, "Up to date"),
// switches airplane mode ON (adb), cold-starts the app, and opens the Inbox, a note, Search and Settings → Offline
// from the app's own routes, failing on any "network error" / blank screen. Logcat and a screenshot per step are
// saved. Airplane mode is ALWAYS switched back off at the end (also on Ctrl+C / errors).
//
// Safety: refuses to run during a phone call or without the phone being awake and unlocked (airplane mode would drop
// the call), and launches the app by its main activity (never `monkey`, which starts the Quick Record launcher).
// Not automated (printed as a checklist): photo, Hey Pocket recording, typed note, voice note, widget — they need hands.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };

const PKG = opt('package', 'com.sanpan003.pocketarchive');
const ANDROID_HOME = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const ADB = fs.existsSync(path.join(ANDROID_HOME, 'platform-tools', 'adb.exe')) ? path.join(ANDROID_HOME, 'platform-tools', 'adb.exe') : 'adb';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.resolve(opt('out', path.join(root, 'build', 'offline-device-test', stamp)));
fs.mkdirSync(OUT, { recursive: true });

let serial = opt('serial', null);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (ok, msg, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}${extra ? `  -- ${extra}` : ''}`); if (!ok) fails++; return ok; };

function adbRaw(args, { binary = false } = {}) {
  const r = spawnSync(ADB, serial ? ['-s', serial, ...args] : args, { encoding: binary ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r;
}
const sh = cmd => (adbRaw(['shell', cmd]).stdout || '').toString().replace(/\r/g, '').trim();

// ── what the screen shows (uiautomator reads the WebView's accessibility tree) ──────────────────────────
function screenTexts() {
  const xml = (adbRaw(['exec-out', 'uiautomator', 'dump', '/dev/tty']).stdout || '').toString();
  const nodes = [];
  for (const m of xml.matchAll(/<node [^>]*?text="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)) {
    const text = (m[1] || m[2] || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#10;/g, ' ').trim();
    if (text) nodes.push({ text, x: (+m[3] + +m[5]) / 2, y: (+m[4] + +m[6]) / 2 });
  }
  return nodes;
}
const allText = nodes => nodes.map(n => n.text).join(' | ');

function screenshot(name) {
  const r = adbRaw(['exec-out', 'screencap', '-p'], { binary: true });
  fs.writeFileSync(path.join(OUT, `${name}.png`), r.stdout);
}

async function waitFor(pattern, { timeoutMs = 20_000, bad = BAD } = {}) {
  const t0 = Date.now();
  let nodes = [];
  while (Date.now() - t0 < timeoutMs) {
    nodes = screenTexts();
    const text = allText(nodes);
    if (bad.test(text)) return { ok: false, nodes, why: `error text on screen: ${text.match(bad)[0]}` };
    if (pattern.test(text)) return { ok: true, nodes };
    await sleep(1500);
  }
  return { ok: false, nodes, why: `"${pattern}" never appeared (saw ${nodes.length} texts: ${allText(nodes).slice(0, 160)})` };
}

const BAD = /network error|ERR_[A-Z_]+|webpage not available|can.?t be reached|no internet|failed to load|something went wrong/i;

function launch(route, { cold = false } = {}) {
  if (cold) sh(`am force-stop ${PKG}`);
  // The main activity (never `monkey -p … LAUNCHER`: that picks the Quick Record launcher alias and starts recording)
  sh(`am start -n ${PKG}/com.sanpan003.pocketarchive.MainActivity -a com.sanpan003.pocketarchive.OPEN_ROUTE --es route ${route}`);
}

// ── airplane mode, always restored ──────────────────────────────────────────────────────────────────────
// Airplane mode alone is NOT offline: Samsung keeps Wi-Fi on in airplane mode, so the NAS stays reachable (a 2.13.1
// finding — the first "offline" runs were silently online). Wi-Fi and mobile data are switched off too, and restored.
let airplaneOn = false;
let before = null;
function airplane(on) {
  if (on) {
    if (!before) before = { wifi: sh('settings get global wifi_on') === '1', data: sh('settings get global mobile_data') === '1' };
    sh('cmd connectivity airplane-mode enable; svc wifi disable; svc data disable');
  } else {
    sh('cmd connectivity airplane-mode disable');
    if (before?.wifi) sh('svc wifi enable');
    if (before?.data) sh('svc data enable');
  }
  airplaneOn = on;
}
/** The phone really has no route to the NAS */
const reallyOffline = () => sh('settings get global airplane_mode_on') === '1' && sh('settings get global wifi_on') !== '1';
function restore() { if (airplaneOn) { try { airplane(false); console.log('(airplane mode switched back off)'); } catch { /* best effort */ } } }
process.on('SIGINT', () => { restore(); process.exit(130); });
process.on('uncaughtException', e => { console.error(e); restore(); process.exit(1); });

// ── run ─────────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  if (!serial) {
    const list = (adbRaw(['devices']).stdout || '').toString().split('\n').slice(1).map(l => l.trim().split(/\s+/)).filter(p => p[1] === 'device').map(p => p[0]);
    if (list.length !== 1) { console.error(`Need exactly one connected device (found ${list.length}); pass --serial`); process.exit(2); }
    serial = list[0];
  }
  console.log(`Device ${serial} · output ${OUT}`);
  if (/emulator-/.test(serial)) { console.error('Real phones only (no emulators).'); process.exit(2); }

  // Safety first
  // Every SIM slot reports its own mCallState: any value other than 0 means a call (the first line alone is not enough)
  const states = sh('dumpsys telephony.registry | grep mCallState=').split('\n').map(l => l.trim()).filter(Boolean);
  if (states.length === 0 || states.some(l => !/mCallState=0$/.test(l))) {
    console.error(`A phone call is active or ringing, or the call state is unknown (${states.join(', ') || 'no data'}). Airplane mode would drop it: try again after the call.`);
    process.exit(2);
  }
  const telecom = sh('dumpsys telecom | grep -E "Call TC@[0-9]+, state=(ACTIVE|DIALING|RINGING|ON_HOLD|CONNECTING)"');
  if (telecom) { console.error('Telecom reports a live call. Try again after the call.'); process.exit(2); }
  const awake = sh('dumpsys power | grep -m1 mWakefulness=');
  if (!/Awake/.test(awake)) { console.error('The phone is asleep: wake and unlock it first.'); process.exit(2); }

  const version = sh(`dumpsys package ${PKG} | grep -m1 versionName`).replace('versionName=', '').trim();
  const repoVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  check(!!version, `app installed (${PKG} ${version})`);
  check(version === repoVersion, `installed version matches this checkout (${version} vs ${repoVersion})`, 'install the release build first');

  // The app loads its screens from the NAS while online: it must serve the same web build as this checkout, or the
  // test (and the phone) runs old screens online and new ones offline
  try {
    const env = fs.existsSync(path.join(root, '.env.android')) ? fs.readFileSync(path.join(root, '.env.android'), 'utf8') : '';
    const origin = (env.match(/^VITE_API_BASE_URL=(.+)$/m)?.[1] || '').trim().replace(/\/+$/, '');
    const local = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8').match(/assets\/index-[\w-]+\.js/)?.[0];
    if (origin && local) {
      const res = await fetch(origin + '/', { signal: AbortSignal.timeout(10_000) });
      const served = (await res.text()).match(/assets\/index-[\w-]+\.js/)?.[0];
      check(served === local, 'the NAS serves the same web build as this checkout', served === local ? '' : `NAS ${served} vs local ${local}: deploy and rebuild the NAS`);
    }
  } catch (e) { console.log(`(skipped the NAS web-build check: ${e.message})`); }

  const log = spawn(ADB, ['-s', serial, 'logcat', '-v', 'time'], { stdio: ['ignore', fs.openSync(path.join(OUT, 'logcat.txt'), 'w'), 'ignore'] });
  sh('logcat -c');

  // 1. Online: the offline copy exists and is current, and the Settings section is never blank
  airplane(false);
  launch('/settings/offline', { cold: true });
  const online = await waitFor(/Offline & storage[\s\S]*(Up to date|Syncing|Downloading|Offline copy not set up|Checking the offline copy|Locked)/i);
  screenshot('1-online-offline-settings');
  check(online.ok, 'Settings → Offline & storage shows a status while online', online.why || '');
  const onlineText = allText(online.nodes);
  check(/Up to date/i.test(onlineText), 'offline copy is up to date before going offline', onlineText.match(/Offline copy not set up|Checking the offline copy|Downloading[^|]*|Syncing[^|]*|Locked[^|]*/i)?.[0] || 'no status text');
  const diag = online.nodes.find(n => /signed in|NOT signed in/.test(n.text));
  if (diag) console.log(`     diagnostics: ${diag.text}`);

  // 2. Airplane mode, cold start, every screen
  airplane(true);
  await sleep(3000);
  check(reallyOffline(), 'airplane mode on and Wi-Fi off');

  launch('/quick/inbox', { cold: true });
  const inbox = await waitFor(/Inbox|Capture|Notes|Lists/i, { timeoutMs: 25_000 });
  screenshot('2-offline-inbox');
  check(inbox.ok, 'cold start in airplane mode opens the Inbox (no error page)', inbox.why || '');
  check(/Offline/i.test(allText(inbox.nodes)), 'the Offline chip is shown');
  const items = inbox.nodes.filter(n => n.y > 400 && n.text.length > 12);
  check(items.length >= 1, 'the Inbox lists notes from the offline copy', `${items.length} items`);

  if (items[0]) {
    sh(`input tap ${Math.round(items[0].x)} ${Math.round(items[0].y)}`);
    await sleep(2500);
    const note = screenTexts();
    screenshot('3-offline-note');
    check(!BAD.test(allText(note)) && note.length > 5, 'a note opens offline', allText(note).slice(0, 120));
  }

  launch('/search', {});
  const search = await waitFor(/Search/i);
  screenshot('4-offline-search');
  check(search.ok, 'Search opens offline', search.why || '');

  launch('/settings/offline', {});
  const settings = await waitFor(/Offline & storage[\s\S]*(Offline ·|Up to date|Offline copy not set up|Checking|Locked)/i);
  screenshot('5-offline-settings');
  check(settings.ok, 'Settings → Offline & storage shows a status offline too', settings.why || '');

  // 3. Logs: nothing crashed, no silent offline-copy failures
  airplane(false);
  await sleep(1500);
  log.kill();
  const logText = fs.readFileSync(path.join(OUT, 'logcat.txt'), 'utf8');
  const crash = (logText.match(/FATAL EXCEPTION[^\n]*\n[^\n]*\n[^\n]*/g) || []).filter(c => c.includes(PKG));
  check(crash.length === 0, 'no crash in logcat', crash[0] || '');
  const problems = logText.split('\n').filter(l => /Offline copy problem|UnsatisfiedLinkError|net::ERR_|Sync stopped/.test(l) && l.includes(PKG.split('.').pop() || 'pocketarchive')).slice(0, 5);
  check(problems.length === 0, 'no offline-copy errors in logcat', problems[0] || '');

  console.log('\nNot automated — do these by hand in airplane mode, then note the result in the release notes:');
  for (const s of ['open a note with a photo', 'play a Hey Pocket recording (admin)', 'create a typed note, then go online: it appears on the NAS once', 'record a voice note: "saved, will upload"', 'tap the widget: it still shows notes']) console.log(`  [ ] ${s}`);

  const pass = fails === 0;
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ pass, version, serial, at: new Date().toISOString(), fails }, null, 2));
  if (pass) {
    // verify-release.mjs looks for this
    fs.mkdirSync(path.join(root, 'build', 'offline-device-test'), { recursive: true });
    fs.writeFileSync(path.join(root, 'build', 'offline-device-test', 'last-pass.json'), JSON.stringify({ version, serial, at: new Date().toISOString() }));
  }
  console.log(`\n${pass ? 'PASS' : `FAIL (${fails})`} — screenshots and logcat in ${OUT}`);
  process.exitCode = pass ? 0 : 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(restore);
