# Gem App-Cutover — Design

**Date:** 2026-06-23
**Status:** Approved (design); implementation plan to follow.

This is **follow-on plan #1** from `2026-06-23-graph-foundation-gems.md`: point the running
app's gem pages and gem search at the built `graph.json` artifact instead of re-deriving gem
data from `$POE2DATADIR` in the request path. The graph foundation (build pipeline, schema,
validator, gem/skill nodes, `grants`/`recommends_support` edges, parity test) already exists.

## Problem

`src/data/gems.js` currently reads raw source at runtime (`skill_gems.json`, `skills.json`,
`base_items.json` via `loadJson`) and re-derives identity, slugs, origins, effect sections,
and recommended-support resolution on every request. That same resolution now also exists in
`scripts/graph/gems.js`, pinned to the app by `test/graph/parity.test.js`. We have two copies
of the resolution logic. The cutover makes the **artifact the single source of resolved gem
data**, leaving `gems.js` as a pure presentation adapter.

Per the graph data-model design (`2026-06-22-graph-data-model-design.md`): the artifact holds
**resolved data**; the app keeps **all view logic** (`renderGameText`, keyword linkification,
rarity borders, card layout, CSS). This cutover preserves that split.

## Scope

**In scope:** gems only. After this pass the gem request path performs **zero** reads of
`$POE2DATADIR`.

**Out of scope:** every other kind (uniques, mods, bases, passives, keywords) keeps reading
source as it does today — those are later follow-on plans. `$POE2DATADIR` therefore remains a
runtime dependency of the app *as a whole* until those land; this pass only severs gems from it.

## Decisions (settled)

- **Artifact shipping:** `build/graph.json` stays **gitignored**; it is produced by a
  `prestart` build step (`npm run build:graph`). The app does not assume a committed artifact.
  Build/test ergonomics are handled by an in-memory fallback (below) so `node --test` and dev
  never break on a missing file.
- **Cutover depth:** clean — extend the builder to carry the few fields the gem view-model
  still needs from source, so nothing in the gem path falls back to `loadJson`.

## Architecture

```
build/graph.json ──► src/data/graph.js ──► src/data/gems.js ──► routes / theorycraft / uniques
(resolved data)      (load + traversal)    (presentation only:    (consumers, unchanged API)
                                            renderGameText, borders,
                                            card layout)
```

### 1. Graph read layer — `src/data/graph.js` (new)

The only module that knows the artifact's on-disk shape. Loads `build/graph.json` once
(memoized) and exposes generic traversal:

- `getNode(id)` → node (with `id`) or `null`
- `nodesByKind(kind)` → `Node[]`
- `nodeBySlug(kind, slug)` → node or `null` (built once per kind, memoized)
- `edgesFrom(id, type?)` → `Edge[]`
- `edgesTo(id, type?)` → `Edge[]` (reverse traversal over the same stored edges)

**Loading & fallback.** Read `build/graph.json`. On `ENOENT`, build the graph in memory via
`buildGraph()`/`toArtifact()` and log a one-line notice (`run npm run build:graph`); never
write the file from the app (prod filesystems may be read-only — `prestart` writes it). This
keeps `node --test` and dev robust under the gitignored-artifact decision.

