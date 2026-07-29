# MCP Graph Server — Design

**Date:** 2026-07-28
**Status:** approved design, not yet implemented
**Evidence base:** `docs/mcp-graph-server.md` (feasibility investigation — every number cited here was measured, not estimated)

## Goal

Expose the Reveal graph to LLM clients as a remote MCP server, so an agent can
investigate PoE2 relationships and **hand back a working Build Planner link** as
the deliverable of that investigation.

## Audience & constraints

- **Private.** The author plus possibly a few friends. Not public.
- **Reachable from anywhere with no local build process** — this is the reason it
  is a remote Worker rather than a local stdio server. A local server was
  seriously considered and rejected on exactly this requirement.
- **Workers Free tier** is expected to suffice (see Cost).
- Access gated by a **single shared bearer token**.

## Architecture

```
build/graph.json ──┐
plannerData() ─────┼─► scripts/build-mcp-sql.js ─► build/mcp.sql ─► D1 (revealpoe2-graph)
passive-tree.json ─┘                                                      │
                                                                          │
                            workers/mcp (revealpoe2-mcp) ─────────────────┘
                            stateless createMcpHandler(), Streamable HTTP
                            mcp.revealpoe2.com
```

### Repo layout

Same repo — rule-determined, since the server needs `build/graph.json`, the
planner projection, and five existing pure modules (`build-code`, `build-store`,
`passive-code`, `passive-path`, `passive-alloc`).

```
src/mcp/
  tools/            pure tool implementations, backend-injected
  backends/fs.js    wraps src/data/graph.js   (tests, local dev)
  backends/d1.js    same interface, SQL       (Worker)
  contract.js       tool JSON schemas + schema() response
workers/mcp/
  index.js          Worker entry: auth, MCP transport, backend wiring
  wrangler.jsonc    revealpoe2-mcp + D1 binding
scripts/
  build-mcp-sql.js  graph + projection + passive adjacency -> build/mcp.sql
test/mcp/           node:test, against fsBackend
```

**Hard constraint:** the pure tool layer must never import `node:fs`. Only
`backends/fs.js` does; the Worker imports only `backends/d1.js`. No barrel file
that pulls both — that single mistake turns a clean split into a broken Worker
bundle.

**Naming** mirrors the canonical public name at every layer: Worker
`revealpoe2-mcp`, database `revealpoe2-graph`, host `mcp.revealpoe2.com`.

### Query layer: one tool layer, two backends

The abstraction already exists. `src/data/graph.js` exposes exactly
`getNode`, `nodeBySlug`, `nodesByKind`, `edgesFrom`, `edgesTo` — that *is* the
backend interface. Tools are pure functions over it, implemented against two
backends.

This follows the `query-core.js` precedent the project already uses to stop
server and client search from diverging. The consequence that matters: the whole
tool surface — including BFS allocation and build assembly, where the real logic
lives — is testable under plain `node:test`, with no Cloudflare, no miniflare,
no D1.

Rejected alternatives:

- **D1-only, Worker-native.** One code path, but the tool layer would then
  require workerd to execute, moving tests to `vitest-pool-workers` and breaking
  the repo's `node:test` convention for the most bug-prone code.
- **Sharded static JSON, no D1.** Cheapest infrastructure, but hop chains can't
  be composed against static files, which eliminates `traverse()`/`schema()` and
  the ability to answer unanticipated questions.

## Tool surface

Three layers. The organising principle for layer 1 is **group by entity, not by
relation** — you ask about a *thing* and receive its relationships, which is how
the wiki's own pages work and the direct expression of the project's thesis that
users shouldn't need to know the relationships in advance.

### Layer 1 — semantic tools (primary; no schema knowledge required)

| Tool | Relations covered |
|---|---|
| `find(description, kind?, limit=25)` | — (FTS entry point → `{kind, slug, name}`) |
| `explain(term)` | keyword glossary (720 nodes) |
| `gem(name)` | `grants`, `recommends_support`, `sockets_into`, `tagged` |
| `item(name)` | `fits_slot`, `in_class`, `has_base`, `rolls_on`, `pool_source`, `tagged` |
| `affix(name)` | `rolls_on` (both directions) |
| `passives(intent \| name)` | passive nodes + `in_ascendancy`; returns `hash` + stat lines |
| `ascendancy(name)` | `in_ascendancy` |
| `slot(name)` | `fits_slot`, `in_class`, `default_skill` |

Eight tools cover all 11 edge types because the relation vocabulary is closed
and small — 11 types across 12 node kinds. Semantic tools can therefore be
**exhaustive rather than speculative**.

### Layer 2 — fallback

