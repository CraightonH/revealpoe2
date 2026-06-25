# Static Site & Cloudflare Pages Deployment

How the server-rendered app is compiled into a **pure static site** and deployed
to **Cloudflare Pages** on the free tier. Read this before changing the build
pipeline, adding a client-fetched endpoint, or touching search / Theory Crafting.

## Why static

The app is Express + Nunjucks, but its content is almost entirely deterministic
(it changes only when game data is re-scraped). Rendering it to static files and
serving from Pages gives us:

- **Free hosting with no compute limits** — unlimited requests/bandwidth; the
  expensive parts (15 MB graph parse, per-request render) happen at build time,
  not on the edge, so we never hit Workers' 10 ms CPU / bundle-size caps.
- **Build-time errors instead of runtime errors** — a broken internal link
  fails the prerender crawl, not a user's page load.
- **SEO + instant shareable links** — every detail page is real HTML at a clean
  URL, crawlable and edge-cached.

Only two features are genuinely dynamic — the global **search** dropdown and
**Theory Crafting** — and both are reimplemented client-side (see below).

## The build pipeline

```
npm run deploy
  └─ npm run build:static
       ├─ npm run build:graph    scripts/graph/cli.js     → build/graph.json
       ├─ npm run build:images   scripts/fetch-images.js  → public/img/*.webp
       ├─ npm run build:index    scripts/build-index.js   → public/generated/*.json
       └─ node scripts/prerender.js                       → dist/
  └─ wrangler pages deploy                                → Cloudflare Pages
```

Each stage:

1. **`build:graph`** — compiles `data/source/` into `build/graph.json` (the
   property graph the app reads). Unchanged by the static work; see CLAUDE.md
   *Data Architecture: the Graph*.
2. **`build:images`** — mirrors every `.dds` referenced by the graph (+ the
   UI-chrome paths in the CSS) from ggpk.exposed into `public/img/` as webp, so
   images ship same-origin with no runtime CDN. Idempotent and ETag-driven
   (unchanged images return 304 — re-syncs in seconds); rate-limit-aware. See
   CLAUDE.md *Icons* and `docs/image-assets.md`.
3. **`build:index`** — emits the two client artifacts (search index + browse
   cards) into `public/generated/`. See **Client artifacts**.
4. **`prerender`** — boots the real app and crawls it into `dist/`. See
   **The prerender crawler**. `copyPublic()` mirrors `public/` (including
   `img/`) into `dist/static/`, so the fetched images deploy automatically.
5. **`wrangler pages deploy`** — uploads `dist/` to Pages.

`build:index` also runs on `predev`/`prestart`, so the dev server has the same
graph + client artifacts the static build does (dev ≈ prod parity). Note
`build:images` is **not** in `predev` — run `npm run build:images` once on a
fresh checkout to populate `public/img/` for the dev server, else icons fall
back to placeholders. The full inner-loop / lifecycle guidance lives in
CLAUDE.md → **Development Workflow**.

## Why we build locally and upload (not Git-integration CI)

`data/source/` is gitignored (~250 MB, regenerable). Cloudflare's Git-integration
build would have **no source data** to build the graph from, so it cannot work.
The model is therefore: **build on the machine that has the data, upload the
prebuilt `dist/`.** `wrangler.toml` documents this; `npm run deploy` is the one
command.

## The prerender crawler (`scripts/prerender.js`)

A link crawler, not a route enumerator. It boots `createApp()` on an ephemeral
port and BFS-crawls from seed pages, writing every 200 response to `dist/` and
following the internal links it finds. This means it renders **exactly what the
site links to** — reusing 100% of the live Nunjucks render path — and a link to
a nonexistent page surfaces as a crawl **failure** (non-zero exit).

### URL discovery

Links are extracted from these attributes in each fetched page:

| Attribute | Source | Example |
|-----------|--------|---------|
| `href` | normal navigation | `/gem/spark` |
| `hx-get` | htmx fragments | (the dynamic endpoints, excluded — see below) |
| `data-card-url` | hover-card tooltips | `/gem/spark/card` |
| `data-keyword` | keyword glossary popups | key → `/api/keyword/<key>` |

`data-keyword` holds a bare key, not a URL, so the crawler builds
`/api/keyword/<encodeURIComponent(key)>` from it. Keyword popups embed nested
`.kw` spans, so re-scanning each fetched fragment discovers keywords reachable
**only** inside other popups (the crawl recurses until no new URLs appear).

