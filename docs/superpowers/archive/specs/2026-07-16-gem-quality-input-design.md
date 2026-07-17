# Gem Quality Input on Gem Cards — Design

**Date:** 2026-07-16
**Status:** Approved design, pre-implementation
**Related:** TODO #6 (gem Scaling table Levels⇄Quality toggle), commit `253dbb7` (interactive gem-level selector)

## Goal

Add an interactive **quality** control to the interactive gem card, mirroring the existing
gem-level `<select>`. It is a **text box**, defaults to `0%`, and:

- At `0%` / empty, each "Additional Effects From Quality" line keeps its current **range**
  text, e.g. `[Chains] (0—2) times`.
- When the user types a non-negative value, every quality line updates to the **single
  value at that quality**, e.g. at `30%` → `[Chains] 3 times`.

The value shown at a typed quality `Q` follows **step semantics**: on a stepped (breakpoint)
gem, typing `29%` shows the value at the largest breakpoint ≤ 29 (e.g. `27%`), because the
step holds until the next breakpoint.

## Non-goals

- The Scaling → Quality reference table is **not** coupled to the input (it stays a static
  reference; the input drives only the card body lines).
- The static hover-tooltip card and the `/gems` browse card are unchanged (no input there).

## Key domain facts (verified against `build/graph.json`)

- Gem quality effects scale **linearly**: `value(Q) = raw × Q / 1000`, through a unit handler
  (all handlers are a divide or a negate), then floored to the stat's display precision. This
  is `qualityValueAt` in `src/data/statText.js`.
- A card quality line (e.g. `[Chain|Chains] (0—2) times`) maps **1:1** to a Quality-table
  column (header `[Chain|Chains] _ times`) by its **blanked skeleton** (replace each `(0—N)`
  with `_`). Multi-number lines exist but are rare — **12 of 771 lines (~1.5%)**, e.g. Hand of
  Chayula; their table cell is the values joined by `" / "`, e.g. `"100 / 50"`.
- **All 374 gems that have card quality lines also have a `qualityTable`** — zero coverage gaps.
- The Quality table has two build modes (`assembleQualityTable`):
  - **Smooth**: coarse 5% grid + `band` rows that check *every* integer between grid points →
    every breakpoint 1–100 is present.
  - **Steppy**: a row wherever a *discrete* column (≤20 changes) ticks; a *dense* column
    (>20 changes) is sampled only at those rows. → the display `rows` can **under-sample a
    dense column** in a steppy gem.

## Architecture decision: single source of truth for the formula

The scaling formula must live in exactly one place. Two options were weighed:

- **Rejected — per-token formula on the client** (`floor(permille×Q/1000/divisor)`): duplicates
  the formula in browser JS. A parity test is only a safety net, not a structural guarantee — a
  new handler or a changed divisor could diverge silently.
- **Chosen — table/data as source of truth**: the client does **zero** scaling math. It reads
  already-floored values produced by the one canonical formula in `statText.js`. A formula change
  regenerates the data and propagates to both the table and the card automatically.

Because the display `rows` can under-sample dense steppy columns (above), the client is **not**
fed the display `rows`. Instead the build emits a dedicated **quality series** — each column's
*complete* step function over Q=1–100 — sampled from the same `valueAt(Q)` the table uses. Same
formula, sampled for lookup instead of for display. Correct by construction; still single-source.

Per-gem series payload measures ~1.2 KB median / ~3.3 KB max (change-compressed), negligible
next to the table HTML the page already ships.

## Components

### 1. `src/data/statText.js`

- **`buildGemQualitySeries(contributors)`** — parallel to `buildGemQualityTable`, reusing
  `qualityColumnDefs` / `valueAt`. Returns `{ [columnKey]: [[q, value], …] }` where the pairs are
  the **change-points** of that column's floored value over Q=1..100 (first entry is the first Q
  whose value differs from the Q=0 baseline). Column keys match `buildGemQualityTable`'s (`q0`,
  `q1`, …) so a line's mapped column key indexes both.
- **`qualityLineTokenMap(qstat)`** (or fold into existing resolve path) — for a resolved quality
  line, return the ordered token→column mapping: the line's blanked skeleton (join key) plus, per
  numeric token, its index within the column's `" / "`-joined cell. Used at build time to tag
  spans; the join to a column key happens in the graph builder where both sides are known.