`traverse(start, hops[], limit)` — a typed **multi-hop chain**, not a
single-edge step. This distinction is the whole point: chaining single steps
would force the model to issue N calls and hold intermediate id lists in
context. One composed query costs the same in the database and far less in
tokens.

Measured on an unanticipated semantic nobody wrote a tool for — *"which affixes
can roll on the base that unique X uses?"* (`unique --has_base--> base
<--rolls_on-- affix`): **52 edge rows touched, 0.079% of 65,973 edges**, every
hop index-backed (`idx_edges_src`, `idx_edges_dst`, nodes PK), answered in one
query. The fallback is not "walk the whole database."

### Layer 3 — discovery

`schema()` — 12 kinds, 11 relations, which kinds each relation connects, and
counts. This is what makes `traverse` self-teaching without prose documentation:
the model calls it once, caches it in context, and can compose any chain. Small
static response.

### Deliverable

`build_link(spec)` — see below.

### Deliberately excluded

- **Set intersection / aggregation in `traverse`** (e.g. "affixes that roll on
  both bows and staves"). This is the honest boundary of the fallback. Deferred
  until observed as a real need.
- **Any tool that makes build-quality judgments the graph cannot justify.**
  Recommending supports from `recommends_support` is data; ranking builds is
  opinion.

### Fan-out discipline

Measured worst case: `affix("Attribute Requirements")` has **940** `rolls_on`
targets; enumerating them with props expanded was **1.27 MB ≈ 318k tokens** — a
single tool response larger than most context windows.

Rules, applied uniformly:

- **Summarize by default.** Group counts by item class ("all 12 bow bases, all 8
  staves, …"); `list: true` is opt-in and capped.
- ids and names by default, `props` only on request.
- **Never `expand` together with an uncapped traversal.** Measured multiplier for
  `expand` is 7.6× on a 17-row result (651 → 4,934 tokens).

## `build_link`

The division of labour: **the model supplies judgment, the server owns
mechanics** and refuses to emit an invalid link.

### Input

```
build_link({
  name, class, ascendancy?,             // "sorceress", "stormweaver"
  skills: [{gem, level?, supports[]}],
  gear?:  {slot: {item, mods?[]}},
  notables?: [name | hash],             // names resolved server-side
  notes?, description?,
  variants?: [{label, ...same shape}]   // whole group in one URL
})
```

### Resolution pipeline (all server-side)

1. Resolve every name → `(kind, slug)` via the seeded projection. **Ambiguous
   name → refuse with the candidate list**; the server never guesses.
2. Resolve notable names → hashes. Check `buildable` on items.
3. BFS-allocate a connected path from the class start
   (`passive-tree.json meta.classStarts`), with `isPathable` **excluding
   ascendancy nodes**.
4. **Greedy nearest-first ordering** — allocate the cheapest-marginal-cost
   target next rather than in list order. Deterministic and cheaper than list
   order. Documented as a heuristic: optimal Steiner tree is NP-hard and not
   worth it here.
5. Ascendancy nodes into the trailing codec section with the 1-based `ascByte`;
   `attrOf` from the class's primary attribute.
6. `validateBuild()` gate, then `encodeGroup` → URL.

### Output

`{url, points_spent, notable_priority[], resolved: {...}, warnings[]}`

`resolved` echoes what each name became, so the model can verify nothing was
misread.

### Codec features v1 does not use

The share codec and `validateBuild` support more than `build_link` will emit.
Stated explicitly so the omissions are decisions rather than oversights:

- **Weapon-set passive nodes** (`ws1`/`ws2` in `synthesizeState`, budget 25 each).
  v1 allocates the **main tree only**; `weaponSet` is emitted empty. Gear
  weapon-set *slots* (`weapon1a/1b/2a/2b`) are ordinary gear slots and **are**
  supported.
- **`grantedSupports`** — the optional per-skill map for supports granted by
  uniques or passives rather than socketed. v1 omits the field; it is valid to
  leave unset, and populating it correctly needs judgment about which grant
  applies to which skill.
- **Legacy v1 share codes.** `build_link` always emits the current codec version.
  Decoding old codes remains the site's concern.

### Why no site changes are required

The share link is `https://revealpoe2.com/builds#/import/<code>`. The build
travels in the **URL fragment**, which never reaches the server. Cloudflare
serves `/builds`, already prerendered in `dist/`. No new endpoint, so the
prerender crawler's discoverability constraint does not apply. No state stored
anywhere.

Verified three ways: in Node (imported from `public/js/` with no shims), in
**workerd** (`CompressionStream('deflate')` present; codec, BFS, and tree encode
all work unmodified), and in the browser — generated links render completely,
including a 56-point passive tree with aggregated stats and the notable-priority
strip.

Measured URL sizes: 443 chars for a light 2-build group, **819** for one build
with a 56-point tree, **991** for an 8-build leveling guide with 10 gear slots
and 6 skills each.

