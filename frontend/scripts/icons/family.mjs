// Pocket Archive app icon family: 16 designs × colors × tiles, one style.
//
// Every icon: the same rounded tile (dark navy / light / AMOLED black) with a soft halo, and a
// glyph in a two-color gradient with a neon glow. Glyphs are plain paths, rects and circles with
// absolute coordinates (1024 box, no transforms) so Android vector drawables (themed / monochrome
// icons) can be made from them. Glow = blurred copies (bitmap only). At small sizes (≤ 48 px) the
// glow is reduced and strokes get thicker so the icon stays readable at 24 px.
//
//   import { iconSvg, DESIGNS, COLORS, TILES } from './family.mjs'
//   iconSvg({ design: 'bolt', color: 'gold', tile: 'dark', small: false, layer: 'master' })
//   layer: master (tile + glyph) | background (tile only, full bleed) | foreground (glyph in the
//          adaptive-icon safe zone, glow included) | monochrome (white glyph, safe zone) | glyph (white, full)

const f = n => Math.round(n * 100) / 100;
const C = 512;

// ── Colors (accents = the exact Appearance theme tokens, 400 → 500) ────────
export const COLORS = {
  gold:       { label: 'Gold',        c1: '#FBBF24', c2: '#F59E0B', core: '#FFF4CC', accent: 'gold' },
  purple:     { label: 'Purple',      c1: '#A78BFA', c2: '#8B5CF6', core: '#EDE9FE', accent: 'purple' },
  blue:       { label: 'Blue',        c1: '#60A5FA', c2: '#3B82F6', core: '#DBEAFE', accent: 'blue' },
  teal:       { label: 'Teal',        c1: '#2DD4BF', c2: '#14B8A6', core: '#CCFBF1', accent: 'teal' },
  rose:       { label: 'Rose',        c1: '#FB7185', c2: '#F43F5E', core: '#FFE4E6', accent: 'rose' },
  neonPurple: { label: 'Neon Purple', c1: '#A78BFA', c2: '#6366F1', core: '#EEF2FF', special: true },
  neonWave:   { label: 'Neon Wave',   c1: '#22D3EE', c2: '#D946EF', core: '#F0FDFF', special: true },
  emerald:    { label: 'Emerald',     c1: '#34D399', c2: '#059669', core: '#D1FAE5', special: true },
  sunset:     { label: 'Sunset',      c1: '#FB923C', c2: '#EC4899', core: '#FFEDD5', special: true },
  ruby:       { label: 'Ruby',        c1: '#FB7185', c2: '#BE123C', core: '#FFE4E6', special: true },
  mono:       { label: 'Mono',        c1: '#FFFFFF', c2: '#CBD5E1', core: '#FFFFFF', special: true, onLight: { c1: '#0F172A', c2: '#334155', core: '#475569' } },
};

export const TILES = {
  dark:   { label: 'Dark' },
  light:  { label: 'Light' },
  amoled: { label: 'AMOLED black' },
};

// ── Geometry helpers ───────────────────────────────────────────────────────
const BOLT_RAW = [[556, 108], [744, 108], [584, 418], [748, 418], [376, 918], [490, 594], [292, 594]];
const BOLT_C = { x: 520, y: 513 };
/** Bolt polygon: scale, center (cx, cy), inset toward its center (for the bright core), 4° tilt */
function boltD(scale, cx = C, cy = C, inset = 0) {
  const a = (4 * Math.PI) / 180;
  const pts = BOLT_RAW.map(([x, y]) => {
    let px = (x - BOLT_C.x) * (1 - inset), py = (y - BOLT_C.y) * (1 - inset);
    const rx = px * Math.cos(a) - py * Math.sin(a), ry = px * Math.sin(a) + py * Math.cos(a);
    return `${f(cx + rx * scale)} ${f(cy + ry * scale)}`;
  });
  return `M${pts.join('L')}Z`;
}

