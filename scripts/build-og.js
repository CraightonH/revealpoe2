// Build step: render an OG preview card PNG for every gem/unique/base page into
// public/og/<kind>/<slug>.png. public/ is served at /static, so a card lands at
// /static/og/<kind>/<slug>.png — which the page declares via <meta og:image>.
//
// Runs as part of `build:static` (before prerender) so the cards ship in dist/.
// No network: art comes from the already-fetched public/img webps.
//
// INCREMENTAL: rendering 2500+ cards with satori+resvg is the dominant deploy
// cost (~3 min), and almost nothing changes between code-only deploys. So each
// card's inputs are hashed into public/og/_manifest.json and a card re-renders
// ONLY when its key changes. A card's PNG depends on exactly three things:
//   1. its spec (name/type/lines/colors/artPath — deterministic from the graph)
//   2. its art file's bytes (mtime+size of the webp; build:images runs first, so
//      a refreshed icon is already on disk and bumps this)
//   3. the render code + fonts (a global salt — a layout/font change busts all)
// Corrupt/missing manifest ⇒ everything treated stale ⇒ full rebuild (fail-safe,
// never serves a stale card). `--force` ignores the manifest and re-renders all.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectOgTargets } from './og/specs.js';
import { renderCard } from './og/render.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'public', 'og');
const MANIFEST = path.join(OUT, '_manifest.json');
const RENDER_JS = path.join(root, 'scripts', 'og', 'render.js');
const FONTS_DIR = path.join(root, 'public', 'fonts');
const CONCURRENCY = 8;
const FORCE = process.argv.slice(2).includes('--force');
// Bump to force-bust every card's cache after a change the salt can't see
// (e.g. a satori/resvg/sharp upgrade in package.json).
const SALT_VERSION = '1';

// Fallback card for the home page and list/index pages that have no single
// item to feature (referenced by base.njk's default og_image block).
const DEFAULT_SPEC = {
  name: 'Reveal',
  typeLine: 'Path of Exile 2',
  lines: [
    'A beginner-friendly wiki for gems, uniques, and bases',
    'Surfaces the relationships between them',
  ],
  accent: '#e6c989',
  glow: 'rgba(230,201,137,0.25)',
  artPath: null,
};

// Global salt: render logic + fonts. A change here invalidates every card.
function renderSalt() {
  const h = crypto.createHash('sha256').update(SALT_VERSION).update(fs.readFileSync(RENDER_JS));
  for (const f of fs.readdirSync(FONTS_DIR).sort()) h.update(fs.readFileSync(path.join(FONTS_DIR, f)));
  return h.digest('hex');
}

// A card's art on disk is its only non-spec, non-code input. mtime+size changes
// whenever build:images rewrites the webp; '' when there's no art.
function artStat(artPath) {
  if (!artPath) return '';
  try { const s = fs.statSync(artPath); return `${s.mtimeMs}:${s.size}`; }
  catch { return ''; }
}

// Pure: a card's identity from its three inputs. `art` is the precomputed
// art-stat string (injected so this stays testable without touching disk).
export function cacheKey(spec, salt, art) {
  return crypto.createHash('sha256')
    .update(salt).update('\0')
    .update(JSON.stringify(spec)).update('\0')
    .update(art)
    .digest('hex');
}

// Pure render plan: decide per entry render-vs-skip and rebuild the manifest
// (from desired entries only, so removed slugs drop out). No I/O — `artStatOf`
// and `exists` are injected so the decision logic is unit-testable.
export function planOg({ entries, prevManifest, salt, artStatOf, exists }) {
  const manifest = {};
  const desiredFiles = new Set();
  const todo = [];
  for (const e of entries) {
    const key = cacheKey(e.spec, salt, artStatOf(e.spec.artPath));
    manifest[e.id] = key;
    desiredFiles.add(e.file);
    if (prevManifest[e.id] !== key || !exists(e.file)) todo.push(e);
  }
  return { manifest, desiredFiles, todo };
}

async function loadManifest() {
  if (FORCE) return {};
  try { return JSON.parse(await fsp.readFile(MANIFEST, 'utf8')); }
  catch { return {}; }
}

async function run() {
  await fsp.mkdir(OUT, { recursive: true });
  const salt = renderSalt();
  const prevManifest = await loadManifest();

  // One unified work list: the default card plus every item card. `id` keys the
  // manifest; `file` is where the PNG lands.
  const entries = [
    { id: '_default', file: path.join(OUT, 'default.png'), spec: DEFAULT_SPEC },
    ...collectOgTargets().map(({ kind, slug, spec }) => ({
      id: `${kind}/${slug}`, file: path.join(OUT, kind, `${slug}.png`), spec,
    })),
  ];

  const { manifest, desiredFiles, todo } = planOg({
    entries, prevManifest, salt, artStatOf: artStat, exists: fs.existsSync,
  });

  const stats = { rendered: 0, skipped: entries.length - todo.length, pruned: 0, failed: [] };
  let cursor = 0;
  async function worker() {
    while (cursor < todo.length) {
      const e = todo[cursor++];
      try {
        const png = await renderCard(e.spec);
        await fsp.mkdir(path.dirname(e.file), { recursive: true });
        await fsp.writeFile(e.file, png);
        stats.rendered++;
      } catch (err) {
        stats.failed.push([e.id, String(err)]);
        delete manifest[e.id]; // don't record a key for a card we failed to write
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Prune orphan PNGs (slugs no longer in the graph). Walk OUT, drop any .png
  // not in the desired set; the manifest was already rebuilt from desired only.
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full); continue; }
      if (full.endsWith('.png') && !desiredFiles.has(full)) { fs.rmSync(full); stats.pruned++; }
    }
  };
  walk(OUT);

  await fsp.writeFile(MANIFEST, JSON.stringify(manifest, null, 0));

  console.log(
    `og: ${stats.rendered} rendered, ${stats.skipped} unchanged, ${stats.pruned} pruned ` +
    `(${entries.length} cards) → ${path.relative(root, OUT)}`,
  );
  if (stats.failed.length) {
    console.error(`\n${stats.failed.length} og card failures:`);
    for (const [id, why] of stats.failed.slice(0, 50)) console.error(`  ${id}  ${why}`);
    process.exitCode = 1;
  }
}

// Only render when run as a script; importing (e.g. tests) must not render cards.
if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
