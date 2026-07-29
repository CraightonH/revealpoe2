# MCP Server over the Graph — Feasibility & Cost

Investigation (2026-07-27) into exposing `build/graph.json` as a queryable
**remote MCP server on Cloudflare**, so an LLM can traverse the graph directly
instead of scraping the prerendered site.

Status: **investigation only — nothing built.** Read this before starting the
work; the measurements and the cost model are the parts worth keeping.

## TL;DR

- **The graph is not in Cloudflare today.** Pages serves prerendered HTML plus
  *presentation projections* of the graph; the edges are flattened out of them.
  R2 holds one opaque CI tarball. Nothing queryable exists on the edge.
- **Recommended shape:** compile `graph.json` → SQLite at build time, seed it
  into **D1**, query it from a **standalone stateless Worker** speaking
  Streamable HTTP. No Durable Object, no KV.
- **Cost: $0/mo for personal use** on the free tier; $5/mo only if it goes
  public and outgrows free limits. The graph is ~4 orders of magnitude smaller
  than the tiers where Cloudflare's pricing curves start to bend.
- **The real cost is tokens, not dollars** — and that's a tool-schema design
  problem, not a hosting one. See [Token cost](#token-cost-is-the-real-cost).
- **Verified against a running Worker + local D1** — see
  [Prototype results](#prototype-results-measured). Free tier's 10 ms CPU is
  fine *provided tool results are capped*, which token cost demands anyway.
  The two constraints point the same direction.
- **The MCP can hand back a working Build Planner link with zero site changes.**
  The share code lives in the URL *fragment*, so the static prerender is
  untouched; the codec and passive-allocation modules already run unmodified in
  workerd. Verified end to end. See
  [Deliverable](#deliverable-emitting-a-build-planner-link).

## What is actually deployed today

| Surface | Contents |
|---|---|
| **Pages** (`revealpoe2`) | `dist/` — 15,443 files / 926 MB: prerendered HTML, `static/img` (172 MB), `static/generated/*.json` |
| **R2** (`revealpoe2-cache`) | one object, `cache.tar.zst` — `data/source` (397 MB) + `public/img` + `public/og`. Opaque tarball consumed by CI |

`build/graph.json` — **23 MB, 7,369 nodes, 65,973 edges** — is gitignored, built
on the CI runner by `build:graph`, consumed by `prerender.js`, and discarded. It
is in neither Pages nor the R2 tarball.

What *does* ship is `public/generated/*`: `search-index.json` (2.7 MB),
`browse-cards.json` (12 MB), `mod-pools.json` (3.2 MB), `passive-*`,
`planner-data.json`. These are render-ready flattenings — **the edges do not
survive them**. So an MCP server built against today's deployed surface would
have to scrape HTML or re-derive traversal from card blobs, which throws away
the one thing this project exists to provide (see *Data Architecture: the Graph*
in `CLAUDE.md`).

Corollary: exposing the graph requires **publishing a new artifact**, not
querying an existing one.

## Measurements

Compiled `build/graph.json` into SQLite (`nodes`, `edges`, 4 indexes, FTS5 over
name + props) to get real numbers rather than estimates:

```
nodes                     7,369      13.06 MB
edges                    65,973       8.31 MB
idx_edges_dst (dst,type)              4.26 MB
idx_edges_src (src,type)              3.93 MB
nodes_fts (FTS5)                      3.49 MB
other indexes                         0.66 MB
─────────────────────────────────────────────
total                                33.8 MB   (4.7 MB gzipped)
```

Traversal shape:

- **avg outdegree 17.9, max 940** — one pathological fan-out (a heavily-tagged
  node), everything else is small.
- `EXPLAIN QUERY PLAN` on the core traversal confirms index use:
  `SEARCH edges USING INDEX idx_edges_src (src=? AND type=?)`.
- Reverse traversal (`edgesTo`) is symmetric via `idx_edges_dst`.

Node payload sizes (this drives token cost, see below):

| | bytes |
|---|---|
| p50 | 995 |
| p95 | 7,219 |
| max | 20,234 (`skill:Flame Wall`) |

Reproduce with `node --input-type=module` against `build/graph.json`; the schema
used was:

```sql
CREATE TABLE nodes(id TEXT PRIMARY KEY, kind TEXT, name TEXT, slug TEXT, source TEXT, props TEXT);
CREATE TABLE edges(type TEXT, src TEXT, dst TEXT, source TEXT, props TEXT);
CREATE INDEX idx_edges_src ON edges(src, type);
CREATE INDEX idx_edges_dst ON edges(dst, type);
CREATE INDEX idx_nodes_kind ON nodes(kind);
CREATE UNIQUE INDEX idx_nodes_slug ON nodes(kind, slug);
CREATE VIRTUAL TABLE nodes_fts USING fts5(name, body, content='');
```

`props` stays JSON TEXT — the graph's node props are heterogeneous by `kind`,
and D1 caps tables at 100 columns. SQLite's `json_extract` handles the rare
case where you need to filter inside props.

## Prototype results (measured)

A throwaway Worker was built against a **local D1 loaded with the full graph**
(7,369 nodes / 65,973 edges confirmed in D1) and driven through realistic MCP
tool shapes via `wrangler dev`. Worst-case fan-out is
`Affix/corrupted/LocalAttributeRequirements` — **940 `rolls_on` edges**.

| Tool call | rows | worker ms | D1 rows read | payload | ~tokens |
|---|---|---|---|---|---|
| `get_node` (projected) | 1 | 0 | — | <1 KB | ~100 |
| `get_node` (props expanded, 20 KB node) | 1 | 1 | — | 20 KB | ~5,000 |
| `neighbors` gem→supports, projected | 17 | 0 | 35 | 2.5 KB | **651** |
| `neighbors` gem→supports, **expanded** | 17 | 0 | 35 | 19.3 KB | **4,934** |
| `neighbors` worst fan-out, projected | 940 | 2 | 1,881 | 134 KB | ~34,000 |
| `neighbors` worst fan-out, **expanded** | 940 | **10** | 1,881 | **1.27 MB** | **~318,000** |
| `neighbors` worst fan-out, `limit=25` | 25 | 0 | 50 | 4.3 KB | ~1,100 |
| two-hop recursive CTE | 17 | 0 | 86 | <1 KB | ~45 |
| search via `LIKE '%q%'` | 50 | 1 | **6,971** | <1 KB | ~43 |
| search via **FTS5 `MATCH`** | 42 | 0 | **84** | <1 KB | ~42 |

### What this settles

1. **CPU is a non-issue if results are capped.** Every projected query landed at
   0–2 ms. The *only* case that reached 10 ms was expanding props across a
   940-row traversal — and that case is unusable for token reasons regardless.
   Cap traversal results and CPU never becomes the binding constraint.
2. **FTS5 is worth ~83× on D1's billed metric.** `LIKE '%flame%'` full-scans
   **6,971 rows** to return 50; the FTS5 index returns equivalent results
   reading **84**. Same latency locally, but on free tier's 5 M rows/day that's
   the difference between ~700 and ~60,000 searches. Build the FTS table.
3. **Props expansion is a 7.6× token multiplier even on small results** (651 →
   4,934 tokens for 17 rows) and a context-destroying 318k tokens on the worst
   case. `expand` must be opt-in and must not be combinable with an uncapped
   traversal.
4. **FTS5 works in D1** and populates in 58 ms via `INSERT..SELECT`.
5. Node id shapes are inconsistent in the source — both
   `Metadata/Items/Gem/…` and `Metadata/Items/Gems/…` (plural) exist. The first
   two-hop probe silently returned 0 rows from guessing the wrong one. Tools
   must resolve by `(kind, slug)`, not by hand-built ids.

### Caveats on these numbers

- **`worker ms` is not billable CPU-ms.** It is `performance.now()` inside
  local `wrangler dev`, on an Apple-silicon core, against **local SQLite rather
  than a real D1 network hop**. It over-counts by including I/O wait and
  under-counts by using a faster CPU than a CF edge core.
- Real D1 queries are **I/O, which Workers does not bill as CPU** — so the
  billable figure for the projected cases is *lower* than shown. The expanded
  case is dominated by `JSON.parse` × 940 + serializing 1.27 MB, which is
  genuine CPU and would be *worse* on an edge core.
- The authoritative number requires a deployed Worker with
  `observability.enabled` and reading CPU-ms from Workers Logs. Not done —
  would create real Cloudflare resources.

Reproduce: the probe Worker and its bench script were scratch-only (not
committed). Rebuild by compiling `build/graph.json` to SQLite with the schema
above, `sqlite3 … .dump > graph.sql`,
`wrangler d1 execute <db> --local --file graph.sql`, then a Worker exposing
`/node`, `/neighbors`, `/twohop`, `/search`, `/fts`.

## Storage options considered

| Option | Verdict | Why |
|---|---|---|
| **D1** | ✅ **recommended** | 33.8 MB vs **500 MB free / 10 GB paid** per-database limit. Real SQL: joins, recursive CTEs for multi-hop, FTS5 for stat-text search. Read replication available on paid |
| **Worker Static Assets** (sharded JSON) | viable, cheapest | "*Requests to static assets are free and unlimited.*" 100k files/version (paid) / 20k (free), 25 MiB per file. But **every query shape must be precomputed at build time** — no ad-hoc traversal, which is most of the value |
| **KV** | ❌ | point reads only, no traversal. 10 M reads/mo included then $0.50/M — strictly worse than D1 at this size |
| **R2** | ❌ | can store the 23 MB blob, but a Worker cannot parse it: **128 MB isolate ceiling** and a 23 MB JSON parses well past that. Range-reads would need a hand-rolled index — i.e. reimplementing D1 |
| **Durable Object + SQLite** | ❌ | stateful, single-instance, adds duration billing (`400,000 GB-s/mo` then `$12.50/M GB-s`). Pointless for a read-only artifact rebuilt weekly |

## Recommended architecture

```
graph.json ──build:sqlite──► graph.sql ──d1 execute --file──► D1
                                                               │
                                mcp.revealpoe2.com (Worker) ───┘
                                stateless createMcpHandler()
                                Streamable HTTP
```

Note there is **no `wrangler d1 import`** subcommand (as of wrangler 4.105);
seeding is `wrangler d1 execute <db> --remote --file dump.sql`, so the build
step must emit **SQL**, not a `.sqlite` file.

**1. `build:sqlite` build step.** Compile `build/graph.json` → `build/graph.sqlite`.
Deterministic, same inputs as `build:graph`, so it inherits `meta.sourceHash`.

**2. Seed D1 from `refresh-data.yml` only — never `deploy.yml`.** The graph is
immutable per deploy, so "migration" is a full re-import, not incremental schema
work. Putting it in `refresh-data.yml` mirrors the split the pipeline already
has (game data changes weekly / on patch; code changes on every push) and dodges
the one genuine free-tier trap: **74k rows written per re-import** against a
**100,000 rows/day** free allowance. Weekly is fine; per-push is not.

**2a. Build derived tables *in the database*, not in the dump.** Measured: the
73,342-statement base dump took **2m10s** to import into local D1, but
populating the FTS5 index took **58 ms** as a single
`INSERT INTO nodes_fts SELECT … FROM nodes`. Ship only the two base tables as
INSERTs; emit indexes and FTS as DDL + one `INSERT..SELECT` each. Keeps both
import wall-clock and D1 rows-written down.

**3. Standalone Worker, not Pages Functions.** Pages stays a pure static upload.
Introducing compute into the deploy target whose entire value proposition is
that it has none would be a regression. Custom domain on the existing
`revealpoe2.com` zone is free; `workers.dev` works for development.

**4. Stateless transport.** Use `createMcpHandler()` over **Streamable HTTP**.
Cloudflare marks `McpAgent` (the Durable-Object-backed stateful path) as
deprecated and recommends the stateless handler for new servers. No DO binding,
no KV — KV only enters if OAuth is added later.

**5. Extend the staleness guard to D1.** There would now be two derived copies
of the graph (Pages projections + D1) that can drift independently. Store
`meta.sourceHash` / `meta.manualHash` in a D1 `meta` table and have the MCP
report it, so a stale D1 is detectable the same way a stale `graph.json` is
(see the boot-time guard in `src/data/graph.js`).

## Cost

Rates verified against Cloudflare docs 2026-07-27.

### If it goes public (Workers Paid)

| Line | Rate | This workload |
|---|---|---|
| Workers Paid base | **$5/mo** — 10 M requests + 30 M CPU-ms included | overage $0.30/M req, $0.02/M CPU-ms |
| D1 storage | first 5 GB included, then $0.75/GB-mo | 33.8 MB → **free** |
| D1 rows read | first **25 billion**/mo included, then $0.001/M | 1 M tool calls × 500 rows = 500 M → **free** |
| D1 rows written | first 50 M/mo included, then $1.00/M | 74k × ~5 re-imports/mo = 370k → **free** |
| Egress | free | — |
| R2 (unchanged) | $0.015/GB-mo, 10 GB free | ~570 MB → **free** |

**Total: $5/mo**, entirely the Workers Paid base fee. Zero marginal cost from
the graph itself — it would take ~50× the current node count and ~50,000× the
current traffic before any usage-based line item becomes non-zero.

### If you are the sole user (Workers Free) — **$0/mo**

Yes, genuinely free, and not marginally so:

| Free-tier limit | Headroom for one user |
|---|---|
| Workers: **100,000 requests/day** | a heavy day of agent use is hundreds, maybe low thousands |
| D1: **5 M rows read/day** | at avg outdegree 17.9, that's ~250k+ traversals/day |
| D1: **100,000 rows written/day** | one 74k-row re-import/day — matches the weekly refresh cadence with room to spare |
| D1: **500 MB per database** (free) | 33.8 MB → 6.8% used |
| D1: **10 databases** (free) | need 1 |

**The one free-tier constraint that could bite is CPU: 10 ms per invocation**
(paid gets 30 s default / 5 min max). This was tested — see
[Prototype results](#prototype-results-measured). Every projected query came in
at 0–2 ms; only expanding props across the 940-row worst case reached 10 ms, and
that response is 1.27 MB / ~318k tokens, i.e. already disqualified on token
grounds. **Cap traversal results in the tool schema and free tier holds.**

Caveat: that measurement is local `wrangler dev` wall-clock, not billable
CPU-ms (see the caveats in that section). The projected cases have enough
headroom that the distinction doesn't change the conclusion; if a future tool
does heavy per-row JS, re-measure on a deployed Worker with
`observability.enabled` before assuming free tier still fits.

Other free-tier things you give up, none of which matter here: read replicas,
the Sessions API, and 30-day Time Travel (free gets 7).

## Token cost is the real cost

Hosting is a rounding error. The cost that scales is **tokens**, paid by the
consuming model, and it is determined entirely by tool-schema design:

- A naive `get_node("Flame Wall")` returns **20 KB ≈ 5k tokens** for a single
  call (measured). p95 is 7.2 KB. Dumping whole nodes makes the server expensive
  to use even though it is free to run.
- **Measured multiplier for `expand`: 7.6×** on a 17-row result (651 → 4,934
  tokens), and **~318,000 tokens** on the 940-row worst case — larger than most
  context windows, from one tool call.
- **Project fields explicitly.** Make `props` expansion opt-in, cap traversal
  result counts, return ids + names by default and full payloads only on
  request. Do not allow `expand` together with an uncapped traversal.
- Prefer a few relationship-shaped tools (`neighbors(id, type)`,
  `supports_for(gem)`) over one generic `query(sql)` — narrower results, and it
  keeps the graph's semantics in the server instead of in the model's head.

## Deliverable: emitting a Build Planner link

The most useful thing an MCP investigation can hand back is not prose — it's a
**working build link**. Since the site is a static prerender, the instinct is
that this needs new server infrastructure. **It does not.** The mechanism
already exists and requires zero changes to the site.

### Why it needs nothing

The planner's share link is `https://revealpoe2.com/builds#/import/<code>`
(built in `public/js/build-editor.js`, parsed in `public/js/builds-render.js`).
The build travels in the **URL fragment**, which:

- **never reaches the server** — Cloudflare sees a request for `/builds`, which
  is already prerendered in `dist/`;
- needs **no new endpoint**, so the prerender crawler's
  discoverability constraint (see `docs/deploy-cloudflare.md`) doesn't apply;
- carries the whole build group, so there is no state to store anywhere.

The codec (`public/js/build-code.js`) is a group → canonical JSON → `deflate` →
base64url with a version prefix — already written as a dual-environment pure
module, the same shared-module pattern as `query-core.js`.

### Verified working, end to end

Every piece an MCP needs is already a pure, importable module:

| Module | Export | Role |
|---|---|---|
| `build-code.js` | `encodeGroup` / `decodeGroup` | build group ⇄ share code |
| `build-store.js` | `validateBuild`, `SCHEMA_VERSION` | shape-check before emitting |
| `passive-path.js` | `shortestPath` | connected route to target notables |
| `passive-alloc.js` | `allocate` | legal allocation, cascade-safe |
| `passive-code.js` | `synthesizeState`, `encode` | allocation → v7 tree code |

`synthesizeState` is explicitly documented as being for programmatic
(non-imported) allocations — it exists for exactly this use case.

Tested three ways:

1. **In Node**, imported straight from `public/js/` with no shims: synthesized a
   build, encoded, decoded, round-tripped losslessly.
2. **In workerd** (`wrangler dev`), the same five modules copied into a Worker:
   `CompressionStream('deflate')` present, `encodeGroup`/`decodeGroup`
   round-trip clean, `shortestPath` + `allocate` + tree `encode` all work
   **unmodified**. This is the one runtime dependency worth confirming, and it
   holds.
3. **In the browser** against the dev server: generated links load and render
   completely — name, class, variant tabs, gear art, the skill + support chain,
   and a **56-point passive tree** with the tree render, aggregated passive
   stats (`49% increased Fire Damage`, `+200 to Intelligence`), and the notable
   priority list.

Full worked example: allocated a connected Sorceress fire tree by BFS to four
notables (Burning Strikes, Burning Nature, Unleash Fire, Breath of Fire),
56 points, plus Fireball + 4 supports — one URL, renders as a complete build.

### Measured URL sizes

| Payload | code | URL |
|---|---|---|
| 2-build group, light | 405 | 443 |
| 1 build + 56-point tree | 779 | 819 |
| 8-build leveling guide, 10 gear slots + 6 skills each | 951 | 991 |

Deflate absorbs inter-variant redundancy well — an 8-build guide is under 1 KB
of URL. No practical length concern; the fragment isn't subject to server URL
limits at all.

### The vocabulary mapping already exists — do NOT enrich the graph

The instinct is that the MCP needs a graph-id → planner-slug translation layer.
**It doesn't.** Verified against the built artifacts:

| Planner vocabulary | Already in the graph? |
|---|---|
| gem slugs (1,045) | ✅ **exactly** the graph's `gem` slugs — 1045/1045, zero misses |
| item slugs (1,447) | ✅ graph `base` ∪ `unique` slugs — 1,033 + 414, **zero** unaccounted |
| passive node hashes | ✅ **all 1,329** `passive` nodes carry `props.hash`, 1:1, no collisions |
| character classes + ascendancies | ✅ derived from `ascendancy` nodes' `props.charClass` + slug (`Druid1`) |
| gear slots | ✅ `gear-slot` nodes + `fits_slot` edges |

This is not a coincidence — `src/data/planner.js` states it in its own header:
*"Reads ONLY the graph (src/data/graph.js) — no source files."*
`planner-data.json` **is a projection of the graph**, written by
`scripts/build-index.js`. The planner's vocabulary is the graph's vocabulary by
construction.

**So the right move is to reuse `plannerData()`, not to enrich the graph.**
Adding planner-specific fields to nodes would push a *downstream consumer's*
concern back into the upstream source — inverting the dependency the whole
`scripts/graph/*` → `src/data/*` split exists to enforce. The graph stays the
source of truth; the planner projection stays a projection; the MCP consumes the
same projection the browser does.

Identity caveat: slugs are unique **within a kind**, not globally — 7,369 nodes
resolve to 6,856 distinct slugs (513 cross-kind collisions). So references must
be `(kind, slug)`. That is already exactly what the planner requires — its
`checkItemRef` demands both `kind` and `slug` — so the two agree by
construction. Never key a planner reference on slug alone.

### The one genuine gap: passive tree class starts

`meta.classStarts` in `passive-tree.json` (6 hashes — 47175 Warrior/Marauder,
54447 Witch/Sorceress, …) is the tree entry point every programmatic allocation
needs, and **no graph node carries it** (checked: 0 of 7,369 nodes have a
`props.hash` matching a class start). It comes from GGG's web tree data, not
RePoE.

Still don't put it in the graph. Per `docs/passive-tree.md` and the Data Notes
in `CLAUDE.md`, tree topology is deliberately GGG-sourced and the graph backs
passive *pages/relationships* only. Duplicating those 6 hashes into the graph
would create a second staleness axis for a fact that already lives one file
away — and the MCP is reading `passive-tree.json` anyway for adjacency.
**Read it where it lives.**

### What the MCP actually needs alongside D1

Only the passive adjacency (`nodes` + `edges` + `meta.classStarts`), and of the
node records only `h` / `name` / `k` / `asc` / `attr` — **not** the per-edge arc
geometry, which is render-only and the bulk of the file. Plus the planner
projection, which is 364 KB and derivable from the same D1 tables.

Sizes are small enough to bundle into the Worker against the 3 MB (free) /
10 MB (paid) gzipped script limit, but generating both from D1 at seed time
keeps one source and one staleness check.

**Two correctness traps found while testing:**

- `allocate(adj, allocated, starts, hash)` takes `starts` as an **array**
  (`.includes`), while `allocated` is a **Set**. Passing a Set for `starts`
  throws.
- `shortestPath` must be given `isPathable` to exclude ascendancy nodes, or it
  will happily route a main-tree path through them.

Emitting a build without validating it against `validateBuild` first — or with
a tree code whose nodes aren't actually connected to the class start — produces
a link that decodes but renders wrong. The MCP should treat `validateBuild` +
a connectivity check as a hard gate before returning any URL.

## Abuse, not billing, is the risk surface

A public MCP with unbounded traversal is a free crawl API over the entire
dataset. Cloudflare's free/included tiers absorb the cost, so there is no
billing alarm to warn you. Mitigations:

- hard caps on result counts and traversal depth in the tool schema
- **never** expose raw SQL
- WAF rate-limiting on the Worker route
- the data is public game data, so this is a bandwidth/politeness concern rather
  than a disclosure one

## Explicitly not needed

- **Workers AI + Vectorize** for semantic search. **D1's FTS5 covers stat-text
  search** — verified working in D1, 84 rows read per query vs 6,971 for `LIKE`
  — and it's exactly what `search-index.json` already does client-side via
  `public/js/query-core.js`. This is also the only option listed here that
  involves real per-request money; don't reach for it until FTS5 demonstrably
  falls short.
- **Durable Objects.** Nothing about a read-only artifact needs coordination or
  per-entity state.

## Open questions before building

1. ~~CPU headroom on free tier~~ — **answered**, see
   [Prototype results](#prototype-results-measured). Fine with capped results.
2. **Tool surface** — which relationships deserve first-class tools? Should
   follow whatever the actual agent use cases turn out to be, not a mechanical
   mirror of `edgesFrom`/`edgesTo`. Every tool needs a default `limit` and
   opt-in `expand`.
3. **Does D1 seeding belong in `refresh-data.yml`, or its own workflow?** Same
   cadence either way; separate keeps a D1 failure from blocking a site deploy.
4. **Auth** — public unauthenticated, or gated? Unauthenticated is simpler and
   the data is public; gating only becomes interesting if abuse shows up.
5. **Billable CPU-ms** — only obtainable from a deployed Worker with
   observability enabled. Worth doing before relying on free tier in anger.
6. ~~Does the graph need a planner-slug mapping?~~ — **answered: no.** The
   vocabularies are already identical; `planner-data.json` is a projection of
   the graph. Reuse `plannerData()`, don't enrich nodes. See
   [Deliverable](#deliverable-emitting-a-build-planner-link).
7. **Should the MCP emit variants?** The codec packs a whole group, so a
   leveling guide (acts 1–3 → endgame) costs under 1 KB of URL. That is
   arguably the most valuable deliverable shape, and it's free.
8. **Serve the passive adjacency from D1 or bundle it?** Only decision left on
   the data-plumbing side; both fit comfortably.
