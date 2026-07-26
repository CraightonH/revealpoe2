// test/classBanners.test.js
// The hero banners are derived art (scripts/build-class-banners.js). What matters
// and is easy to break silently:
//   - the slug -> art mapping goes through the GGG id, never the filename
//   - every generated rule points at a file that exists
//   - an ascendancy with no art produces NO rule (so no 404 and no broken banner)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const CSS = path.join(ROOT, 'public', 'generated', 'class-banners.css');
const DIR = path.join(ROOT, 'public', 'img', 'class-banners');
const planner = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'generated', 'planner-data.json'), 'utf8'));
const tree = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'generated', 'passive-tree.json'), 'utf8'));

const rules = () => {
  if (!fs.existsSync(CSS)) return null;
  return [...fs.readFileSync(CSS, 'utf8')
    .matchAll(/\.dossier-hero\[data-asc="([^"]+)"\]\{background-image:url\("([^"]+)"\)\}/g)]
    .map((m) => ({ slug: m[1], url: m[2] }));
};

test('the generated stylesheet exists (predev/build:static produce it)', () => {
  assert.ok(fs.existsSync(CSS), 'run `npm run build:banners`');
});

test('every rule points at a banner file that is actually on disk', () => {
  const r = rules();
  if (!r?.length) return; // fresh checkout without build:images — nothing to check
  for (const { slug, url } of r) {
    assert.match(url, /^\/static\/img\/class-banners\/[a-z0-9-]+\.webp$/, `${slug}: ${url}`);
    assert.ok(fs.existsSync(path.join(DIR, `${slug}.webp`)), `${slug}.webp missing on disk`);
  }
});

test('every rule slug is a real ascendancy slug', () => {
  const r = rules();
  if (!r?.length) return;
  const known = new Set(planner().classes.flatMap((c) => c.ascendancies.map((a) => a.slug)));
  for (const { slug } of r) assert.ok(known.has(slug), `${slug} is not an ascendancy slug`);
});

test('an ascendancy with no source art gets no rule, rather than a broken one', () => {
  const r = rules();
  if (!r?.length) return;
  const art = tree().meta?.ascendancyArt ?? {};
  const withRule = new Set(r.map((x) => x.slug));
  for (const c of planner().classes) {
    for (const a of c.ascendancies) {
      const hasArt = !!art[a.gggId]?.img;
      if (!hasArt) {
        assert.ok(!withRule.has(a.slug),
          `${c.name}/${a.name} has no art but got a rule — that would 404`);
      }
    }
  }
});

test('the mapping is keyed by GGG id, not by guessing the filename', () => {
  // Several ascendancies were renamed while their art kept the original name.
  // Deriving the file from the slug would silently mis-assign or drop these.
  const art = tree().meta?.ascendancyArt ?? {};
  const bySlug = new Map(planner().classes
    .flatMap((c) => c.ascendancies.map((a) => [a.slug, a.gggId])));
  const renamed = [['stormweaver', 'Stormcaller'], ['ritualist', 'Primalist'], ['spirit-walker', 'Wildspeaker']];
  for (const [slug, fileStem] of renamed) {
    const gggId = bySlug.get(slug);
    assert.ok(gggId, `${slug} is no longer an ascendancy — update this test`);
    const img = art[gggId]?.img;
    if (!img) continue;                       // art absent in this checkout
    assert.match(img, new RegExp(fileStem, 'i'),
      `${slug} should resolve to ${fileStem}* art via ${gggId}, got ${img}`);
    // …and the banner must still be written under OUR slug, not the art's name.
    const r = rules();
    if (r?.length) assert.ok(r.some((x) => x.slug === slug), `no banner rule for ${slug}`);
  }
});

test('banners are small enough to ship on a page load', () => {
  if (!fs.existsSync(DIR)) return;
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.webp'));
  if (!files.length) return;
  for (const f of files) {
    const kb = fs.statSync(path.join(DIR, f)).size / 1024;
    assert.ok(kb < 120, `${f} is ${kb.toFixed(0)} KB — the crop or quality regressed`);
  }
});
