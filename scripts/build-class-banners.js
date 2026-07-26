// scripts/build-class-banners.js — derive the dossier hero banners from the
// ascendancy illustrations.
//
// Two sources, both 1500x1500 CIRCULAR vignettes:
//   ascendancy — Art/2DArt/BaseClassIllustrations/*.webp, a plain file per art
//   class      — a 1500px tile inside the passive tree's sprite ATLAS, located
//                via that atlas's frame map (the tree renders it on canvas; here
//                we just extract the tile)
// The class figures sit higher in frame than the ascendancy ones, so each source
// gets its own band — measured across all 8 / all 22, not guessed. Cropping in
// CSS would still download the full 2.3 MB, so the crop has to happen here: one
// fixed band lands on the character's face and upper body across every
// illustration, so no per-ascendancy tuning — and therefore no hand-authored
// table — is needed.
//
//   1500x1500 @ ~2.3 MB  ->  1100x235 @ ~24 KB   (22 files: 51 MB -> 0.5 MB)
//
// Outputs (both gitignored, like the rest of public/img + public/generated):
//   public/img/class-banners/<ascendancy-slug>.webp
//   public/generated/class-banners.css   — one rule per banner that EXISTS
//
// That CSS is why the renderer needs no knowledge of which art exists: it emits
// `data-asc="<slug>"` unconditionally and an ascendancy without art simply matches
// no rule. No manifest fetch, no 404 for the uncovered case.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const GEN = path.join(ROOT, 'public', 'generated');
const IMG = path.join(ROOT, 'public', 'img');
const OUT_DIR = path.join(IMG, 'class-banners');
const OUT_CSS = path.join(GEN, 'class-banners.css');

// Crop geometry, expressed against the source's own height so art that is not
// 1500px still crops proportionally.
const ASC_BAND_TOP = 380 / 1500;    // ascendancy art: skips the empty upper curve
const CLASS_BAND_TOP = 300 / 1500;  // class art: figures sit higher; 380 decapitates Warrior
const BAND_HEIGHT = 320 / 1500;     // face + upper body
// Crop inside the circle's chord rather than fading its edges away: at this band
// the vignette spans x 115..1385, so 150..1350 contains no curved edge at all.
// Fading it in the IMAGE instead left semi-transparent dark pixels that read as
// grey haze over the light theme's pale ground.
const BAND_LEFT = 150 / 1500;
const BAND_WIDTH = 1200 / 1500;
const OUT_W = 1100;
const OUT_H = 235;

const force = process.argv.includes('--force');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/** Served /static/img/... URL -> local path under public/img. */
function localPath(servedUrl) {
  const m = /^\/static\/img\/(.+)$/.exec(servedUrl || '');
  return m ? path.join(IMG, m[1]) : null;
}

/** Soften the bottom edge so the crop line dissolves rather than reading as a seam. */
function edgeMask(w, h) {
  // Bottom only. The horizontal blend is the CSS mask's job — baking it in here
  // produced translucent dark pixels that turn to haze on a pale background.
  return Buffer.from(`<svg width="${w}" height="${h}">
    <defs>
      <linearGradient id="v" y1="0" y2="1">
        <stop offset="0" stop-color="#fff"/><stop offset="0.72" stop-color="#fff"/>
        <stop offset="1" stop-color="#3a3a3a"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#v)"/>
  </svg>`);
}

