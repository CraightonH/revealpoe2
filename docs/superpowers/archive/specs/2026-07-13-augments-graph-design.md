# Augments (Socketables) — graph model + item-page presentation

**Status:** design approved, execution not started.

## Goal

Model **augments** (socketables — in-game "Augment" items as of patch 0.5: Runes, Soul Cores, Idols, Abyssal Eyes, Congealed Mist) as first-class graph data, and surface them on item pages. The wiki's value is the relationship **"which augments can socket into this item, and what does each do here?"** — answered on `/bases/:class` pages and on unique-item pages whose base class accepts augments.

This delivers item #5 of the data-exploration exercise (2026-07-13 session). Items #1 (runeforged variants) and #4 (Vaal-cultivation replacement pools) are **deferred pending GGPK inspection**. Items #2 (corruption implicits) and #3 (double corruption) are **explicitly out of scope** — their pool data already exists in the graph (`affix` nodes, `origin:"corrupted"`), and the only missing pieces (non-mod Vaal-Orb outcomes: nothing / quality / reroll / add-socket / destroy odds) are engine-logic constants not present in source; we are not hand-curating them now.

## Background (data facts, from the 2026-07-13 audit)

Source: `data/source/repoe-poe2/augments.json` (295 entries, keyed `Metadata/Items/SoulCores/…`) joined to `base_items.json` (100% key match) for name / icon / tags / stack size / description / required level.

- **Five families** (`augments.json` `type_id` → `type_name` label): `Rune` (221), `Idol` (35), `SoulCore` → "Soul Core" (34), `AbyssalEye` → "Abyssal Eye" (4), `CongealedMist` → "Congealed Mist" (1).
- **Only Runes have tier variants.** A rune identity (e.g. "Vision Rune") ships as Lesser / (normal, no prefix) / Greater / Perfect — same base name, distinguished by a name prefix and a `rune_lesser|rune_normal|rune_greater|rune_perfect` tag; only the stat *values* scale across tiers. Tier rank: `lesser < normal < greater < perfect`.
  - Soul Core `soul_core_tier1|2|3|vaal` tags are **not** variants of one identity — each is a distinct item at a fixed tier. Idols, Abyssal Eyes, Congealed Mist are single-tier distinct items. So the "collapse tiers into one node" logic applies **only to Runes**; every other family is one node per entry.
- **Per-category grants.** Each augment's `categories` object maps a gear category (Body Armour, Boots, Helmet, Martial Weapon, Armour, All, …) → `{ stat_text[], stats[], target, bonded_stat_text[]?, bonded_stats[]? }`. A single augment grants *different* stats per slot (e.g. Tempered Rune: "Martial Weapon: Adds 6–9 Physical Damage" / "Armour: 14–21 Physical Thorns damage"). `stat_text` + `stats[]` min/max render exactly like affix tiers do today.
- **Limit** is captured (`augments.json` `limit`): `"1"`, group limits like `"1 [AldursLegacy|Aldur's Legacy]"` / `"1 [Ancient|Ancient Augment]"`, or absent.
- **29 category keys**, including groupings (`Martial Weapon`, `Armour`, `All`, `Caster Weapon`, `Wand or Staff`, compound strings) and one class-name mismatch (`Quarterstaff` → item class `Warstaff`). `target` is inconsistently a string *or* an array — normalize both.

## Graph model

### New node kind: `augment`

Add `KINDS.AUGMENT = 'augment'` (`scripts/graph/schema.js`). One node per augment **identity**:

- **Runes:** tier variants collapse into one node keyed by the base name (leading `Lesser |Greater |Perfect ` stripped) within the `Rune` family; the node carries `tiers[]`. This mirrors the existing `affix` node `tiers[]` pattern, making "card shows top tier, hover reveals other tiers" a pure render decision.
- **All other families:** one node per entry, a single-element `tiers[]`.

Node id: the metadata key of the **highest tier** in the group (stable, source-derived). `source: "repoe"`.

Node shape:

```js
props: {
  family: "Rune",              // type_id
  familyLabel: "Rune",         // type_name, markup stripped — the sub-section header
  limit: "1" | "1 Ancient Augment" | null,   // markup stripped
  iconDds,                     // base_items visual_identity.dds_file (top tier)
  requiredLevel,               // top tier
  stackSize,                   // base_items stack_size (e.g. "1 / 10" numerator/denominator)
  description,                 // base_items properties.description (flavour / "Place into an empty Augment Socket…")
  categories: [                // top-tier slot applicability, display order preserved
    { category: "Martial Weapon", target: "…", statText: [ "Adds 6 to 9 [Physical|Physical] Damage" ], bondedStatText: [] },
    …
  ],
  tiers: [                     // sorted LOW→high; single element for non-runes
    { tier: "lesser|normal|greater|perfect|base", name, requiredLevel,
      categories: [ { category, statText[], bondedStatText[] } ] },
    …
  ],
}
```

`statText` is display text with keyword markup preserved (no HTML) — the app applies `renderGameText`. Reuse `affixes.js` `statLineTexts()` / `resolveImplicitTexts()` machinery for stat_text + min/max → "(6–9)" rendering; refactor the shared bits out of `affixes.js` if needed rather than duplicating.

### New edge: `sockets_into`

Add `EDGE_TYPES.SOCKETS_INTO = 'sockets_into'`. Edge `augment → Class/<itemClass>`, `source: "derived"`, `via` the category map.

- Reverse lookup `edgesTo('Class/<class>', 'sockets_into')` powers `/bases/:class`.
- Unique pages resolve their class through the existing `unique → has_base → base → in_class → Class` path, then the same reverse lookup.
- The `"All"` category expands to every equipment class; groupings expand to their member classes.

