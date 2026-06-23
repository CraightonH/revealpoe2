# Base Items → Graph Foundation + App-Cutover — Design

**Date:** 2026-06-23
**Status:** Approved (design); implementation plan to follow.

This is **follow-on plan #2** from `2026-06-22-graph-data-model-design.md` (Sequencing:
"bases → affixes → uniques → passives → keywords") and mirrors the architecture of
`2026-06-23-gem-app-cutover-design.md`. It ports the **base** node kind into the build-time
graph and cuts the app's base pages over to read the artifact — following the exact
foundation→cutover pattern the gems vertical slice established.

## Problem

`src/data/baseItems.js` reads raw source at runtime (`base_items.json`, `item_classes.json`
via `loadJson`) and re-derives base identity, slugs, class taxonomy, requirements, properties,
icons, implicit IDs, granted skills, and rune-variant folding on every request. Per the graph
data-model design, that resolution belongs in the build-time graph; the app should read
**resolved data** from the artifact and keep **all view logic** (`linkifyRequirement`,
`linkifyPhrases`, `ddsUrl`, card layout).

## Scope & the bases/affixes boundary (the key decision)

Base items are entangled with affixes/mods (the next, separate plan) and uniques (a later
plan). This slice ports only what **bases own intrinsically**, leaving cross-kind references on
source — a **partial cutover**, exactly as the gem slice left non-gem kinds on source.

### The kind-at-a-time principle

The graph is built one node kind at a time. Each slice fully ports **its own kind**, but a
view-model usually also pulls in data belonging to *other* kinds. Those cross-kind reads stay
on source until those other kinds get their own plans.

- **Gems had zero leftovers** because a gem VM depends on exactly one other thing — the skill
  it grants and other gems (recommended supports) — and the gem slice bundled both in (`skill`
  nodes + resolved effect text on the gem node). Nothing a gem needs lived outside the slice.
- **Bases legitimately keep source reads** because a base page displays data from two whole
  kinds that are deliberately separate future plans (mods/affixes, uniques). We cannot port
  those here without doing those plans.

### In scope (ported into the graph)

Builder reads only `base_items.json` + `item_classes.json`.

- **`base` nodes** — one per browsable base, keyed by its source Metadata id. Reproduces
  `buildIndex`'s exact selection from source: `domain === 'item'`,
  `release_state === 'released'`, `item_class ∈ BROWSABLE_CLASSES`, name|class dedup,
  rune-variant exclusion, and the `name--<classslug>` slug-disambiguation (a name appearing in
  >1 distinct browsable class is suffixed).
- **`class` nodes** — one per browsable item class. Synthetic id `Class/<classId>` (item
  classes have no Metadata key). `name` = class display name, `slug` = `slugify(classId)`.
- **`tag` nodes** — one per distinct tag carried by a browsable base. Synthetic id
  `Tag/<tag>`. `name` = the tag string, `slug` = `slugify(tag)`.
- **Edges:** `in_class` (base → class) and `tagged` (base → tag). Both already in `EDGE_TYPES`.

**Base node `props`** (resolved *data*, pre-presentation):
`itemClass, className, classSlug, dropLevel, inventorySize {w,h}, tags[], attr, iconDds,
implicitIds[], skillsGranted[], requirements[]` (plain strings, pre-linkify),
`properties` (`computeProperties` structured output, pre-`labelHtml`), `rawProperties`,
`runeVariants [{ name, optionIdSets: number[][] }]` (raw implicit-id sets per variant).
`search` = lowercased `name + className + tags`.

### Deferred — stays on source in `baseItems.js` (mod/affix + unique kinds)

The base node stores the raw join keys; only the *resolution* into other kinds is deferred.

| Base-page data | Owner kind | Resolution path (deferred) |
|---|---|---|
| implicit mod **text** (`resolveImplicits(implicitIds)`) | mod/affix | `mods.js` |
| rune-variant implicit **text** (`optionIdSets` → `resolveImplicits`) | mod/affix | `mods.js` |
| class affix tables (`getModsForClass`/`getCorruptedForClass`/`getDesecratedForTags`) = the `rolls_on` relationship | mod/affix | `mods.js` |
| `affixBaseTargets` (reverse of the affix tables) | mod/affix | `mods.js` (via `getItemClass`) |
| `uniquesOnBase` ("which uniques use this base") | unique | `uniques.js` |

