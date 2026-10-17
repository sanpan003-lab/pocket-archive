// npm run icons — every app icon: the Purple Neon Bolt (since 1.3.0) on three selectable tiles
// (Dark = default, Light, AMOLED), drawn by scripts/icons/family.mjs. Settings → App icon switches
// between them (one launcher alias per tile). The old gold mic set in branding/ still supplies
// glyph-mic.svg for record buttons; branding/bolt (gold bolt) and branding/family (all 16 designs) are kept.
//
//   branding/icon-master.svg      gold tile + mic (web icons, legacy launcher PNGs, splash bitmaps)
//   branding/icon-background.svg  adaptive background (gold gradient + highlight)
//   branding/icon-foreground.svg  adaptive foreground (mic + waves, inside the 66dp safe zone)
//   branding/icon-monochrome.svg  themed icon (Android 13+, PWA monochrome)
//   branding/icon-fullbleed.svg   no tile shape (iOS touch icon, PWA maskable)
//   branding/quick-record.svg     + red recording dot   ·  stop-record.svg  + stop square
//   branding/glyph-mic.svg        mic only (notification icon, widget button, watch tile/complication)
//
// Bitmaps are rendered with resvg; Android vector drawables are converted from
// the same SVGs (paths, fills, round-capped strokes, linear gradients; blur
// filters are bitmap-only). To change the design: edit the SVGs (or
// scripts/icons/design.mjs → `npm run icons:design`), then `npm run icons`.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { iconSvg, DESIGN_IDS } from './family.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const M = file => readFileSync(join(root, 'branding', file), 'utf8');
const out = (rel, data) => {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};
let count = 0;

// ── Rendering ───────────────────────────────────────────────────────────────

function png(svgText, width, height = width) {
  const r = new Resvg(svgText, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } });
  const img = r.render();
  if (img.height !== height) throw new Error(`unexpected size ${img.width}×${img.height}`);
  return img.asPng();
}

/** Wrap SVG sources (as <image>s) into a new canvas; layers: [{ svg, x, y, size }] */
function compose(width, height, layers, { background = null, clipCircle = false } = {}) {
  const imgs = layers.map(l =>
    `<image href="data:image/svg+xml;base64,${Buffer.from(l.svg).toString('base64')}" x="${l.x}" y="${l.y}" width="${l.size}" height="${l.size}"/>`).join('');
  const clip = clipCircle ? `<clipPath id="c"><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 2}"/></clipPath>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${clip}</defs>` +
    `${background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : ''}` +
    `<g${clipCircle ? ' clip-path="url(#c)"' : ''}>${imgs}</g></svg>`;
}

/** Adaptive icon the way launchers draw it: 108dp layers, middle 72dp visible, circle mask */
const adaptiveRound = (bg, fg, size) =>
  compose(size, size, [bg, fg].map(svg => ({ svg, x: -size / 4, y: -size / 4, size: size * 1.5 })), { clipCircle: true });

// ── .ico (PNG-compressed entries) ───────────────────────────────────────────

function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map(p => p.data)]);
}

// ── SVG → Android VectorDrawable ────────────────────────────────────────────

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

function androidColor(hex, opacity = 1) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, '0');
  return `#${a}${h}`.toUpperCase();
}

function gradients(svgText) {
  const map = {};
  for (const m of svgText.matchAll(/<(linear|radial)Gradient([^>]*)>([\s\S]*?)<\/\1Gradient>/g)) {
    const [, type, a, inner] = m;
    const stops = [...inner.matchAll(/<stop([^>]*)\/>/g)].map(st => ({
      offset: Number(attr(st[1], 'offset')),
      color: androidColor(attr(st[1], 'stop-color'), Number(attr(st[1], 'stop-opacity') ?? 1)),
    }));
    map[attr(a, 'id')] = type === 'linear'
      ? { type, x1: attr(a, 'x1'), y1: attr(a, 'y1'), x2: attr(a, 'x2'), y2: attr(a, 'y2'), stops }
      : { type, cx: attr(a, 'cx'), cy: attr(a, 'cy'), r: attr(a, 'r'), stops };
  }
  return map;
}

const gradientXml = (name, gr) => `
        <aapt:attr name="android:${name}">
            <gradient ${gr.type === 'linear'
    ? `android:type="linear" android:startX="${gr.x1}" android:startY="${gr.y1}" android:endX="${gr.x2}" android:endY="${gr.y2}"`
    : `android:type="radial" android:centerX="${gr.cx}" android:centerY="${gr.cy}" android:gradientRadius="${gr.r}"`}>
${gr.stops.map(st => `                <item android:offset="${st.offset}" android:color="${st.color}"/>`).join('\n')}
            </gradient>
        </aapt:attr>`;

