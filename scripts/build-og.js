// Build step: render an OG preview card PNG for every gem/unique/base page into
// public/og/<kind>/<slug>.png. public/ is served at /static, so a card lands at
// /static/og/<kind>/<slug>.png — which the page declares via <meta og:image>.
//
// Runs as part of `build:static` (before prerender) so the cards ship in dist/.
// No network: art comes from the already-fetched public/img webps. Idempotent
// and concurrency-limited so it's safe to run on every deploy.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectOgTargets } from './og/specs.js';
import { renderCard } from './og/render.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'public', 'og');
const CONCURRENCY = 8;

// Fallback card for the home page and list/index pages that have no single
// item to feature (referenced by base.njk's default og_image block).
const DEFAULT_SPEC = {
  name: 'PoE2 Wiki',
  typeLine: 'Path of Exile 2',
  lines: [
    'A beginner-friendly wiki for gems, uniques, and bases',
    'Surfaces the relationships between them',
  ],
  accent: '#e6c989',
  glow: 'rgba(230,201,137,0.25)',
  artPath: null,
};

async function run() {
  await fsp.rm(OUT, { recursive: true, force: true });
  await fsp.mkdir(OUT, { recursive: true });
  await fsp.writeFile(path.join(OUT, 'default.png'), await renderCard(DEFAULT_SPEC));

  const targets = collectOgTargets();

  const stats = { written: 0, failed: [] };
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const { kind, slug, spec } = targets[cursor++];
      const file = path.join(OUT, kind, `${slug}.png`);
      try {
        const png = await renderCard(spec);
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file, png);
        stats.written++;
      } catch (err) {
        stats.failed.push([`${kind}/${slug}`, String(err)]);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`og: rendered ${stats.written} cards into ${path.relative(root, OUT)}`);
  if (stats.failed.length) {
    console.error(`\n${stats.failed.length} og card failures:`);
    for (const [id, why] of stats.failed.slice(0, 50)) console.error(`  ${id}  ${why}`);
    process.exitCode = 1;
  }
}

run();

// Guard against an accidental empty render set silently shipping no cards.
process.on('exit', () => {
  if (!fs.existsSync(OUT)) console.warn('og: no cards written — check graph build');
});
