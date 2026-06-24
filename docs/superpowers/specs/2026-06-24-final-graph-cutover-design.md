# Final graph cutover — `src/` reads only the graph db

**Date:** 2026-06-24
**Status:** Approved design

## Goal

Zero references from the wiki app to `$POE2DATADIR`. The app (`src/**`) reads
its data exclusively from the build-time graph artifact (`build/graph.json`).
The graph builder (`scripts/graph/**`) of course still reads source — it is the
ETL that populates the db. This is the final cutover in the series that already
moved gems, bases, affixes, uniques, mods, and passives into the graph.

**Acceptance:** `grep -rn "POE2DATADIR\|loadJson\|getDataDir\|listDataDir" src/`
returns zero hits; `npm test` green; the server boots and renders gem / unique /
keyword tooltips from the artifact with `$POE2DATADIR` unset.

## Problem shape

Two distinct things hide behind "references to POE2DATADIR":

### 1. Runtime leaks — `src/` code that reads source while the server runs

| Module | Source file(s) | Provides | Consumers |
|---|---|---|---|
| `src/data/keywordDefs.js` | `keywords.json` | `{term, definition}` per keyword id; `hasDefinition` gating | keyword API route, gating across all rendered text |
| `src/data/keywordPhrases.js` | `keywords.json` + 4 `stat_translations/*` | derived surface-phrase → keyword-id pairs (startup scan of game markup) | `src/data/keywords.js` renderer |
| `src/data/gemTags.js` | `gem_tags.json` | tag id → `[Id\|Display]` token | `src/data/gems.js` |
| `src/data/theorycraft.js` | `skills.json` | `grants_skills` key → skill display name | search index |

These are the real targets.

### 2. Build-only code that merely *lives* in `src/`

- `src/data/loader.js` (`loadJson`, `listDataDir`) — imported only by
  `scripts/graph/*` after the leaks above are migrated.
- `src/config.js` source-path bits (`getDataDir`, `REPOE`, `expandHome`) —
  imported by `scripts/graph/*` (and `loader.js`).
- `src/data/flavour.js` — already build-only: its only caller is
  `scripts/graph/uniques.js`, which bakes `props.flavour` onto unique nodes. No
  runtime `src` module imports it.

None of these are runtime leaks, but they are the *builder's* code sitting in the
wrong directory, and they keep source-path logic under `src/`. Relocating them
makes the boundary literal: source I/O lives under `scripts/graph/`, and nothing
under `src/` references it.

## What stays as-is (correctly)

- `scripts/graph/**` reads `$POE2DATADIR`. Untouched in principle — it is the ETL.
- `src/data/graph.js` keeps its in-memory build fallback (when the artifact is
  missing) and its dev-only staleness warning. Its import of
  `scripts/graph/build.js` is the **app asking the builder to build the db**, not
  the app reading source: in production (`$POE2DATADIR` absent) both paths no-op.
  This is the established pattern from every prior cutover and is out of scope.

## Part A — Migrate the 4 runtime leaks into the graph

### A1. Keyword glossary → `KEYWORD` nodes

`schema.js` already declares `KINDS.KEYWORD = 'keyword'` (currently unpopulated).

**New build module `scripts/graph/keywords.js`** exports `keywordNodes()`,
producing one node per keyword that has a **non-empty definition**:

```js
{
  id:   <keywordId>,            // e.g. "Critical", "Resistances", "EnergyShield"
  kind: 'keyword',
  name: <term>,                 // keywords.json entry.term, falls back to id
  slug: slugify(id),
  props: {
    definition: <string>,       // non-empty (empty-def keywords get no node)
    phrases: [<surface phrase>, ...]  // derived; may be empty
  }
}
```

- The entire phrase-derivation logic currently in
  `keywordPhrases.deriveKeywordPhrases` **moves here**: scan the glossary
  definitions + the four stat_translation files
  (`stat_descriptions`, `gem_stat_descriptions`,
  `active_skill_gem_stat_descriptions`, `skill_stat_descriptions`), parse
  `[Id|Display]` / `[Id]` tokens, apply the existing `isPhraseLike` filter,
  ambiguity tie-break (canonical-term match), and rare-elision suppression.
