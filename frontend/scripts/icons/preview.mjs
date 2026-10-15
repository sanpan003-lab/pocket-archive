// Icon preview sheet → branding/preview.png
//
//   node scripts/icons/preview.mjs [variantDir=label ...]
//   (default: the sources in branding/)
//
// Sizes 512/192/48/24 on light and dark, Android masks (circle, squircle) using
// the adaptive layers the way launchers do (108dp layer, 72dp visible), the
// themed (monochrome) icon, the current app icon, and the Quick Record variant.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const variants = (process.argv.slice(2).length ? process.argv.slice(2) : ['branding=New icon']).map(a => {
  const [dir, label] = a.split('=');
  return { dir: join(root, dir), label: label || dir };
});

const b64 = (buf, type) => `data:${type};base64,${Buffer.from(buf).toString('base64')}`;
const svgData = file => b64(readFileSync(file), 'image/svg+xml');
const currentIcon = join(root, 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png');
const currentRound = join(root, 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png');

function superellipse(cx, cy, r, n = 4.2, steps = 96) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push(`${(cx + r * Math.sign(c) * Math.abs(c) ** (2 / n)).toFixed(1)},${(cy + r * Math.sign(s) * Math.abs(s) ** (2 / n)).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

let clipId = 0;
// Adaptive icon as a launcher draws it: layers scaled 1.5× around the center, clipped to the mask
function adaptive(x, y, size, layers, maskPath) {
  const id = `m${clipId++}`;
  const big = size * 1.5, off = -size * 0.25;
  const imgs = layers.map(href => `<image href="${href}" x="${x + off}" y="${y + off}" width="${big}" height="${big}"/>`).join('');
  return `<clipPath id="${id}"><path d="${maskPath}"/></clipPath><g clip-path="url(#${id})">${imgs}</g>`;
}
const circle = (x, y, s) => `M${x} ${y + s / 2}A${s / 2} ${s / 2} 0 1 0 ${x + s} ${y + s / 2}A${s / 2} ${s / 2} 0 1 0 ${x} ${y + s / 2}Z`;
const label = (x, y, text, color = '#475569', size = 22, weight = 400) =>
  `<text x="${x}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${text}</text>`;

const W = 2000;
const ROW = 1200;
let body = '';
let y = 40;
body += label(40, y + 30, 'Pocket Archive — app icon preview', '#0F172A', 40, 700);
y += 80;

for (const v of variants) {
  const master = svgData(join(v.dir, 'icon-master.svg'));
  const bg = svgData(join(v.dir, 'icon-background.svg'));
  const fg = svgData(join(v.dir, 'icon-foreground.svg'));
  const mono = svgData(join(v.dir, 'icon-monochrome.svg'));
  const quick = svgData(join(v.dir, 'quick-record.svg'));

  body += label(40, y + 28, v.label, '#B45309', 34, 700);
  y += 50;

  // Sizes on light and dark
  for (const [i, panel] of [['#FFFFFF', '#475569'], ['#0F172A', '#94A3B8']].entries()) {
    const px = 40 + i * 970;
    body += `<rect x="${px}" y="${y}" width="930" height="600" rx="24" fill="${panel[0]}" stroke="#E2E8F0"/>`;
    let x = px + 30;
    for (const s of [512, 192, 48, 24]) {
      body += `<image href="${master}" x="${x}" y="${y + 40}" width="${s}" height="${s}"/>`;
      body += label(x, y + 590 - 10, `${s}px`, panel[1], 20);
      x += s + 40;
    }
  }
  y += 640;

  // Masks, themed, current, Quick Record (192 each)
  const S = 192;
  const cells = [
    ['Circle mask', (x, yy) => adaptive(x, yy, S, [bg, fg], circle(x, yy, S))],
    ['Squircle mask', (x, yy) => adaptive(x, yy, S, [bg, fg], superellipse(x + S / 2, yy + S / 2, S / 2))],
    ['Themed (Android 13+)', (x, yy) => `<circle cx="${x + S / 2}" cy="${yy + S / 2}" r="${S / 2}" fill="#D7E3FF"/>` +
      `<g opacity="1">${adaptive(x, yy, S, [], circle(x, yy, S))}</g>` +
      themed(x, yy, S, mono)],
    ['Quick Record', (x, yy) => `<image href="${quick}" x="${x}" y="${yy}" width="${S}" height="${S}"/>`],
    ['Quick Record 48px', (x, yy) => `<image href="${quick}" x="${x + 72}" y="${yy + 72}" width="48" height="48"/>`],
    ['Current icon', (x, yy) => existsSync(currentIcon) ? `<image href="${b64(readFileSync(currentIcon), 'image/png')}" x="${x}" y="${yy}" width="${S}" height="${S}"/>` : ''],
    ['Current (round)', (x, yy) => existsSync(currentRound) ? `<image href="${b64(readFileSync(currentRound), 'image/png')}" x="${x}" y="${yy}" width="${S}" height="${S}"/>` : ''],
  ];
  body += `<rect x="40" y="${y}" width="1900" height="300" rx="24" fill="#F1F5F9"/>`;
  cells.forEach(([name, draw], i) => {
    const x = 70 + i * 266;
    body += draw(x, y + 30);
    body += label(x, y + 30 + S + 40, name, '#334155', 20);
  });
  y += 340;
}

// Themed icon: the monochrome glyph tinted (Material You style), adaptive scale
function themed(x, y, size, monoHref) {
  const id = `t${clipId++}`;
  const big = size * 1.5, off = -size * 0.25;
  return `<filter id="${id}"><feFlood flood-color="#1D3A6E"/><feComposite in2="SourceAlpha" operator="in"/></filter>` +
    `<image href="${monoHref}" x="${x + off}" y="${y + off}" width="${big}" height="${big}" filter="url(#${id})"/>`;
}

const H = y + 20;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#F8FAFC"/>${body}</svg>`;
const png = new Resvg(sheet, { fitTo: { mode: 'original' }, font: { loadSystemFonts: true } }).render().asPng();
const out = join(root, 'branding', 'preview.png');
writeFileSync(out, png);
console.log(`icons: preview → ${out} (${W}×${H})`);
void ROW;