**Staleness guard.** When the artifact was loaded from disk **and** `$POE2DATADIR` is present,
recompute the source hash (reuse the builder's `hashSources`, exported from `build.js`) and
`console.warn` on mismatch against `meta.sourceHash`. Skip silently when source is absent
(production) or when the graph was built in-memory (fresh by construction). This is what makes
source a **build-time** dependency for gems.

### 2. Builder extension — `scripts/graph/gems.js`

`buildGemViewModel` reads three facts the artifact does not yet carry. Add them so the gem path
needs no source:

- gem node prop **`gemIconDds`** ← `base_items[base_item.id].visual_identity.dds_file` (the
  faceted inventory-gem icon, distinct from the skill's `iconDds`).
- gem node prop **`hoverDds`** ← `raw.ui_image`.
- skill node prop **`reservation`** ← `skill.static.reservations` → `{ kind, amount }` or `null`
  (a fact of the granted skill, so it lives on the skill node per graph rule #5).

Regenerate the artifact. Extend `test/graph/parity.test.js` to assert the three new fields
(still a valid source↔artifact comparison at this stage; the file is deleted in step 5).

### 3. Presentation adapter — `src/data/gems.js` (rewrite internals)

Public API is **unchanged**: `listGems`, `listGemCards`, `getGem`, `getGemRefByKey`,
`getRecommendedSupports`, `buildGemViewModel`, `attributeRequirements`. Internals switch to
`graph.js`:

- Identity / slug / props come from gem nodes (`nodesByKind('gem')`, `nodeBySlug('gem', slug)`).
- The granted skill comes from the `grants` edge → skill node (`types`, `description`,
  `reservation`); `effectSections` are read from gem `props.effectSections` (plain strings) and
  rendered with `renderGameText` here.
- `getRecommendedSupports` walks `recommends_support` edges → target gem nodes for
  `{ slug, name, color }`.
- `getGemRefByKey(key)` is `getNode(key)` → `{ slug, name, iconUrl }`.
- No `loadJson`, no `classifyOrigin`/`index`/`_byKey` — that resolution now lives in the builder.
- Display constants and helpers that are **presentation** stay (`BORDER`, `cardColor`,
  `attributeRequirements`, `ATTR_REQ_RANGE`, `CHAR_LEVEL_RANGE`, `SKILL_TYPE_CATEGORY`,
  `TYPE_LABEL`, `RESERVATION_LABEL`).

`getGem` returns a **normalized** object (node-derived), not the raw record. The two external
readers are updated to the new shape:
- `src/data/uniques.js` reads `gem.icon_dds_file` → use the normalized `iconDds`.
- `src/data/theorycraft.js` reads `raw.grants_skills` / `raw.tags` → use `grantsSkills` / `tags`.

### 4. Boot wiring

`prestart` npm script runs `build:graph` so a deployed/started server has the artifact on disk.
`graph.js` is imported transitively when the gem routes load; no change to `server.js` boot
order is required (the read layer self-initializes on first use).

### 5. Tests

- `test/gems.test.js` (view-model output) must stay **green unchanged** — the rendered VM is
  identical; only its data source moved.
- `test/graph/parity.test.js` is **deleted** at the end (per its own header): once `gems.js`
  reads *from* the artifact, comparing artifact↔app is circular.
- `test/graph/*` builder tests stay.
- Add a focused `test/graph.test.js` for the read layer (`getNode`/`nodeBySlug`/`edgesFrom`/
  `edgesTo`, missing-file fallback).
- Add `pretest`/`prestart` hooks running `build:graph` for `npm test`/`npm start`; the
  in-memory fallback covers bare `node --test`.

## Data flow (gem detail page, after)

```
GET /gem/:slug
  → buildGemViewModel(slug)
      → graph.nodeBySlug('gem', slug)                 // node + props
      → graph.edgesFrom(id, 'grants')[0] → skill node // types, description, reservation
      → graph.edgesFrom(id, 'recommends_support')     // → support gem nodes
      → renderGameText(...) on props.effectSections   // app-owned rendering
  → render gem.njk
```

## Risks / mitigations

- **Stale artifact masking a real change.** The boot staleness guard warns in dev; CI runs
  `npm test` (→ `pretest` rebuild) so tests always run against a fresh artifact.
- **`getGem` shape change breaking a consumer.** Only two external readers; both updated and
  covered by existing `uniques`/`theorycraft`/`search` tests.
- **App→builder coupling via the in-memory fallback.** Acceptable: the builder already depends
  on `src/data/*` leaf resolvers, and the fallback is a dev/test convenience, not the prod path.

## Non-Goals

- Migrating any non-gem kind off source.
- Committing the artifact.
- Any rendering/view change — output is byte-for-byte the same as today.
- Removing `$POE2DATADIR` as a runtime dependency of the whole app (only gems are severed).