- The resulting `[phrase, id]` pairs are grouped by `id` and stored as
  `props.phrases` on the owning keyword node. Because the derivation already
  filters candidates to those with definitions, every phrase-bearing id has a
  node.
- Empty-definition keywords (~257) get **no node** — matching today's
  `hasDefinition` gating, where they render as plain text.

**App side:**

- `src/data/keywordDefs.js` reads from keyword nodes:
  - `hasDefinition(id)` → node exists AND `props.definition` non-empty.
  - `getDefinition(id)` → `{ term: node.name, definition: node.props.definition }`
    for a defined keyword, else `null`.
- `src/data/keywordPhrases.js` shrinks to a thin reader:
  - `installKeywordPhrases()` flattens `nodesByKind('keyword')` into `[phrase,id]`
    pairs (`node.props.phrases.map(p => [p, node.id])`) and calls
    `registerDerivedPhrases`. Stays idempotent (guarded by the existing
    `installed` flag).
  - `deriveKeywordPhrases` and the token-scan helpers are removed from this
    module (they now live in the build module).

`src/data/keywords.js` (the renderer: `renderGameText`, `linkifyPhrases`, the
curated `KEYWORD_PHRASES` seed, `registerDerivedPhrases`) is **unchanged** — it
already consumes phrases via `registerDerivedPhrases` and gates via an injected
`hasDefinition`.

### A2. Gem tags → baked onto gem nodes

`scripts/graph/gems.js` resolves `gem_tags.json` at build time. For each gem
node it stores the displayable tokens for that gem's tags:

```js
props.tagTokens: [
  { token: '[AoESkill|AoE]', display: 'AoE' },
  { token: '[Fire]',          display: 'Fire' },
  ...
]
```

Resolution reuses the existing `parseTagToken` rules: map id → `gem_tags.json`
value, drop ids whose value is `null` (non-display tags), and split
`[Id|Display]` vs `[Display]` to derive `display`.

**App side:**

- `src/data/gems.js` replaces both `displayTagTokens(gem.tags, [typeLine])` call
  sites with a local helper that filters `node.props.tagTokens`, dropping any
  whose `display` is in the exclude list, and returns the `token` strings (still
  fed through `renderGameText` for keyword hovers, unchanged).
- `src/data/gemTags.js` is **deleted**.
- `test/gemTags.test.js` is removed; the resolution rules get coverage on the
  build side (a `scripts/graph` test asserting the token shape for known tag ids:
  `area` → `[AoESkill|AoE]`, `fire` → `[Fire]`, `strength` → dropped).

`toGem(node)` in `gems.js` gains `tagTokens: p.tagTokens ?? []` (kept available
for the local helper; the raw `tags` id list remains for any other use).

### A3. `theorycraft.js` grant names → existing skill nodes

In `gemDocs()`, replace:

```js
const skills = loadJson(`${REPOE}/skills.json`);
const grants = (raw.grants_skills ?? [])
  .map((k) => skills[k]?.active_skill?.display_name)
  .filter(Boolean);
```

with a graph lookup:

```js
const grants = (raw.grants_skills ?? [])
  .map((k) => getNode(k)?.name)
  .filter(Boolean);
```

`getNode` is already imported transitively via `gems.js`; import it directly from
`./graph.js`. Skill node id == `grants_skills` key, and `name` ==
`active_skill.display_name || key` (confirmed in `scripts/graph/gems.js`
`skillNodes`).

**Documented drift:** Skill nodes fall back to `name = key` when the source
`display_name` is empty — this affects a majority of grant keys, not a rare few.
To preserve the prior `.filter(Boolean)` behavior, `gemDocs()` drops any grant
whose resolved node name equals its key, so internal keys never enter the search
index. No behavioral drift remains.

## Part B — Relocate build-only source I/O out of `src/`