/** Sine wave path from x0 to x1 around y, amplitude enveloped (0 at the ends) */
function waveD(x0, x1, y, amp, cycles) {
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const env = Math.sin(Math.PI * t);
    pts.push(`${f(x0 + (x1 - x0) * t)} ${f(y + amp * env * Math.sin(t * cycles * 2 * Math.PI))}`);
  }
  return `M${pts.join('L')}`;
}

const sparkleD = (x, y, r) => `M${x} ${y - r}Q${f(x + r * 0.1)} ${f(y - r * 0.1)} ${x + r} ${y}Q${f(x + r * 0.1)} ${f(y + r * 0.1)} ${x} ${y + r}Q${f(x - r * 0.1)} ${f(y + r * 0.1)} ${x - r} ${y}Q${f(x - r * 0.1)} ${f(y - r * 0.1)} ${x} ${y - r}Z`;

// ── Glyphs ─────────────────────────────────────────────────────────────────
// p: { fill, stroke, core, bg, w(n) (stroke width; thicker when small), small }
const S = (p, d, w, extra = '') => `<path d="${d}" fill="none" stroke="${p.stroke}" stroke-width="${f(p.w(w))}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
const F = (p, d, extra = '') => `<path d="${d}" fill="${p.fill}"${extra}/>`;
const rr = (x, y, w, h, r) => `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
const circleD = (cx, cy, r) => `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
const core = (p, d, op = 0.85) => (p.mono ? '' : `<path d="${d}" fill="${p.core}" fill-opacity="${op}"/>`);

/** Mic: capsule + cradle + stand + base (x center, capsule top y, capsule width/height) */
function mic(p, cx, top, w, h, { stand = true, base = true, sw = 34 } = {}) {
  const r = w / 2;
  const out = [F(p, rr(cx - r, top, w, h, r))];
  const cy = top + h * 0.62, cr = r + 58;
  out.push(S(p, `M${cx - cr} ${cy}A${cr} ${cr} 0 0 0 ${cx + cr} ${cy}`, sw));
  if (stand) out.push(S(p, `M${cx} ${cy + cr}V${cy + cr + 90}`, sw));
  if (base) out.push(S(p, `M${cx - 74} ${cy + cr + 98}H${cx + 74}`, sw));
  out.push(core(p, rr(cx - r * 0.42, top + 34, r * 0.38, h * 0.45, r * 0.19), 0.45));
  return out.join('');
}

export const DESIGNS = {
  bolt: { label: 'Neon Bolt', glyph: p => F(p, boltD(0.62)) + core(p, boltD(0.62, C, C, 0.5)) },
  purpleBolt: { label: 'Purple Neon Bolt', defaultColor: 'neonPurple', featured: true, glyph: p => F(p, boltD(0.62)) + core(p, boltD(0.62, C, C, 0.5)) },
  sparkMic: {
    label: 'Spark Mic',
    glyph: p => [
      F(p, rr(437, 214, 150, 300, 75)),
      core(p, rr(468, 248, 30, 140, 15), 0.45),
      S(p, 'M368 420A144 144 0 0 0 656 420', 34),
      // stand = a small lightning bolt
      F(p, 'M520 566L582 566L544 652L596 652L470 820L500 700L448 700Z'),
    ].join(''),
  },
  boltWave: {
    label: 'Bolt Wave',
    glyph: p => [
      S(p, waveD(222, 802, 520, 120, 3), 30),
      `<path d="${boltD(0.5)}" fill="none" stroke="${p.bg}" stroke-width="${f(p.w(44))}" stroke-linejoin="round"/>`,
      F(p, boltD(0.5)), core(p, boltD(0.5, C, C, 0.5)),
    ].join(''),
  },
  voiceWave: {
    label: 'Voice Wave',
    glyph: p => [100, 210, 150, 330, 450, 290, 370, 190, 110]
      .map((h, i) => F(p, rr(f(C + (i - 4) * 60 - 18), f(C - h / 2), 36, h, 18))).join(''),
  },
  captureRings: {
    label: 'Capture Rings',
    glyph: p => [
      S(p, circleD(C, C, 286), 22, ' stroke-opacity="0.38"'),
      S(p, circleD(C, C, 212), 26, ' stroke-opacity="0.7"'),
      F(p, rr(466, 372, 92, 176, 46)),
      S(p, 'M428 492A84 84 0 0 0 596 492', 26),
      S(p, 'M512 576V626', 26),
    ].join(''),
  },
  recordDot: {
    label: 'Record Dot',
    glyph: p => S(p, circleD(C, C, 252), 46) + F(p, circleD(C, C, 150)) + core(p, circleD(470, 470, 54), 0.5),
  },
  eqMic: {
    label: 'Equalizer Mic',
    glyph: p => [
      ...[[446, 306], [479, 252], [512, 228], [545, 252], [578, 306]].map(([x, top]) => F(p, rr(x - 13, top, 26, 540 - top, 13))),
      S(p, 'M380 470A132 132 0 0 0 644 470', 32),
      S(p, 'M512 604V690', 32),
      S(p, 'M440 708H584', 32),
    ].join(''),
  },
  pocket: {
    label: 'Pocket',
    glyph: p => [
      F(p, boltD(0.42, 560, 352)),
      core(p, boltD(0.42, 560, 352, 0.5)),
      `<path d="M300 430H724V600C724 720 640 792 512 806C384 792 300 720 300 600Z" fill="${p.bg}" stroke="${p.stroke}" stroke-width="${f(p.w(34))}" stroke-linejoin="round"/>`,
      S(p, 'M348 474H676V596C676 688 608 744 512 758C416 744 348 688 348 596Z', 12, ' stroke-opacity="0.5"'),
    ].join(''),
  },
  archive: {
    label: 'Archive',
    glyph: p => [
      S(p, rr(282, 292, 460, 116, 28), 32),
      S(p, 'M316 408V700Q316 748 364 748H660Q708 748 708 700V408', 32),
      S(p, waveD(376, 648, 586, 70, 2), 26),
    ].join(''),
  },
  voiceNote: {
    label: 'Voice Note',
    glyph: p => [
      S(p, 'M394 228H604L692 316V746Q692 794 644 794H394Q346 794 346 746V276Q346 228 394 228Z', 30),
      S(p, 'M604 236V292Q604 316 628 316H684', 22),
      S(p, waveD(404, 636, 438, 34, 2), 22),
      S(p, waveD(404, 636, 540, 48, 3), 22),
      S(p, waveD(404, 576, 642, 28, 2), 22),
    ].join(''),
  },
  listMic: {
    label: 'List Mic',
    glyph: p => [
      ...[300, 430, 560].map((y, i) => S(p, rr(296, y, 72, 72, 18), 22) + (i < 2 ? S(p, `M314 ${y + 38}L330 ${y + 54}L352 ${y + 22}`, 20) : '')),
      S(p, 'M414 336H700', 26), S(p, 'M414 466H700', 26), S(p, 'M414 596H540', 26),
      F(p, rr(618, 520, 72, 132, 36)),
      S(p, 'M586 612A68 68 0 0 0 722 612', 22),
      S(p, 'M654 680V726', 22),
    ].join(''),
  },
  placeWave: {
    label: 'Place Wave',
    glyph: p => [
      F(p, 'M512 800C512 800 368 614 368 470A144 144 0 0 1 656 470C656 614 512 800 512 800Z'),
      `<path d="${circleD(512, 468, 54)}" fill="${p.bg}"/>`,
      S(p, 'M308 384A170 170 0 0 0 308 560', 26), S(p, 'M250 330A240 240 0 0 0 250 614', 22, ' stroke-opacity="0.5"'),
      S(p, 'M716 384A170 170 0 0 1 716 560', 26), S(p, 'M774 330A240 240 0 0 1 774 614', 22, ' stroke-opacity="0.5"'),
    ].join(''),
  },
  speak: {
    label: 'Speak',
    glyph: p => [
      S(p, 'M384 262H640Q762 262 762 384V538Q762 660 640 660H470L350 770L368 660Q262 646 262 538V384Q262 262 384 262Z', 32),
      F(p, boltD(0.34, 514, 462)), core(p, boltD(0.34, 514, 462, 0.5)),
    ].join(''),
  },
  aiSpark: {
    label: 'AI Spark',
    glyph: p => [
      mic(p, 476, 236, 150, 300, { sw: 32 }),
      F(p, sparkleD(676, 292, 84)),
      F(p, sparkleD(748, 430, 36)),
    ].join(''),
  },
  paMono: {
    label: 'PA Monogram',
    glyph: p => [
      S(p, 'M300 712V312H418Q528 312 528 414Q528 516 418 516H300', 48),
      S(p, 'M552 712L648 312L744 712', 48),
      S(p, 'M584 584H712', 40),
      S(p, waveD(296, 748, 792, 22, 3), 24),
    ].join(''),
  },
};

// ── Tiles ──────────────────────────────────────────────────────────────────
const TILE_R = 228;
export const tilePath = rr(0, 0, 1024, 1024, TILE_R);

function tileDefs(tile, col) {
  const halo = tile === 'light' ? 0.26 : tile === 'amoled' ? 0.22 : 0.30;
  const base = tile === 'light'
    ? `<linearGradient id="tileBg" x1="512" y1="0" x2="512" y2="1024" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E2E8F0"/></linearGradient>`
    : tile === 'amoled'
      ? `<linearGradient id="tileBg" x1="512" y1="0" x2="512" y2="1024" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#000000"/></linearGradient>`
      : `<radialGradient id="tileBg" cx="512" cy="470" r="640" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1E2A44"/><stop offset="0.55" stop-color="#0F172A"/><stop offset="1" stop-color="#0B1222"/></radialGradient>`;
  return `${base}
    <radialGradient id="rim" cx="512" cy="512" r="724" gradientUnits="userSpaceOnUse"><stop offset="0.55" stop-color="${col.c2}" stop-opacity="0"/><stop offset="0.82" stop-color="${col.c2}" stop-opacity="0.10"/><stop offset="1" stop-color="${col.c1}" stop-opacity="0.26"/></radialGradient>
    <radialGradient id="halo" cx="512" cy="512" r="430" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${col.c2}" stop-opacity="${halo}"/><stop offset="0.6" stop-color="${col.c2}" stop-opacity="${f(halo * 0.27)}"/><stop offset="1" stop-color="${col.c2}" stop-opacity="0"/></radialGradient>`;
}
const tileBase = tile => (tile === 'light' ? '#F1F5F9' : tile === 'amoled' ? '#000000' : '#0F172A');

