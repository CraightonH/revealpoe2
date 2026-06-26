# Trade-Site Integration

The "Search on PoE Trade" balance-scale icon on every item tooltip/card opens the
official Path of Exile 2 trade site with a search prefilled for that item.

Implements `docs/TODO.md` item 4, part 1. Design: `docs/superpowers/specs/2026-06-25-trade-site-search-design.md`.

## Where it lives

- **`src/data/trade.js`** — `tradeUrl({ kind, name, type })` builds the URL; `TRADE_LEAGUE` constant. Pure, no graph access. Unit-tested in `test/trade.test.js`.
- **View-model wiring** — `tradeUrl` is attached in the domain adapters:
  - `src/data/uniques.js` (`toUnique` → full popup; `uniqueCardVM` → condensed card)
  - `src/data/baseItems.js` (`toBase` → both full popup and condensed card)
  - `src/data/gems.js` (`buildGemViewModel` → full popup; `gemBrowseCardVM` → condensed card)
- **`views/macros/card-actions.njk`** — `tradeLink(url)` (real `<a>`, used in the full popups) and `tradeButton(url)` (`<span data-trade-url>`, used on condensed cards) + the inline scale-icon SVG.
- **`public/js/trade-link.js`** — delegated click/keydown handler for `[data-trade-url]` (condensed-card overlay). See "Why two render forms" below.
- **CSS** — `.card-actions` / `.trade-link` / `.trade-scale` at the end of `public/css/app.css`.

## The URL

```
https://www.pathofexile.com/trade2/search/poe2/<League>?q=<url-encoded JSON>
```

The `q` payload is the standard trade query object. Every query uses
`status: { option: "securable" }` — PoE2's secured/instant-buy listings, which
excludes the no-price / whisper-for-price listings (AFK price-fixers, scammers)
that a plain "online" search surfaces.

| kind | query |
|------|-------|
| `unique` | `name` (unique name) + `type` (base type) — pinned for precision |
| `base` | `type` (base name) only |
| `gem` | `type` (gem name) + the gem default filters below |

### Gem default filters

Cut skill gems **are** tradeable as distinct Listed Items (search by `type` = gem
name). The link defaults to the setup players price-check, using **min-bounds** so
the ideal *and* better-than-baseline listings both show (fewer empty results,
friendlier for a beginner-first wiki):

- `gem_level >= 20` — `misc_filters`
- `quality >= 20` — `type_filters` (general Item Quality field)
- `corrupted = true` — `misc_filters`

The "+1" players mention is a corrupted level-21 gem, which `gem_level >= 20`
already includes — so no fragile per-skill `+1` stat id is needed. Filter ids
verified against `https://www.pathofexile.com/api/trade2/data/filters`.

## League is a hardcoded constant — and why it can't be derived

`TRADE_LEAGUE = 'Runes of Aldur'` in `src/data/trade.js`. **Update this one line
each league.**

The current trade league is GGG **trade-service state**, not game-content data:

- The scraped RePoE source (`data/source/`) never models it. `_manifest.json` (the
  closest thing to a version stamp) carries only `fetched_at` + a file list — no
  game version, patch, or league field.
- The only league references in source are (a) per-unique provenance — PoB's
  `pob-uniques/*.json` `League:` lines meaning *"this unique was introduced in that
  league"* — and (b) coincidental lore in `audio.json`. Neither is a "current trade
  league" object.

You *could* heuristically derive `max(League:)` across uniques ≈ "newest content
league," but it's fragile: it tracks *content-introduction* league (not *trade*
league — they diverge; Standard is a valid target and the challenge league ends
while the data stays put), it lags PoB's hand-maintenance, and it breaks if PoB
rewords the annotation. The data models *"what league introduced this item"* (a
stable historical fact), never *"what league trade is running right now"* (volatile
service state). So the league is an irreducible, hand-authored, per-league bump.

It is deploy-time presentation config — not a graph relationship — so it lives as a
constant rather than in `data/manual/*.json` (which is for graph overlays merged
with referential-integrity checks against source nodes; a free-floating league
string has nothing to reference).

## Why two render forms (link vs. button)

The full tooltip popups (`uniqueCard` / `gemCard` / `baseCard`) are plain `<div>`s,
so the trade affordance is a real `<a target="_blank">` — works with no JS, and the
static crawler ignores external links.

The condensed browse/list cards are themselves `<a>` elements. A nested `<a>` is
invalid HTML and spills the card, so there the affordance is a
`<span data-trade-url role="button">` overlay; `public/js/trade-link.js` intercepts
the click, stops it propagating to the parent card's navigation, and opens the
trade URL in a new tab. Mirrors the existing `data-card-url` tooltip delegation.

## Updating each league

1. Edit `TRADE_LEAGUE` in `src/data/trade.js`.
2. `npm run deploy`.

That's it — every trade link across the site picks up the new league.
