// Pocket Archive icon design → branding/*.svg (the sources every icon is made from).
//
//   node scripts/icons/design.mjs [--tilt=<degrees>] [--out=<dir>]
//
// A gold rounded tile with the web logo's handheld vocal mic (lucide "Mic2"),
// redrawn as a filled glyph: round grille head, collar, tapered handle, and
// two faint sound-wave arcs on each side. Geometry is in a 1024×1024 box and
// uses plain <path> elements only, so scripts/icons/build.mjs can also turn
// it into Android vector drawables.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
export const TILT = Number(arg('tilt') ?? 35);          // degrees clockwise — approved: Option A, tilted like the web logo
const OUT = arg('out') ? join(root, arg('out')) : join(root, 'branding');

// ── Palette ─────────────────────────────────────────────────────────────────
export const GOLD = { light: '#FBBF24', mid: '#F59E0B', dark: '#D97706', shadow: '#92400E' };
const RED = { light: '#F87171', dark: '#DC2626' };

// ── Geometry helpers ────────────────────────────────────────────────────────
const f = n => Math.round(n * 100) / 100;
const PIVOT = { x: 512, y: 560 };                     // tilt around the mic's middle
function rot({ x, y }, deg = TILT, c = PIVOT) {
  const a = (deg * Math.PI) / 180;
  const dx = x - c.x;
  const dy = y - c.y;
  return { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) };
}
const pt = p => `${f(p.x)} ${f(p.y)}`;

// Upright design, then tilted as a whole
const HEAD = { x: 512, y: 382, r: 120 };

// Center the whole glyph (waves included) in the tile, a touch above the
// middle so it looks centered (the handle is visually lighter than the head).
const OFFSET = (() => {
  const h = rot(HEAD);
  const pts = [
    { x: h.x - 258, y: h.y - 129 }, { x: h.x + 258, y: h.y + 129 },   // wave arcs
    { x: h.x, y: h.y - HEAD.r }, { x: h.x, y: h.y + HEAD.r },
    rot({ x: 470, y: 810 }), rot({ x: 554, y: 810 }), rot({ x: 512, y: 810 }), // handle end
  ];
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  return { x: 512 - (Math.min(...xs) + Math.max(...xs)) / 2, y: 500 - (Math.min(...ys) + Math.max(...ys)) / 2 };
})();
const WAVES = [
  { r: 192, w: 26, opacity: 0.62 },
  { r: 258, w: 22, opacity: 0.34 },
];

/**
 * The glyph at a given scale around the tile's center. The master tile uses 1;
 * the Android adaptive foreground/monochrome layers use FG_SCALE so everything
 * stays inside the 66dp safe zone (launchers show only the middle 72 of 108dp).
 */
