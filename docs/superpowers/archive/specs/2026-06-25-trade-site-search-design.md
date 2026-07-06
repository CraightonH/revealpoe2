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

`<League>` is `Runes of Aldur` (URL-encoded `Runes%20of%20Aldur`) — see **League handling** below. The `q` payload is the standard trade query object. Every query uses `status: { option: "securable" }`:

- **unique:** `{"query":{"status":{"option":"securable"},"name":"<unique name>","type":"<base type>","stats":[{"type":"and","filters":[]}]}}`
- **base:** `{"query":{"status":{"option":"securable"},"type":"<base name>","stats":[{"type":"and","filters":[]}]}}`
- **gem:** see **Gem default filters** below — gems add misc filters on top of `type`.

Uniques pin both `name` and base `type` for precision; bases search by `type` alone.

### Status: `securable` (Instant Buyout)

`status: { option: "securable" }` restricts results to listings purchasable through PoE2's secured/instant-buy trade system — i.e. immediately buyable, excluding the no-price / whisper-for-price listings that a plain "online" search surfaces (dominated by AFK price-fixers and scammers). This value is taken directly from a live PoE2 saved search on the current trade site, and supersedes the older `online` + `sale_type: "priced"` combo (from a pre-secured-trade third-party tool).

### Gem default filters

Cut skill gems **are** tradeable as distinct Listed Items (search by `type` = gem name). Rather than a bare name search, the gem trade link defaults to the setup players actually price-check, using **min-bounds** (decided): **level ≥ 20, quality ≥ 20, corrupted, +1**. Min-bounds (not exact values) surfaces the ideal setup *and* better-than-baseline listings — fewer empty results, friendlier for a beginner-first wiki, still price-checks the good version. Canonical filter ids (from `/api/trade2/data/filters`):

- `gem_level` → `misc_filters` (minMax) → `{ "min": 20 }`
- `corrupted` → `misc_filters`, `{ "option": "true" }`
- `quality` → `type_filters` (minMax) → `{ "min": 20 }` (general Item Quality, not gem-specific)
- **+1** → a `stats` filter — exact stat id (and whether "corrupted +1" is a discrete stat vs `gem_level` → 21) **to be pinned from a fully-filtered saved search** during implementation.

**The +1 stat id is lifted from a user-provided filtered saved-search hash during implementation** — same method already proven on the unfiltered `9ljByw8uK` hash (the trade API returns the raw `query` object verbatim). This avoids hand-guessing the `+1` stat id. The other three filters are pinned above.

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
