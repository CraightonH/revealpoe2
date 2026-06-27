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

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { imageRelPath } from '../src/data/images.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAPH = path.join(root, 'build', 'graph.json');
const CSS_DIR = path.join(root, 'public', 'css');
const IMG_DIR = path.join(root, 'public', 'img');
const MANIFEST = path.join(IMG_DIR, '_manifest.json');
const CDN = 'https://image.ggpk.exposed/poe2';
// poe2db mirrors the same art tree pre-converted to webp. Used ONLY as a
// fallback for the handful of assets ggpk's webp proxy 500s on (its backend
// 302-errors on art it can't convert). Same path layout as imageRelPath.
const FALLBACK_CDN = 'https://cdn.poe2db.tw/image';
const FALLBACK_REFERER = 'https://poe2db.tw/';
const USER_AGENT = 'poe2wiki-image-sync/1.0 (+self-hosting referenced art)';

// Subdirectories of public/img managed by a DIFFERENT sync step, not this one —
// they must be excluded from the orphan prune (their files won't be in the
// GGPK-derived desired set). passive-atlas/ holds GGG's web sprite sheets, synced
// by scripts/fetch-ggg-tree.js alongside the passive-tree data they belong to.
const EXTERNAL_DIRS = new Set(['passive-atlas']);
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

