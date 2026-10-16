// Release check: is the version in the changelog really deployed everywhere?
//
//   node scripts/verify-release.mjs [--phone] [--watch=<adb serial>]
//
// Compares the newest CHANGELOG.md entry with: package.json, the NAS build
// folder (Z:\pocket-archive\frontend — what the NAS image builds from), and,
// with --phone, the app installed on every connected phone (adb). Exit code 1
// when something is behind, so deploy-to-nas.bat / update-android.bat stop
// with a clear message instead of "done".
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const NAS_FRONTEND = process.env.PA_NAS_FRONTEND || 'Z:\\pocket-archive\\frontend';
const ADB = process.env.ADB || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');

const topVersion = text => text.match(/^## (\d+\.\d+(?:\.\d+)?) — /m)?.[1] || null;
let failures = 0;
const line = (ok, label, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
};

const changelog = path.join(root, 'src', 'generated', 'changelog.md');
const want = fs.existsSync(changelog) ? topVersion(fs.readFileSync(changelog, 'utf8')) : null;
console.log(`Release check: CHANGELOG says ${want || '(missing)'}`);
line(!!want, 'CHANGELOG has a version entry', want ? null : 'run npm run changelog');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
line(pkg === want, 'package.json version', pkg);

// The NAS builds from its own copy of the source
const nasLog = path.join(NAS_FRONTEND, 'src', 'generated', 'changelog.md');
if (fs.existsSync(NAS_FRONTEND)) {
  const nas = fs.existsSync(nasLog) ? topVersion(fs.readFileSync(nasLog, 'utf8')) : null;
  line(nas === want, `NAS build folder (${NAS_FRONTEND})`, nas ? `has ${nas}` : 'no changelog → old source; run deploy-to-nas.bat');
  const local = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const remote = fs.existsSync(path.join(NAS_FRONTEND, 'src', 'App.jsx')) ? fs.readFileSync(path.join(NAS_FRONTEND, 'src', 'App.jsx'), 'utf8') : '';
  line(local === remote, 'NAS source matches this folder (src/App.jsx)', local === remote ? null : 'out of date');
} else {
  line(false, `NAS build folder (${NAS_FRONTEND})`, 'not reachable (map the Z: drive)');
}

// Installed Android app(s)
if (args.includes('--phone') || args.some(a => a.startsWith('--watch='))) {
  const versions = {};
  try {
    const props = fs.readFileSync(path.join(root, 'android', 'app', 'version.properties'), 'utf8');
    versions.built = props.match(/^VERSION_NAME=(.+)$/m)?.[1]?.trim();
    line(versions.built === want, 'Built phone app (version.properties)', versions.built);
  } catch { line(false, 'Built phone app', 'version.properties missing'); }
  let devices = [];
  try {
    devices = execFileSync(ADB, ['devices'], { encoding: 'utf8' }).split(/\r?\n/).slice(1)
      .map(l => l.trim().split(/\s+/)).filter(p => p[1] === 'device').map(p => p[0]).filter(s => !s.startsWith('emulator-'));
  } catch { /* adb missing */ }
  const watch = args.find(a => a.startsWith('--watch='))?.split('=')[1];
  if (!devices.length) line(false, 'Phone connected (adb)', 'none — plug in the phone');
  for (const serial of devices) {
    try {
      const dump = execFileSync(ADB, ['-s', serial, 'shell', 'dumpsys', 'package', 'com.sanpan003.pocketarchive'], { encoding: 'utf8' });
      const installed = dump.match(/versionName=(\S+)/)?.[1];
      const isWatch = serial === watch || /watch/i.test(execFileSync(ADB, ['-s', serial, 'shell', 'getprop', 'ro.build.characteristics'], { encoding: 'utf8' }));
      if (isWatch) line(!!installed, `Watch ${serial}`, installed ? `has ${installed}` : 'app not installed');
      else line(installed === want, `Phone ${serial}`, installed ? `has ${installed}` : 'app not installed');
    } catch (err) {
      line(false, `Device ${serial}`, err.message.split('\n')[0]);
    }
  }
}

console.log(failures ? `\nRELEASE NOT COMPLETE: ${failures} check(s) failed.` : '\nRelease verified: everything is on the same version.');
process.exit(failures ? 1 : 0);
