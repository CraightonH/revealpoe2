#!/usr/bin/env node
// Ingest GGG's OWN processed passive-tree dataset + sprite atlases.
//
// Source of truth for the passive tree is GGG's web endpoint — the exact data
// their official tree renderer consumes — rather than the RePoE community mirror
// (which lacks the precomputed per-edge arc geometry that makes connections sweep
// instead of cross, and the web sprite atlases). RePoE stays the source for the
// rest of the wiki (gems, items, relationships); only the passive *tree* domain
// is sourced here.
//
// Writes:
//   data/source/ggg-poe2/passive-tree.json   — the tree data (nodes/edges/groups/classes)
//   data/source/ggg-poe2/atlas/<name>.json   — sprite atlas frame maps (build input)
//   public/img/passive-atlas/<name>.webp      — sprite atlas images (self-hosted, served)
//
// Idempotent + offline-friendly downstream: builds/tests read the cached files;
// only this script (run like scripts/scrape.py, on demand after a game patch)
// hits the network. Re-run to refresh after a tree change.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(root, 'data', 'source', 'ggg-poe2');
const ATLAS_DATA_DIR = path.join(DATA_DIR, 'atlas');
const ATLAS_IMG_DIR = path.join(root, 'public', 'img', 'passive-atlas');

const TREE_URL = 'https://pathofexile2.com/internal-api/content/game-passive-skill-tree';
const UA = 'revealpoe2-tree-sync/1.0 (+self-hosting official tree data)';
const TIMEOUT = 30_000;
const RETRIES = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, { json = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) {
        if (attempt < RETRIES && [429, 500, 502, 503, 504].includes(res.status)) {
          await sleep(400 * 2 ** attempt);
          continue;
        }
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return json ? res.json() : Buffer.from(await res.arrayBuffer());
    } catch (err) {
      clearTimeout(t);
      lastErr = err;
      await sleep(400 * 2 ** attempt);
    }
  }
  throw lastErr;
}

async function run() {
  await fsp.mkdir(ATLAS_DATA_DIR, { recursive: true });
  await fsp.mkdir(ATLAS_IMG_DIR, { recursive: true });

  // 1) Tree data.
  console.log('fetch-ggg-tree: downloading tree data…');
  const treeRaw = await fetchWithRetry(TREE_URL);
  await fsp.writeFile(path.join(DATA_DIR, 'passive-tree.json'), treeRaw);
  const tree = JSON.parse(treeRaw.toString('utf8'));
  const assets = tree.context?.assets ?? {};
  const d = tree.context?.data ?? {};
  console.log(
    `fetch-ggg-tree: tree data ${(treeRaw.length / 1e6).toFixed(2)}MB — ` +
    `${Object.keys(d.nodes ?? {}).length} nodes, ${(d.edges ?? []).length} edges, ` +
    `${Object.keys(d.groups ?? {}).length} groups, ${Object.keys(assets).length} atlases`,
  );

  // 2) Sprite atlases — frame map (.json) into data/source, image (.webp) into
  // public/img. The assets map gives versioned .json URLs; the .webp lives beside
  // it under the name in the atlas meta.image.
  let okImg = 0, okJson = 0;
  for (const [name, url] of Object.entries(assets)) {
    try {
      const atlas = await fetchWithRetry(url, { json: true });
      await fsp.writeFile(
        path.join(ATLAS_DATA_DIR, `${name}.json`),
        JSON.stringify(atlas),
      );
      okJson++;
      const imageName = atlas?.meta?.image;
      if (imageName) {
        // Image sits at the same directory as the .json (strip query + basename).
        const imgUrl = new URL(imageName, url.split('?')[0]).href;
        const img = await fetchWithRetry(imgUrl);
        await fsp.writeFile(path.join(ATLAS_IMG_DIR, imageName), img);
        okImg++;
      }
    } catch (err) {
      console.warn(`fetch-ggg-tree: atlas ${name} — ${err.message}`);
    }
  }
  console.log(`fetch-ggg-tree: ${okJson} atlas maps, ${okImg} atlas images synced`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error('fetch-ggg-tree failed:', err); process.exit(1); });
}

export { run };
