# Buffs as Effect Entities — Phase 1 Design

**Roadmap:** `2026-07-14-complete-graph-roadmap.md`, Phase 1.
**Status:** design approved; implementation not started.

Phase 1 of the complete-graph effort. It ingests **buff/debuff effect entities**
from RePoE `buffs.json` as first-class graph nodes and connects them to the skills
that grant them. It doubles as the pilot for two roadmap rails:

1. **Rule-based cross-domain edge on clean data** — one derivation rule
   (`skill.active_skill.id == buff key`) yields the `grants_buff` edge; provider
   lists (gems/uniques) fall out of *existing* `grants` edges via traversal.
2. **Graph-completeness decoupled from static file count** (roadmap principle 7) —
   the `buff` kind is large (~1,600 nodes) but ships as **one client-rendered JSON
   bundle**, not per-node prerendered files.

## Background: buff vs. provider vs. keyword

Three distinct concerns the graph keeps separate:

- **The effect** — a buff/debuff entity (`herald_of_ash`, `onslaught`,
  `power_charge`). *What state you're in and what it does.* This is the new node.
- **The provider** — the gem / unique / passive that grants it. *Already a node.*
- **The prose keyword** — a glossary term of the same name (`Ignite`), used for
  render-time popups. *Already a node; a different layer.* Not merged in Phase 1.

The relationship provider→effect is an **edge**, not ownership: a buff with several
providers (or none, or a non-gem provider) still has one home — its own node. This
is why the buff does not "live on the gem page."

## Source facts (verified)

- `buffs.json`: 3,211 entries. **1,616 invisible**; **~1,595 visible**. Categories
  include Debuff (672), Buff (723), Flask (100), Charge (18), Charm (18), Herald
  (7), Mark (6), Aura/Active skill (44), Hex (13), Link (12), plus niche
  (PVP/Shrine/Stolen/Labyrinth trap). 1,518 entries have `category: null`.
- Each entry: `name`, `description` (with `[Id|Display]` markup), `category`,
  `invisible`, `removable`, `stack_limit`, `stats` (applied stat-ids), `visuals`,
  `sources` (**always null** — no stored provider FK), `templates` (occasional
  variant overrides, e.g. Sentinel).
- **The join:** skills.json `X.active_skill.id` equals the `buffs.json` key for
  granted buffs — e.g. `HeraldOfAshPlayer.active_skill.id == "herald_of_ash"`.
  This is the derivation rule for `grants_buff`.
- Existing graph: `grants` edges (1,388) already connect gem/item → skill. No new
  item→buff join is required; providers are reached transitively.

## Node model

New kind `buff` (add to `schema.js` `KINDS`).

- **Which entries become nodes (greedy):** every `buffs.json` entry that is
  **`invisible === false` AND has a non-null `category`** — **1,319 entries**
  (verified: Debuff 566, Buff 543, Active skill 40, Buff shrine 36, Charge 18,
  Flask 38, Charm 15, Hex 13, Spell shrine 10, Stolen 12, Link 12, Herald 7, Mark
  6, PVP flag 3). Greedy per roadmap principle 3; cheap because the surface is
  client-rendered. (A rule, not a hand-picked list — new buffs from a future scrape
  are picked up automatically.)
- **Node shape:**
  - `id`: the `buffs.json` key (e.g. `herald_of_ash`).
  - `kind`: `buff`. `name`: entry `name`. `slug`: `slugify(id)`.
  - `props`: `{ description, category, removable, stackLimit, stats }`
    (`stats` = the applied stat-id list; kept as a light prop, not expanded).
  - `search`: name + category, lowercased.
  - `source`: `repoe`.
- **Not merged with `keyword`.** Where a buff and a keyword share a concept
  (`ignited`/`Ignite`), they remain separate nodes in Phase 1. A future phase may
  add a cross-link edge; deferred.

## Edge model — the proving ground

Exactly **one** new edge type: `grants_buff` (add to `schema.js` `EDGE_TYPES`).

- **Direction:** `skill → buff`.
- **Derivation rule:** at build time `buffs.js` reads `skills.json` from source
  (the `active_skill.id` is **not** stored on skill node props), and for each
  skills.json entry whose `active_skill.id` equals a `buff` node id, emits
  `grants_buff(skill → buff)`, `source: repoe`. The edge `from` is the skills.json
  key, which **is** the skill node id (verified: `HeraldOfAshPlayer`).
