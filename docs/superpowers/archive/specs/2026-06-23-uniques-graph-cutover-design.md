# Uniques → Build-Time Graph — Design

**Date:** 2026-06-23
**Status:** Approved (design); implementation plan to follow.
**Builds on:** `2026-06-22-graph-data-model-design.md` (the graph data-model + style guide).

## Problem

`src/data/uniques.js` reads `$POE2DATADIR` directly — it parses the `pob-uniques/*.json`
text blocks plus `uniques.json` metadata, joins to bases via `getBaseByName`, and resolves
granted-skill gem refs. `src/data/grantedSkills.js` independently re-parses the same PoB
blocks to collect unique-granted skill names (used by gem origin classification). Uniques are
the next node kind in the `source → graph` cutover (after gems, bases, affixes); the schema
already declares `KINDS.UNIQUE` and the `HAS_BASE` / `GRANTS` edges.

## Decision Summary

Add a `unique` node kind to the build-time graph. One node per source unique, carrying
resolved stat text (split into implicits/explicits), the full set of PoB **variants**, base
identity, and the filterable item class. Two edge kinds connect it: `has_base` (unique → base,
when the base is browsable) and `grants` (unique → skill, one per current-variant
"Grants Skill:" line). The PoB blocks are parsed **once** at build time; `grantedSkillNames`
folds into the unique resolver. `src/data/uniques.js` becomes a pure presentation adapter and
no longer reads `$POE2DATADIR`.

## Node Model — `unique`

