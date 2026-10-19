// Publishes the signed release APKs for over-the-air updates (served by the NAS, see backend updates.js).
//
//   node scripts/publish-update.mjs [--draft] [--dir=<updates folder>] [--min=<minVersionCode>]
//
// Copies android/app/.../app-release.apk and android/wear/.../wear-release.apk into
//   <updates folder>/phone|watch/pocket-archive-<target>-<versionName>-<versionCode>.apk  (+ .json details)
// and writes latest.json (or draft.json with --draft: held back until Settings → Users → App updates →
// Publish). Keeps the newest 3 APKs per app. The default folder is P:\_updates (= ARCHIVE/_updates on
// the NAS; PA_UPDATES_DIR overrides). Release notes come from the CHANGELOG entry of that version.
// Never touches anything outside the updates folder.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = name => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const DIR = arg('dir') || process.env.PA_UPDATES_DIR || 'P:\\_updates';
const DRAFT = args.includes('--draft');
const MIN = Number(arg('min')) || 0;
const KEEP = 3;

const APPS = [
  { target: 'phone', apk: path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), props: path.join(root, 'android', 'app', 'version.properties') },
  { target: 'watch', apk: path.join(root, 'android', 'wear', 'build', 'outputs', 'apk', 'release', 'wear-release.apk'), props: path.join(root, 'android', 'wear', 'version.properties') },
];

function prop(file, key) {
  return fs.readFileSync(file, 'utf8').match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim() || null;
}

/** The CHANGELOG entry for a version (Markdown, without its "## X.Y.Z — date" heading) */
function releaseNotes(version) {
  const src = [path.join(root, '..', 'CHANGELOG.md'), path.join(root, '..', 'pocket-archive-monorepo', 'CHANGELOG.md'), path.join(root, 'src', 'generated', 'changelog.md')].find(p => fs.existsSync(p));
  if (!src) return '';
  const text = fs.readFileSync(src, 'utf8');
  const start = text.search(new RegExp(`^## ${version.replace(/\./g, '\\.')} — `, 'm'));
  if (start < 0) return '';
  const rest = text.slice(start);
  const next = rest.slice(3).search(/^## \d/m);
  return (next < 0 ? rest : rest.slice(0, next + 3)).replace(/^## [^\n]*\n/, '').trim().slice(0, 8000);
}

if (!fs.existsSync(path.dirname(path.resolve(DIR))) && !fs.existsSync(DIR)) {
  console.error(`publish-update: ${DIR} is not reachable (map the archive drive, or set PA_UPDATES_DIR).`);
  process.exit(1);
}

for (const { target, apk, props } of APPS) {
  if (!fs.existsSync(apk)) { console.error(`publish-update: ${apk} not found — build first.`); process.exit(1); }
  const versionName = prop(props, 'VERSION_NAME');
  const versionCode = Number(prop(props, 'VERSION_CODE'));
  if (!versionName || !versionCode) { console.error(`publish-update: no version in ${props}`); process.exit(1); }
  const dir = path.join(DIR, target);
  fs.mkdirSync(dir, { recursive: true });
  const buf = fs.readFileSync(apk);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const file = `pocket-archive-${target}-${versionName}-${versionCode}.apk`;
  const info = {
    versionName, versionCode, sha256, size: buf.length, minVersionCode: MIN,
    releaseNotes: releaseNotes(versionName), publishedAt: new Date().toISOString(), file,
  };
  // Copy, then check it arrived intact before pointing anything at it
  const tmp = path.join(dir, `${file}.part`);
  fs.writeFileSync(tmp, buf);
  const back = crypto.createHash('sha256').update(fs.readFileSync(tmp)).digest('hex');
  if (back !== sha256) { fs.unlinkSync(tmp); console.error(`publish-update: copy of ${file} is corrupt`); process.exit(1); }
  fs.renameSync(tmp, path.join(dir, file));
  fs.writeFileSync(path.join(dir, file.replace(/\.apk$/, '.json')), JSON.stringify(info, null, 2));
  fs.writeFileSync(path.join(dir, DRAFT ? 'draft.json' : 'latest.json'), JSON.stringify(info, null, 2));
  if (!DRAFT && fs.existsSync(path.join(dir, 'draft.json'))) fs.unlinkSync(path.join(dir, 'draft.json'));

  // Keep the newest 3 (and whatever latest/draft point at)
  const pinned = new Set(['latest.json', 'draft.json'].map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).file; } catch { return null; } }).filter(Boolean));
  const apks = fs.readdirSync(dir).filter(f => /^pocket-archive-.*\.apk$/.test(f))
    .map(f => ({ f, code: Number(f.match(/-(\d+)\.apk$/)?.[1] || 0) })).sort((a, b) => b.code - a.code);
  for (const { f } of apks.slice(KEEP)) {
    if (pinned.has(f)) continue;
    fs.unlinkSync(path.join(dir, f));
    const meta = path.join(dir, f.replace(/\.apk$/, '.json'));
    if (fs.existsSync(meta)) fs.unlinkSync(meta);
  }
  console.log(`${DRAFT ? 'Draft' : 'Published'} ${target} ${versionName} (${versionCode}) — ${(buf.length / 1048576).toFixed(1)} MB, sha256 ${sha256.slice(0, 12)}…`);
}
if (DRAFT) console.log('Held back as a draft: publish it in Settings → Users → App updates.');