### Exclusions and file mapping

- **Excluded:** `/search` and `/theorycraft/results` — the query-driven
  endpoints, now rendered client-side. They're only ever reached via `hx-get`,
  so excluding them drops them from the crawl entirely.
- **Query strings are stripped** — `/theorycraft?q=...` → the base page; the
  query is handled client-side.
- **File layout** (Pages serves `*.html` at its extensionless path):
  `/` → `dist/index.html`, `/gems` → `dist/gems.html`,
  `/gem/spark` → `dist/gem/spark.html`,
  `/gem/spark/card` → `dist/gem/spark/card.html`.
- `public/` is copied to `dist/static`; the app's styled 404 is captured as
  `dist/404.html` (Pages' fallback).

### ⚠️ Adding a new client-fetched endpoint

The crawler only finds URLs that appear in one of the attributes above. If you
add JS that fetches a server URL built some other way (a bare id, a computed
path), the crawler **will not discover it** and it will 404 on the static site —
this is exactly the bug that hit `/api/keyword/*`. When adding such a feature,
either:

1. expose the URL via a crawlable attribute (preferred), **or**
2. teach `extractLinks()` in `prerender.js` to derive it (as done for
   `data-keyword`).

A silent miss won't fail the build (nothing references it, so nothing 404s) — it
just won't be there. Verify new fetch paths against the deployed site.

## Client artifacts (`public/generated/`, gitignored)

Built by `scripts/build-index.js`:

| File | Contents | Size (raw / gzip) |
|------|----------|-------------------|
| `search-index.json` | `allDocs()` — the full-text doc set (name, slug, url, category, color, tags, req, grants, **text** haystack, icon/subtitle) | ~1.6 MB / ~0.25 MB |
| `browse-cards.json` | The real macro-rendered browse-card HTML, keyed `category → slug/id` | ~4.7 MB / ~0.28 MB |

`browse-cards.json` lets client Theory Crafting reuse the **exact** server card
HTML (no card macros ported to JS). It compresses ~15:1 (repetitive markup), so
Pages serves it brotli'd at ~0.28 MB. Card keys mirror the server's
`cardMapFor()`: `gem`/`support`/`spirit` all read the `gem` bucket; others key
by their own slug (or node id for keystones/notables).

## Shared query core (`public/js/query-core.js`)

The single source of truth for query parsing, matching, grouping, and ranking.
It's a **pure, dependency-free ES module** (no Node or DOM APIs) imported by
**both**:

- the **server** — `src/data/theorycraft.js` and `src/data/search.js` import it
  via relative path and wrap it (attaching cards / projecting search rows);
- the **browser** — served at `/static/js/query-core.js` and imported by the
  client modules.

Because both sides run the same code, **client results cannot diverge from the
server**. The 283-test suite exercises the server wrappers, which transitively
validate the core. If you change matching/ranking, change it here.

## Client-side search & Theory Crafting

On the static site there is no server at runtime, so two small modules take over:

- **`public/js/search-client.js`** (header dropdown) — loads `search-index.json`,
  ranks with the shared core, renders the same markup as
  `partials/search-results.njk`.
- **`public/js/theorycraft-client.js`** — loads both artifacts, groups with the
  shared core, renders each result by looking up `browse-cards.json` (compact
  fallback for affixes / missing), mirroring `partials/theorycraft-results.njk`.
  Reads `?q=` from the URL for deep links and writes it back via
  `history.replaceState` so any query is shareable.

### How they take over from htmx

The templates still carry the `hx-get`/`hx-trigger`/`hx-target` attributes (the
existing tests assert their presence, and they're the no-JS/dev fallback). The
client modules are `type="module"` (deferred), so they run **after DOM parse but
before htmx processes on `DOMContentLoaded`**; their top-level code strips the
`hx-*` attributes off the input, so htmx never binds and never fires a request.
Tooltips still work on the injected results because `tooltips.js` uses
`tippy.delegate('body', …)` (event-delegated — no re-init needed).

### Server routes are kept

`/search` and `/theorycraft/results` remain in `src/routes/` — they back the
test suite, dev parity, and a no-JS fallback. They are simply not prerendered
and not used by the browser on the static build.

## Free-tier limits (Cloudflare Pages)

| Limit | Free value | Current usage |
|-------|------------|---------------|
| Requests / bandwidth | unlimited | — |
| Files per deployment | 20,000 | ~5,990 |
| Max file size | 25 MiB | largest ~1.6 MB (`gems.html`) |
| Builds / month | 500 | irrelevant (we build locally) |

Things that would break "free": bundling the graph into a Worker, per-request
SSR on Workers, or per-request KV reads — the static model avoids all three.

## Operations

### First-time setup

```bash
npx wrangler login                                   # browser OAuth, once
npx wrangler pages project create poe2wiki --production-branch main
```

### Deploy

```bash
npm run deploy            # build:static + wrangler pages deploy
```

- Deploying from a non-`main` git branch creates a **preview** deployment
  (`https://<hash>.poe2wiki.pages.dev`), not production.
- Production `poe2wiki.pages.dev` updates only from the `main` branch:
  `wrangler pages deploy dist --branch main`, or merge to `main` then
  `npm run deploy`.

### Update after a game patch

```bash
python scripts/scrape.py   # refresh data/source/
npm run deploy             # rebuild graph + images + index + pages, upload
```

That's the whole content-update loop: re-scrape → rebuild → upload. `build:images`
inside `build:static` reconciles `public/img/` against the refreshed data — new
icons are fetched, re-arted icons are caught by ETag, orphans pruned — so images
stay in sync with each patch automatically. (Most images return 304, so this adds
only seconds to a normal deploy.)

### Rollback

```bash
wrangler pages deployment list --project-name poe2wiki
# Pages keeps every deployment; promote a prior one from the dashboard,
# or simply redeploy a known-good local build.
```

## Verifying a deploy

Static + JS behavior should be checked against the **deployed** site, since the
breakage modes (Pages routing, module MIME types, client rendering) don't show
up in unit tests.

- **Routing / content-types** — fetch key paths and assert status + content-type
  (detail page, `/card` fragment, `/api/keyword/*`, the two `generated/*.json`,
  the module scripts as `application/javascript`).
- **Client rendering** — drive headless Chrome:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new
  --virtual-time-budget=8000 --dump-dom "<url>/theorycraft?q=herald"` and grep
  the DOM for `tc-group-heading`. For the search dropdown (renders on input),
  use the Chrome DevTools Protocol to type into the box and read
  `#search-results`.
- **Note:** the system `curl`/`SSL_CERT_FILE` is pinned to a corporate CA bundle
  and fails TLS to Cloudflare. Use Node's `fetch` or Chrome (own TLS stacks)
  for verification, not `curl`.

## Caching headers (`_headers`)

Cloudflare Pages defaults every asset to `Cache-Control: public, max-age=0,
must-revalidate` — correct (a strong ETag is emitted, so conditional requests
get `304`) but it forces a revalidation roundtrip per asset on every page view.
The repo-root **`_headers`** file overrides this for static art and fonts;
`prerender.js`'s `copyPublic()` copies it (and `_redirects`, if present) to
`dist/_headers`, the only location Pages reads.

- It lives at the **repo root**, not `public/` — `public/` maps to `dist/static/`,
  and Pages ignores `_headers` anywhere but the deploy root.
- Art (`/static/img/*`) uses `max-age=86400, stale-while-revalidate=604800`, **not
  `immutable`**: image paths are *not* content-hashed and the fetcher rewrites art
  in place (same filename) when ggpk's ETag changes on a re-scrape, so a long
  immutable TTL would pin stale icons. The ETag still enforces correctness once
  the TTL lapses.
- Verify post-deploy with a Node `fetch` against a `/static/img/...webp` URL and
  assert the `Cache-Control` header (it can't be checked locally — Pages applies
  `_headers` at the edge).

## File map

| Path | Role |
|------|------|
| `scripts/prerender.js` | crawl the app → `dist/` |
| `_headers` | Cloudflare Pages cache policy (copied to `dist/_headers`) |
| `scripts/build-index.js` | emit `public/generated/{search-index,browse-cards}.json` |
| `public/js/query-core.js` | shared pure query engine (server + browser) |
| `public/js/search-client.js` | client search dropdown |
| `public/js/theorycraft-client.js` | client Theory Crafting results |
| `wrangler.toml` | Pages project config |
| `src/data/search.js`, `theorycraft.js` | server wrappers around the shared core |