### Known correctness traps (found by testing, must be encoded as tests)

- `allocate(adj, allocated, starts, hash)` takes `starts` as an **array**
  (`.includes`) while `allocated` is a **Set**. Passing a Set for `starts`
  throws.
- `shortestPath` requires `isPathable` to exclude ascendancy nodes, or it routes
  main-tree paths through them.
- A tree code whose nodes aren't connected to the class start **decodes fine and
  renders wrong** — the worst failure mode, because it looks like success.
- Slugs are unique **within a kind**, not globally: 7,369 nodes → 6,856 distinct
  slugs (513 cross-kind collisions). References must be `(kind, slug)`. The
  planner already requires both (`checkItemRef`), so they agree by construction.
- Node ids are inconsistent in source — both `Metadata/Items/Gem/…` and
  `Metadata/Items/Gems/…` exist. Never hand-build ids; resolve by `(kind, slug)`.
- `kind: 'class'` in the graph is **item** class (bow, claw, dagger), *not*
  character class. Character classes are reconstructed from `ascendancy` nodes'
  `props.charClass`.

## Data plane

### D1 schema

```sql
nodes(id PK, kind, name, slug, source, props JSON, buildable INT)
edges(type, src, dst, source, props)
passive_nodes(h PK, name, kind, asc, attr)   -- adjacency only, no arc geometry
passive_edges(a, b)
meta(key, value)                              -- sourceHash, manualHash, builtAt
nodes_fts USING fts5(name, body, content='')

idx_edges_src(src, type)   idx_edges_dst(dst, type)
idx_nodes_kind(kind)       idx_nodes_slug(kind, slug) UNIQUE
```

Passive tables carry adjacency plus `name`/`kind`/`asc`/`attr` only. The
per-edge arc geometry in `passive-tree.json` is render-only and is the bulk of
that file; it is excluded.

### The projection is seeded, never reimplemented

`build-mcp-sql.js` **calls `plannerData()`** and emits its output as rows.
Recomputing the projection in the Worker against D1 would be a second
implementation free to drift from `src/data/planner.js`. Seeding the real output
makes the MCP's projection identical by construction and makes `buildable` a
trivial membership check.

### Seed file structure

Driven by measured import costs:

- base-table `INSERT`s only — 73,342 statements took **2m10s** to import
- indexes and FTS as DDL + one `INSERT..SELECT` each — **58 ms**
- **`DROP TABLE`, never `DELETE FROM`.** A full reseed is ~84k rows written
  against a **100k/day** free allowance; `DELETE` would likely bill the removed
  rows as writes too and could double that. `DROP` is a metadata operation.

This is the tightest free-tier constraint in the design, and the reason
reseeding stays on the weekly cadence and never runs per-push.

### FTS is mandatory, not an optimisation

Measured: `LIKE '%flame%'` full-scans **6,971 rows** to return 50 results;
FTS5 `MATCH` returns equivalent results reading **84** — an **83×** reduction in
D1's billed metric. On the free tier's 5M rows/day that is the difference
between roughly 700 and 60,000 searches per day.

### Graph ↔ projection parity assertion

The answer to "what if the projection has a bug" is: don't trust it, assert on
it. Measured current divergence:

| | in graph | absent from projection | cause |
|---|---|---|---|
| gems | 1,045 | **0** | perfect parity |
| bases | 1,067 | 34 | all Jewels + Talismans — no `fits_slot` edge |
| uniques | 436 | 22 | 9 pool uniques, 13 jewel/talisman |
| reverse | — | **0** | nothing in the projection lacks a graph node |

All 13 "has a base yet absent" uniques resolve to Jewel or Talisman bases
(The Adorned→Diamond, Grand Spectrum→Ruby, Voices→Sapphire,
Amor Mandragora→Changeling Talisman). The planner's 15 slots include no jewel
socket or talisman slot, so this is a **product gap, not a data bug**.

`build-mcp-sql.js` therefore asserts:

- gem divergence **must be 0** — fail the build otherwise;
- the item divergence set must contain **only item classes that have no
  gear-slot**. If a Body Armour or a weapon ever appears there, that *is* a bug
  and the build warns.

Same spirit as the existing unique-reconciliation guardrail in
`scripts/graph/manual.js`. A future projection bug then surfaces at build time
rather than as a puzzling MCP refusal.

### Staleness

`meta` carries `sourceHash`, `manualHash`, `builtAt`; `schema()` reports them,
and `refresh-data.yml` asserts the seeded hash matches the graph it just built.
Honest limitation: the Worker cannot self-detect staleness — it has no source to
compare against — so CI is the only checkpoint.

## CI

