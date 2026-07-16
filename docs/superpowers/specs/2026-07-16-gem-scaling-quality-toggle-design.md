# Gem "Scaling" table — Levels ⇄ Quality toggle (TODO #6)

**Date:** 2026-07-16
**Status:** Approved design, pre-implementation
**Scope:** Gem detail page scaling table only. No change to the gem card body or its level `<select>`.

## Goal

Rename the gem detail page's "Per-level scaling" table to **"Scaling"** and add a
**Levels ⇄ Quality** toggle. The Quality mode shows how a gem's quality effects scale
with gem quality — specifically surfacing the **breakpoints above the normal 20% cap**
(Gemling Legionnaire / catalyst territory; quality is uncapped in principle but the table
enumerates up to 100%, the realistic ceiling).

Support gems are out of scope — **support gems have no quality**. Only active/spirit skill
gems that carry varying `quality_stats` get a Quality table.

## Background (already in the codebase)

- The quality formula is already reverse-engineered and documented in `src/data/statText.js`:
  a quality stat is stored **per-mille-per-quality-point**, so its value at quality `Q%` is
  `raw × Q / 1000` (hence `raw / 50` at the 20% cap), *before* any unit handler
  (`HANDLERS` map). `resolveQuality()` currently uses this only to render the single
  `(0—N)` string shown at 20%.
- The raw inputs needed to recompute at any quality live in source:
  `skill.stat_sets[i].static.quality_stats = [{ stat: "<template>", stats: { <id>: <permille> } }]`.
  601 such entries exist across skills.json.
- The **level table** is the pattern to parallel:
  - Built at build time: `buildLevelTable(skill)` in `statText.js` → stored on each **skill
    node** as `props.levelTable`.
  - Merged across a gem's granted skills at runtime: `mergeLevelTables(gem)` in
    `src/data/gems.js`, then `renderLevelTable()` → `vm.levelTable`.
  - Rendered by `views/macros/gem-level-table.njk` (a `<details class="rec-group gem-levels">`
    with a scrolling `<table class="gem-levels-table">`).
- The **expandable-rows** pattern to parallel is the affix accordion:
  `views/macros/affix-tables.njk` + `public/js/affix-accordion.js` — a top row always shown
  with a `▸` caret; subsequent rows in the same `tbody` are `hidden` until the top row
  (`role="button"`, `aria-expanded`) is clicked. Pure visibility toggle over server-rendered
  HTML, so it works identically on the static build. Global scripts are wired in
  `views/base.njk` (deferred).

## Data model

### Quality table shape (mirrors the level table)

`buildQualityTable(skill)` returns `null` (no varying quality) or:

```
{
  columns: [ { key, header, kind: 'quality' } ],   // one per varying quality effect
  rows:    [ { quality, cap, band: [ … ], cells: { <key>: <displayValue> } } ]
}
```

- **Columns** — one per `quality_stats` entry whose value **actually varies** across
  quality `1..100`. The `header` keeps the RePoE `[Id|Display]` markup and the number
  blanked to `_` (same convention as level-table headers, e.g. `"Chains _ times"`), so it
  resolves through `renderGameText` at render time. Entries that resolve to no scaling token
  (base-skill references, `dummy_stat_display_nothing`, permille `0`) are dropped.
- **Rows** — **coarse rows at every 5%** (`100, 95, …, 10, 5`, descending to match the level
  table). The **20% row carries `cap: true`** (the standard-quality ceiling, the exact
  analogue of the level-20 `cap` flag). The all-zero 0% baseline row is omitted.
  - Each coarse row's `band` holds the 1% rows strictly between it and the next-lower coarse
    step (e.g. the 25% row's band = `[24, 23, 22, 21]`; the 5% row's band = `[4, 3, 2, 1]`),
    each as `{ quality, cells }`. `band` is present (non-empty) **only if some column's
    display value changes within it**; otherwise the band is omitted and the coarse row is
    not expandable.
- **Cells** — the display value at that quality. Just the scalar (prose lives in the column
  header), same as level-table cells.

### Value display — floor integer counts, exact for magnitudes

`value(raw, Q, handler) = applyHandler(handler, raw × Q / 1000)`, then displayed as:

- **Count/integer stats** (chains, stages, projectiles, stacks, swarms — bare `{stat}` count
  templates): **floored** to an integer. This is what makes breakpoints visible: Arc
  `number_of_chains=100` shows `10%→1, 15%→1, 20%→2` — the jump lands exactly at 20%, as
  in-game. Without flooring, `15%→1.5` reads as wrong and no flat breakpoint appears.
- **Magnitude/percent stats** (`…_+%`, `…metres`, `…seconds`, decimal unit handlers):
  the **exact** scaled value at its natural precision (reuse `resolveQuality`'s
  `round(x, 2)`), e.g. Archmage reservation efficiency `500 → 0.5%/1% → 10% at 20%`.

