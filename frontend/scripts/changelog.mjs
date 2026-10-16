// Copies the monorepo's CHANGELOG.md (single source of truth) into
// src/generated/changelog.md so the app can show it (Settings → About).
// Runs before every build ("prebuild"). When the changelog isn't reachable
// (e.g. inside the NAS Docker build, which only sees frontend/), the copy
// that's already in src/generated/ is used.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  path.join(root, '..', 'CHANGELOG.md'),                              // monorepo: frontend/../CHANGELOG.md
  path.join(root, '..', 'pocket-archive-monorepo', 'CHANGELOG.md'),   // local dev folders side by side
];
const out = path.join(root, 'src', 'generated', 'changelog.md');
const src = candidates.find(p => fs.existsSync(p));

if (!src) {
  if (fs.existsSync(out)) console.log('changelog: source not found here — keeping src/generated/changelog.md');
  else { console.error('changelog: CHANGELOG.md not found and no generated copy'); process.exit(1); }
} else {
  const text = fs.readFileSync(src, 'utf8');
  if (!/^## \d+\.\d+(\.\d+)? — /m.test(text)) { console.error('changelog: no "## X.Y.Z — date" entries in', src); process.exit(1); }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const prev = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (prev !== text) fs.writeFileSync(out, text);
  console.log(`changelog: ${path.relative(root, src)} → src/generated/changelog.md (${text.match(/^## ([^ ]+)/m)[1]})`);
}
