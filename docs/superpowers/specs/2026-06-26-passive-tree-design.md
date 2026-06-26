# Full Passive Tree — Design Spec

**Date:** 2026-06-26
**TODO item:** #5 — "Add full passive tree as seen in game (big map of passives with correct shape)"
**Status:** Approved design; pre-implementation.

## Goal

Render the Path of Exile 2 character passive tree (`Default.json`) faithfully and
interactively, as the tree-half of the future Build Planner (TODO #1). The tree is a
client-side app over a purpose-built static artifact — no server compute, no new
third-party runtime dependencies — consistent with the wiki's static-prerender model.

This spec covers two layers:

1. **The tree app** — geometry-faithful render, click-to-allocate with connectivity
   validation and point counting, ascendancy sub-trees, weapon-set points, and
   round-trip import/export of the official share code.
2. **Data consolidation** — parse `Default.json` once into a canonical intermediate
   that feeds both the render artifact and the existing graph's semantic passive
   nodes, eliminating the current duplicate parse in `scripts/graph/passives.js`.

**Out of scope (next spec):** making passive nodes searchable in `/search` and
`/theorycraft` with tooltips, and retiring the standalone keystone/ascendancy
representations in favor of the tree. The consolidated data model from layer 2 is the
precondition that makes that follow-up cheap.

## Scope decisions (from brainstorming)

| Axis | Decision |
|------|----------|
| Interactivity | Allocation-aware **and** link-shareable (combine viewer + allocation + sharing) |
| Visual fidelity | **Geometry-faithful, clean style** — exact positions, correct arc/line edges, real node icons, flat backgrounds, clean per-kind frames. **No** painted parchment/group-bg art, **no** new asset mirror beyond node icons already mirrored. |
| Sharing | **Round-trip** the official `pathofexile2.com` share code (import **and** export) |
| Ascendancy | **In v1** — render and allocate ascendancy sub-trees (separate start + point pool) |
| Weapon-set points | **In v1** — per-node set I / II / both, second point pool |
| Rendering tech | **Canvas 2D** (immediate-mode), rejected SVG/DOM (jank at ~11k elements) and WebGL (overkill, adds deps) |
| Spec boundary | Tree app + consolidation (layers 1+2); search/theorycraft integration is the next spec |

## Data foundation (verified against `Default.json`)

- **Geometry model (standard PoE tree):** each group has a center `(x, y)`; each node
  sits on an orbit around its group. Node world position =
  `group.center + polar(orbit_radii[node.radius], 2π · node.position_clockwise / skills_per_orbit[node.radius])`.
  - `orbit_radii = [0, 82, 162, 335, 493, 662, 846, 251, 1080, 1332]` —
    **NOT monotonic** (index 7 = 251). Always index by the node's `radius` field;
    never assume orbits are sorted.
  - `skills_per_orbit = [1, 12, 24, 24, 72, 72, 72, 24, 72, 144]`.
- **Two parallel node structures:** `groups[].passives[]` carries geometry
  (`hash`, `radius`, `position_clockwise`, `connections[]`, `splines[]`);
  top-level `passives{hash}` carries semantics (`name`, `stats`, `icon`, flags,
  `ascendancy`, `weapon_set_points`).
- **Edge model:** 6068 unique (deduped, bidirectional) edges. An edge is drawn as a
  **curved arc** iff both endpoints are in the **same group and same orbit** (1610
  edges); otherwise a **straight line** (4458 edges). Arc direction is the minor arc
  between the two `position_clockwise` angles. This arc-vs-line rule is the "correct
  shape" the design must reproduce.
- **Counts:** 5150 passives total — 1304 notables, 33 keystones, 19 jewel sockets,
  368 icon-only, 36 ascendancy-starting nodes, 3 free. 36 ascendancy clusters in
  data, but many are data-mined PoE1 placeholders (Marauder/Duelist/Shadow/Templar);
  `ascendancies.json` `disabled` / `[DNT` flags gate to the live PoE2 set.
- **Class roots:** `roots = [50459, 47175, 50986, 61525, 54447, 44683]` (6 class start
  nodes).
- **Share code:** the example `AAAABwoAAAA=` decodes to 8 bytes
  `00 00 00 07 0a 00 00 00` — uint32 BE **version = 7**, then class/ascendancy/node
  bytes. Same family as the PoE1 format; node hashes (max ~61525) fit in uint16.

## Architecture

```
data/source/.../Default.json + ascendancies.json
            │
            ▼  (build time, parsed ONCE)
scripts/graph/passiveSource.js  ── canonical intermediate { nodes[], edges[], meta }
            │                                   owns the stat-translation pass
            ├──────────────┐
            ▼              ▼
scripts/graph/passives.js   scripts/build-index.js (or sibling)
(refactored: consumes        emits public/generated/passive-tree.json
 intermediate; graph         (full geometry render artifact)
 output byte-for-byte
 unchanged)
            │                                   │
            ▼                                   ▼  (runtime, client-only)
build/graph.json (semantic         /passives page shell  +  public/js/passive-tree.js
 passive nodes, unchanged)         (Canvas render, fetches the artifact)
```

## Components

### B1. `scripts/graph/passiveSource.js` (new) — canonical parse

- Parses `Default.json` + `ascendancies.json` exactly once.
- Owns stat-id → English translation (the `statMap` / `resolveStatLines` logic
  currently duplicated in `passives.js`, moved here).
- Returns `{ nodes[], edges[], meta }` where each node carries both geometry
  (precomputed world `x`, `y`, edge classification) and semantics (name, stat lines,
  kind, ascendancy, weapon-set points).
- `meta`: `{ classStarts:{class→hash}, ascStarts:{ascId→hash}, orbit_radii,
  skills_per_orbit, pointBudget }` plus the live-ascendancy filter applied.

### B2. `scripts/graph/passives.js` (refactored) — consolidation

- Stops re-parsing `Default.json`; imports the canonical intermediate from
  `passiveSource.js`.
- Emits the **same** graph nodes (notables + keystones), ascendancy nodes, and edges
  (`grants`, `in_ascendancy`) as today. **Acceptance: existing passive tests stay
  green and graph output is unchanged.**

### B3. Render artifact emitter — `public/generated/passive-tree.json`

Added to the `build:index` family (so the dev server serves it at
`/static/generated/passive-tree.json` and prerender copies it into `dist/`).

Schema:
- `nodes[]`: `{ h, x, y, k, name, stats[], icon, asc, ws }`
  - `k` ∈ `small | notable | keystone | jewel | ascStart | ascNotable | ascSmall`
  - `icon` = same-origin webp url via `ddsUrl()`
  - `asc` = ascendancy id or `null`; `ws` = weapon-set points (int)
- `edges[]`: `{ a, b }` (straight) or `{ a, b, arc:{ cx, cy, r, a0, a1, ccw } }` (arc)
- `meta`: `{ classStarts, ascStarts, pointBudget }`

All geometry precomputed at build time; the client does no orbit math.
**Size target:** ~2–3MB; flag if > ~4MB (consider trimming or splitting ascendancy
data). Served gzip/brotli by Cloudflare Pages.

### D. `public/js/passive-tree.js` (new) — Canvas renderer

- Single `<canvas>`; world→screen transform driven by wheel-zoom and drag-pan.
- Layered immediate-mode draw: straight edges → arc edges (`ctx.arc`) → node icons →
  per-kind frames → allocation highlights.
- Hit-test via a spatial grid (bucket by world cell) → nearest node within its radius.
- Hover → HTML tooltip overlay (reuses existing tooltip styling; shows name +
  translated stat lines). Notables/keystones link to their existing wiki page.
- Loads `/static/generated/passive-tree.json`; reads a `#<code>` fragment on load to
  pre-highlight an imported allocation.

### E. `public/js/passive-alloc.js` (new) — allocation engine (pure)

Pure, unit-tested module (mirrors the shared-`query-core.js` pattern):
- `canAllocate(state, hash)` — true iff `hash` is adjacent to an allocated node or a
  start node.
- `allocate` / `deallocate` — deallocation **cascades**: removing a node auto-frees
  any node thereby orphaned from its start (PoB behavior), rather than blocking the
  click.
- `pointsSpent(state)` and budget tracking.
- **Ascendancy:** the chosen ascendancy's start node is a second root with its own
  point pool; allocation within the ascendancy cluster validates against that start.
- **Weapon-set points:** a node may be allocated to set I, set II, or both; second
  point pool; a UI mode toggle selects which set a click affects.

### F. `public/js/passive-code.js` (new) — share codec (pure)

- `decode(base64) → state`, `encode(state) → base64`.
- Targets the official format: uint32 BE version (7), class byte, ascendancy byte,
  then allocated node hashes (uint16 BE list); weapon-set allocation per the format
  once a sample is available.
- **Hard dependency:** finalization is blocked on real test vectors (see Risks). The
  codec is designed and stubbed; components B–E proceed without it.

### G. Page & route

- New route `/passives` renders the canvas shell (server route retained for dev /
  no-JS parity, consistent with `/search` and `/theorycraft`).
- Share links use the URL **hash** (`/passives#<code>`) — client-only, no server
  param, no prerender interaction.
- The artifact is a static file under `public/generated/`, copied wholesale by
  prerender — it is **not** a route, so there is no crawler-discoverability problem.
- Add a nav link to `/passives` so the page is crawl-reachable.

## Testing

- **Allocation engine units:** connectivity (allocatable iff adjacent to allocated/
  start), point counting, cascade-deallocate, ascendancy pool isolation, weapon-set
  pools.
- **Codec round-trip:** `decode(encode(state)) === state`, validated against real
  test vectors (incl. one ascendancy and one weapon-set sample).
- **Geometry spot-checks:** a few known nodes → expected world `(x, y)`; arc-vs-line
  classification counts (1610 / 4458).
- **Artifact:** validates against a schema; sane node/edge counts.
- **Consolidation regression:** existing passive tests stay green; graph output for
  passive/ascendancy nodes + edges is unchanged.

## Risks & open items

1. **Official code format (blocks codec only).** Need ~3–5 real share codes with known
   allocations from the user: at minimum one plain, one with an ascendancy chosen, and
   one with weapon-set points, to pin the exact node-list layout and weapon-set
   encoding. Reverse-engineered format → a game patch may bump the version; the version
   byte lets us detect and fail loudly.
2. **Weapon-set encoding** unknown until a sample code is available.
3. **Artifact size** — measure during implementation; mitigate by trimming text or
   splitting ascendancy data if it exceeds ~4MB.

## Implementation ordering

1. `passiveSource.js` canonical parse + geometry precompute (B1).
2. Refactor `passives.js` onto it; prove graph output unchanged (B2).
3. Render artifact emitter + schema (B3).
4. Canvas renderer with pan/zoom/hover (D) — visual milestone.
5. Allocation engine + UI wiring (E).
6. `/passives` route, nav link, hash import (G).
7. Share codec (F) — once test vectors are in hand.
