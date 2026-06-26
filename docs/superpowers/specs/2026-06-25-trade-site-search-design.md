# Trade-Site Search Icon — Design (Todo 4, part 1)

**Date:** 2026-06-25
**Todo:** `docs/TODO.md` item 4 — "All tooltips/cards get clickable icons for: 1. Search on PoE Trade site, 2. Add to Theory Craft." This spec covers **part 1 only** (the PoE Trade search icon), but builds the action affordance as a container so part 2 (Add to Theory Craft) slots in later with no rework.

## Goal

Every item tooltip/card surfaces a clickable icon that opens the official Path of Exile 2 trade site with a search prefilled for that item. Applies to **uniques, base items, and gems**, on **both** the full tooltip popups and the condensed browse/list cards.

## The trade URL

Official site, GET-prefilled search:

```
https://www.pathofexile.com/trade2/search/poe2/<League>?q=<url-encoded JSON>
```

`<League>` is `Runes of Aldur` (URL-encoded `Runes%20of%20Aldur`) — see **League handling** below. The `q` payload is the standard trade query object:

- **unique:** `{"query":{"status":{"option":"online"},"name":"<unique name>","type":"<base type>","stats":[{"type":"and","filters":[]}]}}`
- **base:** `{"query":{"status":{"option":"online"},"type":"<base name>","stats":[{"type":"and","filters":[]}]}}`
- **gem:** `{"query":{"status":{"option":"online"},"type":"<gem name>","stats":[{"type":"and","filters":[]}]}}`

Uniques pin both `name` and base `type` for precision; bases and gems search by `type` alone.

### Gem caveat

In PoE2, specific skill/support gems generally aren't tradeable as distinct items — players trade generic *Uncut* gems. A gem trade-search by name will often return **empty**. We include the icon anyway: the affordance is consistent across all card kinds, the failure mode is a harmless empty result page, and the cost is near-zero. Documented in `docs/trade-integration.md`; trivially droppable if it proves noisy.

## League handling — why it's a hardcoded constant, not derived

`TRADE_LEAGUE = 'Runes of Aldur'` lives as a single constant in `src/data/trade.js`.

The current trade league is **GGG trade-service state**, not game content data. The scraped RePoE source (`data/source/`) does not model it:

- `_manifest.json` (closest thing to a version stamp) carries `fetched_at` + a file list — **no game version, patch, or league field**.
- The only league references in source are (a) **per-unique provenance** — PoB's `pob-uniques/*.json` `League:` lines meaning *"this unique was introduced in that league"* — and (b) coincidental lore in `audio.json`. Neither is a "current trade league" object.

You *could* heuristically derive `max(League:)` across uniques ≈ "newest content league," but it's fragile: it tracks *content-introduction* league (not *trade* league — they diverge; Standard is a valid target and the challenge league ends while data stays put), it lags PoB's hand-maintenance, and it breaks if PoB rewords the annotation. So the data models *"what league introduced this item"* (a stable fact), never *"what league trade is running right now"* (volatile service state).

Therefore the league is an irreducible, volatile, hand-authored fact. It's deploy-time presentation config — not a graph relationship — so it does **not** belong in `data/manual/*.json` (which is for graph overlays merged with referential-integrity checks against source nodes; a free-floating league string has nothing to reference). It lives as a clearly-commented constant, updated by hand once per league.

## Components

### 1. `src/data/trade.js` (new — pure, unit-tested)
- `export const TRADE_LEAGUE = 'Runes of Aldur';` — single source of truth; one-line per-league edit.
- `export function tradeUrl({ kind, name, type })` — builds the URL above. Pure string builder, no graph access. `kind` ∈ `unique | base | gem`; throws/falls back gracefully on missing inputs.

### 2. View-model wiring
Add a `tradeUrl` field to:
- Full-popup VMs: `uniqueCardVM` (`src/data/uniques.js`), the base-card vm (`src/data/bases.js`), the gem-card vm (`src/data/gems.js`).
- Condensed-card data: `listUniqueCards` (unique-list), gem-browse data, base-list data.

Each adapter calls `tradeUrl(...)` with the name/type it already holds.

### 3. Templates — `.card-actions` slot
- New macro file `views/macros/card-actions.njk` exporting `tradeIcon(url)` (or `cardActions(...)`), rendering a **self-contained inline SVG** (no external asset) for the trade glyph. Built as a container so part 2's "Add to Theory Craft" button drops in beside it.
- **Full popups** (`uniqueCard` / `gemCard` / `baseCard`): a real `<a class="trade-link" href="{{ vm.tradeUrl }}" target="_blank" rel="noopener">` inside a `.card-actions` bar pinned top-right of `.newItemPopup`. No JS required; the static crawler ignores external links.
- **Condensed cards** (each is itself an `<a>` — nesting an anchor is invalid HTML): a `<span class="trade-link" data-trade-url="{{ ... }}" role="button" tabindex="0">` overlay, handled by a tiny delegated script.

### 4. `public/js/trade-link.js` (new)
Delegated click/keydown handler on `[data-trade-url]`: `preventDefault()` + `stopPropagation()` + `window.open(url, '_blank', 'noopener')`. Mirrors the existing `data-card-url` delegation pattern. Added to `views/base.njk` script includes (served from `/static/js/` like the others). Only condensed cards need it; full popups use the plain `<a>`.

### 5. CSS (`public/css/app.css`)
- `.card-actions` — absolute, top-right of `.newItemPopup`.
- `.trade-link` — sizing, hover/focus state.
- On condensed cards: icon pinned top-right, brightening on card hover (avoids clutter at rest).

### 6. `docs/trade-integration.md` (new)
Documents: the URL format + per-kind query JSON; the `TRADE_LEAGUE` constant, where to bump it each league, and the full "not derivable from data" rationale (above); the gem caveat; which surfaces carry the icon.

## Data flow

```
graph node (name, base type)
  → domain adapter (uniques/bases/gems.js) calls tradeUrl({kind,name,type})
    → vm.tradeUrl / card.tradeUrl
      → macro renders <a> (popup) or <span data-trade-url> (condensed card)
        → click: native nav (popup) | trade-link.js window.open (condensed)
```

## Static-site considerations

Purely additive. External links need no crawler discovery (the crawler only follows internal URLs). The new JS ships under `/static/js/` and its `<script>` tag is in every page's `<head>`, so it's present in the prerendered output. No new client-fetched internal endpoint, so no `extractLinks()` change needed.

## Testing

- **Unit (`test/`):** `trade.js` — correct URL + encoding per kind (unique/base/gem), `TRADE_LEAGUE` present and URL-encoded in the path, graceful handling of missing name/type.
- **Render assertion:** each card kind (unique/base/gem, popup + condensed) emits a trade affordance pointing at `pathofexile.com/trade2`.
- `npm test` stays green; verify the condensed-card overlay click doesn't navigate the parent card via `build:static` / manual check (static-only interaction).

## Out of scope

- Part 2 ("Add to Theory Craft") — only the `.card-actions` container is prepared, not the button.
- Stat-based / affix-based trade queries — name+type only.
- Auto-updating the league (intentionally manual, per rationale above).
```