// Passive-tree ascendancy illustrations have no GGG web atlas, so they ride the
// ggpk .dds→webp pipeline like node icons. The build artifact stores their
// served webp URLs in meta.ascendancyArt; reverse-map to .dds (same as CSS) so
// fetch-images self-hosts them. (Other passive art is in the GGG sprite atlases,
// synced by fetch-ggg-tree, so this is the only artifact-referenced dds source.)
function ddsFromPassiveArtifact() {
  const out = new Set();
  const p = path.join(root, 'public', 'generated', 'passive-tree.json');
  if (!fs.existsSync(p)) return out;
  const art = JSON.parse(fs.readFileSync(p, 'utf8'))?.meta?.ascendancyArt ?? {};
  for (const a of Object.values(art)) {
    const m = /^\/static\/img\/(.+)\.webp$/.exec(a?.img || '');
    if (m) out.add(`${m[1]}.dds`);
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

// Pure gate decision. The referenced set is graph/CSS-derived, so an unchanged
// set with every file already on disk means nothing can need fetching. Returns
// the referenced-set hash (stamped into the manifest) and whether to skip the
// network sync. `exists(ddsPath)` is injected so the logic is unit-testable.
export function syncGate({ dds, manifest, exists, force }) {
  const refHash = crypto.createHash('sha256').update([...dds].sort().join('\n')).digest('hex');
  const skip = !force && manifest._refHash === refHash && [...dds].every(exists);
  return { refHash, skip };
}

async function run() {
  if (!fs.existsSync(GRAPH)) {
    console.error('fetch-images: build/graph.json missing — run build:graph first.');
    process.exit(1);
  }

  const dds = new Set([...ddsFromGraph(), ...ddsFromCss(), ...ddsFromPassiveArtifact()]);
  const manifest = FORCE ? {} : await loadManifest();

  // Gate the network sync on the referenced set (the bulk of this step's cost
  // on a code-only deploy is ~3000 conditional round-trips that all 304). See
  // syncGate. Trade-off: an upstream art change with no content change won't be
  // seen until a `--force` pass. The scrape→deploy content loop always changes
  // the graph (hence always does a full pass), so that's the rare exception.
  const { refHash, skip } = syncGate({
    dds, manifest, force: FORCE,
    exists: (d) => fs.existsSync(path.join(IMG_DIR, imageRelPath(d))),
  });
  if (skip) {
    console.log(`fetch-images: ${dds.size} referenced | unchanged (graph + files on disk), skipped network sync`);
    return;
  }

  const desiredFiles = new Set(); // relative img paths we should keep

  const stats = { fresh: 0, updated: 0, added: 0, recovered: 0, failed: [], missing: 0 };
  const items = [...dds];
  let cursor = 0;

  // poe2db origin hotlink-protects on cache miss, so a Referer is required.
  // Path is per-segment encoded (spaces, apostrophes in unique names).
  async function fetchFallback(rel, etag) {
    const url = `${FALLBACK_CDN}/${rel.split('/').map(encodeURIComponent).join('/')}`;
    const headers = { 'User-Agent': USER_AGENT, Referer: FALLBACK_REFERER };
    if (!FORCE && etag) headers['If-None-Match'] = etag;
    return fetchWithRetry(url, headers);
  }

  async function syncOne(ddsPath) {
    const rel = imageRelPath(ddsPath);          // e.g. Art/.../Foo.webp
    desiredFiles.add(rel);
    const dest = path.join(IMG_DIR, rel);
    const onDisk = fs.existsSync(dest);
    const prev = manifest[ddsPath];

    const commit = async (buf, etag, source) => {
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, buf);
      manifest[ddsPath] = { etag: etag || null, bytes: buf.length, ...(source ? { source } : {}) };
      if (onDisk) stats.updated++; else stats.added++;
      if (source === 'poe2db') stats.recovered++;
    };

    // Primary: ggpk webp proxy, revalidated against our stored ETag when we
    // already hold a ggpk-sourced copy. (A poe2db-sourced ETag means ggpk was
    // failing last run — skip the conditional so a recovered ggpk serves 200.)
    let primary = 'no response';
    try {
      const headers = { 'User-Agent': USER_AGENT };
      if (!FORCE && onDisk && prev?.etag && prev.source !== 'poe2db') headers['If-None-Match'] = prev.etag;
      const res = await fetchWithRetry(`${CDN}/${ddsPath}?format=webp`, headers);
      if (res.status === 304) { stats.fresh++; return; }
      if (res.status === 200) return commit(Buffer.from(await res.arrayBuffer()), res.headers.get('etag'));
      primary = `HTTP ${res.status}`;
    } catch (err) {
      primary = err.message;
    }

    // Fallback: poe2db. Recovers assets ggpk can't convert; revalidated against
    // our stored ETag when the prior copy already came from poe2db.
    try {
      const fbEtag = onDisk && prev?.source === 'poe2db' ? prev.etag : null;
      const fb = await fetchFallback(rel, fbEtag);
      if (fb.status === 304) { stats.fresh++; return; }
      if (fb.status === 200) return commit(Buffer.from(await fb.arrayBuffer()), fb.headers.get('etag'), 'poe2db');
      if (onDisk) stats.failed.push([ddsPath, `kept stale: ggpk ${primary}, poe2db HTTP ${fb.status}`]);
      else { stats.missing++; stats.failed.push([ddsPath, `ggpk ${primary}, poe2db HTTP ${fb.status}`]); }
    } catch (err) {
      if (onDisk) stats.failed.push([ddsPath, `kept stale: ggpk ${primary}, poe2db ${err.message}`]);
      else { stats.missing++; stats.failed.push([ddsPath, `ggpk ${primary}, poe2db ${err.message}`]); }
    }
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
        // Don't descend into externally-managed dirs (synced by another step).
        if (e.isDirectory() && dir === IMG_DIR && EXTERNAL_DIRS.has(e.name)) continue;
        if (e.isDirectory()) { walk(full); continue; }
        if (e.name === '_manifest.json') continue;
        const rel = path.relative(IMG_DIR, full).split(path.sep).join('/');
        if (!desiredFiles.has(rel)) { fs.rmSync(full); delete manifest[`${rel.replace(/\.webp$/, '')}.dds`]; pruned++; }
      }
    };
    walk(IMG_DIR);
  }

  manifest._refHash = refHash; // gate marker for the next run
  await fsp.mkdir(IMG_DIR, { recursive: true });
  await fsp.writeFile(MANIFEST, JSON.stringify(manifest, null, 0));

  console.log(
    `fetch-images: ${dds.size} referenced | ` +
    `${stats.added} added, ${stats.updated} updated, ${stats.fresh} unchanged, ` +
    `${pruned} pruned${stats.recovered ? `, ${stats.recovered} via poe2db` : ''}` +
    `${stats.missing ? `, ${stats.missing} MISSING` : ''}`,
  );
  if (stats.failed.length) {
    console.warn(`fetch-images: ${stats.failed.length} fetch issue(s):`);
    for (const [p, why] of stats.failed.slice(0, 20)) console.warn(`  ${p} — ${why}`);
    if (stats.failed.length > 20) console.warn(`  …and ${stats.failed.length - 20} more`);
  }
}

// Only sync when run as a script; importing (e.g. tests) must not hit the network.
if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