- **Referential guard:** emit an edge only when the `from` skill node actually
  exists in the graph (pass the `nodeIds` set, like sibling edge builders) — not
  every skills.json entry becomes a node (monster/variant skills are filtered), and
  a `grants_buff` edge to a non-existent node must not be produced. This naturally
  restricts grants to real (player) skill nodes.
- **Providers via traversal (no new edge):** "what grants X?" is answered by
  `edgesTo(buff, 'grants_buff')` → the skill(s), then `edgesTo(skill, 'grants')` →
  the gems/uniques/passives that grant that skill. The buff card renders this
  transitive provider list.
- **Deferred (out of scope):**
  - `inflicts` for ailments (diffuse chance-on-hit across many mods — a later
    phase, with its own fuzzier rule and regression tests).
  - Direct mod-stat → buff edges for "You have X" uniques that grant a buff
    *without* granting a skill node (needs stat-text/stat-id parsing).
  - `scales`/`modifies` (increased buff magnitude / effect) edges.

## Presentation (principle-7 pilot)

`buff` is **card-only and client-rendered** — no `/buff/:slug` prerendered page,
following the `keyword`/`augment` precedent and the `/search` + `/theorycraft`
client-render pattern.

- **New build artifact** `public/generated/buffs.json` — an array of buff view
  models (`{ id, slug, name, category, description(html), removable, stackLimit,
  grantedBy: [{kind, slug, name}] }`), produced by a build step alongside
  `browse-cards.json`. `grantedBy` is precomputed at build time by the traversal
  above so the client does no graph work.
- **Buff card** — a client-rendered popup (reusing the card/tooltip styling) showing
  the effect description, category badge, stack/removable facts, and the
  **"Granted by"** provider list (links to gem/unique pages). One shared template;
  the client picks the buff out of the bundle by slug.
- **"Grants →" chip on gem/skill pages** — server-rendered from
  `edgesFrom(skill, 'grants_buff')`; the chip carries a `data-buff` attribute the
  client wires to the buff-card popup. (Mirror `data-keyword` so the mechanism is
  familiar; do **not** require a crawlable per-buff URL — the bundle is the source.)
- **Light `/buffs` index** — a client-rendered browse page over the bundle
  (searchable/filterable by category), so buffs are reachable and searchable. Added
  to `search-index.json` so site search finds them.
- **File-count impact:** ~1 bundle + 1 index page. Not ~1,600 files.

## Provenance & testing

- All buff nodes and `grants_buff` edges are `source: repoe`. `meta.provenance`
  counts update automatically; `sourceHash` gains `buffs.json` (add to
  `SOURCE_FILES` in `build.js`).
- **Regression tests (roadmap principle 6 — pin in-game truth):**
  - `HeraldOfAshPlayer` skill → `grants_buff` → `herald_of_ash` buff exists.
  - The `herald_of_ash` buff's transitive `grantedBy` includes the Herald of Ash
    gem.
  - `onslaught` buff node exists, is `category: Buff`, `invisible: false`.
  - Node count sanity: `buff` node count ≈ **1,319** (allow a small band) — guards a
    scrape that silently drops or reshapes the file.
- **Schema/validate:** `validate.js` accepts the new kind + edge type; a
  `grants_buff` edge whose endpoints don't resolve fails the build (referential
  integrity, unchanged policy).

## Build/runtime wiring

- **Build:** new `scripts/graph/buffs.js` exporting `buffNodes()` + `buffEdges()`,
  merged in `build.js` (source tier, before the manual overlay). Add `buffs.json`
  to `SOURCE_FILES`.
- **Bundle:** extend the generated-artifact build step to emit
  `public/generated/buffs.json` from the graph (adapter in `src/data/buffs.js`,
  read-only over nodes/edges — no source reads at runtime).
- **Runtime adapter** `src/data/buffs.js`: `listBuffs()`, `buffBySlug()`,
  `buffViewModel()` reading nodes/edges via `graph.js`; used by the bundle builder,
  the `/buffs` route, and the gem-page "Grants" chip.
- **Prerender:** `/buffs` index is crawlable; buff cards are **not** crawled (client
  renders from the bundle) — same exclusion posture as `/search`. Verify with
  `npm run build:static` (static-only failure modes).

## Explicit non-goals

- Ailment `inflicts` edges; `scales`/`modifies` edges.
- Direct mod-stat → buff parsing (non-skill "you have X" grants).
- buff ↔ keyword cross-link/dedup.
- Per-buff prerendered pages.
- The broad static file-count rearchitecture (art→R2, migrating existing card
  kinds) — recorded in the roadmap, not built here.