- `resolveQuality` is unchanged and still produces the default `(0—N)` range string.

### 2. Build — `scripts/graph/gems.js` + `scripts/graph/gemQuality.js`

- Attach `qualitySeries` to the gem node (built from the same merged contributors as
  `qualityTable`; `null` when there is no quality table). Additive — does not touch existing
  fields, the table, or the tooltip.
- For each effect-section `quality` / `altQuality` line, attach a per-line token descriptor:
  `[{ col, idx }]` (one entry per numeric token, in order), resolved by skeleton-joining the line
  to a `qualitySeries` / `qualityTable` column. Tokens with no matching column (a non-varying line
  filtered out of the table) get `col: null`.

### 3. Runtime — `src/data/gems.js`

- For **interactive** gems, render each quality / altQuality line by interleaving the
  keyword-rendered prose with one `<span class="qual-tok" data-col="qN" data-idx="K"
  data-range="(0—N)">(0—N)</span>` per numeric token. The default (0%) text inside the span is the
  existing `(0—N)` range, so the initial render is visually identical to today.
- Static card / hover tooltip keep the current baked-string rendering (`opts.static`).
- Expose `qualitySeries` on the view-model, plus a boolean `hasQuality` (any section has a quality
  or altQuality line) to gate the input.

### 4. Template — `views/macros/gem-card.njk`

- After the `.gem-level-line`, when `interactive and vm.hasQuality`, render:
  `Quality: <input type="text" inputmode="numeric" class="gem-quality-input" value="0"
  aria-label="Gem quality">%`.
- Embed the series once per card as a `<script type="application/json" class="gem-quality-data">`
  (JSON is inert, no escaping pitfalls, not executed). Scoped inside `.newItemPopup` so multiple
  cards stay independent.

### 5. Client — `public/js/gem-quality-input.js` + shared lookup module

- **Shared pure module** `public/js/gem-quality-core.js` (imported by both the browser script and
  a node test, mirroring `query-core.js`): `valueAt(series, col, Q)` → the value string at the
  largest breakpoint ≤ Q, or `null` when Q is below the first breakpoint (→ treated as `0`).
- **`gem-quality-input.js`**: on `input`, parse an integer, clamp to `[0, 100]`; non-integer/NaN →
  `0`. If `Q >= 1`: for every `.qual-tok` in the card (including hidden level variants, so
  switching level preserves the typed quality), read `data-col`/`data-idx`, look up the cell,
  split on `" / "`, take `idx`, set `textContent`. If `Q` is `0`/empty: restore each span's
  `data-range`. Pure DOM text toggling — the static build behaves identically to the server.

### 6. Tests (`test/`, node:test)

- **Series parity**: `buildGemQualitySeries` reproduces `valueAt(Q)` / the table cells at
  breakpoints — Arc (`29% → 27%`-step, chains `100→2` at 20%), negatives (Combat Frenzy
  `(0—-1)`), multi-token cell split (Hand of Chayula `"100 / 50"`).
- **Token mapping**: each quality line's tokens resolve to the correct `(col, idx)`; non-varying
  lines get `col: null`.
- **View-model**: interactive quality lines emit `.qual-tok` spans with correct `data-*`;
  `hasQuality` gates correctly; static card emits no spans/input.
- **Lookup module**: `valueAt` step semantics, below-first-breakpoint → `null`, clamping.

## Behavior summary

| Input state        | Quality lines show                                  |
|--------------------|-----------------------------------------------------|
| `0` / empty / NaN  | the `(0—N)` range (default, unchanged from today)   |
| `Q ≥ 1`            | single value at the largest breakpoint ≤ Q          |
| `Q > 100`          | clamped to 100                                      |
| `Q < 0`            | clamped / treated as 0                              |

## Edge cases

- **Below first breakpoint** (e.g. Q=3 when the first tick is at 5%): `valueAt` → `null` → span
  shows `0`.
- **Token with no column** (non-varying line filtered from the table): span keeps its range /
  shows `0` at `Q≥1`; rare.
- **Level independence**: quality lines render inside every level variant; the input updates all
  spans (visible + hidden), and `gem-level-select.js` only toggles visibility, so the two controls
  compose without interaction.
- **Multiple cards on a page** (`/theorycraft`): data + spans scoped to each `.newItemPopup`.