/** A class's art is a tile inside the tree's sprite atlas; resolve it to a rect. */
function classTile(entry) {
  if (!entry?.atlas || !entry?.map || !entry?.frame) return null;
  const atlas = path.join(IMG, entry.atlas.replace(/^\/static\/img\//, ''));
  const mapPath = path.join(GEN, entry.map.replace(/^\/static\/generated\//, ''));
  if (!fs.existsSync(atlas) || !fs.existsSync(mapPath)) return null;
  const rect = readJson(mapPath)?.frames?.[entry.frame]?.frame;
  return rect ? { src: atlas, rect } : null;
}

/** Everything to build, both kinds, keyed by the CSS attribute it will match. */
function sources() {
  const treePath = path.join(GEN, 'passive-tree.json');
  const plannerPath = path.join(GEN, 'planner-data.json');
  for (const p of [treePath, plannerPath]) {
    if (!fs.existsSync(p)) {
      console.log(`build-class-banners: ${path.basename(p)} missing — run build:index / build:passives first; skipping`);
      return null;
    }
  }
  // The art is keyed by GGG ascendancy id and its FILENAME does not track our
  // slug — GGG renamed several ascendancies but kept the original art name
  // (stormweaver -> Stormcaller, ritualist -> Primalist, spirit-walker ->
  // Wildspeaker). Guessing from the slug would silently mis-assign art.
  const meta = readJson(treePath).meta ?? {};
  const art = meta.ascendancyArt ?? {};
  const classArt = meta.classArt ?? {};
  const out = [];
  for (const cls of readJson(plannerPath).classes ?? []) {
    // Class banner first — it is the fallback for an ascendancy with no art, and
    // for a build that has picked a class but no ascendancy yet.
    const tile = classTile(classArt[cls.name]);
    out.push({
      kind: 'class', attr: 'data-class', slug: cls.slug, out: `class-${cls.slug}`,
      name: cls.name, className: cls.name, bandTop: CLASS_BAND_TOP,
      src: tile?.src ?? null, rect: tile?.rect ?? null,
    });
    for (const a of cls.ascendancies ?? []) {
      out.push({
        kind: 'ascendancy', attr: 'data-asc', slug: a.slug, out: a.slug,
        name: a.name, className: cls.name, bandTop: ASC_BAND_TOP,
        src: localPath(art[a.gggId]?.img), rect: null,
      });
    }
  }
  return out;
}

async function main() {
  const list = sources();
  if (!list) { fs.mkdirSync(GEN, { recursive: true }); fs.writeFileSync(OUT_CSS, '/* no data yet */\n'); return; }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const mask = edgeMask(OUT_W, OUT_H);
  const made = [];
  let built = 0; let cached = 0; const missing = [];

  for (const a of list) {
    if (!a.src || !fs.existsSync(a.src)) {
      missing.push(a.kind === 'class' ? `${a.name} (class)` : `${a.className}/${a.name}`);
      continue;
    }
    const out = path.join(OUT_DIR, `${a.out}.webp`);
    const srcStat = fs.statSync(a.src);
    const fresh = fs.existsSync(out) && fs.statSync(out).mtimeMs >= srcStat.mtimeMs;
    if (fresh && !force) { made.push(a); cached++; continue; }

    const meta = await sharp(a.src).metadata();
    // A class tile is a sub-rect of a big atlas; an ascendancy file is the whole
    // image. Normalise to one rect so the band maths is identical for both.
    const box = a.rect ?? { x: 0, y: 0, w: meta.width ?? 1500, h: meta.height ?? 1500 };
    await sharp(a.src)
      .extract({
        left: box.x + Math.round(box.w * BAND_LEFT),
        top: box.y + Math.round(box.h * a.bandTop),
        width: Math.round(box.w * BAND_WIDTH),
        height: Math.round(box.h * BAND_HEIGHT),
      })
      .resize(OUT_W, OUT_H)
      .composite([{ input: mask, blend: 'dest-in' }])
      .webp({ quality: 72, effort: 5 })
      .toFile(out);
    made.push(a);
    built++;
  }

  // Prune banners whose class/ascendancy no longer exists (a rename upstream).
  const keep = new Set(made.map((m) => `${m.out}.webp`));
  let pruned = 0;
  for (const f of fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR) : []) {
    if (f.endsWith('.webp') && !keep.has(f)) { fs.unlinkSync(path.join(OUT_DIR, f)); pruned++; }
  }

  // ORDER IS LOAD-BEARING. Both selectors have the same specificity, so the
  // later rule wins: class first, ascendancy second. That gives, for free, the
  // two behaviours we want — an ascendancy overrides its class's banner, and an
  // ascendancy with NO art (Witch/Abyssal Lich) falls back to the class banner
  // rather than showing nothing.
  const rule = (m) =>
    `.dossier-hero[${m.attr}="${m.slug}"]{background-image:url("/static/img/class-banners/${m.out}.webp")}`;
  const byKind = (k) => made.filter((m) => m.kind === k).sort((x, y) => x.slug.localeCompare(y.slug)).map(rule);
  fs.mkdirSync(GEN, { recursive: true });
  fs.writeFileSync(OUT_CSS,
    '/* GENERATED by scripts/build-class-banners.js — do not edit.\n'
    + '   One rule per class / ascendancy that HAS art. Class rules come FIRST so\n'
    + '   an ascendancy of equal specificity overrides them, and an ascendancy with\n'
    + '   no art of its own falls back to its class banner. */\n'
    + byKind('class').join('\n') + '\n'
    + byKind('ascendancy').join('\n') + '\n');

  const bytes = made.reduce((n, m) => {
    const p = path.join(OUT_DIR, `${m.out}.webp`);
    return n + (fs.existsSync(p) ? fs.statSync(p).size : 0);
  }, 0);
  const nClass = made.filter((m) => m.kind === 'class').length;
  console.log(`build-class-banners: ${made.length} banners (${nClass} class, ${made.length - nClass} ascendancy; `
    + `${built} built, ${cached} cached`
    + `${pruned ? `, ${pruned} pruned` : ''}), ${(bytes / 1024).toFixed(0)} KB total -> ${OUT_CSS.replace(ROOT + '/', '')}`);
  if (missing.length) {
    console.log(`build-class-banners: no source art for ${missing.length} — ${missing.join(', ')}`
      + ' (an ascendancy falls back to its class banner; run build:images if this is a fresh checkout)');
  }
}

await main();
