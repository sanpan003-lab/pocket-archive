// Code shared with the backend (2.9.0): the search core runs on the server (GET /api/find) and in the Android app's
// offline copy, so offline search gives the same answers. The backend file is the source; this copies it into
// src/lib/offline/searchCore.js (committed — the NAS builds the frontend without the backend next to it).
//
//   node scripts/shared-code.mjs          copy (when the backend is next to this folder), else keep the committed copy
//   node scripts/shared-code.mjs --check  fail when the copy differs from the backend (verify-release, tests)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src', 'lib', 'offline', 'searchCore.js');
// This folder next to the backend (C:\Users\sundi\Documents\pocket-archive + …-backend) or inside the monorepo (frontend/)
const sources = [join(root, '..', 'pocket-archive-backend', 'search-core.mjs'), join(root, '..', 'search-core.mjs')];
const source = sources.find(existsSync);
const header = '// GENERATED from the backend\'s search-core.mjs by scripts/shared-code.mjs — edit it there, not here.\n';

if (!source) {
  if (!existsSync(target)) { console.error('shared-code: no backend search-core.mjs and no committed copy'); process.exit(1); }
  console.log('shared-code: backend not next to this folder — using the committed searchCore.js');
  process.exit(0);
}
const want = header + readFileSync(source, 'utf8').replace(/\r\n/g, '\n');
const have = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;
if (process.argv.includes('--check')) {
  if (have !== want) { console.error(`shared-code: ${target} differs from ${source} — run npm run shared`); process.exit(1); }
  console.log('shared-code: search core matches the backend');
  process.exit(0);
}
if (have !== want) writeFileSync(target, want);
console.log(`shared-code: ${have === want ? 'up to date' : 'copied'} search core`);
