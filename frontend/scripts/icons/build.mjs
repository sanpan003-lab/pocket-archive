// npm run icons — every app icon, generated from the SVG sources in branding/.
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

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const B = file => readFileSync(join(root, 'branding', file), 'utf8');
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
  for (const m of svgText.matchAll(/<linearGradient([^>]*)>([\s\S]*?)<\/linearGradient>/g)) {
    const id = attr(m[1], 'id');
    const stops = [...m[2].matchAll(/<stop([^>]*)\/>/g)].map(s => ({
      offset: Number(attr(s[1], 'offset')),
      color: androidColor(attr(s[1], 'stop-color'), Number(attr(s[1], 'stop-opacity') ?? 1)),
    }));
    map[id] = { x1: attr(m[1], 'x1'), y1: attr(m[1], 'y1'), x2: attr(m[1], 'x2'), y2: attr(m[1], 'y2'), stops };
  }
  return map;
}

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
    if (fill && fill !== 'none') {
      const g = fill.match(/url\(#([^)]+)\)/)?.[1];
      if (g && grads[g]) {
        const gr = grads[g];
        gradient = `
        <aapt:attr name="android:fillColor">
            <gradient android:type="linear" android:startX="${gr.x1}" android:startY="${gr.y1}" android:endX="${gr.x2}" android:endY="${gr.y2}">
${gr.stops.map(s => `                <item android:offset="${s.offset}" android:color="${s.color}"/>`).join('\n')}
            </gradient>
        </aapt:attr>`;
      } else {
        xml += ` android:fillColor="${androidColor(color || fill, Number(attr(t, 'fill-opacity') ?? 1))}"`;
      }
    }
    if (stroke && stroke !== 'none') {
      xml += ` android:strokeColor="${androidColor(color || stroke)}" android:strokeWidth="${attr(t, 'stroke-width')}"`;
      xml += ` android:strokeAlpha="${attr(t, 'stroke-opacity') ?? 1}"`;
      if (attr(t, 'stroke-linecap') === 'round') xml += ' android:strokeLineCap="round"';
    }
    out.push(gradient ? `${xml}>${gradient}\n    </path>` : `${xml}/>`);
  }
  return out.join('\n');
}

