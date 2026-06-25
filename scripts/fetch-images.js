#!/usr/bin/env node
// Self-host game art. Reads the set of .dds asset paths the site actually
// references (from build/graph.json + the UI-chrome paths baked into the CSS),
// fetches each as webp from ggpk.exposed, and mirrors them under public/img/
// so the live site serves images same-origin with no runtime third-party CDN.
//
// Drift handling (the whole point):
//   * NEW images   -> a path in the graph that isn't on disk is downloaded.
//   * CHANGED art   -> ggpk serves nginx ETags ("{mtime}-{size}"); we store
//                      them and send If-None-Match. 304 = unchanged (skip),
//                      200 = re-arted -> re-download.
//   * REMOVED images-> on-disk files no longer referenced are pruned.
//
// Idempotent: same upstream + same graph in -> no writes out (all 304s).
// Resilient: a fetch failure keeps any existing local copy so the build still
// succeeds; only never-seen images are left to the runtime placeholder.
//
// Usage:
//   node scripts/fetch-images.js              # sync referenced images
//   node scripts/fetch-images.js --no-prune   # keep orphaned files
//   node scripts/fetch-images.js --workers 32
//   node scripts/fetch-images.js --force      # ignore ETags, re-download all

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageRelPath } from '../src/data/images.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAPH = path.join(root, 'build', 'graph.json');
const CSS_DIR = path.join(root, 'public', 'css');
const IMG_DIR = path.join(root, 'public', 'img');
const MANIFEST = path.join(IMG_DIR, '_manifest.json');
const CDN = 'https://image.ggpk.exposed/poe2';
const USER_AGENT = 'poe2wiki-image-sync/1.0 (+self-hosting referenced art)';
const TIMEOUT = 30_000;
const RETRIES = 5;
// Transient HTTP statuses worth retrying — chiefly 429 (the CDN rate-limits
// sustained load) and 5xx gateway hiccups. Genuine always-500 assets simply
// exhaust the retries and get reported.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const PRUNE = !flag('--no-prune');
const FORCE = flag('--force');
// Conservative default: the CDN is one person's free Cloudflare Worker and
// rate-limits sustained bursts. 8 keeps a full re-validation under the limit.
const WORKERS = Number(opt('--workers', '8'));

// --- discover the referenced dds-path set ---------------------------------- //

// Every string value in the graph that names a .dds asset. Walking the whole
// graph (rather than a fixed key list) guarantees we never miss a renderable
// image when a new prop is added; over-fetching a few unused paths is harmless.
function ddsFromGraph() {
  const out = new Set();
  const walk = (o) => {
    if (typeof o === 'string') { if (/\.dds$/i.test(o)) out.add(o); return; }
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === 'object') Object.values(o).forEach(walk);
  };
  walk(JSON.parse(fs.readFileSync(GRAPH, 'utf8')));
  return out;
}

// UI-chrome images are referenced from CSS as /static/img/<path>.webp; reverse
// that back to the source <path>.dds so chrome stays auto-discovered too.
function ddsFromCss() {
  const out = new Set();
  const re = /\/static\/img\/([^)?"'\s]+)\.webp/g;
  for (const f of fs.readdirSync(CSS_DIR)) {
    if (!f.endsWith('.css')) continue;
    const src = fs.readFileSync(path.join(CSS_DIR, f), 'utf8');
    for (const m of src.matchAll(re)) out.add(`${m[1]}.dds`);
  }
  return out;
}

// --- fetch with retry/timeout ---------------------------------------------- //

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Backoff with jitter, honoring Retry-After when the CDN sends it.
function backoffMs(attempt, res) {
  const ra = Number(res?.headers?.get('retry-after'));
  if (ra > 0) return ra * 1000;
  return Math.min(8000, 400 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

async function fetchWithRetry(url, headers) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(t);
      if (RETRYABLE.has(res.status) && attempt < RETRIES) {
        await sleep(backoffMs(attempt, res));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(t);
      lastErr = err;
      await sleep(backoffMs(attempt));
    }
  }
  // Reached only when every attempt threw (a retryable status is returned from
  // inside the loop on the final attempt).
  throw lastErr;
}

async function loadManifest() {
  try { return JSON.parse(await fsp.readFile(MANIFEST, 'utf8')); }
  catch { return {}; }
}

async function run() {
  if (!fs.existsSync(GRAPH)) {
    console.error('fetch-images: build/graph.json missing — run build:graph first.');
    process.exit(1);
  }

  const dds = new Set([...ddsFromGraph(), ...ddsFromCss()]);
  const manifest = FORCE ? {} : await loadManifest();
  const desiredFiles = new Set(); // relative img paths we should keep

  const stats = { fresh: 0, updated: 0, added: 0, failed: [], missing: 0 };
  const items = [...dds];
  let cursor = 0;

  async function syncOne(ddsPath) {
    const rel = imageRelPath(ddsPath);          // e.g. Art/.../Foo.webp
    desiredFiles.add(rel);
    const dest = path.join(IMG_DIR, rel);
    const onDisk = fs.existsSync(dest);
    const prev = manifest[ddsPath];

    const headers = { 'User-Agent': USER_AGENT };
    if (!FORCE && onDisk && prev?.etag) headers['If-None-Match'] = prev.etag;

    let res;
    try {
      res = await fetchWithRetry(`${CDN}/${ddsPath}?format=webp`, headers);
    } catch (err) {
      if (onDisk) { stats.failed.push([ddsPath, `kept stale: ${err.message}`]); }
      else { stats.missing++; stats.failed.push([ddsPath, `no copy: ${err.message}`]); }
      return;
    }

    if (res.status === 304) { stats.fresh++; return; }
    if (res.status !== 200) {
      if (!onDisk) stats.missing++;
      stats.failed.push([ddsPath, `HTTP ${res.status}`]);
      return;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, buf);
    manifest[ddsPath] = { etag: res.headers.get('etag') || null, bytes: buf.length };
    if (onDisk) stats.updated++; else stats.added++;
  }

  async function worker() {
    while (cursor < items.length) { await syncOne(items[cursor++]); }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker));

  // Prune on-disk images no longer referenced by the current data.
  let pruned = 0;
  if (PRUNE && fs.existsSync(IMG_DIR)) {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (e.name === '_manifest.json') continue;
        const rel = path.relative(IMG_DIR, full).split(path.sep).join('/');
        if (!desiredFiles.has(rel)) { fs.rmSync(full); delete manifest[`${rel.replace(/\.webp$/, '')}.dds`]; pruned++; }
      }
    };
    walk(IMG_DIR);
  }

  await fsp.mkdir(IMG_DIR, { recursive: true });
  await fsp.writeFile(MANIFEST, JSON.stringify(manifest, null, 0));

  console.log(
    `fetch-images: ${dds.size} referenced | ` +
    `${stats.added} added, ${stats.updated} updated, ${stats.fresh} unchanged, ` +
    `${pruned} pruned${stats.missing ? `, ${stats.missing} MISSING` : ''}`,
  );
  if (stats.failed.length) {
    console.warn(`fetch-images: ${stats.failed.length} fetch issue(s):`);
    for (const [p, why] of stats.failed.slice(0, 20)) console.warn(`  ${p} — ${why}`);
    if (stats.failed.length > 20) console.warn(`  …and ${stats.failed.length - 20} more`);
  }
}

run();
