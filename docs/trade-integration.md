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

**Exception — Lineage supports** don't use this item search at all; they go to the
bulk exchange (see "Lineage supports → bulk exchange" below).

### Gem default filters

Cut skill gems **are** tradeable as distinct Listed Items (search by `type` = gem
name). The link defaults to the setup players price-check, using **min-bounds** so
the ideal *and* better-than-baseline listings both show (fewer empty results,
friendlier for a beginner-first wiki):

- `gem_level >= 21` — `misc_filters`
- `gem_sockets >= 5` — `misc_filters` ("5-link"; see below)
- `quality >= 20` — `type_filters` (general Item Quality field)
- `corrupted = true` — `misc_filters`

`gem_level >= 21` (not 20): an uncorrupted gem caps at level 20, so level 21 is the
genuine max + corruption. A min of 20 would also surface level-19 bases corrupted up
to 20 — fakes players don't want.

PoE2 has no link system; the equivalent is the skill gem's support-gem slot count,
filtered by `gem_sockets`. So "5-link" = `gem_sockets >= 5`. Filter ids verified
against `https://www.pathofexile.com/api/trade2/data/filters`.

## Build Planner: filtering by the mods you actually crafted

Everywhere else on the site a trade link is "find me this item type." In the
**Build Planner** it is "find me *this* item" — the base or unique the card
already names, narrowed by the mods the item builder put on it.

A rare with three chosen affixes and a corrupted implicit becomes a search for
that base with four stat filters, `corrupted = true` and `rarity = nonunique`.
A unique with a corrupted implicit keeps its pinned `name` and adds the implicit.

### Where it lives

- **`public/js/trade-core.js`** — pure, node-tested (`test/trade-core.test.js`),
  imported by the browser at `/static/js/trade-core.js`.
  `tradeQueryFilters({cell, pools, statIds, isUnique})` → `{filters, stats, mapped, unmapped}`;
  `mergeTradeQuery(href, …)` folds them into an existing URL; `tradeActionLabel()`
  produces the label/tooltip.
- **`public/js/item-card-view.js`** — the planner's existing card-rewrite seam
  calls the above on the fragment's `.item-action-bar a.item-action`.
- **`public/js/trade-stat-ids.js`** — the one lazy fetch of the map, shared by the
  gear-well tooltip (`builds-page.js`) and the mod picker's preview.
- **`scripts/fetch-trade-stats.js`** (`npm run fetch:trade-stats`) → committed
  `src/data/trade-stat-ids.json`; `build-index.js` copies it to
  `public/generated/trade-stat-ids.json`.

### It merges into the server's link, it does not rebuild it

The prerendered wiki card already carries a correct `name`/`type`/league link.
The planner decodes that `q` payload, merges filters in, and re-encodes — so the
planner can never disagree with the wiki about an item's identity, and it needs
no client-side name resolution. Anything unparseable is returned untouched, so a
failure degrades to today's plain link rather than a broken one.

### Deliberate choices

- **No value bounds.** The tier you modelled is a planning target, not a purchase
  requirement, so every stat filter matches any roll.
- **`rarity = nonunique`, not the planner's magic/rare re-skin.** Someone who
  modelled "life + strength" is happy to buy a rare that also has four other
  mods; the stat filters do the narrowing. Strictly more results, never fewer.
- **Partial coverage is disclosed, never hidden.** ~15% of item-scope affix
  families have no trade filter at all. The link still filters on everything else
  and the action reads `Trade (4 of 5)` in amber, with the unfilterable mods named
  in the tooltip. The count is dropped on narrow screens (the label is hidden by
  CSS) but the amber edge and `aria-label` survive.

### The stat-id map — matching by display text

`generic` (ours: `"+# to Strength"`) joins to trade's `text` (`"# to Strength"`)
through four normalisations, tried in order: **sign** (trade folds `+`/`-` into
the value), **hybrids** (our `generic` is the whole mod, trade indexes each stat
*line* — so `"#% increased Armour\n+# to Stun Threshold"` yields two ids),
**fixed values** (literals blanked to `#`), and **polarity** (trade indexes a
downside under its upside wording with a negative magnitude, so `reduced` →
`increased`).

**Accepted limitation — hybrids can only be approximated.** The trade site has no
combined filter for a two-stat mod: its index is one entry per stat line and
contains zero hybrid entries. (The 78 multi-line entries in the Explicit group
are word-wrapped *single* stats, not two-stat mods.) So a hybrid becomes two
AND-ed filters, which returns a **superset** — every item carrying the hybrid,
plus items that got the same two lines from two separate mods. It never misses
the hybrid, which is the direction that matters, but it cannot prove the lines
came from one mod. There is nothing better available; don't re-investigate.

Coverage of item-scope families, as of the last refresh: **~85%** overall —
corrupted 95%, desecrated 97%, standard 77%. `test/trade-core.test.js` enforces
an 80% floor so a re-scrape that rewords affix text fails loudly instead of
silently under-filtering. The residue is mostly stats the trade site does not
index at all (`Mana Reservation Efficiency`, `chance to Avoid being Shocked`) or
stale RePoE families with no live equivalent (fishing, trap-league mods).

Spot-checked against ground truth: real listings publish their own stat hash in
`item.extended.mods.explicit[].hash`, and the map agreed on 10 of 10 mods sampled
from live Attuned Wand listings.

### ⚠️ Local vs global stats — resolved per stat *line*

Eight stats share their display text with a different stat and are told apart
only by a `(Local)` suffix on the trade side: `# to Accuracy Rating` is the
global one (rings, helmets) and `# to Accuracy Rating (Local)` is the weapon's
own. Verified against live listings, the two ids match **disjoint** item sets —
the local id returns Anvil Mauls and crossbows, the global id returns rings and
masks. So binding a weapon affix to the global id searches for an item that
cannot exist.

