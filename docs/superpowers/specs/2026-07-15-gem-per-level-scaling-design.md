# Gem Per-Level Scaling Table — Design

**Status:** shipped; extended 2026-07-15 (see *Update* below)
**Date:** 2026-07-15

> **Update (2026-07-15) — two gaps closed after ship:**
> 1. **`damage_multiplier` is now a column.** The original design read only `stat_text`
>    and `costs`. Many attack/triggered skills (Volcanic Steps, Volcanic Eruption, …)
>    scale ONLY via the bare per-level `damage_multiplier` number and so produced an
>    empty/null table. `buildLevelTable` now emits a `kind:"damage"` column per
>    stat_set whose multiplier varies, headed **"Base Damage"**, cells shown as `X%`.
> 2. **The gem table now merges ALL granted skills, not just `grants_skills[0]`.**
>    Scaling still lives per-skill on skill nodes; `src/data/gems.js` `mergeLevelTables()`
>    unions every granted skill's table into one (columns namespaced by skill; each
>    column carries a `skill` caption, shown only when >1 skill contributes, so e.g.
>    Ancestral Cry's two "Base Damage" columns read apart as Volcanic Steps / Volcanic
>    Eruption). Mirrors the effect-sections aggregation done in `scripts/graph/gems.js`.
> 3. **Requires Level + Str/Dex/Int requirement columns added (reverses the two Non-goals).**
>    - *Required level per gem level* is **not** in RePoE — it lives in the GGPK
>      `ItemExperiencePerLevel` table (keyed by `SkillGems.ItemExperienceType`). Promoted
>      via the canaried extraction step `scripts/ggpk/extract-gem-levels.js` →
>      committed `data/manual/gem-levels.generated.json` → `gem-levels` overlay handler →
>      `reqLevels` prop on the gem node. (Supersedes the "required-level column deferred to
>      GGPK backlog" non-goal.)
>    - *Attribute requirements* are stored nowhere; computed like poe2db:
>      `reqAttr = round(4 + 1.7 × requiredLevel × FACTOR[percent])`, where FACTOR is an
>      empirically-fixed per-percent value (NOT percent/100 — every participating attribute
>      takes the full +4 base). Reverse-engineered and verified exactly against poe2db at
>      every gem level for all percents that occur on leveled gems (25/50/75/100). Unseen
>      percents throw. Both columns are gem-wide and lead the table (Requires Level, then
>      Str/Dex/Int), before the per-skill scaling columns.
**Roadmap:** realizes Phase 1 of `2026-07-14-complete-graph-roadmap.md` (gem/skill
per-level scaling). NOTE: the roadmap frames Phase 1 as establishing a
"load-on-demand side-artifact rail" — that framing is a **holdover from scrapped
phases** and is explicitly dropped here (see *Non-goals*). The roadmap doc should be
updated to match once this ships.

## Goal

Add a **per-level scaling table** to the gem page so a reader can see what a skill's
stats actually are at each gem level — the numbers today's tooltip collapses into a
single `(min—max)` range. Example: instead of only "Deals (8—2577) to (12—3866) Fire
Damage", show every level's values (Fireball L1 `8–12` … L20 `224–336` … L40
`2577–3866`).

## Background (current state)

- `scripts/graph/gems.js` → `effectSections()` → `buildSections(skill, 20)` in
  `src/data/statText.js` already reads `stat_sets[].per_level`, but **range-merges**
  the lowest and highest level into one `(min—max)` string. The per-level detail is
  discarded. No level-by-level table exists anywhere in the UI.
- Source: RePoE `data/source/repoe-poe2/skills.json`. Per-level scaling lives in
  `skills[key].stat_sets[].per_level[level].stat_text` (already-rendered sentences,
  e.g. `"Deals 8 to 12 [Fire] Damage"`) and cost in
  `skills[key].per_level[level].costs` (e.g. `{ "Mana": 10 }`).
- The gem page reaches its granted skill via the existing `grants` edge; the gem
  presentation adapter (`src/data/gems.js`) runs every effect line through
  `renderGameText()` (which resolves `[Id|Display]` markup to glossary-linked spans)
  at render/build time. `gem-card.njk` renders the result.

### Data facts (measured across all real gem-granted skills)

- 1,246 gem-granted skills; **301** have ≥1 stat line whose value varies by level —
  these are the ones that get a meaningful table. The rest scale only in cost or not
  at all.
- Varying lines almost always carry numbers (129 have ≥2, only **3** have zero) →
  numeric extraction is safe, with a raw-text fallback for the zero-number oddballs.
- Cost kinds present: `Mana`, `ManaPerMinute`, `Ward`, `WardPerMinute`.
- **143** skills have >1 `stat_set`.
- Cast time is a single top-level `cast_time` (constant, not per-level) → NOT a table
  column; it stays in the existing effect header.
- Inlining the table prop on skill nodes costs **~0.7 MB** on a 16.6 MB
  `graph.json` (~4%). Acceptable as a plain prop — no side-artifact needed.

## Non-goals

