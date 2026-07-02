// Generates the Reveal brand assets from one sigil definition:
//   public/logo/favicon.svg        scalable, transparent, green→gold gradient, ring
//   public/logo/favicon-32.png     transparent, ring
//   public/logo/favicon-16.png     transparent, NO ring (ring is illegible this small)
//   public/logo/apple-touch-icon.png  180, opaque dark bg (iOS masks its own corners)
//   public/logo/icon-192.png / icon-512.png  PWA manifest icons, opaque dark bg
//
// These are BRAND assets, not game-derived — committed to the repo (public/logo/
// is not gitignored). Re-run `node scripts/build-logo.js` only if the mark changes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'public', 'logo');

const GREEN = '#9fe86a';
const GOLD = '#e6c989';
const BG = '#0b0c0a';

// The sigil-R inside a broken abyssal ring. `stroke` is a color or url(#grad).
const sigilBody = (stroke, { ring = true } = {}) => `
  ${ring ? `<circle cx="33" cy="33" r="30" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-dasharray="4 5" opacity="0.85"/>` : ''}
  <path d="M22 47 L22 19 L38 19 Q47.5 19 47.5 28.5 Q47.5 37.5 38 37.5 L24 37.5 M37 37.5 L48 49"
    fill="none" stroke="${stroke}" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>`;

// The icon family is DESECRATED GREEN — the tab/home-screen mark stays in its
// unrevealed state; the site is where it reveals to gold.
// Transparent favicon: 66-unit viewBox.
const faviconSvg = ({ ring = true } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 66 66">${sigilBody(GREEN, { ring })}</svg>`;

// Opaque app icon: dark ground, green sigil centered with padding (100-unit box).
const appIconSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
  `<rect width="100" height="100" fill="${BG}"/>` +
  `<g transform="translate(17,17)">${sigilBody(GREEN)}</g></svg>`;

// Share-card sigil is GOLD — the revealed rest state, matching the site header.
const ogSigilSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 66 66">${sigilBody(GOLD)}</svg>`;

async function png(svg, size, file) {
  await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(path.join(OUT, file));
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'favicon.svg'), faviconSvg().trim());
  await png(faviconSvg(), 32, 'favicon-32.png');
  await png(faviconSvg({ ring: false }), 16, 'favicon-16.png');
  await png(appIconSvg(), 180, 'apple-touch-icon.png');
  await png(appIconSvg(), 192, 'icon-192.png');
  await png(appIconSvg(), 512, 'icon-512.png');
  await png(ogSigilSvg(), 48, 'og-sigil.png');
  console.log('build-logo: wrote favicon.svg + 6 PNGs →', path.relative(root, OUT));
}

run().catch((e) => { console.error('build-logo failed:', e); process.exit(1); });