The full set: flat/percent Armour, flat/percent Evasion Rating, flat maximum
Energy Shield, Accuracy Rating, Attack Speed, Block chance.

Locality comes from the RePoE stat id's `local_` prefix — which `modPools()`
projects away, so `fetch-trade-stats.js` reads the affix nodes from the graph
directly. It must be resolved **per stat line, not per family**:
`accuracyattackspeedhybrid` (`+# to Accuracy Rating / #% increased Attack Speed`)
is *global* accuracy plus *local* attack speed, so either family-level answer
would be wrong for one of its lines. Lines are paired positionally with the top
tier's `stats[]`, guarded on the counts matching (they do for every family that
touches an ambiguous text).

Note that a `(Local)` variant existing is what makes a stat ambiguous — plain
`#% increased Physical Damage` **is** the weapon-local one, because trade spells
its global counterpart out as `#% increased Global Physical Damage`. The lookup
therefore falls through to the ordinary chain when no local variant exists.

Measured effect: 38 family-stat bindings, i.e. most of the local defensive
crafting surface. A live before/after on body armour with
`+# to Evasion Rating / +# to maximum Energy Shield` went from **0** results to
10 000; the weapon phys/accuracy hybrid went from 49 (weapons that happened to
carry a global accuracy roll — the wrong items) to 10 000.

### ⚠️ Corrupted implicits map to `enchant.*`, not `implicit.*`

This is the one counter-intuitive rule and the easiest thing to "fix" back into a
bug. Trade's **Implicit** group is *base-item* implicits (ring/amulet/belt lines,
map-device mods) and carries no corruption outcomes. Vaal corrupted implicits are
indexed under **Enchant**. Verified live: a corrupted search for
`+1 to Maximum Power Charges` returns listings under `enchant.stat_227523295` and
**zero** under `implicit.stat_227523295`.

Related: **never fall back across stat groups.** The same stat appears in several
groups under one hash, and each id only matches that stat *in that position* — so
filtering a corrupted implicit by its `explicit.*` id silently searches for a
different item (one that rolled the mod as an affix). An affix absent from its
own group is left unmapped and disclosed. A test asserts group-per-origin.

### Refreshing

Run `npm run fetch:trade-stats` on the same cadence as a re-scrape — after a game
patch, or when a league changes the mod pool — and read the printed coverage
report before committing. It lists every item-scope mod that found no filter, by
text (not family name: names repeat across families, so a name list shows false
alarms).

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

## Lineage supports → bulk exchange (not the item search)

Lineage support gems (tagged `lineage`) are **fungible, fixed items** — every copy
is identical, so they're never Listed Items in the regular trade search. They're
traded through PoE2's **bulk / currency exchange**. The gem-search URL above would
return nothing for them (and the gem default filters — level/quality/sockets — are
nonsensical for a fixed item). So `gemTradeUrl` routes them to a bulk-exchange link
instead via `gemExchangeUrl(metadataId)`.

**The link is want-only — we never pin the offered currency.** The exchange query
sets only `want: [<id>]` and leaves `have: []`. That returns every offer for the
gem regardless of which currency the seller asks. This is deliberate: most Lineage
supports are undesired and priced in Exalted Orbs, the sought-after few in Divine
Orbs, but *which currency a listing wants is volatile market state we neither have
nor need*. Want-only sidesteps the exalted-vs-divine pair entirely.

```
https://www.pathofexile.com/trade2/exchange/poe2/<League>?q={"query":{"status":{"option":"online"},"want":["amanamus-tithe"],"have":[]}}
```

### The exchange-id map (trade-service state, like the league)

The `want` value is the gem's **exchange id** (e.g. `amanamus-tithe`), which lives
in the trade service's static data (`api/trade2/data/static`, group
`LineageSupportGems`) — **not in RePoE source**. Like `TRADE_LEAGUE`, it's volatile
trade-service state, so it's cached in a committed file and refreshed by a script:

- **`src/data/lineage-exchange-ids.json`** — `{ <our gem metadata id>: <exchange id> }`.
  Loaded once by `trade.js`. A missing file or unmapped gem → `gemExchangeUrl`
  returns `null` → the card omits the affordance (no broken link), same graceful
  fallback as a missing icon.
- **`npm run fetch:exchange-ids`** (`scripts/fetch-exchange-ids.js`) — fetches the
  static data, matches each `LineageSupportGems` entry to our gem by display name,
  rewrites the JSON, and prints a coverage report: our Lineage gems with no
  exchange id (not bulk-tradeable, or renamed → no link), and exchange gems we
  don't carry yet (a re-scrape will pick them up). Refresh it like a re-scrape —
  after a game patch or when GGG adds Lineage supports.

It is **not** a `data/manual/*.json` graph overlay: it's trade-service presentation
config, not a graph relationship, and merging an exchange id onto a `repoe`-sourced
gem node would break the provenance-isolation policy. It belongs in the presentation
layer next to `TRADE_LEAGUE`, for the same reasons.

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

After a game patch that adds/renames Lineage supports, also run
`npm run fetch:exchange-ids` and commit the updated
`src/data/lineage-exchange-ids.json` (check the printed coverage report).

After a game patch that changes the mod pool or affix wording, also run
`npm run fetch:trade-stats` and commit the updated `src/data/trade-stat-ids.json`
(again, check the printed coverage report — `npm test` enforces a coverage floor
but the report is what tells you *which* mods dropped out).
