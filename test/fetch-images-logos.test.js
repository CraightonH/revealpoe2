// test/fetch-images-logos.test.js — league wordmarks are downscaled on ingest.
//
// The in-game league logos are 1080x420 (~350KB) and the CDN ignores resize
// params. They render at ~40px tall in the site header on every page, so the
// fetcher shrinks them before writing to public/img/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { isLeagueLogo, LOGO_WIDTH, downscaleLogo } from '../scripts/fetch-images.js';

test('isLeagueLogo matches only the Logos directory', () => {
  assert.equal(isLeagueLogo('Art/2DArt/Logos/POELeagueLogoForbiddenRites.dds'), true);
  assert.equal(isLeagueLogo('art/2dart/logos/poeleaguelogorunesofaldur.dds'), true);
  assert.equal(isLeagueLogo('Art/2DArt/SkillIcons/Fireball.dds'), false);
  assert.equal(isLeagueLogo('Art/2DItems/Amulets/Amulet1.dds'), false);
});

// A 1080x420 transparent canvas with an opaque 720x180 "wordmark" centred in it —
// the shape of GGG's real league logos (the text sits in a sea of padding).
async function fakeWordmark(w = 1080, h = 420, textW = 720, textH = 180) {
  const text = await sharp({
    // Semi-transparent like the real glow edges, so alpha must survive the encode.
    create: { width: textW, height: textH, channels: 4, background: { r: 200, g: 180, b: 90, alpha: 0.9 } },
  }).png().toBuffer();
  return sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: text, left: (w - textW) / 2, top: (h - textH) / 2 }]).webp().toBuffer();
}

test('downscaleLogo trims transparent padding, then shrinks to LOGO_WIDTH keeping aspect and alpha', async () => {
  const big = await fakeWordmark();
  const small = await downscaleLogo(big);
  const meta = await sharp(small).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, LOGO_WIDTH);
  // Height follows the TRIMMED content box (720x180 → 4:1), not the padded canvas.
  assert.equal(meta.height, Math.round(180 * (LOGO_WIDTH / 720)));
  assert.equal(meta.hasAlpha, true);
  assert.ok(small.length < big.length);
});

test('downscaleLogo never upscales a wordmark already smaller than LOGO_WIDTH', async () => {
  const tiny = await fakeWordmark(200, 80, 100, 40);
  const meta = await sharp(await downscaleLogo(tiny)).metadata();
  assert.equal(meta.width, 100);
});