Implicit-text resolution is deferred *whole* (not split) because the same `resolveImplicits`
serves the rollable affix tables and runs through the mod table (`mods.json`,
`generation_type: "unique"`) — half-porting it would mean porting the mod resolver, which **is**
the affixes plan.

### Not "stays on source"

- **`skills_granted`** resolves via `getGemRefByKey` — and gems are **already ported**, so that
  is a **graph read, not a source read**. Stored as a raw `skillsGranted[]` prop; resolved to
  `{ slug, name, iconUrl }` refs at VM time through the existing graph-backed helper.
- A `grants` base→gem **edge** is **not** created this slice: it is out of the task's
  `in_class`/`tagged` edge scope, and the gem key→node mapping has known edge cases (noted in
  `scripts/graph/gems.js`) that an edge could diverge on. Resolving through `getGemRefByKey`
  preserves exact parity. Promotion to an edge is deferred.

### Net result

After cutover, `baseItems.js` reads **zero** `base_items.json`/`item_classes.json`. It still
calls `mods.js`/`uniques.js` for the deferred pieces — exactly the gem-slice shape (a kind
fully severed from its own source; cross-kind references awaiting their plans). Nothing is
permanently excluded: each deferred item ports when its kind's plan lands (affixes next, then
uniques); the base node already holds the raw keys/IDs those plans will turn into edges.

## Architecture

```
build/graph.json ──► src/data/graph.js ──► src/data/baseItems.js ──► routes / uniques / theorycraft
(resolved data)      (load + traversal,    (presentation adapter +   (consumers, unchanged API)
                      reused unchanged)      deferred mods/uniques)
```

### 1. Builder — `scripts/graph/bases.js` (new)

The base-kind resolver, modeled on `scripts/graph/gems.js`. Reads only source via `loadJson`;
imports allowed pure leaf resolvers (`slugify`; `computeProperties` from `itemStats.js`, which
operates on raw `v.properties`; the `ATTR_ABBR`/`ATTR_ORDER` constants from `attributes.js`).

- `selectBaseRecords()` → `[{ id, slug, itemClass, raw }]` — re-derives `buildIndex`'s base
  selection, dedup, rune-exclusion, and slug-disambiguation from source.
- `baseNodes()` → `{ nodes, records }` — base nodes with the props above, including the
  builder-owned rune-variant fold (`RUNE_VARIANT_RE` match, parent join, dedup by implicit-id
  set) producing `runeVariants[{ name, optionIdSets }]` on the parent base node.
- `classNodes()` → `Node[]` — browsable item-class nodes.
- `tagNodes(records)` → `Node[]` — distinct-tag nodes over the selected bases (no dangling).
- `baseEdges(records, nodeIds)` → `Edge[]` — `in_class` + `tagged`, emitted only when the
  target node exists.

### 2. Builder fold-in — `scripts/graph/build.js`

Add base/class/tag nodes and base edges to `buildGraph()`; add `item_classes.json` to
`SOURCE_FILES` so `sourceHash` covers all builder inputs. `validateGraph` already enforces
per-kind slug uniqueness, unknown kinds/edge-types, and no dangling edges.

### 3. Read layer — `src/data/graph.js`

**Reused unchanged.** `getNode`/`nodesByKind`/`nodeBySlug`/`edgesFrom`/`edgesTo`, the memoized
load, the in-memory `ENOENT` fallback, and the staleness guard all already exist from the gem
cutover.

### 4. Presentation adapter — `src/data/baseItems.js` (rewrite internals)

Public API is **unchanged**: `listItemClasses`, `getItemClass`, `listBaseNav`, `getBaseItem`,
`getBaseByName`, `buildBaseItemViewModel`, `affixBaseTargets`. Internals switch to `graph.js`:

