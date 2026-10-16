// Bolt icon preview → branding/preview-bolt.png
//
//   node scripts/icons/preview-bolt.mjs
//
// 512/192/48/24 on light and dark (48/24 use the reduced-glow small icon),
// circle + squircle masks (adaptive layers, 108dp → 72dp visible), themed
// (monochrome), Quick Record, Stop Recording, notification icon, watch round
// icon, and the current mic icon side by side.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bolt = f => join(root, 'branding', 'bolt', f);
const svgData = file => `data:image/svg+xml;base64,${readFileSync(file).toString('base64')}`;
// Small sizes as bitmaps rendered at that size (like a real favicon)
const pngData = (file, size) => `data:image/png;base64,${Buffer.from(
  new Resvg(readFileSync(file, 'utf8'), { fitTo: { mode: 'width', value: size } }).render().asPng()).toString('base64')}`;

const B = {
  master: svgData(bolt('icon-master.svg')),
  bg: svgData(bolt('icon-background.svg')),
  fg: svgData(bolt('icon-foreground.svg')),
  mono: svgData(bolt('icon-monochrome.svg')),
  quick: svgData(bolt('quick-record.svg')),
  stop: svgData(bolt('stop-record.svg')),
  glyph: svgData(bolt('glyph-bolt.svg')),
  watch: svgData(bolt('watch-round.svg')),
};
const MIC = svgData(join(root, 'branding', 'icon-master.svg'));
const MIC_STOP = svgData(join(root, 'branding', 'quick-record.svg'));

let clipId = 0;
const label = (x, y, text, color = '#475569', size = 22, weight = 400, anchor = 'start') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${text}</text>`;
const img = (href, x, y, s) => `<image href="${href}" x="${x}" y="${y}" width="${s}" height="${s}"/>`;
const circle = (x, y, s) => `M${x} ${y + s / 2}A${s / 2} ${s / 2} 0 1 0 ${x + s} ${y + s / 2}A${s / 2} ${s / 2} 0 1 0 ${x} ${y + s / 2}Z`;
function superellipse(cx, cy, r, n = 4.2, steps = 96) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
    pts.push(`${(cx + r * Math.sign(c) * Math.abs(c) ** (2 / n)).toFixed(1)},${(cy + r * Math.sign(s) * Math.abs(s) ** (2 / n)).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}
function adaptive(x, y, size, layers, maskPath) {
  const id = `m${clipId++}`, big = size * 1.5, off = -size * 0.25;
  return `<clipPath id="${id}"><path d="${maskPath}"/></clipPath><g clip-path="url(#${id})">${layers.map(h => img(h, x + off, y + off, big)).join('')}</g>`;
}
function themed(x, y, size) {
  const id = `t${clipId++}`, big = size * 1.5, off = -size * 0.25;
  return `<circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}" fill="#D7E3FF"/>` +
    `<filter id="${id}"><feFlood flood-color="#1D3A6E"/><feComposite in2="SourceAlpha" operator="in"/></filter>` +
    `<image href="${B.mono}" x="${x + off}" y="${y + off}" width="${big}" height="${big}" filter="url(#${id})"/>`;
}

const W = 2000;
let body = '';
let y = 40;
body += label(40, y + 30, 'Pocket Archive — neon bolt icon (proposal)', '#0F172A', 40, 700);
y += 90;

// Sizes on light and dark
for (const [i, [bgc, fgc, name]] of [['#FFFFFF', '#475569', 'Light'], ['#0F172A', '#94A3B8', 'Dark']].entries()) {
  const px = 40 + i * 970;
  body += `<rect x="${px}" y="${y}" width="930" height="620" rx="24" fill="${bgc}" stroke="#E2E8F0"/>`;
  body += label(px + 30, y + 40, `${name} background`, fgc, 22, 600);
  let x = px + 30;
  for (const s of [512, 192, 48, 24]) {
    const href = s <= 48 ? pngData(bolt('icon-small.svg'), s) : B.master;
    body += img(href, x, y + 64, s);
    body += label(x, y + 600, `${s}px`, fgc, 20);
    x += s + 40;
  }
}
y += 660;

