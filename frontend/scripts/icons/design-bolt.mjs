// Neon lightning-bolt icon (proposal) → branding/bolt/*.svg
//
//   node scripts/icons/design-bolt.mjs [--angle=<degrees>] [--out=<dir>]
//
// An original bolt in Pocket Archive's style: dark navy rounded tile with a soft
// center glow, a bold slightly angled gold bolt (#FBBF24 → #F59E0B) with a
// bright white-gold core, and a neon bloom (two glow layers). Plain paths and
// strokes only (vector-drawable friendly); blur layers are marked filter=… so
// the Android converter skips them and uses the stroked glow instead.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
export const ANGLE = Number(arg('angle') ?? 4);    // degrees clockwise — "slightly angled"
const OUT = arg('out') ? join(root, arg('out')) : join(root, 'branding', 'bolt');

export const NAVY = { deep: '#0B1222', base: '#0F172A', glow: '#1E2A44' };
export const GOLD = { light: '#FBBF24', mid: '#F59E0B', core: '#FFF4CC', warm: '#FDE68A' };
const RED = { light: '#F87171', dark: '#DC2626' };
const f = n => Math.round(n * 100) / 100;

// ── Bolt geometry (upright, 1024 box) ───────────────────────────────────────
// Top edge, long left edge, left notch, tip, long right edge, right notch.
const RAW = [
  [556, 108], [744, 108], [584, 418], [748, 418], [376, 918], [490, 594], [292, 594],
];
const center = (() => {
  const xs = RAW.map(p => p[0]), ys = RAW.map(p => p[1]);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
})();

/** Bolt polygon scaled + rotated around the tile center; returns { d, points, extent } */
export function bolt(scale = 1, angle = ANGLE, inset = 0) {
  const a = (angle * Math.PI) / 180;
  // Inset (for the bright core): pull every point toward the shape's center
  const pts = RAW.map(([x, y]) => {
    let px = x - center.x, py = y - center.y;
    if (inset) { px *= 1 - inset; py *= 1 - inset; }
    const rx = px * Math.cos(a) - py * Math.sin(a), ry = px * Math.sin(a) + py * Math.cos(a);
    return { x: 512 + rx * scale, y: 512 + ry * scale };
  });
  const d = `M${pts.map(p => `${f(p.x)} ${f(p.y)}`).join('L')}Z`;
  const extent = Math.max(...pts.map(p => Math.hypot(p.x - 512, p.y - 512)));
  return { d, pts, extent };
}

const MASTER_SCALE = 0.74;                    // bolt height ≈ 590 of 1024 on the tile
const SAFE_RADIUS = 292;                      // adaptive icon: 66dp safe circle = 313 of 1024
export const FG_SCALE = SAFE_RADIUS / bolt(1).extent;

// ── Pieces ──────────────────────────────────────────────────────────────────
const TILE_R = 228;
const tile = `M${TILE_R} 0H${1024 - TILE_R}A${TILE_R} ${TILE_R} 0 0 1 1024 ${TILE_R}V${1024 - TILE_R}A${TILE_R} ${TILE_R} 0 0 1 ${1024 - TILE_R} 1024H${TILE_R}A${TILE_R} ${TILE_R} 0 0 1 0 ${1024 - TILE_R}V${TILE_R}A${TILE_R} ${TILE_R} 0 0 1 ${TILE_R} 0Z`;

const defs = `
    <radialGradient id="navyGlow" cx="512" cy="470" r="640" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${NAVY.glow}"/>
      <stop offset="0.55" stop-color="${NAVY.base}"/>
      <stop offset="1" stop-color="${NAVY.deep}"/>
    </radialGradient>
    <radialGradient id="amberHalo" cx="512" cy="512" r="420" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${GOLD.mid}" stop-opacity="0.30"/>
      <stop offset="0.6" stop-color="${GOLD.mid}" stop-opacity="0.08"/>
      <stop offset="1" stop-color="${GOLD.mid}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="boltFill" x1="512" y1="160" x2="512" y2="880" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${GOLD.light}"/>
      <stop offset="1" stop-color="${GOLD.mid}"/>
    </linearGradient>
    <linearGradient id="coreFill" x1="512" y1="200" x2="512" y2="840" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="${GOLD.core}"/>
    </linearGradient>
    <filter id="bloomWide" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="46"/></filter>
    <filter id="bloomTight" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16"/></filter>
    <filter id="coreSoft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="13"/></filter>
    <clipPath id="tileClip"><path d="${tile}"/></clipPath>`;

const background = (shape = true) => `${shape ? '' : ''}<rect width="1024" height="1024" fill="url(#navyGlow)"/>
  <rect width="1024" height="1024" fill="url(#amberHalo)"/>`;