// ── Assembly ───────────────────────────────────────────────────────────────
function colorFor(color, tile) {
  const c = COLORS[color] || COLORS.gold;
  return tile === 'light' && c.onLight ? { ...c, ...c.onLight } : c;
}

/** Glyph markup with glow. glow: 'full' | 'small' | 'none' */
function glyphLayer(design, col, tile, glow, mono = false) {
  const d = DESIGNS[design] || DESIGNS.bolt;
  const small = glow === 'small';
  const p = {
    fill: mono ? '#FFFFFF' : 'url(#g)', stroke: mono ? '#FFFFFF' : 'url(#g)', core: col.core, bg: mono ? '#000000' : tileBase(tile),
    w: n => (small ? n * 1.6 : n), small, mono,
  };
  const body = d.glyph(p);
  if (mono || glow === 'none') return body;
  const lightTile = tile === 'light';
  const bloom = small
    ? `<g filter="url(#bloomSmall)" opacity="${lightTile ? 0.35 : 0.55}">${body}</g>`
    : `<g filter="url(#bloomWide)" opacity="${lightTile ? 0.35 : 0.6}">${body}</g><g filter="url(#bloomTight)" opacity="${lightTile ? 0.45 : 0.85}">${body}</g>`;
  return bloom + body;
}

function defs(col, tile) {
  return `
    ${tileDefs(tile, col)}
    <linearGradient id="g" x1="300" y1="220" x2="724" y2="804" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${col.c1}"/><stop offset="1" stop-color="${col.c2}"/></linearGradient>
    <filter id="bloomWide" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
    <filter id="bloomTight" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="bloomSmall" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
    <clipPath id="tileClip"><path d="${tilePath}"/></clipPath>
    <linearGradient id="red" x1="700" y1="700" x2="868" y2="868" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#F87171"/><stop offset="1" stop-color="#DC2626"/></linearGradient>`;
}

