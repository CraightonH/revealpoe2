// Static prerenderer: boots the real Express app and crawls every internally
// reachable URL, writing each response to dist/ as a static file. Because it
// crawls links rather than enumerating routes, it renders exactly what the site
// links to — no orphan-miss, no dead-route render — and it reuses 100% of the
// live rendering path (same Nunjucks output users would get from the server).
//
// Dynamic, query-driven endpoints (/search, /theorycraft/results) are never
// linked with a static attribute, so they're naturally excluded here and handled
// client-side instead. See docs/deploy-cloudflare.md.
//
// Output layout (Cloudflare Pages serves *.html at its extensionless path):
//   /                  -> dist/index.html
//   /gems              -> dist/gems.html
//   /gem/spark         -> dist/gem/spark.html
//   /gem/spark/card    -> dist/gem/spark/card.html   (data-card-url fragment)

import { createApp } from '../src/server.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const DIST = path.join(root, 'dist');
const PUBLIC = path.join(root, 'public');

// Where the crawl starts. Everything else is discovered from links on these.
const SEEDS = ['/', '/gems', '/uniques', '/bases', '/keystones', '/ascendancies'];

// Attributes whose "/..." values are internal links worth following.
const LINK_ATTRS = ['href', 'hx-get', 'data-card-url'];
const ATTR_RE = new RegExp(`(?:${LINK_ATTRS.join('|')})="(/[^"]*)"`, 'g');

// Keyword tooltips are fetched lazily by keywords.js from /api/keyword/:key,
// where the key comes from a data-keyword attribute (a bare key, not a URL).
// We must mirror that endpoint into static files. Keyword popups also embed
// nested .kw spans, so re-scanning each fetched fragment (which the crawl does
// for everything it writes) discovers keywords reachable only inside popups.
const KW_RE = /data-keyword="([^"]*)"/g;
const keywordUrl = (key) => `/api/keyword/${encodeURIComponent(key)}`;

// Query-driven endpoints rendered client-side from the shipped index — never
// prerendered (their static form would be a useless empty-query shell). They're
// reached only via hx-get, so excluding them here drops them from the crawl.
const EXCLUDE = new Set(['/search', '/theorycraft/results']);

const CONCURRENCY = 16;

// Map a URL path to the file it should be written as. The last segment becomes
// "<name>.html"; earlier segments are directories. "/" is the site index.
function fileForPath(urlPath) {
  if (urlPath === '/') return path.join(DIST, 'index.html');
  const clean = urlPath.replace(/^\/+/, '').replace(/\/+$/, '');
  return path.join(DIST, `${clean}.html`);
}

// Keep only same-site, non-asset, non-dynamic links. Strips the query string
// (query-driven views are rendered client-side from the static base page).
function normalize(rawHref) {
  if (!rawHref.startsWith('/')) return null;            // external / protocol-relative
  if (rawHref.startsWith('/static/')) return null;      // assets, copied separately
  const noHash = rawHref.split('#')[0];
  const noQuery = noHash.split('?')[0];
  if (!noQuery) return null;                            // was a pure #/?-link
  if (EXCLUDE.has(noQuery)) return null;                // dynamic, client-side
  return noQuery;
}

function extractLinks(html) {
  const out = new Set();
  for (const m of html.matchAll(ATTR_RE)) {
    const n = normalize(m[1]);
    if (n) out.add(n);
  }
  for (const m of html.matchAll(KW_RE)) {
    const n = normalize(keywordUrl(m[1]));
    if (n) out.add(n);
  }
  return out;
}

async function copyPublic() {
  // The app serves public/ at /static; mirror that into dist/static.
  await fsp.cp(PUBLIC, path.join(DIST, 'static'), { recursive: true });
}

async function run() {
  if (fs.existsSync(DIST)) await fsp.rm(DIST, { recursive: true });
  await fsp.mkdir(DIST, { recursive: true });

  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const seen = new Set();
  const queue = [];
  const stats = { ok: 0, written: 0, failed: [] };
  const enqueue = (p) => { if (!seen.has(p)) { seen.add(p); queue.push(p); } };
  SEEDS.forEach(enqueue);

  async function handle(urlPath) {
    let res;
    try {
      res = await fetch(base + urlPath);
    } catch (err) {
      stats.failed.push([urlPath, String(err)]);
      return;
    }
    if (res.status !== 200) {
      stats.failed.push([urlPath, `HTTP ${res.status}`]);
      return;
    }
    stats.ok++;
    const html = await res.text();
    const file = fileForPath(urlPath);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, html);
    stats.written++;
    for (const link of extractLinks(html)) enqueue(link);
  }

  // Drain the queue with a fixed-size worker pool. New links discovered mid-run
  // are appended to the same queue, so the crawl expands until nothing is left.
  let cursor = 0;
  async function worker() {
    while (true) {
      while (cursor >= queue.length) {
        // Wait for in-flight workers to enqueue more, or finish if all idle.
        if (active === 0) return;
        await new Promise((r) => setTimeout(r, 5));
      }
      const next = queue[cursor++];
      active++;
      try { await handle(next); } finally { active--; }
    }
  }
  let active = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Capture the app's own styled 404 as Pages' fallback page.
  const notFound = await fetch(`${base}/__definitely_missing__`);
  await fsp.writeFile(path.join(DIST, '404.html'), await notFound.text());

  await copyPublic();
  server.close();

  console.log(`prerendered ${stats.written} pages (${stats.ok} ok)`);
  if (stats.failed.length) {
    console.error(`\n${stats.failed.length} failures:`);
    for (const [p, why] of stats.failed.slice(0, 50)) console.error(`  ${p}  ${why}`);
    process.exitCode = 1;
  }
}

run();