export function makeGlyph(scale = 1, customPlace = null) {
  const place = customPlace || (p => ({ x: 512 + (p.x + OFFSET.x - 512) * scale, y: 512 + (p.y + OFFSET.y - 512) * scale }));
  const P = (x, y) => place(rot({ x, y }));
  const head = place(rot(HEAD));
  const R = n => f(n * scale);

  const circlePath = (c, r) =>
    `M${f(c.x - r)} ${f(c.y)}A${f(r)} ${f(r)} 0 1 0 ${f(c.x + r)} ${f(c.y)}A${f(r)} ${f(r)} 0 1 0 ${f(c.x - r)} ${f(c.y)}Z`;

  // Collar: a rounded band under the head
  const collar = (() => {
    const y0 = 512, y1 = 548, hw = 92, r = 18;
    const a = P(512 - hw + r, y0), b = P(512 + hw - r, y0), c = P(512 + hw, y0 + r), d = P(512 + hw, y1 - r);
    const e = P(512 + hw - r, y1), g = P(512 - hw + r, y1), h = P(512 - hw, y1 - r), i = P(512 - hw, y0 + r);
    const rr = R(r);
    return `M${pt(a)}L${pt(b)}A${rr} ${rr} 0 0 1 ${pt(c)}L${pt(d)}A${rr} ${rr} 0 0 1 ${pt(e)}L${pt(g)}A${rr} ${rr} 0 0 1 ${pt(h)}L${pt(i)}A${rr} ${rr} 0 0 1 ${pt(a)}Z`;
  })();

  // Handle: tapers from the collar to a rounded end
  const handle = (() => {
    const top = 560, bottom = 768, wTop = 74, wBot = 42;
    const a = P(512 - wTop, top), b = P(512 + wTop, top), c = P(512 + wBot, bottom), d = P(512 - wBot, bottom);
    return `M${pt(a)}L${pt(b)}L${pt(c)}A${R(wBot)} ${R(wBot)} 0 0 1 ${pt(d)}Z`;
  })();

  // Grille: three chords across the head (dark gold on the white head)
  const grille = [-44, 0, 44].map(dy => {
    const half = Math.sqrt(HEAD.r ** 2 - dy ** 2) - 30;
    return `M${pt(P(HEAD.x - half, HEAD.y + dy))}L${pt(P(HEAD.x + half, HEAD.y + dy))}`;
  });

  // Sound waves: arcs around the head, left and right, always horizontal
  const arcPath = (r, centerDeg, spanDeg) => {
    const a0 = ((centerDeg - spanDeg) * Math.PI) / 180;
    const a1 = ((centerDeg + spanDeg) * Math.PI) / 180;
    const rs = r * scale;
    const p0 = { x: head.x + rs * Math.cos(a0), y: head.y + rs * Math.sin(a0) };
    const p1 = { x: head.x + rs * Math.cos(a1), y: head.y + rs * Math.sin(a1) };
    return `M${pt(p0)}A${f(rs)} ${f(rs)} 0 0 1 ${pt(p1)}`;
  };

  // Farthest point from the center (for the safe-zone check)
  const extent = Math.max(
    ...WAVES.flatMap(w => [-30, 0, 30, 150, 180, 210].map(deg => {
      const a = (deg * Math.PI) / 180;
      return Math.hypot(head.x + w.r * scale * Math.cos(a) - 512, head.y + w.r * scale * Math.sin(a) - 512) + (w.w * scale) / 2;
    })),
    Math.hypot(head.x - 512, head.y - 512) + HEAD.r * scale,
    ...[P(470, 810), P(554, 810), P(512, 810)].map(p => Math.hypot(p.x - 512, p.y - 512)),
  );

  return {
    scale,
    extent,
    strokeScale: scale,
    head: circlePath(head, HEAD.r * scale),
    collar,
    handle,
    grille,
    waves: WAVES.flatMap(w => [
      { d: arcPath(w.r, 180, 30), w: f(w.w * scale), opacity: w.opacity },
      { d: arcPath(w.r, 0, 30), w: f(w.w * scale), opacity: w.opacity },
    ]),
  };
}

// 66dp of 108dp → radius 313 of 1024; keep ~13 px of margin
const SAFE_RADIUS = 300;
export const glyph = makeGlyph(1);
export const FG_SCALE = Math.min(1, SAFE_RADIUS / glyph.extent);
export const fgGlyph = makeGlyph(FG_SCALE);

// Mic only (no waves), filling the box: small UI glyphs (notification, widget button,
// watch tile/complication) where thin waves would blur
export const micGlyph = (() => {
  const raw = [
    ...[0, 90, 180, 270].map(deg => {
      const h = rot(HEAD), a = (deg * Math.PI) / 180;
      return { x: h.x + HEAD.r * Math.cos(a), y: h.y + HEAD.r * Math.sin(a) };
    }),
    rot({ x: 420, y: 512 }), rot({ x: 604, y: 512 }), rot({ x: 420, y: 548 }), rot({ x: 604, y: 548 }),
    rot({ x: 438, y: 560 }), rot({ x: 586, y: 560 }), rot({ x: 470, y: 810 }), rot({ x: 554, y: 810 }), rot({ x: 512, y: 810 }),
  ];
  const xs = raw.map(q => q.x), ys = raw.map(q => q.y);
  const bx = (Math.min(...xs) + Math.max(...xs)) / 2, by = (Math.min(...ys) + Math.max(...ys)) / 2;
  const s = 900 / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return makeGlyph(s, q => ({ x: 512 + (q.x - bx) * s, y: 512 + (q.y - by) * s }));
})();

// ── SVG building blocks ─────────────────────────────────────────────────────
const TILE_R = 228;
const tile = `M${TILE_R} 0H${1024 - TILE_R}A${TILE_R} ${TILE_R} 0 0 1 1024 ${TILE_R}V${1024 - TILE_R}A${TILE_R} ${TILE_R} 0 0 1 ${1024 - TILE_R} 1024H${TILE_R}A${TILE_R} ${TILE_R} 0 0 1 0 ${1024 - TILE_R}V${TILE_R}A${TILE_R} ${TILE_R} 0 0 1 ${TILE_R} 0Z`;