**Count-vs-magnitude predicate** (the reverse-engineering to verify): treat a stat as an
integer count — and therefore floor it — when its template token has **no decimal-producing
unit handler** and the stat is **not a percentage/magnitude** (stat id does not contain `%`
and the template does not render the token immediately followed by `%`). Everything else is
a magnitude shown exactly.

> **Verification gate (implementation):** confirm the predicate + flooring against poe2db for
> at least: Arc (chains, floor), Arctic Armour (stages, floor), Archmage (reservation
> efficiency %, exact), Ball Lightning / Elemental Surge (AoE radius in metres, exact). If the
> game rounds rather than floors counts, adjust to match observed in-game values. Do not ship
> the predicate unverified.

## Build & runtime wiring (parallels the level table exactly)

1. **`src/data/statText.js`** — add `buildQualityTable(skill)` and the value/predicate
   helpers. Export it.
2. **`scripts/graph/gems.js`** — in `skillNodes`, add `qualityTable: buildQualityTable(skill)`
   to each skill node's `props` (next to `levelTable`). Same size/inline treatment.
3. **`src/data/gems.js`** — add `mergeQualityTables(gem)` (parallel to `mergeLevelTables`:
   union columns across `grants_skills`, dedupe, add a per-column `skill` caption when the
   gem grants >1 contributing skill) and `renderQualityTable()` (parallel to
   `renderLevelTable`: headers + cells through `renderGameText`). In `buildGemViewModel`, set
   `qualityTable: renderQualityTable(mergeQualityTables(gem))`.
   - Row order and the `cap` flag follow `buildQualityTable`; `renderQualityTable` also renders
     each row's `band` cells so the template can emit hidden 1% rows.

## View

`views/macros/gem-level-table.njk` (keep the file; it now renders both modes):

- Rename the `<summary>` text to **"Scaling"**.
- If **both** `vm.levelTable` and `vm.qualityTable` exist, render a segmented **Levels |
  Quality** toggle (two `<button>`s, `role="tablist"`, `aria-selected`) inside the
  `<details>`; render **both** tables, the Quality one `hidden` by default. If only one
  exists, render just that table with no toggle (header still "Scaling"). Levels remains the
  default visible mode.
- The count badge (`.rec-group-count`) reflects the active mode ("N levels" / "N quality
  breakpoints"); default = Levels count, updated by JS on toggle.
- **Quality table markup** mirrors `gem-levels-table` for column styling, but rows use the
  affix-accordion structure: each coarse row is a `<tr>` (with `▸` caret, `role="button"`,
  `aria-expanded="false"`, `tabindex="0"`) when it has a `band`; the band's 1% rows follow as
  `hidden` sibling `<tr class="gem-qual-band-row">`. Coarse rows without a band render as a
  plain `<tr>` with an empty-caret spacer (affix `--empty` convention). The 20% row gets a
  `cap` class/marker like the level table's cap row.

## Client JS

- **`public/js/scaling-toggle.js`** (new, wired in `base.njk`, deferred): toggles the two
  tables' visibility and the `aria-selected`/count-badge text when a Levels/Quality button is
  clicked. Scoped to each `.gem-levels` details block (multiple cards per page stay
  independent). Pure visibility toggle over server-rendered HTML — no data resolution — so the
  static build behaves identically (same discipline as `gem-level-select.js`).
- **Band expansion** reuses the affix accordion behavior. Simplest path: give the coarse rows
  and band rows the affix classes/attributes so the existing `affix-accordion.js` handles them
  — **or** generalize its selector. Decide during implementation; do not duplicate the
  toggle logic.
- `gem-level-select.js`'s row-highlight already scopes to `.gem-levels-row[data-level]`, so it
  only affects the Levels table — no change needed; the Quality table uses different row
  classes.

## Testing

- **Unit (`node:test`)** for `buildQualityTable`:
  - Arc → single `chains` column; coarse rows show `…,10→1,…,20→2,…`; 20% row `cap: true`;
    breakpoints on 5%-multiples ⇒ **no bands** (not expandable).
  - Archmage (or any `_+%` continuous) → every coarse row has a non-empty `band` (1% detail).
  - A gem with a non-5%-multiple discrete breakpoint (if one exists) → band present on the
    straddling coarse row and its 1% rows show where the value changes.
  - Support gem / gem with no `quality_stats` → `buildQualityTable` returns `null`.
  - `mergeQualityTables` on a multi-skill gem → columns carry `skill` captions.
- **Static build** (`npm run build:static`): the Quality table is server-rendered and JS only
  toggles visibility, so the crawler renders it and no new client-fetched URL is introduced —
  confirm no static-only breakage and that both tables appear in `dist/` gem pages.
- Keep existing gem/level-table tests green.

## Out of scope (YAGNI)

- No quality selector on the gem card body (card stays level-driven).
- Gemling **alt-quality** ("second quality") columns in the Quality table — the card already
  shows alt-quality lines; a separate alt-quality scaling column set is deferred.
- Quality above 100%.
```