const wrap = (body, d) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs>${d}</defs>${body}</svg>`;

/** Red-dot (Quick Record) / stop-square (Stop Recording) badge, bottom right */
function badge(kind, tile) {
  const ring = tileBase(tile);
  if (kind === 'dot') return `<circle cx="784" cy="784" r="112" fill="${ring}"/><circle cx="784" cy="784" r="86" fill="url(#red)"/>`;
  if (kind === 'stop') return `<circle cx="784" cy="784" r="112" fill="#FFFFFF"/><circle cx="784" cy="784" r="86" fill="#0F172A"/><rect x="746" y="746" width="76" height="76" rx="12" fill="#FFFFFF"/>`;
  return '';
}

/**
 * One icon as SVG text (1024 × 1024).
 * The adaptive foreground draws the glyph at 2/3 scale around the center (the launcher shows the
 * middle 72 of 108 dp and keeps the 66 dp safe circle), with the badge inside the visible area.
 */
export function iconSvg({ design = 'bolt', color, tile = 'dark', small = false, layer = 'master', badgeKind = null } = {}) {
  const col = colorFor(color || DESIGNS[design]?.defaultColor || 'gold', tile);
  const d = defs(col, tile);
  const glow = small ? 'small' : 'full';
  const bgRects = `<rect width="1024" height="1024" fill="url(#tileBg)"/><rect width="1024" height="1024" fill="url(#halo)"/>${tile === 'light' ? '<rect width="1024" height="1024" fill="url(#rim)"/>' : ''}`;
  switch (layer) {
    case 'background':
      return wrap(bgRects, d);
    case 'foreground': {
      const k = 0.667; // 72 of 108 dp: same size as on the master tile
      const t = f(C * (1 - k));
      const fgBadge = badgeKind ? `<g transform="translate(${f(C * (1 - 0.62))} ${f(C * (1 - 0.62))}) scale(0.62)">${badge(badgeKind, tile)}</g>` : '';
      return wrap(`<g transform="translate(${t} ${t}) scale(${k})">${glyphLayer(design, col, tile, glow)}</g>${fgBadge}`, d);
    }
    case 'monochrome': {
      // Plain paths only: the Android vector converter scales it with a <group> itself
      return wrap(glyphLayer(design, col, tile, 'none', true), d);
    }
    case 'fullbleed': // no tile shape (iOS touch icon, PWA maskable): the glyph sits well inside the safe zone
      return wrap(`${bgRects}${glyphLayer(design, col, tile, glow)}`, d);
    case 'glyph':
      return wrap(glyphLayer(design, col, tile, 'none', true), d);
    default:
      return wrap(`<g clip-path="url(#tileClip)">${bgRects}${tile === 'light' ? '' : `<path d="${tilePath}" fill="none" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="6"/>`}${glyphLayer(design, col, tile, glow)}</g>${tile === 'light' ? `<path d="${tilePath}" fill="none" stroke="#0F172A" stroke-opacity="0.08" stroke-width="6"/>` : ''}${badge(badgeKind, tile)}`, d);
  }
}

export const DESIGN_IDS = Object.keys(DESIGNS);
export const COLOR_IDS = Object.keys(COLORS);
export const ACCENT_COLOR_IDS = COLOR_IDS.filter(c => !COLORS[c].special);
export const SPECIAL_COLOR_IDS = COLOR_IDS.filter(c => COLORS[c].special);
