// App icon choices preview → branding/preview-icons.png
//   node scripts/icons/preview-icons.mjs
// A: all 16 designs in Gold on a dark home screen (192 / 48 / 24 px)
// B: Purple Neon Bolt on the Dark / Light / AMOLED tiles (on dark and light wallpapers)
// C: one design (Neon Bolt) in every color
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { iconSvg, DESIGNS, DESIGN_IDS, COLORS, COLOR_IDS, TILES } from './family.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const png = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
const img = (opts, size, x, y) => `<image href="data:image/png;base64,${png(iconSvg({ ...opts, small: size <= 48 }), size).toString('base64')}" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
const text = (x, y, s, { size = 20, weight = 400, color = '#E2E8F0', anchor = 'middle' } = {}) =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${s}</text>`;

const W = 2080;
let y = 0;
const parts = [];
parts.push(`<rect width="${W}" height="100%" fill="#F8FAFC"/>`);
parts.push(text(40, 64, 'Pocket Archive — app icon choices (proposal)', { size: 40, weight: 700, color: '#0F172A', anchor: 'start' }));
parts.push(text(40, 100, 'One style family: same rounded tile, neon glow (reduced at 48 px and below). Original artwork.', { size: 22, color: '#475569', anchor: 'start' }));
y = 130;

// ── A: 16 designs, Gold, dark home screen ──
const cols = 8, cellW = 250, cellH = 360;
const aH = 70 + Math.ceil(DESIGN_IDS.length / cols) * cellH;
parts.push(`<defs><linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B1020"/><stop offset="0.5" stop-color="#1E1B4B"/><stop offset="1" stop-color="#0F172A"/></linearGradient></defs>`);
parts.push(`<rect x="20" y="${y}" width="${W - 40}" height="${aH}" rx="36" fill="url(#wall)"/>`);
parts.push(text(60, y + 50, 'A · All 16 designs in Gold on a dark home screen — 192 px, 48 px, 24 px', { size: 26, weight: 600, anchor: 'start' }));
DESIGN_IDS.forEach((id, i) => {
  const cx = 60 + (i % cols) * cellW + cellW / 2 - 15;
  const top = y + 80 + Math.floor(i / cols) * cellH;
  const color = id === 'purpleBolt' ? 'neonPurple' : 'gold';
  parts.push(img({ design: id, color }, 192, cx - 96, top));
  parts.push(img({ design: id, color }, 48, cx - 64, top + 210));
  parts.push(img({ design: id, color }, 24, cx + 24, top + 222));
  parts.push(text(cx, top + 300, `${i + 1}. ${DESIGNS[id].label}`, { size: 21, weight: 600 }));
  if (id === 'purpleBolt') parts.push(text(cx, top + 326, '(Neon Purple)', { size: 17, color: '#A5B4FC' }));
});
y += aH + 30;

// ── B: Purple Neon Bolt on three tiles, dark + light wallpapers ──
const bH = 330;
parts.push(text(40, y + 30, 'B · Purple Neon Bolt (#A78BFA → #6366F1) on the three tiles', { size: 26, weight: 600, color: '#0F172A', anchor: 'start' }));
['#111827', '#E5E7EB'].forEach((wall, wi) => {
  const x0 = 20 + wi * ((W - 40) / 2 + 0);
  const bw = (W - 60) / 2;
  parts.push(`<rect x="${x0 + wi * 20}" y="${y + 50}" width="${bw}" height="${bH}" rx="30" fill="${wall}"/>`);
  Object.keys(TILES).forEach((t, ti) => {
    const cx = x0 + wi * 20 + 60 + ti * (bw - 120) / 3 + (bw - 120) / 6;
    parts.push(img({ design: 'purpleBolt', color: 'neonPurple', tile: t }, 176, cx - 88, y + 80));
    parts.push(img({ design: 'purpleBolt', color: 'neonPurple', tile: t }, 48, cx - 60, y + 272));
    parts.push(img({ design: 'purpleBolt', color: 'neonPurple', tile: t }, 24, cx + 30, y + 284));
    parts.push(text(cx, y + 350, `${TILES[t].label} tile`, { size: 20, weight: 600, color: wi ? '#0F172A' : '#E2E8F0' }));
  });
});
y += bH + 90;

// ── C: Neon Bolt in every color ──
const cH = 290;
parts.push(text(40, y + 30, 'C · Neon Bolt in every color — accents (Gold, Purple, Blue, Teal, Rose) + special editions', { size: 26, weight: 600, color: '#0F172A', anchor: 'start' }));
parts.push(`<rect x="20" y="${y + 50}" width="${W - 40}" height="${cH}" rx="30" fill="url(#wall)"/>`);
const step = (W - 80) / COLOR_IDS.length;
COLOR_IDS.forEach((c, i) => {
  const cx = 40 + step * i + step / 2;
  parts.push(img({ design: 'bolt', color: c }, 150, cx - 75, y + 80));
  parts.push(img({ design: 'bolt', color: c }, 48, cx - 24, y + 246));
  parts.push(text(cx, y + 318, COLORS[c].label, { size: 19, weight: 600 }));
  if (COLORS[c].special) parts.push(text(cx, y + 62, 'special', { size: 14, color: '#94A3B8' }));
});
y += cH + 80;

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}">${parts.join('\n')}</svg>`;
const out = join(root, 'branding', 'preview-icons.png');
writeFileSync(out, new Resvg(sheet, { fitTo: { mode: 'original' }, font: { loadSystemFonts: true } }).render().asPng());
console.log(`preview: ${out}`);