### Category → item-class map

A committed, hand-authored taxonomy constant consumed by the resolver (recommended over a `data/manual/` overlay because augment nodes are already source-derived in the same module — keeps it self-contained; edges are still stamped `derived` with a `via`). It maps each of the 29 category keys to a set of `BROWSABLE_CLASSES` members (e.g. `Armour → {Body Armour, Boots, Gloves, Helmet}`, `Martial Weapon → {all martial weapon classes}`, `All → every equipment class`, `Quarterstaff → Warstaff`).

**Guardrails (build-failing), mirroring `gear-slots.json`:**

- **Coverage audit:** every category key appearing in `augments.json` must be mapped; an unmapped key **fails the build** (never a silent drop).
- **Referential integrity:** every target class name must resolve to a live class node; a stale name (renamed in a future scrape) **fails the build**.
- **Retirement/derivability note:** if a future scrape ever ships `sockets_into`-equivalent data natively, revisit and retire the constant.

## Presentation

### Card layout (maps onto the existing `.newItemPopup` structure)

Matches the in-game tooltip (reference: Tempered Rune):

```
.itemHeader.doubleLine   → augment name banner (rune/rarity border)
[ ICON ]                 → inside the popup, between header and type line   ← see icon rule below
.typeLine                → familyLabel ("Rune")
Stack Size: n / m        → stackSize
.separator
Requires: Level N        → requiredLevel (top tier)
.separator
.explicitMod × categories → one line per category, category name linkified,
                            value ranges inline ("Martial Weapon: Adds 6 to 9 Physical Damage")
.separator
.FlavourText             → description ("Place into an empty Augment Socket…")
```

### New rule: icon placement by item bulk (generalize, don't special-case)

Document in the UI-fidelity rules (CLAUDE.md + `docs/`):

- **Stackable items** (source `item_class: "StackableCurrency"` / has `stack_size`): icon renders **inside** the popup, between the header banner and the first body line. (Augments, currency, etc.)
- **Equipment items** (weapons/armour/jewels): art stays **outside** the popup in `.itemboximage` — the existing rule — because the art is too large to sit inside.

This is a general stackable-vs-equipment rule, not an augment exception.

### Tier block — item-page-only

The reusable augment card renders a **single** augment (used elsewhere later — e.g. a bare hover tooltip — showing only the hovered augment).

On `/bases/:class` and unique pages **only**, the card appends — **under `.FlavourText`, after another `.separator`** — the rune's **other tiers, ordered highest-range on top** (perfect → greater → normal → lesser), each with its per-category value ranges. Non-rune augments (single tier) render no tier block.

The macro takes a `showTiers` flag (default `false`); the base/unique templates pass `true`. Everywhere else the flag stays off, keeping the card isolated.

### Adapter, macro, templates

- `src/data/augments.js` — presentation adapter: reads augment nodes + `sockets_into` edges, groups by family for a class, picks the top tier, owns rendering (stat text → HTML, tier-range formatting). No source reads.
- `views/macros/augment-cards.njk` — the card macro (`showTiers` param) + a "Socketables" section macro that sub-groups by family.
- `/bases/:class` and unique templates include the section, gated to classes that have augments.
- **Crawler:** the tier hover/expander is rendered **inline** (data-driven CSS/DOM, no fetched URL), so it introduces no new crawlable endpoint and no static-prerender 404 risk.

## New / changed files

- `scripts/graph/schema.js` — `+KINDS.AUGMENT`, `+EDGE_TYPES.SOCKETS_INTO`.
- `scripts/graph/augments.js` — **new** resolver: `augmentNodes()`, `augmentEdges()`, category→class map + guardrails; reuses shared stat-text rendering from `affixes.js`.
- `scripts/graph/build.js` — wire augment nodes/edges into the merge + `SOURCE_FILES` hash (`augments.json`) + provenance.
- `src/data/augments.js` — **new** adapter.
- `views/macros/augment-cards.njk` — **new** macro.
- `/bases/:class` + unique templates — include the Socketables section.
- CLAUDE.md + `docs/` — the stackable-icon rule.
- Tests (below).

## Testing

- **Build/graph tests:** family counts (Rune 221 collapses to N rune identities; Idol 35 / SoulCore 34 / AbyssalEye 4 / CongealedMist 1 stay 1 node each); Rune tier collapsing (a known rune has ordered `tiers[]` with correct rank + scaling values); every `sockets_into` edge resolves to a live class node; category-coverage audit fails on a synthetic unmapped key; `limit` parsed for a Limit-1 augment.
- **Graph-shape test:** `augment` kind + `sockets_into` edge type present in the artifact; provenance counts include them.
- **Adapter test:** reverse lookup returns the right augments for a sample class; top-tier selection + tier-range ordering (highest on top).
- **Static build:** `npm run build:static` clean (no new crawlable endpoint expected; confirm no 404s).
- Keep `npm test` green throughout (TDD).

## Non-goals / deferred

- Corruption / double-corruption outcome curation (#2/#3) — pool already in graph; non-mod outcomes are engine constants, not sourced.
- Runeforged variants (#1) and Vaal-cultivation replacement pools (#4) — **deferred pending GGPK inspection**; both need extraction not present in RePoE.
- Modeling the augment items as browsable `base` nodes (they are not in `BROWSABLE_CLASSES`) or as currency nodes — not required for the relationship.
- Reusable augment tooltip on non-item pages — the macro supports it (`showTiers:false`), but wiring other pages is out of scope here.
```