const vector = (paths, { dp = 108, group = null } = {}) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/icons/build.mjs from branding/*.svg — edit those, then: npm run icons -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="${dp}dp" android:height="${dp}dp"
    android:viewportWidth="1024" android:viewportHeight="1024">
${group ? `    <group android:pivotX="512" android:pivotY="512" android:scaleX="${group}" android:scaleY="${group}">\n${paths}\n    </group>` : paths}
</vector>
`;

const adaptiveXml = (fg, mono = 'ic_launcher_monochrome') => `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_bg"/>
    <foreground android:drawable="@drawable/${fg}"/>
    <monochrome android:drawable="@drawable/${mono}"/>
</adaptive-icon>
`;

// ── Sources ─────────────────────────────────────────────────────────────────

const master = B('icon-master.svg');
const bgSvg = B('icon-background.svg');
const fgSvg = B('icon-foreground.svg');
const monoSvg = B('icon-monochrome.svg');
const fullbleed = B('icon-fullbleed.svg');
const quickSvg = B('quick-record.svg');
const stopSvg = B('stop-record.svg');
const micSvg = B('glyph-mic.svg');

// Adaptive foregrounds with a badge, kept inside the visible 72dp area
const badge = kind => kind === 'dot'
  ? '<circle cx="690" cy="690" r="78" fill="#FFFFFF"/><circle cx="690" cy="690" r="58" fill="#EF4444"/>'
  : '<circle cx="690" cy="690" r="78" fill="#FFFFFF"/><circle cx="690" cy="690" r="58" fill="#0F172A"/><rect x="664" y="664" width="52" height="52" rx="9" fill="#FFFFFF"/>';
const withBadge = (svg, kind) => svg.replace(/<\/svg>\s*$/, `  ${badge(kind)}\n</svg>\n`);
const quickFg = withBadge(fgSvg, 'dot');
const stopFg = withBadge(fgSvg, 'stop');

// Splash (Android 12+): gold disc + mic, inside the 2/3 circle the system shows
const splashSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${bgSvg.match(/<defs>([\s\S]*?)<\/defs>/)[1]}</defs>
  <circle cx="512" cy="512" r="336" fill="url(#gold)"/>
  <circle cx="512" cy="512" r="336" fill="url(#highlight)"/>
</svg>`;

// ── Web / PWA ───────────────────────────────────────────────────────────────

out('public/favicon.svg', master); count++;
out('public/favicon.ico', ico([16, 32, 48].map(size => ({ size, data: png(master, size) })))); count++;
out('public/icons/apple-touch-icon.png', png(fullbleed, 180)); count++;
out('public/icons/icon-192.png', png(master, 192)); count++;
out('public/icons/icon-512.png', png(master, 512)); count++;
out('public/icons/icon-maskable-512.png', png(fullbleed, 512)); count++;
out('public/icons/icon-monochrome-512.png', png(monoSvg, 512)); count++;
out('public/icons/quick-record-192.png', png(quickSvg, 192)); count++;

// ── Android: phone (app) + watch (wear) ─────────────────────────────────────

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

for (const module of ['app', 'wear']) {
  const res = `android/${module}/src/main/res`;
  // Vector layers
  out(`${res}/drawable/ic_launcher_bg.xml`, vector(vectorPaths(bgSvg)));
  out(`${res}/drawable/ic_launcher_fg.xml`, vector(vectorPaths(fgSvg)));
  out(`${res}/drawable/ic_launcher_monochrome.xml`, vector(vectorPaths(monoSvg)));
  out(`${res}/drawable/ic_quick_record_fg.xml`, vector(vectorPaths(quickFg)));
  out(`${res}/drawable/ic_stop_record_fg.xml`, vector(vectorPaths(stopFg)));
  // White mic glyph: notification small icon, widget button, watch tile/complication
  out(`${res}/drawable/ic_stat_mic.xml`, vector(vectorPaths(micSvg, { color: '#FFFFFF' }), { dp: 24, group: 0.86 }));
  out(`${res}/drawable/ic_mic_white.xml`, vector(vectorPaths(micSvg, { color: '#FFFFFF' }), { dp: 24 }));
  count += 7;
  // Adaptive icons
  out(`${res}/mipmap-anydpi-v26/ic_launcher.xml`, adaptiveXml('ic_launcher_fg'));
  out(`${res}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptiveXml('ic_launcher_fg'));
  out(`${res}/mipmap-anydpi-v26/ic_quick_record.xml`, adaptiveXml('ic_quick_record_fg'));
  out(`${res}/mipmap-anydpi-v26/ic_stop_record.xml`, adaptiveXml('ic_stop_record_fg'));
  count += 4;
  // Bitmaps (previews, launchers that ignore adaptive icons)
  for (const [d, k] of Object.entries(DENSITIES)) {
    const size = Math.round(48 * k);
    out(`${res}/mipmap-${d}/ic_launcher.png`, png(master, size));
    out(`${res}/mipmap-${d}/ic_launcher_round.png`, png(adaptiveRound(bgSvg, fgSvg, size), size));
    const old = join(root, `${res}/mipmap-${d}/ic_launcher_foreground.png`);
    if (existsSync(old)) rmSync(old); // replaced by the vector foreground
    count += 2;
  }
}

// Phone only: splash icon, launcher shortcut icon, legacy splash bitmaps
const appRes = 'android/app/src/main/res';
out(`${appRes}/drawable/ic_splash.xml`, `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/icons/build.mjs — Android 12+ splash: gold disc + mic -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@drawable/ic_splash_disc"/>
    <item android:drawable="@drawable/ic_launcher_fg"/>
</layer-list>
`);
out(`${appRes}/drawable/ic_splash_disc.xml`, vector(vectorPaths(splashSvg)));
out(`${appRes}/mipmap-anydpi-v26/shortcut_mic.xml`, adaptiveXml('ic_launcher_fg'));
count += 3;
for (const d of ['', '-land-mdpi', '-land-hdpi', '-land-xhdpi', '-land-xxhdpi', '-land-xxxhdpi', '-port-mdpi', '-port-hdpi', '-port-xhdpi', '-port-xxhdpi', '-port-xxxhdpi']) {
  const file = join(root, `${appRes}/drawable${d}/splash.png`);
  if (!existsSync(file)) continue;
  const buf = readFileSync(file);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const s = Math.round(Math.min(w, h) * 0.34);
  out(`${appRes}/drawable${d}/splash.png`, png(compose(w, h, [{ svg: master, x: (w - s) / 2, y: (h - s) / 2, size: s }], { background: '#0F172A' }), w, h));
  count++;
}

console.log(`icons: generated ${count} files from branding/*.svg`);