const gradientDefs = `
    <linearGradient id="gold" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${GOLD.light}"/>
      <stop offset="0.5" stop-color="${GOLD.mid}"/>
      <stop offset="1" stop-color="${GOLD.dark}"/>
    </linearGradient>
    <linearGradient id="highlight" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.34"/>
      <stop offset="0.42" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>`;

// Background layer: gold gradient + soft top highlight (full bleed, no shape)
function backgroundBody() {
  return `<rect width="1024" height="1024" fill="url(#gold)"/>
  <rect width="1024" height="1024" fill="url(#highlight)"/>`;
}

// Foreground layer: waves + mic. shadow = soft drop shadow (bitmap renders only)
function foregroundBody({ g = glyph, color = '#FFFFFF', grille = true, shadow = true, waves: withWaves = true } = {}) {
  const waves = (withWaves ? g.waves : []).map(w =>
    `<path d="${w.d}" fill="none" stroke="${color}" stroke-width="${w.w}" stroke-linecap="round" stroke-opacity="${w.opacity}"/>`).join('\n    ');
  const grilleLines = grille
    ? g.grille.map(d => `<path d="${d}" fill="none" stroke="${GOLD.dark}" stroke-width="${f(11 * g.scale)}" stroke-linecap="round" stroke-opacity="0.4"/>`).join('\n    ')
    : '';
  return `<g${shadow ? ' filter="url(#drop)"' : ''}>
    ${waves}
    <path d="${g.head}" fill="${color}"/>
    <path d="${g.collar}" fill="${color}"/>
    <path d="${g.handle}" fill="${color}"/>
    ${grilleLines}
  </g>`;
}

const dropFilter = `
    <filter id="drop" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="${GOLD.shadow}" flood-opacity="0.38"/>
    </filter>`;

const innerShadow = `
    <filter id="inner" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="22"/>
    </filter>
    <clipPath id="tileClip"><path d="${tile}"/></clipPath>`;

function svg(body, defs = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${defs}
  </defs>
  ${body}
</svg>
`;
}

function masterBody({ recordingDot = false, stopSquare = false } = {}) {
  const dot = recordingDot ? `
  <g>
    <circle cx="784" cy="784" r="112" fill="#FFFFFF"/>
    <circle cx="784" cy="784" r="86" fill="url(#red)"/>
  </g>` : stopSquare ? `
  <g>
    <circle cx="784" cy="784" r="112" fill="#FFFFFF"/>
    <circle cx="784" cy="784" r="86" fill="#0F172A"/>
    <rect x="746" y="746" width="76" height="76" rx="12" fill="#FFFFFF"/>
  </g>` : '';
  return `<g clip-path="url(#tileClip)">
    ${backgroundBody()}
    <path d="${tile}" fill="none" stroke="#78350F" stroke-opacity="0.22" stroke-width="44" filter="url(#inner)"/>
  </g>
  ${foregroundBody()}${dot}`;
}

const redDefs = `
    <linearGradient id="red" x1="700" y1="700" x2="868" y2="868" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${RED.light}"/>
      <stop offset="1" stop-color="${RED.dark}"/>
    </linearGradient>`;

export const sources = {
  'icon-master.svg': svg(masterBody(), gradientDefs + dropFilter + innerShadow),
  'icon-background.svg': svg(backgroundBody(), gradientDefs),
  'icon-foreground.svg': svg(foregroundBody({ g: fgGlyph }), dropFilter),
  'icon-monochrome.svg': svg(foregroundBody({ g: fgGlyph, color: '#FFFFFF', grille: false, shadow: false })),
  'quick-record.svg': svg(masterBody({ recordingDot: true }), gradientDefs + dropFilter + innerShadow + redDefs),
  'stop-record.svg': svg(masterBody({ stopSquare: true }), gradientDefs + dropFilter + innerShadow),
  // Full bleed (no rounded tile): iOS touch icon + PWA maskable icon (the platform adds the shape)
  'icon-fullbleed.svg': svg(`${backgroundBody()}
  ${foregroundBody()}`, gradientDefs + dropFilter),
  'glyph-mic.svg': svg(foregroundBody({ g: micGlyph, grille: false, shadow: false, waves: false })),
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(sources)) writeFileSync(join(OUT, name), content);
  console.log(`icons: wrote ${Object.keys(sources).length} SVG sources to ${OUT} (tilt ${TILT}°, adaptive foreground scale ${FG_SCALE.toFixed(3)}, glyph extent ${Math.round(glyph.extent)} → ${Math.round(fgGlyph.extent)} of 313 safe)`);
}