- **No side-artifact / load-on-demand mechanism.** The payload is small enough to
  inline as a node prop. (Explicitly overrides the roadmap's Phase-1 "rail" framing.)
- **No required-character-level-per-gem-level column.** That data is not in RePoE
  `skills.json` (`per_level` carries only `costs`); it lives in the GGPK gem
  XP/level-progression tables. Deferred to the GGPK backlog, not this phase.
- **No header reduction / relabeling.** Headers are the number-blanked sentence
  verbatim (decision below). No attempt to shorten "Deals _–_ Fire Damage" to
  "Fire Damage".

## Design

### Data model — `levelTable` prop on the SKILL node

Scaling is a property of the granted skill; multiple gems share a skill; the gem page
already traverses `grants`. So the prop lives on the **skill** node (deduped), not the
gem node.

```
props.levelTable = {
  columns: [ { key, header, kind } ],   // kind: "cost" | "stat"
  rows:    [ { level, cap, cells } ],   // cells: { [columnKey]: cellString }
}
```

- `columns` — one entry per field that **varies** across the skill's levels. A field
  that is constant across all levels is NOT a column (it already appears in the
  effect header; a per-level table should only show what changes). Union of:
  - **cost columns** — one per cost kind (`Mana`, `ManaPerMinute`, `Ward`,
    `WardPerMinute`) whose value varies. `key = "cost:<kind>"`.
    `header` = friendly label via a small `COST_LABELS` map
    (`ManaPerMinute` → "Mana / min", etc.).
  - **stat columns** — one per `stat_text` template key whose rendered value varies,
    merged across ALL `stat_sets`. `key` = the `stat_text` object key (stable stat-id
    string). `header` = the rendered sentence with numbers blanked to `_`, markup
    tokens left intact (resolved at render — see below).
- `rows` — one per level present (union of levels across the cost map and every
  `stat_set`), ordered **descending** (highest level first, e.g. 40 → 1).
  - `cap: true` on the level-20 row (the max a skill gem reaches without external
    modifiers; drives UI flair). `false` otherwise.
  - `cells[columnKey]` = for a stat column, the numbers extracted from that level's
    rendered line, in order, joined by `" / "` (e.g. `"8 / 12"`); the 3 zero-number
    lines fall back to the raw (token-bearing) sentence. For a cost column, the number
    string. A level missing a given column has no entry (renders blank).
- `null` when the skill has no varying field at all (no table shown).

Headers/cells that contain `[Id|Display]` markup are stored **raw** and resolved at
render by `renderGameText()` — same path as `effectSections`, so tokens become
glossary-linked spans and the table can't diverge from the tooltip.

### Builder — `buildLevelTable(skill)` in `src/data/statText.js`

Sits beside `buildSections`, reusing its `NUM` regex / number handling. Pure function:
`skill` → `levelTable` object (or `null`). Called from `scripts/graph/gems.js`
`skillNodes()` and stored on the skill node's `props.levelTable`.

Algorithm:
1. Collect the level set = keys of `skill.per_level` ∪ keys of every
   `stat_set.per_level`. Numeric, sorted descending.
2. For each cost kind and each `stat_text` key, gather its value at every level;
   include it as a column only if it has ≥2 distinct values across levels (varies).
3. Stat header = pick any level's rendered sentence for that key, replace number
   tokens with `_`. Stat cell = ordered numbers of that level's sentence joined by
   `" / "`; if the sentence has zero numbers, cell = the raw sentence.
4. Emit `columns` (cost columns first, then stat columns in `tooltip_order` where
   available, else object order) and `rows` (descending, `cap` on 20).

### Presentation — `src/data/gems.js`

The gem view-model getter resolves the granted skill's `levelTable` (via the graph,
following `grants`) and maps each `column.header` and each string cell through
`renderGameText(text, hasDefinition)`. Adds `levelTable` to the gem view model.

### UI — new section in `views/macros/gem-card.njk` (+ CSS)

A "Per-level scaling" section below the existing effect/tooltip block, rendered only
when `levelTable` is present:
- An HTML `<table>`: a header row of `column.header` cells, then one `<tr>` per level
  (descending). First column is the level number.
- Level numbers and cell values are high-contrast (white numbers on the card surface)
  for at-a-glance scanning across a level.
- The `cap` row (level 20) gets flair: a highlighted row background + a small
  "max gem level" marker/badge.
- Wide tables scroll inside an `overflow-x: auto` container (many columns possible);
  the page body never scrolls horizontally.

## Testing

- **`test/statText.test.js`** — `buildLevelTable` units:
  - Fireball: 2-number damage stat column + descending rows + `cap` on 20.
  - A cost-varying skill → a `cost:Mana` column with correct header label.
  - A multi-`stat_set` skill → columns merged across sets.
  - A constant field → NOT emitted as a column.
  - A zero-number varying line → raw-sentence cell fallback.
  - A skill with nothing varying → returns `null`.
- **`test/gems.test.js`** — the `levelTable` prop lands on skill nodes; a known gem's
  resolved view-model exposes the expected columns/rows with markup resolved.
- **Static build** — `npm run build:static` (a page section changed; catch
  static-only breakage).

## Rollout

1. TDD `buildLevelTable` in `statText.js`.
2. Wire into `scripts/graph/gems.js` `skillNodes()`; `npm run build:graph`.
3. Presentation getter in `src/data/gems.js`; template section + CSS.
4. `npm test` green; `npm run build:static`; verify a damage gem (Fireball) and a
   mechanics gem on `localhost`.
5. Update `2026-07-14-complete-graph-roadmap.md` to drop the side-artifact framing
   from Phase 1 and tick the checklist.
