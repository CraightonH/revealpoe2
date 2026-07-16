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

> **Revision (2026-07-16, post-review):** the row model and value rounding below reflect the
> shipped implementation after several rounds of review. Superseded ideas: a `cap: true` flag
> on the 20% row (dropped — mirrors the level-20 badge removed in `ceae77e`); a count-vs-
> magnitude predicate that floored only counts (dropped — everything floors now); a
> pure-union-breakpoint model (dropped — 77% of gems hit 51–100 rows); rendering smooth
> effects as a range line (dropped); and a purely density-based split (dropped — it made
> Archmage a 5-row table, but a count-less gem should stay coarse+band). Final rule is the
> **count-gated breakpoints vs coarse grid** below.

## Data model

### Quality table shape

The merged table is built at **build time** (`buildGemQualityTable`, `src/data/statText.js`)
and stored on the gem node, then rendered by `renderQualityTable` (`src/data/gems.js`):

```
{
  columns: [ { key, header, kind: 'quality' | 'alt-quality', skill? } ],
  rows:    [ { quality, cells: { <key>: <displayValue> }, band?: [ { quality, cells } ] } ]
}
```

- **Columns** — one per quality effect whose value **actually varies** across quality
  `1..100`. Standard quality (`skill.stat_sets[].static.quality_stats`) → `kind:'quality'`;
  Gemling second-quality (`gemQuality.altQualityStats`) → `kind:'alt-quality'`. The `header`
  keeps RePoE `[Id|Display]` markup with the number blanked to `_`. Entries with no scaling
  token (base-skill references, `dummy_stat_display_nothing`, permille `0`) are dropped. A
  per-column `skill` caption is added only when the gem has >1 contributing skill.
