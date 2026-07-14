# Complete-Graph Roadmap

**Status:** direction agreed; execution starting at Phase 1 (ailment glossary).
**This document is the cross-session tracking surface** for the long-term effort to
make `build/graph.json` a *complete, source-derived* model of PoE2 game content.
Each executing session authors the phase's design spec (if not present), builds it,
then ticks the checklist below and commits the change with the phase's final commit.

## Goal

Grow the graph toward **complete coverage of available source data**, so any game
concept (e.g. *Ignite* / flammability) resolves to a node with edges to every
related skill, mod, base, passive, and glossary term — for free, and **kept current
as GGG patches the game** because the graph is *derived from source*, not
hand-maintained.

Two source databases exist for PoE2 content, and only two:

- **RePoE-fork** (`data/source/repoe-poe2/`) — curated, named-field JSON. Stable
  schema; GGG changes are absorbed upstream. Cheap and safe to ingest.
- **GGPK** (`data/source/ggpk-poe2/`, 1019 raw `.datc64` tables) — authoritative and
  vast, but columnar/positional. GGG reorders and renames columns freely between
  patches, and a shifted column yields *plausible garbage*, not a crash. Expensive
  and fragile to ingest.

## Governing principles (the decision record)

These are *why* a given table is or isn't in the graph yet. Apply them to every
future ingestion decision.

1. **Curate rules, never enumerations.** Every domain module (`gems.js`,
   `affixes.js`, …) is hand-written extraction *logic* — that is unavoidable and
   fine. What must stay rule-shaped is the mapping: one `gem→class` rule that emits
   an edge per base, never 27 hand-written edges. (This restates the root
   `CLAUDE.md` Data Provenance policy; it is the axis on which completeness scales
   without rot.)

2. **Nodes are cheap; edges are the work — and superlinear.** Adding nodes for a
   table is mechanical. The value *and* the cost is in cross-domain edges (the
   stat-id / tag-intersection / metadata-path joins). Scope every phase as
   *complete node coverage, incrementally-deepened edge coverage* — never assume
   those are one lift.

3. **Greedy on RePoE, use-case-pulled on GGPK.** RePoE JSON is cheap+stable →
   ingest freely. Every GGPK table is a parser + a schema assertion + a patch-day
   liability *whether or not any page reads it*, so a GGPK table enters the graph
   only when a concrete want-to-surface case pulls it in. "Complete eventually" is a
   direction, not a mandate to carry fragile parsers for invisible data.

4. **Semantic canaries on every GGPK table.** `meta.sourceHash` catches *"source
   bytes changed"*; it does **not** catch *"source changed meaning"* (a shifted
   column). Every GGPK ingestion ships assertions — row-count bounds, known-value
   spot checks (e.g. "Exalted Orb still maps to this effect string") — that fail the
   build loud when the schema drifts. Without them, GGPK completeness trades a
   content gap for a silent correctness bug.

5. **Heavy leaf payloads live outside the boot artifact.** `graph.json` is loaded
   whole at boot (and shipped to a static Cloudflare deploy). The graph holds
   nodes + edges + *light* props; bulky per-node data (per-level scaling tables,
   monster stats, map data) lives in **load-on-demand side artifacts keyed by node
   id**. "Complete graph" ≠ "everything in `graph.json`."

6. **Some high-value edges go stale with zero schema change.** `recommends_support`
   and support-legality are *game logic* (tag/type intersection), not stored FKs —
   a rebalance invalidates them while every source byte stays identical. No
   staleness hash can catch this; these edges need tests against known in-game
   truth. Treat rule-derived cross-domain edges as needing their own regression
   coverage.

7. **Graph completeness is decoupled from static file count.** Cloudflare Pages
   caps a deployment at **20,000 files** (a platform limit — *not* tier-gated, so
   it cannot be bought out of; the fix is architectural). Today every node ships
   ~2 files (a page + a `/card` fragment), and `dist/` is already at **~14.4k /
   20k**. At that multiplier the complete-graph vision blows the cap long before
   "complete." Therefore a node in the graph does **not** imply a shipped file:
   large kinds surface via a **client-rendered artifact** (the proven `/search` +
   `/theorycraft` pattern — one bundled JSON in `public/generated/`, rendered
   in-browser by `query-core.js`, **zero per-node files**), not per-node
   prerendered cards. Per-node crawlable URLs are reserved for kinds that genuinely
   warrant them (gems, uniques). See **Static file-count budget** below.

## Static file-count budget (ops — recorded, not yet scheduled)

A cross-cutting rearchitecture the complete-graph effort depends on. **Concept:**
the static deployment's file count is a hard, finite budget (20k on Pages) that
must be managed independently of how many nodes the graph holds. Recorded here so
the concept and the big wins aren't lost; execution is deliberately deferred.

