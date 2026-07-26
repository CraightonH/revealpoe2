// scripts/build-class-banners.js — derive the dossier hero banners from the
// ascendancy illustrations.
//
// The source art (Art/2DArt/BaseClassIllustrations/*.webp, mirrored locally by
// build:images) is a 1500x1500 CIRCULAR vignette at ~2.3 MB apiece. Cropping in
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
const BAND_TOP = 380 / 1500;      // skip the vignette's empty upper curve
const BAND_HEIGHT = 320 / 1500;   // face + upper body
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

/** ascendancy slug -> local source illustration, via the GGG id (NOT the filename). */
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
  const art = readJson(treePath).meta?.ascendancyArt ?? {};
  const out = [];
  for (const cls of readJson(plannerPath).classes ?? []) {
    for (const a of cls.ascendancies ?? []) {
      const src = localPath(art[a.gggId]?.img);
      out.push({ slug: a.slug, name: a.name, className: cls.name, gggId: a.gggId, src });
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
    if (!a.src || !fs.existsSync(a.src)) { missing.push(`${a.className}/${a.name}`); continue; }
    const out = path.join(OUT_DIR, `${a.slug}.webp`);
    const srcStat = fs.statSync(a.src);
    const fresh = fs.existsSync(out) && fs.statSync(out).mtimeMs >= srcStat.mtimeMs;
    if (fresh && !force) { made.push(a.slug); cached++; continue; }

    const meta = await sharp(a.src).metadata();
    const H = meta.height ?? 1500;
    await sharp(a.src)
      .extract({
        left: Math.round((meta.width ?? 1500) * BAND_LEFT),
        top: Math.round(H * BAND_TOP),
        width: Math.round((meta.width ?? 1500) * BAND_WIDTH),
        height: Math.round(H * BAND_HEIGHT),
      })
      .resize(OUT_W, OUT_H)
      .composite([{ input: mask, blend: 'dest-in' }])
      .webp({ quality: 72, effort: 5 })
      .toFile(out);
    made.push(a.slug);
    built++;
  }

  // Prune banners whose ascendancy no longer exists (a rename upstream).
  const keep = new Set(made.map((s) => `${s}.webp`));
  let pruned = 0;
  for (const f of fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR) : []) {
    if (f.endsWith('.webp') && !keep.has(f)) { fs.unlinkSync(path.join(OUT_DIR, f)); pruned++; }
  }

  fs.mkdirSync(GEN, { recursive: true });
  fs.writeFileSync(OUT_CSS,
    '/* GENERATED by scripts/build-class-banners.js — do not edit.\n'
    + '   One rule per ascendancy that HAS art; an uncovered ascendancy matches\n'
    + '   nothing and simply renders no banner. */\n'
    + made.sort().map((slug) =>
      `.dossier-hero[data-asc="${slug}"]{background-image:url("/static/img/class-banners/${slug}.webp")}`).join('\n')
    + '\n');

  const bytes = made.reduce((n, s) => {
    const p = path.join(OUT_DIR, `${s}.webp`);
    return n + (fs.existsSync(p) ? fs.statSync(p).size : 0);
  }, 0);
  console.log(`build-class-banners: ${made.length} banners (${built} built, ${cached} cached`
    + `${pruned ? `, ${pruned} pruned` : ''}), ${(bytes / 1024).toFixed(0)} KB total -> ${OUT_CSS.replace(ROOT + '/', '')}`);
  if (missing.length) {
    console.log(`build-class-banners: no source art for ${missing.length} ascendanc`
      + `${missing.length === 1 ? 'y' : 'ies'} — ${missing.join(', ')}`
      + ' (renders without a banner; run build:images if this is a fresh checkout)');
  }
}

await main();