- Move `src/data/loader.js` → `scripts/graph/loader.js`.
- Move `getDataDir` / `REPOE` / `expandHome` out of `src/config.js` into a new
  `scripts/graph/source.js`. If `src/config.js` is left empty, delete it; if it
  retains non-source exports, keep only those.
- Move `src/data/flavour.js` → `scripts/graph/flavour.js`.
- Update the imports in the six `scripts/graph/*` files that reference
  `../../src/data/loader.js` and `../../src/config.js`
  (`build.js`, `uniques.js`, `affixes.js`, `passives.js`, `bases.js`, `gems.js`)
  to the new locations.
- Move `test/loader.test.js` → `test/graph/loader.test.js` (or alongside the
  build tests) and relocate the `expandHome` assertions from `test/config.test.js`
  to a test that imports the new `scripts/graph/source.js`. Delete
  `test/config.test.js` if nothing else remains in it.

After Part B, `src/**` imports no source-reading code; `getDataDir` and friends
have only build-layer consumers.

## Build wiring & validation

In `scripts/graph/build.js`:

- `import { keywordNodes } from './keywords.js'` and add its output to the `nodes`
  array in `buildGraph()`. Keyword nodes have no edges in this cutover
  (the curated phrase map + token markup already wire keyword references at render
  time; `references_keyword` edges remain reserved for future work).
- Extend `SOURCE_FILES` so `sourceHash` covers everything the build now reads:
  add `keywords.json`, `gem_tags.json`,
  `stat_translations/gem_stat_descriptions.json`,
  `stat_translations/active_skill_gem_stat_descriptions.json`,
  `stat_translations/skill_stat_descriptions.json`.
  (`stat_descriptions.json`, `passive_skill_stat_descriptions.json`, and
  `flavour.json` are already listed.) Some of the four phrase-scan translation
  files are optional in a given snapshot — guard their reads (the current
  derivation already wraps them in try/catch) and only hash files that exist,
  consistent with the existing `pob-uniques` directory handling.
- `validateGraph` runs over the augmented node set unchanged (keyword nodes carry
  the standard `id/kind/name/slug` and pass `makeNode`).

## Migration strategy — parity-first (matches prior cutovers)

For each leak, before deleting the source-reading path, add a **temporary parity
test** asserting the graph-derived output equals the old source-derived output,
then cut over, then remove the temporary test:

1. **A1 keyword defs + phrases:** parity test compares
   `nodesByKind('keyword')`-derived `getDefinition`/`hasDefinition` and the
   flattened phrase pairs against the current `keywords.json`-derived results
   (including the full set produced by today's `deriveKeywordPhrases`).
2. **A2 gem tag tokens:** parity test compares per-gem `tagTokens` against
   `gem_tags.json`-resolved tokens for a sample of gems.
3. **A3 grant names:** parity test compares `getNode(k)?.name` against
   `skills.json` display names for all `grants_skills` keys (allowing the
   documented empty-`display_name` drift).

Remove the temporary parity tests after cutover, as `dc6c992` did for the base
cutover.

## Order of work

1. **Part B relocation** (no behavior change) — move `loader.js`, source bits of
   `config.js`, and `flavour.js` into `scripts/graph/`; fix imports; move tests.
   Run `npm test` to confirm green.
2. **A1 keywords** — build module + node assembly + parity test → app cutover
   (`keywordDefs.js`, `keywordPhrases.js`) → remove parity test.
3. **A2 gem tags** — bake `tagTokens` in `scripts/graph/gems.js` + parity test →
   app cutover in `src/data/gems.js`, delete `gemTags.js` + its test.
4. **A3 theorycraft** — parity test → swap to `getNode(k)?.name`.
5. **Final sweep** — extend `SOURCE_FILES`; run the acceptance grep; full
   `npm test`; boot the server with `$POE2DATADIR` unset and spot-check gem,
   unique, and keyword-hover rendering.

## Out of scope

- `references_keyword` edges / keyword cross-link traversal (reserved; not needed
  to remove the leaks).
- Any change to `src/data/graph.js`'s in-memory fallback or staleness warning.
- Re-modeling item `TAG` nodes or unique `flavour` (already in the graph).