**Current state:** `dist/` ≈ **14,402 files** (72% of cap). Breakdown: `static`
(art/js/css) **6,063** (42% of all files), `base` 2,129, `gem` 2,090, `passive`
2,064, `unique` 866, `api`/keyword 467, `mod` 375, `augment` 240. The dominant
driver of per-*node* growth is the page-plus-`/card` 2-file multiplier; the
dominant driver *overall* is art.

**Big wins (ranked by leverage):**
1. **Move image assets off the Pages file set → R2** (already used for the build
   cache), served via bucket/Worker. Reclaims ~**6k files** in one move — nearly
   doubles headroom to ~8k used. Highest leverage, independent of any feature.
2. **Client-render concept cards from bundled JSON** instead of one prerendered
   fragment each (the `/search` pattern). Converts N files → 1 per kind. Migrating
   the existing card-only kinds (keyword 467, augment 240, mod 375) reclaims ~1k+
   files and makes every *future* concept kind (buffs, currency, …) cost ~1 file
   regardless of taxonomy size. **Phase 1 pilots this pattern with buffs.**
3. **Collapse the page+`/card` split** where the page can embed/derive the card
   client-side — roughly halves per-node file cost for the kinds that keep pages.

When this is picked up it graduates to its own spec; for now it is a governing
constraint on every new kind (principle 7).

## Phases

Execution protocol per phase:

1. Read this roadmap + the phase's design spec (author it via
   `superpowers:brainstorming` → `writing-plans` if absent).
2. Build it TDD; keep `npm test` green.
3. Verify acceptance criteria, incl. `npm run build:static` when pages/artifacts change.
4. Tick the checkbox below, note the completing commit, commit.

The first four phases are deliberately sequenced so each also *establishes a
reusable rail* the rest of the effort depends on.

| # | Phase | Source | Establishes rail | Spec |
|---|-------|--------|------------------|------|
| 1 | Buffs (effect entities) + provider edges | RePoE `buffs.json` | **two rails:** (a) rule-based cross-domain edge (`grants_buff` provider→effect) on clean data; (b) **client-rendered, file-cheap surface** (principle 7 pilot — buffs ship as ~1 bundled JSON, not per-node files) | `2026-07-14-buffs-graph-design.md` |
| 2 | Character classes | RePoE `characters.json` | — (quick win; `ascendancy→class` edge) | TBA |
| 3 | Gem/skill per-level scaling | RePoE `skills.json` `per_level` | **load-on-demand side-artifact** convention | TBA |
| 4 | Currency effects | GGPK (pilot) | **`.datc64` ingestion + semantic canary** harness | TBA |

After Phase 4 both rails (side-artifacts, GGPK-with-canaries) are proven, and Tier
B/C tables can be pulled in one use case at a time with bounded, known effort.

### Why this order

Phase 1 is the purest expression of the whole thesis — a game concept (a buff/
effect entity) that many providers grant, so the reverse lookup "what grants
Onslaught / this herald?" falls out of `edgesTo(buff, 'grants_buff')`. It runs on
the *easiest* substrate (clean RePoE JSON) so we shake out the rule-based
cross-domain join before doing it on raw `.datc64`, and it **doubles as the pilot
for principle 7** — buffs are a large kind surfaced entirely via a client-rendered
`buffs.json` bundle (the `/search` pattern), adding ~1 file regardless of how big
the buff taxonomy grows. Modeling note: the buff *effect* is its own node, distinct
from its *provider* (a gem/unique/passive that already exists) and from any prose
*keyword* of the same name; providers link to it, and buffs with no provider (or
non-gem providers) still have a home because the node is the home. Phase 3 is the first
genuinely heavy payload, so it forces the side-artifact decision once, for all
future heavy tables. Phase 4 proves the expensive GGPK path against the
highest-value content gap on the site (currency effects — 867 `StackableCurrency` +
50 `Omen` items exist as bare bases today with **no effect text**).

### Status checklist

- [ ] Phase 1 — Buffs (effect entities) + provider edges (+ client-render pilot)
- [ ] Phase 2 — Character classes
- [ ] Phase 3 — Gem/skill per-level scaling (+ side-artifact rail)
- [ ] Phase 4 — Currency effects (+ GGPK canary rail)

## Backlog (not scheduled — pulled in per principle 3 as use cases arise)

- **Quest rewards** (GGPK ~29 tables) — gems / passive points per quest → campaign
  progression guide.
- **Crafting bench recipes** (GGPK ~32 tables) — high value, higher churn.
- **League/endgame** (Breach/Ritual/Expedition/maps, ~100 tables) — endgame reference.
- **Bestiary** (monsters/bosses, ~63 tables) — large scope, high churn.
- **Tier C plumbing** — `audio`, `stats_by_file`, `stat_value_handlers`,
  `tags`/`tag_details`, `world_areas`: skip until a concrete page needs them.
- **Static file-count rearchitecture** — see **Static file-count budget** above.
  Big wins: art → R2 (~6k files), client-render existing card-only kinds (~1k+
  files). Graduates to its own spec when scheduled.