Follows the cadence split the pipeline already has, as **separate jobs** so a
Worker or D1 failure cannot fail the site deploy.

| Trigger | Action |
|---|---|
| push to `main` (`deploy.yml`) | deploy the MCP Worker — code only, never touches D1 |
| `refresh-data.yml` | reseed D1 from the freshly-built graph, then assert hash parity |

## Auth

Single shared bearer token in Workers Secrets Store, checked **before any tool
dispatch**. Friends paste it into their MCP client config. Rotation means
telling everyone the new value — accepted, given the audience size.

Transport is stateless `createMcpHandler()` over Streamable HTTP. **No Durable
Object** — Cloudflare marks the DO-backed `McpAgent` deprecated and recommends
the stateless handler for new servers. No KV.

## Error handling

Two failure classes, deliberately distinguished — refuse when the link would
render *wrong*, warn when it renders correctly but is unachievable:

| Condition | Behaviour |
|---|---|
| unknown slug, ambiguous name, unreachable notable, disconnected tree | **refuse** — no URL emitted |
| item exists but is not buildable (Jewel/Talisman) | **refuse**, naming the item class |
| exceeds 122 passive points, or 8 ascendancy points | **emit + warn** — a real build, just not reachable in game |
| result exceeds cap | truncate + state the truncation in the response |

Truncation is always reported. A silently capped result reads as "that's
everything," which is worse than an explicit cap.

Auth failures return 401 without a tool list. Query tools never expose raw SQL,
and `traverse` takes a constrained hop structure rather than an expression.

## Testing

All tool-layer tests run under `node:test` against `fsBackend`, matching the
repo's existing convention (52 test files, `test/graph/` for builder tests).

1. **Tool contract tests** — each semantic tool against the real graph via
   `fsBackend`: shape, caps applied, summarize-by-default, `expand` opt-in.
2. **`traverse` tests** — hop chains resolve; caps enforced; unknown relation
   rejected.
3. **`build_link` tests** — the six known traps above, each as a named
   regression test. Specifically: `starts`-as-array, ascendancy exclusion in
   pathfinding, **connectivity of the emitted tree** (the decodes-but-renders-wrong
   case), `(kind, slug)` disambiguation, refuse-vs-warn classification.
4. **Round-trip test** — `build_link` output decoded with `decodeGroup` equals
   the intended build, including the tree code.
5. **Parity test** — the graph ↔ projection assertion, so a projection
   regression fails `npm test` rather than surfacing in production.
6. **Backend equivalence** — a shared suite run against both `fsBackend` and a
   local D1-backed backend, asserting identical results. This is the test that
   makes the two-backend design safe.

Not covered by unit tests, and verified manually against a deployed preview:
Streamable HTTP transport behaviour, auth rejection, and real D1 latency.

## Cost

Expected **$0/month** on Workers Free for this audience:

| Free limit | Headroom |
|---|---|
| Workers 100,000 req/day | a heavy agent day is hundreds |
| D1 5M rows read/day | ~250k+ traversals at avg outdegree 17.9 |
| D1 100,000 rows written/day | one ~84k-row reseed/day; cadence is weekly |
| D1 500 MB/database | 33.8 MB → 6.8% used |

CPU was measured, not assumed: every projected query landed at 0–2 ms against
the free tier's **10 ms per invocation** ceiling. Only expanding props across
the 940-row worst case reached 10 ms, and that response is disqualified on token
grounds anyway. **Capping results keeps CPU a non-issue** — the same discipline
token cost already demands.

Caveat: that figure is local `wrangler dev` wall-clock, not billable CPU-ms.
Real D1 queries are I/O, which Workers does not bill as CPU, so projected cases
are cheaper than measured. Obtaining the true number requires a deployed Worker
with `observability.enabled` — worth doing before relying on free tier in anger.

## Out of scope

- Public access, per-user tokens, WAF rate limiting, abuse mitigation.
- Workers AI / Vectorize semantic search — D1's FTS5 covers stat-text search,
  and it is the only option here with real per-request cost.
- Durable Objects.
- Set operations in `traverse`.
- Weapon-set passive allocation and `grantedSupports` in emitted builds (see
  *Codec features v1 does not use*).
- Enriching the graph with planner-specific fields. The vocabularies are already
  identical (gems 1045/1045, items = `base ∪ unique`, all 1,329 passives carry
  `props.hash`); `planner-data.json` is a projection of the graph. Adding
  planner fields to nodes would invert the dependency the
  `scripts/graph/*` → `src/data/*` split exists to enforce.
- Duplicating `meta.classStarts` into the graph. Tree topology is deliberately
  GGG-sourced per `docs/passive-tree.md`; the MCP reads
  `passive-tree.json` for adjacency anyway.