// Variants
const S = 176;
const cells = [
  ['Circle mask', (x, yy) => adaptive(x, yy, S, [B.bg, B.fg], circle(x, yy, S))],
  ['Squircle mask', (x, yy) => adaptive(x, yy, S, [B.bg, B.fg], superellipse(x + S / 2, yy + S / 2, S / 2))],
  ['Themed (Android 13+)', (x, yy) => themed(x, yy, S)],
  ['Quick Record', (x, yy) => img(B.quick, x, yy, S)],
  ['Stop Recording', (x, yy) => img(B.stop, x, yy, S)],
  ['Notification', (x, yy) => `<rect x="${x}" y="${yy}" width="${S}" height="${S}" rx="20" fill="#334155"/>` +
    img(B.glyph, x + S / 2 - 24, yy + 30, 48) + img(B.glyph, x + S / 2 - 12, yy + 110, 24) +
    label(x + S / 2, yy + 160, '48 · 24 dp', '#CBD5E1', 16, 400, 'middle')],
  ['Watch (round)', (x, yy) => `<circle cx="${x + S / 2}" cy="${yy + S / 2}" r="${S / 2 + 10}" fill="#000"/>` + img(B.watch, x, yy, S)],
  ['Watch tile', (x, yy) => `<circle cx="${x + S / 2}" cy="${yy + S / 2}" r="${S / 2}" fill="#000"/>` +
    `<circle cx="${x + S / 2}" cy="${yy + S / 2}" r="46" fill="#F59E0B"/>` + img(B.glyph, x + S / 2 - 26, yy + S / 2 - 26, 52)],
];
body += `<rect x="40" y="${y}" width="1920" height="290" rx="24" fill="#F1F5F9"/>`;
cells.forEach(([name, draw], i) => {
  const x = 66 + i * 236;
  body += draw(x, y + 28);
  body += label(x + S / 2, y + 28 + S + 42, name, '#334155', 19, 500, 'middle');
});
y += 330;

// Side by side with the current mic icon
body += `<rect x="40" y="${y}" width="1920" height="300" rx="24" fill="#0F172A"/>`;
body += label(70, y + 44, 'Current (mic) → New (bolt)', '#E2E8F0', 24, 600);
const pairs = [[MIC, B.master, 192], [MIC_STOP, B.quick, 120]];
let x = 70;
for (const [oldI, newI, s] of pairs) {
  body += img(oldI, x, y + 70, s);
  body += label(x + s + 26, y + 70 + s / 2 + 12, '→', '#94A3B8', 40, 400);
  body += img(newI, x + s + 70, y + 70, s);
  x += 2 * s + 170;
}
// Home-screen row mock: icon among others at 64px
const homeX = 1100;
body += label(homeX, y + 44, 'On a home screen (64 px)', '#E2E8F0', 22, 500);
for (let i = 0; i < 4; i++) {
  const ix = homeX + i * 100;
  if (i === 1) body += img(pngData(bolt('icon-small.svg'), 64), ix, y + 90, 64);
  else if (i === 2) body += img(MIC, ix, y + 90, 64);
  else body += `<rect x="${ix}" y="${y + 90}" width="64" height="64" rx="16" fill="${['#2563EB', '#16A34A', '#DB2777', '#9333EA'][i]}"/>`;
}
body += label(homeX + 100 + 32, y + 184, 'new', '#CBD5E1', 16, 400, 'middle');
body += label(homeX + 200 + 32, y + 184, 'current', '#CBD5E1', 16, 400, 'middle');
y += 340;

const H = y;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#F8FAFC"/>${body}</svg>`;
const out = join(root, 'branding', 'preview-bolt.png');
writeFileSync(out, new Resvg(sheet, { fitTo: { mode: 'original' }, font: { loadSystemFonts: true } }).render().asPng());
console.log(`icons: bolt preview → ${out} (${W}×${H})`);