function rectPath(t) {
  const x = Number(attr(t, 'x') ?? 0), y = Number(attr(t, 'y') ?? 0);
  const w = Number(attr(t, 'width')), h = Number(attr(t, 'height'));
  const r = Number(attr(t, 'rx') ?? 0);
  if (!r) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}
const circlePath = t => {
  const cx = Number(attr(t, 'cx')), cy = Number(attr(t, 'cy')), r = Number(attr(t, 'r'));
  return `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
};

/** Converts the drawable parts of an SVG (outside <defs>/<clipPath>) to <path> elements. */
function vectorPaths(svgText, { color = null } = {}) {
  const grads = gradients(svgText);
  const body = svgText.replace(/<defs>[\s\S]*?<\/defs>/g, '').replace(/<clipPath[\s\S]*?<\/clipPath>/g, '');
  const out = [];
  for (const m of body.matchAll(/<(path|rect|circle)(\s[^>]*?)\/?>/g)) {
    const [, kind, t] = m;
    const d = kind === 'path' ? attr(t, 'd') : kind === 'rect' ? rectPath(t) : circlePath(t);
    const fill = attr(t, 'fill');
    const stroke = attr(t, 'stroke');
    if (stroke && stroke !== 'none' && attr(t, 'filter')) continue; // blurred inner shadow: bitmap only
    let xml = `    <path android:pathData="${d}"`;
    let gradient = '';
    const gradOf = v => grads[v?.match(/url\(#([^)]+)\)/)?.[1]];
    if (fill && fill !== 'none') {
      if (gradOf(fill) && !color) {
        gradient += gradientXml('fillColor', gradOf(fill));
        if (attr(t, 'fill-opacity')) xml += ` android:fillAlpha="${attr(t, 'fill-opacity')}"`;
      } else {
        xml += ` android:fillColor="${androidColor(color || fill, Number(attr(t, 'fill-opacity') ?? 1))}"`;
      }
    }
    if (stroke && stroke !== 'none') {
      if (gradOf(stroke) && !color) gradient += gradientXml('strokeColor', gradOf(stroke));
      else xml += ` android:strokeColor="${androidColor(color || stroke)}"`;
      xml += ` android:strokeWidth="${attr(t, 'stroke-width')}" android:strokeAlpha="${attr(t, 'stroke-opacity') ?? 1}"`;
      if (attr(t, 'stroke-linecap') === 'round') xml += ' android:strokeLineCap="round"';
      if (attr(t, 'stroke-linejoin') === 'round') xml += ' android:strokeLineJoin="round"';
    }
    out.push(gradient ? `${xml}>${gradient}\n    </path>` : `${xml}/>`);
  }
  return out.join('\n');
}

const vector = (paths, { dp = 108, group = null } = {}) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/icons/build.mjs (scripts/icons/family.mjs) — edit those, then: npm run icons -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="${dp}dp" android:height="${dp}dp"
    android:viewportWidth="1024" android:viewportHeight="1024">
${group ? `    <group android:pivotX="512" android:pivotY="512" android:scaleX="${group}" android:scaleY="${group}">\n${paths}\n    </group>` : paths}
</vector>
`;


// ── Sources: Purple Neon Bolt (scripts/icons/family.mjs) on three tiles ──────
// Written to branding/purple/<tile>/ for reference; everything below renders from them.

const TILE_IDS = ['dark', 'light', 'amoled'];
const DESIGN = 'purpleBolt';
const COLOR = 'neonPurple';
const SRC = {};
for (const tile of TILE_IDS) {
  const s = layer => iconSvg({ design: DESIGN, color: COLOR, tile, layer });
  SRC[tile] = {
    master: s('master'),
    small: iconSvg({ design: DESIGN, color: COLOR, tile, layer: 'master', small: true }), // ≤ 48 px: less glow
    background: s('background'),
    foreground: s('foreground'),
    quick: iconSvg({ design: DESIGN, color: COLOR, tile, layer: 'master', badgeKind: 'dot' }),
  };
  for (const [name, svg] of Object.entries(SRC[tile])) { out(`branding/purple/${tile}/${name}.svg`, svg); }
}
const monoSvg = iconSvg({ design: DESIGN, color: COLOR, layer: 'monochrome' });  // white bolt, master size
const glyphSvg = monoSvg;                                                         // same shape for notifications / watch tile
const micSvg = M('glyph-mic.svg');      // record buttons (widget, watch record screen) stay a mic
out('branding/purple/monochrome.svg', monoSvg);

// Adaptive foregrounds with a badge, kept inside the visible 72dp area
const badge = kind => kind === 'dot'
  ? '<circle cx="690" cy="690" r="78" fill="#FFFFFF"/><circle cx="690" cy="690" r="58" fill="#EF4444"/>'
  : '<circle cx="690" cy="690" r="78" fill="#FFFFFF"/><circle cx="690" cy="690" r="58" fill="#0F172A"/><rect x="664" y="664" width="52" height="52" rx="9" fill="#FFFFFF"/>';
const withBadge = (svg, kind) => svg.replace(/<\/svg>\s*$/, `${badge(kind)}</svg>`);

// Splash (Android 12+): dark tile disc + bolt, inside the 2/3 circle the system shows
const splashSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${SRC.dark.background.match(/<defs>([\s\S]*?)<\/defs>/)[1]}</defs>
  <circle cx="512" cy="512" r="336" fill="url(#tileBg)"/>
  <circle cx="512" cy="512" r="336" fill="url(#halo)"/>
</svg>`;

// ── Web / PWA (Dark is the default; the app swaps the favicon at runtime) ────

const fullbleed = t => iconSvg({ design: DESIGN, color: COLOR, tile: t, layer: 'fullbleed' }); // iOS touch icon, PWA maskable
out('public/favicon.svg', SRC.dark.master); count++;
out('public/favicon.ico', ico([16, 32, 48].map(size => ({ size, data: png(SRC.dark.small, size) })))); count++;
out('public/icons/apple-touch-icon.png', png(fullbleed('dark'), 180)); count++;
out('public/icons/icon-192.png', png(SRC.dark.master, 192)); count++;
out('public/icons/icon-512.png', png(SRC.dark.master, 512)); count++;
out('public/icons/icon-maskable-512.png', png(fullbleed('dark'), 512)); count++;
out('public/icons/icon-monochrome-512.png', png(monoSvg, 512)); count++;
out('public/icons/quick-record-192.png', png(SRC.dark.quick, 192)); count++;
for (const t of TILE_IDS) {
  out(`public/icons/favicon-${t}.svg`, SRC[t].master);
  out(`public/icons/favicon-${t}-32.png`, png(SRC[t].small, 32));
  out(`public/icons/app-icon-${t}-192.png`, png(SRC[t].master, 192));   // Settings → App icon preview
  out(`public/icons/apple-touch-icon-${t}.png`, png(fullbleed(t), 180));
  count += 4;
}

// ── Android: phone (app) + watch (wear) ─────────────────────────────────────

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
// Resource suffix per tile: Dark keeps the original names (the default launcher entries)
const SUFFIX = { dark: '', light: '_light', amoled: '_amoled' };

const adaptive = (bg, fg, mono = 'ic_launcher_monochrome') => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/${bg}"/>
    <foreground android:drawable="@drawable/${fg}"/>
    <monochrome android:drawable="@drawable/${mono}"/>
</adaptive-icon>
`;

function writeBitmaps(res, name, svg) {
  const old = join(root, `${res}/drawable/${name}.xml`);
  if (existsSync(old)) rmSync(old);
  for (const [d, k] of Object.entries(DENSITIES)) { out(`${res}/drawable-${d}/${name}.png`, png(svg, Math.round(108 * k))); count++; }
}

for (const module of ['app', 'wear']) {
  const res = `android/${module}/src/main/res`;
  const tiles = module === 'app' ? TILE_IDS : ['dark']; // the watch keeps the Dark tile
  // Foreground bitmaps (the glow is a blur, which vector drawables can't do). Dark and AMOLED
  // share one; the Light tile has its own with a softer glow.
  writeBitmaps(res, 'ic_launcher_fg', SRC.dark.foreground);
  if (module === 'app') {
    writeBitmaps(res, 'ic_quick_record_fg', withBadge(SRC.dark.foreground, 'dot'));
    writeBitmaps(res, 'ic_stop_record_fg', withBadge(SRC.dark.foreground, 'stop'));
    writeBitmaps(res, 'ic_launcher_fg_light', SRC.light.foreground);
    writeBitmaps(res, 'ic_quick_record_fg_light', withBadge(SRC.light.foreground, 'dot'));
    writeBitmaps(res, 'ic_stop_record_fg_light', withBadge(SRC.light.foreground, 'stop'));
  } else {
    writeBitmaps(res, 'ic_quick_record_fg', withBadge(SRC.dark.foreground, 'dot'));
    writeBitmaps(res, 'ic_stop_record_fg', withBadge(SRC.dark.foreground, 'stop'));
  }
  for (const t of tiles) {
    const sx = SUFFIX[t];
    const fg = t === 'light' ? '_light' : '';
    out(`${res}/drawable/ic_launcher_bg${sx}.xml`, vector(vectorPaths(SRC[t].background)));
    out(`${res}/mipmap-anydpi-v26/ic_launcher${sx}.xml`, adaptive(`ic_launcher_bg${sx}`, `ic_launcher_fg${fg}`));
    out(`${res}/mipmap-anydpi-v26/ic_launcher_round${sx}.xml`, adaptive(`ic_launcher_bg${sx}`, `ic_launcher_fg${fg}`));
    out(`${res}/mipmap-anydpi-v26/ic_quick_record${sx}.xml`, adaptive(`ic_launcher_bg${sx}`, `ic_quick_record_fg${fg}`));
    out(`${res}/mipmap-anydpi-v26/ic_stop_record${sx}.xml`, adaptive(`ic_launcher_bg${sx}`, `ic_stop_record_fg${fg}`));
    count += 5;
  }
  // Themed icon (Android 13+): the bolt silhouette, same size as the foreground
  out(`${res}/drawable/ic_launcher_monochrome.xml`, vector(vectorPaths(monoSvg), { group: 0.667 }));
  // White glyphs: bolt = notification small icon (ic_stat_mic keeps its name) + watch tile/complication;
  // mic = record buttons (widget, watch record screen)
  out(`${res}/drawable/ic_stat_mic.xml`, vector(vectorPaths(glyphSvg, { color: '#FFFFFF' }), { dp: 24, group: 1.6 }));
  out(`${res}/drawable/ic_bolt_white.xml`, vector(vectorPaths(glyphSvg, { color: '#FFFFFF' }), { dp: 24, group: 1.7 }));
  out(`${res}/drawable/ic_mic_white.xml`, vector(vectorPaths(micSvg, { color: '#FFFFFF' }), { dp: 24 }));
  count += 4;
  // Bitmaps (previews, launchers that ignore adaptive icons) — Dark
  for (const [d, k] of Object.entries(DENSITIES)) {
    const size = Math.round(48 * k);
    out(`${res}/mipmap-${d}/ic_launcher.png`, png(k <= 1 ? SRC.dark.small : SRC.dark.master, size));
    out(`${res}/mipmap-${d}/ic_launcher_round.png`, png(adaptiveRound(SRC.dark.background, SRC.dark.foreground, size), size));
    count += 2;
  }
}

// Phone only: splash icon, launcher shortcut icon, legacy splash bitmaps
const appRes = 'android/app/src/main/res';
out(`${appRes}/drawable/ic_splash.xml`, `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/icons/build.mjs — Android 12+ splash: dark disc + purple neon bolt -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@drawable/ic_splash_disc"/>
    <item android:drawable="@drawable/ic_launcher_fg"/>
</layer-list>
`);
out(`${appRes}/drawable/ic_splash_disc.xml`, vector(vectorPaths(splashSvg)));
out(`${appRes}/mipmap-anydpi-v26/shortcut_mic.xml`, adaptive('ic_launcher_bg', 'ic_launcher_fg'));
count += 3;
for (const d of ['', '-land-mdpi', '-land-hdpi', '-land-xhdpi', '-land-xxhdpi', '-land-xxxhdpi', '-port-mdpi', '-port-hdpi', '-port-xhdpi', '-port-xxhdpi', '-port-xxxhdpi']) {
  const file = join(root, `${appRes}/drawable${d}/splash.png`);
  if (!existsSync(file)) continue;
  const buf = readFileSync(file);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const s = Math.round(Math.min(w, h) * 0.34);
  out(`${appRes}/drawable${d}/splash.png`, png(compose(w, h, [{ svg: SRC.dark.master, x: (w - s) / 2, y: (h - s) / 2, size: s }], { background: '#0F172A' }), w, h));
  count++;
}

// The other designs and colors aren't shipped; their sources stay in branding/family/ for later
for (const id of DESIGN_IDS) out(`branding/family/${id}.svg`, iconSvg({ design: id, tile: 'dark' }));

console.log(`icons: generated ${count} files (Purple Neon Bolt: ${TILE_IDS.join(', ')})`);