- A `toBase(node)` normalizer mirrors today's record field names so `uniques.js`
  (`getBaseByName(name)` → `.className`/`.classSlug`/`.rawProperties`/`.inventorySize`/
  `.requirements`) and `theorycraft.js` need no change. `requirements` is built by mapping
  `linkifyRequirement` over the node's plain `requirements`; `properties` adds `labelHtml` via
  `linkifyPhrases` over the node's structured `properties`; `iconUrl = ddsUrl(node.props.iconDds)`;
  `implicits = resolveImplicits(node.props.implicitIds)` (deferred); `grantedSkills =
  skillsGranted.map(getGemRefByKey).filter(Boolean)` (graph-backed).
- Index helpers (`_byClass`/`_byName`/`_classInfo`) are rebuilt from `nodesByKind('base')` and
  `nodesByKind('class')` instead of `loadJson`. `getItemClass`, `topTierBases`, `subtypesOf`,
  `modeProp`, `listBaseNav`, `listItemClasses` operate over graph-derived base records.
- `getItemClass`'s affix tables and `affixBaseTargets` call `mods.js` exactly as today
  (deferred). `buildBaseItemViewModel` resolves rune `optionIdSets` via `resolveImplicits` and
  `uniquesOnBase` via `listUniques` (deferred).
- Display constants/grouping that are presentation stay (`GROUPS`, `BROWSABLE_CLASSES`,
  `ATTR_ORDER`, `ATTR_LABELS`, `OFFHAND_CLASSES`). `RUNE_VARIANT_RE` moves to the builder with
  the rune selection it gates.

## TDD & parity

Mirror the gem task shape (schema → resolver → nodes → edges → fold → cutover). `schema.js`/
`validate.js` are reused.

- Per-step builder tests in `test/graph/bases.test.js`: selection/slug parity vs `getBaseItem`/
  `listBaseNav`, node props, class/tag nodes, edges (no dangling).
- A **temporary** `test/graph/parity.test.js` (modeled on the gem parity asserts in
  `test/graph/gems.test.js`): compares the builder's base output to the **current**
  `baseItems.js` record fields — id/slug set, props, rune id-sets, class/tag node sets, edges.
  Proves re-derivation **before** cutover; **deleted at the end** (circular once the app reads
  the artifact). Parity is a test, never a build input — lineage stays source → graph.
- `test/baseItems.test.js` stays **green unchanged** throughout (the rendered VM is identical;
  only its data source moves).
- `pretest`/`prestart` already run `build:graph`; the in-memory fallback covers bare
  `node --test`.

## Data flow (base detail page, after)

```
GET /base/:slug
  → buildBaseItemViewModel(slug)
      → graph.nodeBySlug('base', slug)            // node + props (class, tags, size, icon, ...)
      → linkifyRequirement / linkifyPhrases       // app-owned presentation
      → resolveImplicits(props.implicitIds)        // mods.js (deferred)
      → props.runeVariants → resolveImplicits      // mods.js (deferred)
      → props.skillsGranted.map(getGemRefByKey)    // graph-backed (gems already ported)
      → listUniques().filter(base === name)        // uniques.js (deferred)
  → render base.njk
```

## Risks / mitigations

- **Record-shape drift breaking a consumer.** Two external readers (`uniques.js`,
  `theorycraft.js`) plus `test/baseItems.test.js` pin the shape; `toBase` mirrors field names
  exactly. Covered by existing tests staying green.
- **Selection/slug divergence from the current app.** The temporary parity test asserts the
  base id/slug set and props field-for-field before cutover.
- **Stale artifact.** Existing boot staleness guard + `pretest` rebuild (gem-cutover work).

## Non-Goals

- Migrating any mod/affix or unique kind off source (those are the next plans).
- A `rolls_on` affix↔base edge, `affixBaseTargets` on the graph, or a `grants` base→gem edge.
- Committing the artifact (`build/graph.json` stays gitignored, rebuilt by `prestart`/`pretest`).
- Any rendering/view change — base pages render byte-for-byte the same as today.