/**
 * The bolt with its glow. glow: 'full' (bitmap bloom + stroked glow), 'vector'
 * (stroked glow only), 'small' (one faint outline — 16–48 px), 'none'.
 */
function boltLayer(scale, glow = 'full') {
  const b = bolt(scale);
  const core = bolt(scale, ANGLE, 0.5);
  const w = n => f(n * scale / MASTER_SCALE);
  const bloom = glow === 'full' ? `
    <path d="${b.d}" fill="none" stroke="${GOLD.mid}" stroke-width="${w(96)}" stroke-linejoin="round" stroke-opacity="0.65" filter="url(#bloomWide)"/>
    <path d="${b.d}" fill="none" stroke="${GOLD.light}" stroke-width="${w(30)}" stroke-linejoin="round" stroke-opacity="0.85" filter="url(#bloomTight)"/>` : '';
  const stroked = glow === 'full' || glow === 'vector' ? `
    <path d="${b.d}" fill="none" stroke="${GOLD.mid}" stroke-width="${w(84)}" stroke-linejoin="round" stroke-opacity="0.07"/>
    <path d="${b.d}" fill="none" stroke="${GOLD.mid}" stroke-width="${w(52)}" stroke-linejoin="round" stroke-opacity="0.12"/>
    <path d="${b.d}" fill="none" stroke="${GOLD.light}" stroke-width="${w(26)}" stroke-linejoin="round" stroke-opacity="0.22"/>` : '';
  const small = glow === 'small' ? `
    <path d="${b.d}" fill="none" stroke="${GOLD.mid}" stroke-width="${w(40)}" stroke-linejoin="round" stroke-opacity="0.18"/>` : '';
  return `${bloom}${stroked}${small}
    <path d="${b.d}" fill="url(#boltFill)" stroke="url(#boltFill)" stroke-width="${w(14)}" stroke-linejoin="round"/>
    <path d="${core.d}" fill="url(#coreFill)" fill-opacity="${glow === 'full' ? 0.95 : 0.8}" stroke="url(#coreFill)" stroke-width="${w(10)}" stroke-linejoin="round"${glow === 'full' ? ' filter="url(#coreSoft)"' : ''}/>`;
}

const svg = (body, d = defs) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${d}
  </defs>
  ${body}
</svg>
`;

function master({ glow = 'full', badge = null } = {}) {
  const dot = badge === 'dot' ? `
  <circle cx="784" cy="784" r="112" fill="${NAVY.base}"/>
  <circle cx="784" cy="784" r="86" fill="url(#red)"/>` : badge === 'stop' ? `
  <circle cx="784" cy="784" r="112" fill="#FFFFFF"/>
  <circle cx="784" cy="784" r="86" fill="${NAVY.base}"/>
  <rect x="746" y="746" width="76" height="76" rx="12" fill="#FFFFFF"/>` : '';
  return `<g clip-path="url(#tileClip)">
    ${background()}
    <path d="${tile}" fill="none" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="6"/>
    ${boltLayer(MASTER_SCALE, glow)}
  </g>${dot}`;
}

const redDefs = `
    <linearGradient id="red" x1="700" y1="700" x2="868" y2="868" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${RED.light}"/>
      <stop offset="1" stop-color="${RED.dark}"/>
    </linearGradient>`;

const flat = (scale, color = '#FFFFFF') => `<path d="${bolt(scale).d}" fill="${color}" stroke="${color}" stroke-width="${f(14 * scale / MASTER_SCALE)}" stroke-linejoin="round"/>`;
const GLYPH_SCALE = 450 / bolt(1).extent;   // silhouette filling the box (notification, tile, complication)

export const sources = {
  'icon-master.svg': svg(master()),
  'icon-small.svg': svg(master({ glow: 'small' })),                       // 16–48 px: glow reduced
  'icon-background.svg': svg(background()),
  'icon-foreground.svg': svg(boltLayer(FG_SCALE, 'full')),
  'icon-monochrome.svg': svg(flat(FG_SCALE)),
  'quick-record.svg': svg(master({ badge: 'dot' }), defs + redDefs),
  'stop-record.svg': svg(master({ badge: 'stop' })),
  'icon-fullbleed.svg': svg(`${background()}
  ${boltLayer(MASTER_SCALE * 0.92, 'full')}`),
  'glyph-bolt.svg': svg(flat(GLYPH_SCALE)),
  'watch-round.svg': svg(`<circle cx="512" cy="512" r="512" fill="url(#navyGlow)"/><circle cx="512" cy="512" r="512" fill="url(#amberHalo)"/>
  ${boltLayer(MASTER_SCALE * 0.9, 'full')}`),
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(sources)) writeFileSync(join(OUT, name), content);
  console.log(`icons: wrote ${Object.keys(sources).length} bolt SVGs to ${OUT} (angle ${ANGLE}°, adaptive scale ${FG_SCALE.toFixed(3)})`);
}
