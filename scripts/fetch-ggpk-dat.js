#!/usr/bin/env node
// Mirror the raw PoE2 game data tables (.datc64) that RePoE does not export.
//
// A third raw-upstream fetcher alongside scripts/scrape.py (RePoE) and
// scripts/fetch-ggg-tree.js (GGG web API). Source is ggpk.exposed, which decodes
// the game's bundle system and serves every table over HTTP — so no game
// install, no Oodle/native tooling, and it always reflects the current live
// patch. See docs/ggpk-datamining.md.
//
// Writes (all gitignored under data/source/):
//   data/source/ggpk-poe2/tables/<name>.datc64  — raw mirror (English, ~1020 tables)
//   data/source/ggpk-poe2/schema.min.json        — pinned dat-schema (column names)
//   data/source/ggpk-poe2/_manifest.json         — fetch metadata
//   data/source/ggpk-poe2/CATALOG.md             — navigation map (via catalog.js)
//
// Idempotent + disk-cached: a table is re-downloaded only when its byte size
// differs from the mirror (the index API reports file_size), so re-runs after a
// patch fetch only what changed. Orphans (tables no longer upstream) are pruned.
//
// Usage:
//   npm run fetch:dat                 # mirror everything (incremental)
//   npm run fetch:dat -- --force      # re-download every table
//   npm run fetch:dat -- --dry-run    # enumerate + report, download nothing
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GGPK_DIR, TABLES_DIR, SCHEMA_PATH } from './ggpk/dat.js';
import { writeCatalog } from './ggpk/catalog.js';

const ADAPTER = 'poe2';
const DATA_PATH = 'data/balance'; // PoE2 tables live under Data/Balance, not Data/ root
const INDEX_URL = (p) =>
  `https://ggpk.exposed/files?q=index&adapter=${ADAPTER}&path=${encodeURIComponent(`poe2://${p}`)}`;
const DOWNLOAD_URL = (p) =>
  `https://ggpk.exposed/files?q=download&adapter=${ADAPTER}&path=${encodeURIComponent(`poe2://${p}`)}`;
const SCHEMA_URL =
  'https://github.com/poe-tool-dev/dat-schema/releases/latest/download/schema.min.json';

const UA = 'revealpoe2-datamine/1.0 (+self-hosting raw game tables)';
const TIMEOUT = 30_000;
const RETRIES = 4;
const CONCURRENCY = 8; // ggpk is Cloudflare-fronted + rate-limits sustained bursts

const argv = new Set(process.argv.slice(2));
const FORCE = argv.has('--force');
const DRY_RUN = argv.has('--dry-run');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, { json = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' });
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
  await fsp.mkdir(TABLES_DIR, { recursive: true });

  // 1) Enumerate the balance tables (top-level only — skip per-language dirs).
  console.log('fetch:dat: enumerating tables…');
  const index = await fetchWithRetry(INDEX_URL(DATA_PATH), { json: true });
  const tables = index.files
    .filter((f) => f.type === 'file' && f.extension === 'datc64')
    .map((f) => ({ name: f.basename, size: f.file_size, path: `${DATA_PATH}/${f.basename}` }));
  console.log(`fetch:dat: ${tables.length} tables upstream`);

  // 2) Cache gate: skip a table whose mirrored byte size matches upstream.
  const localSize = (name) => {
    try { return fs.statSync(path.join(TABLES_DIR, name)).size; } catch { return -1; }
  };
  const todo = FORCE ? tables : tables.filter((t) => localSize(t.name) !== t.size);
  console.log(
    `fetch:dat: ${todo.length} to download, ${tables.length - todo.length} cached` +
    (DRY_RUN ? ' (dry run — downloading nothing)' : ''),
  );

  if (DRY_RUN) {
    for (const t of todo.slice(0, 40)) console.log(`  would fetch ${t.name} (${t.size}B)`);
    if (todo.length > 40) console.log(`  … and ${todo.length - 40} more`);
    return;
  }

  // 3) Download (concurrency-limited workers over a shared queue).
  let done = 0, failed = 0;
  const queue = todo.slice();
  async function worker() {
    for (;;) {
      const t = queue.pop();
      if (!t) return;
      try {
        const buf = await fetchWithRetry(DOWNLOAD_URL(t.path));
        await fsp.writeFile(path.join(TABLES_DIR, t.name), buf);
        done++;
      } catch (err) {
        failed++;
        console.warn(`fetch:dat: ${t.name} — ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`fetch:dat: ${done} downloaded, ${failed} failed`);

  // 4) Prune orphans (mirrored tables no longer upstream).
  const upstream = new Set(tables.map((t) => t.name));
  let pruned = 0;
  for (const f of fs.readdirSync(TABLES_DIR)) {
    if (f.endsWith('.datc64') && !upstream.has(f)) { fs.rmSync(path.join(TABLES_DIR, f)); pruned++; }
  }
  if (pruned) console.log(`fetch:dat: pruned ${pruned} orphan tables`);

  // 5) Pin the dat-schema (column names/types).
  console.log('fetch:dat: pinning dat-schema…');
  const schema = await fetchWithRetry(SCHEMA_URL, { json: true });
  await fsp.writeFile(SCHEMA_PATH, JSON.stringify(schema));

  // 6) Manifest + catalog.
  await fsp.writeFile(
    path.join(GGPK_DIR, '_manifest.json'),
    JSON.stringify(
      {
        source: 'ggpk.exposed',
        adapter: ADAPTER,
        dataPath: DATA_PATH,
        fetchedAt: new Date().toISOString(),
        tableCount: tables.length,
        schemaVersion: schema.version ?? null,
        schemaCreatedAt: schema.createdAt ?? null,
      },
      null,
      2,
    ),
  );
  const cat = await writeCatalog();
  console.log(`fetch:dat: wrote CATALOG.md (${cat.count} tables). Explore with: npm run dat -- ls`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error('fetch:dat failed:', err); process.exit(1); });
}

export { run };