- **Rows — count-gated breakpoints vs coarse grid.** A gem is **"truly steppy"** iff it has
  an integer-**count** column (chains, stages, projectiles; `isCountToken`) — only ~10–20 gems.
  - **Steppy gem** → one row at each quality where a **discrete** column ticks up (no grid, no
    bands). "Discrete" = any column that breaks at most once per 5% (`≤ 20` breakpoints over
    1–100): the count itself, plus a *slow* companion effect (e.g. a Gemling % that ticks
    every ~7%). So Arc shows chains' 10% steps **and** its alt's off-count breakpoints — the
    27% row that makes "go to 30% for the next step, not just 27%" obvious. A column that ticks
    every ~1% is **not** discrete: it's sampled at the chosen rows rather than flooding them
    (Arctic Armour → 5 stage rows, its every-1% alt sampled).
  - **Otherwise** (no count column: Archmage, Fragments) → the coarse **5% grid**: keep a row
    only when a value changed since the previous grid mark, off-grid breakpoints in an
    expandable **`band`** (Archmage's 20% band is `[16, 18]`, skipping the ½% steps). Rationale:
    a pure-breakpoint model made 77% of gems 51–100 rows long, because many magnitudes change
    every 1%.
  - Descending, like the level table. **No `cap` flag** — the 20% row gets no special
    treatment (mirrors the level-20 badge removed in `ceae77e`).
- **Cells** — the floored display value at that quality. Just the scalar (prose lives in the
  header).

### Value rounding — floor everything to its natural precision

`value(raw, Q, handler) = floor( applyHandler(handler, raw × Q / 1000) )` at the stat's
display precision. **The game rounds every quality effect DOWN** (you can never have half a
chain *or* half a percent), so a value is shown as a true integer/fixed-precision step and its
breakpoint lands on the exact quality.

- **Precision** is derived from the unit handler (`precisionOf`): no handler → `0dp` (integer
  counts *and* integer percents); an explicit `_Ndp` → N; `divide_by_ten` → 1dp;
  `divide_by_one_hundred` / `milliseconds_to_seconds` / `per_minute` → 2dp.
- ~~Count-vs-magnitude predicate~~ **Dropped.** Flooring to precision subsumes it: counts and
  `_+%` percents are both `0dp`, so both floor to integers; distance/duration floor to their
  handler's dp. Examples: Arc chains → `floor(Q/10)` (breaks every 10%); Archmage reservation
  efficiency `500` → `floor(0.5·Q)` integer % (breaks every 2%, band skips the ½% steps);
  Fragments radius `200` via `divide_by_ten_1dp` → `floor` to tenths (breaks every 5%).

> **Verification (done):** on-cap (20%) values match poe2db — Arc 2 chains, Arctic Armour 1
> stage, Archmage 10% / alt "(0—1)…extra Lightning" + "(0—2)% mana cost", Fragments 0.4 m /
> alt "(0—1) s". A full-dataset audit of every quality stat confirmed no stat floors to an
> implausible value.

## Build & runtime wiring

1. **`src/data/statText.js`** — `buildQualityTable(skill)` (single skill) and
   `buildGemQualityTable(contributors)` (merged across a gem's granted skills, folding in each
   skill's alt-quality `{stat,stats}`), plus `precisionOf`/`floorTo`/`parseQualityStat`/
   `qualityValueAt`/`assembleQualityTable` helpers.
2. **`scripts/graph/gemQuality.js`** — `altQualityStats(skillKey, set, translationFile)`
   returns Gemling second-quality effects as parseable `{stat,stats}` objects (factored out of
   `renderAltStat`). **Bug fix:** `specificIdx` kept `path.basename`, which dropped the
   `specific_skill_stat_descriptions/` subdir so per-skill alt templates never loaded — now it
   keeps the subpath. This also fixes alt-quality on the gem **card**.
3. **`scripts/graph/gems.js`** — in `gemNodes`, set `props.qualityTable = buildGemQualityTable(
   grants_skills.map(k => ({ skill, name, altStats })))`. Merged here (not at runtime) so band
   rows resolve from the live value formulas across all contributing skills.
4. **`src/data/gems.js`** — `renderQualityTable(gem.qualityTable)` (headers + coarse & band
   cells through `renderGameText`, `kind` preserved). `getGem` exposes `qualityTable`;
   `buildGemViewModel` sets `qualityTable: renderQualityTable(gem.qualityTable)`.

## View

`views/macros/gem-level-table.njk` (keep the file; it now renders both modes):

- Rename the `<summary>` text to **"Scaling"**.
- If **both** `vm.levelTable` and `vm.qualityTable` exist, render a segmented **Levels |
  Quality** toggle (two `<button>`s, `role="tablist"`, `aria-selected`) inside the
  `<details>`; render **both** tables, the Quality one `hidden` by default. If only one
  exists, render just that table with no toggle (header still "Scaling"). Levels remains the
  default visible mode.
- The count badge (`.rec-group-count`) reflects the active mode ("N levels" / "N breakpoints");
  default = Levels count, updated by JS on toggle.
- **Quality table markup** mirrors `gem-levels-table` for column styling. On a smooth gem the
  rows use the affix-accordion structure: an expandable coarse row is a `<tr>` (with `▸` caret,
  `role="button"`, `aria-expanded="false"`, `tabindex="0"`) and its band rows follow as
  `hidden` sibling `<tr class="gem-qual-band-row">`; non-expandable rows (all steppy rows, and
  smooth rows with no off-grid breakpoint) render plain with an empty-caret spacer. **No cap
  treatment.** `alt-quality` columns get `gem-levels-col--alt-quality` (the second-quality
  colour `--color-crafted`) — **no header chip** (removed per review).

## Client JS

- **`public/js/scaling-toggle.js`** (new, wired in `base.njk`, deferred): toggles the two
  tables' visibility and the `aria-selected`/count-badge text when a Levels/Quality button is
  clicked. Scoped to each `.gem-levels` details block (multiple cards per page stay
  independent). Pure visibility toggle over server-rendered HTML — no data resolution — so the
  static build behaves identically (same discipline as `gem-level-select.js`).
- **Band expansion** lives in `scaling-toggle.js` alongside the mode toggle (walk the
  `gem-qual-band-row` siblings, toggle `aria-expanded` + `hidden`). Same behaviour as
  `affix-accordion.js`; kept self-contained rather than overloading the affix classes.
- `gem-level-select.js`'s row-highlight scopes to `.gem-levels-row[data-level]`; Quality rows
  have no `data-level`, so it only affects the Levels table — no change needed.

## Testing

- **Unit (`node:test`, `statText.test.js`)**:
  - Arc (steppy) → single `chains` column; breakpoint rows `100,90,…,10`; no bands.
  - Archmage (smooth) → coarse 5% rows `100,95,…,5`, integer-% floor; 20% band `[16,18]`.
  - Fragments (smooth) → distance floored to tenths, coarse rows every 5%, no bands.
  - Arctic Armour (steppy) → blanked base-skill token; breakpoints every 20% (`100,80,…,20`).
  - Count-gate: a steppy gem with a *sparse* alt shows the alt's breakpoints as rows; with a
    *dense* (every-1%) alt, rows stay on the count and the alt is sampled.
  - `buildGemQualityTable` → captions on a two-skill gem; folds in tagged `alt-quality` cols.
  - No `quality_stats` / permille 0 → `null`.
- **`gemQuality.test.js`** — regression: a spec-file-only stat (`archmage_*`) now resolves.
- **Static build**: Quality table is server-rendered, JS only toggles visibility, no new
  client-fetched URL — prerender covers it; no static-only breakage.
- Keep existing gem/level-table tests green.

## Out of scope (YAGNI)

- No quality selector on the gem card body (card stays level-driven).
- Quality above 100%.

## Delivered beyond the original scope

- **Gemling alt-quality** ("second quality") effects are now **in** the Quality table as
  `alt-quality` columns (the original draft deferred them). This required the `specificIdx`
  bug fix, which also restores alt-quality on the gem card.
```