- **Identity (rule #3).** Node id `Unique/<uniques.json id>` (e.g. `Unique/Astramentis`),
  falling back to `Unique/<slug>` for the lone unique with no `uniques.json` match
  (Waistgate Heavy Belt). Stable source id, not the display name; slug is a routing property.
  Same-name dedup (Grand Spectrum's two PoB blocks) keeps the first, as today.
- **Stat text is resolved data, not HTML.** PoB braces/variant tags are stripped and the
  implicit/explicit split (`Implicits: N`) is applied. The app keeps all rendering
  (`linkifyPhrases`, value highlighting, gem-icon attachment).
- **Unique-only stat lines stay searchable text** on the node (graph design's worked search
  case) — never promoted to nodes.

```jsonc
"Unique/TheAnvil": {
  "kind": "unique", "name": "The Anvil", "slug": "the-anvil",
  "props": {
    "base": "Bloodstone Amulet",        // PoB line 2 (base display name)
    "itemClass": "Amulet",              // resolved filterable class (see below)
    "className": "Amulets", "classSlug": "amulet",
    "iconDds": "Art/.../TheAnvil.dds",
    "flavour": ["..."],
    "inventorySize": { "w": 1, "h": 1 },
    "currentIndex": 2,                   // live variant: the `Current` token, else last index
    "variants": [
      { "name": "Pre 0.2.0", "implicits": ["+(30-40) to maximum Life"], "explicits": ["20% increased Block chance", "..."] },
      { "name": "Pre 0.4.0", "implicits": ["+(30-40) to maximum Life"], "explicits": ["25% increased Block chance", "..."] },
      { "name": "Current",   "implicits": ["+(30-40) to maximum Life"], "explicits": ["25% increased Block chance", "+(5-10)% to maximum Block chance", "..."] }
    ]
  },
  "search": "the anvil bloodstone amulet <CURRENT-variant stat text> <flavour>"
}
```

### Variants

A **variant** is an alternate version of a unique. ~50% of uniques (216/435) carry `Variant:`
lines; the property is a superset of three cases the graph stays factual about:

- **202 are patch history** — `Pre 0.2.0 → Current`. A variant named exactly `Current` exists
  and is always last.
- **14 are concurrent gameplay forms** all live in the current game — Darkness Enthroned
  (`Helmet / Body Armour / Gloves / Boots / Shield`), Sunsplinter (resistance allocations),
  Voices (socket counts), Rite of Passage (animal forms). No `Current` token.
- **A few mix both** — Morior Invictus, Guiding Palm interleave forms and patch versions.

**Resolution.** `Implicits: N` is a single fixed count (never variant-tagged, never doubled).
For each variant index `i`: `filtered = lines applying to i` (untagged, or `{variant:…}`
includes `i`), in source order, braces stripped; `implicits = filtered[0:N]`,
`explicits = filtered[N:]`. This handles variant-gated implicits (e.g. Guiding Palm's one of
three Purity grants per variant) correctly by construction.

**`currentIndex`** = index of the variant named `Current`; else the last index (the 14 form
uniques, the mixed ones, and zero-/single-variant uniques). The app renders
`variants[currentIndex]` for the tooltip — **byte-identical to today's positional "last
variant" pick**, but selecting by token is robust to PoB reordering.

**No `history`-vs-`form` discriminator is stored.** `variants` (PoB's own umbrella term) is
the only accurate name; `history` would mislabel the 14 concurrent-form uniques. The
distinction is deterministic from a stored fact — `variants.some(v => v.name === 'Current')` —
so future page features (a patch-history diff for the 202; a variant switcher for the 14)
derive it at render time with no re-migration. Full PoB **alt-variant** multi-axis selection
(`Selected Variant:` / `Has Alt Variant:`) is **out of scope**: the current app ignores it
(treats variants single-axis, last wins) and those tokens stay filtered as metadata.

### Filterable item class (resolved at build)

`classifyUnique` runs at build time and stores `className`/`classSlug` on the node: when the
base is browsable, the base node's canonical class (e.g. "Two Hand Maces"); otherwise the
unique's own `item_class`, normalized to the canonical class by slug when one matches, else
raw (charms, flasks, jewels). The app's class-filter list becomes a straight node read.

### Searchable text (rule #7)

`name + base + className + current-variant stat text + flavour`, lowercased. **Current variant
only** — a search reflects the live game state; patch-history rolls are surfaced on the item
page, not in search results.

## Edges

| Source field / join | Edge type | Direction | Notes |
|---|---|---|---|
| unique base name → browsable base node | `has_base` | unique → base | omitted when base not browsable |
| current-variant "Grants Skill:" line | `grants` | unique → skill | resolved by name-slug → skill node |

### `has_base` (unique → base)

Emitted only when the unique's base name resolves to a browsable base node (via a
`name → baseId` map over the base records). Jewels / flasks / charms have no base node →
**no edge**; the unique still carries `base`/`className`/`classSlug` props, so the detail page
and class filters work as today (mirrors `getBaseByName` returning null). The edge replaces
two source-coupled joins:

- **Forward** (unique detail derived stats): app follows `has_base` → base node, reads
  `rawProperties`/`requirements`/`className`, applies `parseLocalMods` + `computeProperties`
  (unchanged, over graph data). No edge → empty properties, `className` falls back to
  `itemClass`.
- **Reverse** (base detail "uniques on this base"): `baseItems.js` replaces
  `listUniques().filter(u.base === b.name)` with `edgesTo(baseId, 'has_base')` — **dropping its
  import of `uniques.js`**.

### `grants` (unique → skill)

One per current-variant "Grants Skill:" line, resolved by name-slug → skill node (72/72
coverage; all unique-granted skills already exist as gem-granted skill nodes), emitted in the
edge phase against `nodeIds` (the `gemEdges` pattern). This is the canonical relationship and
powers reverse queries ("which uniques grant Herald of Ash").

**Rendering stays decoupled for parity.** The grant line's gem icon/link keeps using the app's
existing `getGem(slugify(name))` lookup (70 linked, 2 unlinked — `Compose Requiem`,
`Skeletal Warrior Minion` — identical to today). The edge is the data; upgrading the icon to
walk `skill → gem` (which would fix those 2) is a deliberate later change, not bundled here.

## Module Structure

- **New `scripts/graph/uniques.js`** (build-side resolver):
  - `uniqueNodes()` → `{ nodes, records }`
  - `uniqueEdges(records, baseRecords, nodeIds)` → `has_base` + `grants` edges
  - `grantedSkillNames()` → `Set<string>` — pure source parse of PoB blocks, no graph deps
- **`scripts/graph/gems.js`** imports `grantedSkillNames` from `./uniques.js` (no circular
  import: the function is pure; edges resolve in the edge phase via `nodeIds`).
- **`scripts/graph/build.js`**: assemble unique nodes/edges; extend `SOURCE_FILES`/`hashSources`
  to cover `uniques.json`, `flavour.json`, and the `pob-uniques/*.json` set.
- **Delete `src/data/grantedSkills.js`.**
- **`src/data/uniques.js`** becomes a presentation adapter over the graph (no `$POE2DATADIR`):
  `listUniques`/`getUnique`/`listUniqueCards`/`listUniqueClassFilters`/`buildUniqueViewModel`
  read `unique` nodes + edges and own all rendering. `theorycraft.js` `uniqueDocs` reads
  `unique` nodes (current-variant text only).

## Testing

**Build-side unit tests** (`test/graph/uniques.test.js`):
- One node per unique; id scheme + fallback; Astramentis resolves base, class fields, icon,
  flavour, `variants[]`, `currentIndex`.
- Variant resolution: The Anvil `currentIndex` → `Current`, 3 variants, current explicits
  include the current Block values and exclude legacy ones; Guiding Palm per-variant single
  grant implicit; split applied to filtered lines.
- `grantedSkillNames` pure, contains a known granted skill.
- `uniqueEdges`: `has_base` only to browsable base nodes (Astramentis→Stellar Amulet; a
  jewel/flask unique → none); `grants` resolves 72/72, zero dangling.
- `search` excludes non-current-variant text.

**Temporary worktree parity check** (affix migration's pattern): worktree at `master`
(pre-migration) dumps current output for every unique — `listUniqueCards`,
`buildUniqueViewModel(slug)` for all slugs, `listUniqueClassFilters`, `uniqueDocs` — to a JSON
fixture. A throwaway branch test asserts the graph-backed output equals it byte-for-byte.
**Deleted before merge** (post-cutover the in-repo comparison would be circular).

**Regression guard**: existing `test/uniques.test.js` passes unchanged (borders, variant
filtering, derived stats, flavour, implicit/explicit split). `mods`/`bases`/`gems` suites stay
green. `validateGraph` catches dangling edges / duplicate slugs.

**Artifact size**: measure `build/graph.json` size + parse time before/after (watch the
all-variants data, e.g. Morior Invictus's 28 variants), reported in the merge commit.

## Sequencing (no big-bang)

Branch `feat/uniques-graph-cutover`:
1. Build resolver (`scripts/graph/uniques.js`) + unit tests.
2. Wire into `build.js`; point `gems.js` at the folded `grantedSkillNames`.
3. App cutover: `uniques.js` adapter, `baseItems.js` reverse-edge `uniquesOnBase`,
   `theorycraft.js` unique docs; delete `grantedSkills.js`.
4. Worktree parity check → confirm → remove temp test/fixture.
5. Full suite green; artifact-size measurement.
6. `--no-ff` merge to master.

## Non-Goals

- No PoB alt-variant multi-axis selection (`Selected Variant:`/`Has Alt Variant:`).
- No variant-switcher / patch-history-diff UI (future, pure presentation; data is ready).
- No `skill → gem` icon upgrade for the 2 currently-unlinked grants (deliberate later change).
- No `history`/`form` discriminator baked into the artifact (derivable from variant names).
- Unique-only stat lines stay searchable text, not nodes.
