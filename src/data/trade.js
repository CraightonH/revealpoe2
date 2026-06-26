// Builds "Search on PoE Trade" links for the official Path of Exile 2 trade site.
//
// Pure presentation: takes an item's name/type and returns a GET-prefilled trade
// URL. No graph access. The per-domain adapters (uniques/bases/gems) attach the
// result as `tradeUrl` on their view models.
//
// See docs/trade-integration.md for the full rationale, especially why the league
// is a hardcoded constant rather than derived from the scraped data.

// The trade league the site is currently running. This is GGG trade-service state
// (it rotates ~every league), NOT game-content data — RePoE never models it, so it
// can't be derived from data/source/. Update this one line each league.
export const TRADE_LEAGUE = 'Runes of Aldur';

const SEARCH_BASE = 'https://www.pathofexile.com/trade2/search/poe2/';

// `securable` = listings purchasable through PoE2's secured/instant-buy system,
// excluding the no-price / whisper-for-price listings (AFK price-fixers, scammers)
// that a plain "online" search surfaces. Taken from a live PoE2 saved search.
const STATUS = { option: 'securable' };

// Gems are tradeable as Listed Items (search by type = gem name). Default to the
// setup players price-check, using MIN-BOUNDS so the ideal and better-than-baseline
// listings both show (friendlier than exact values, fewer empty results):
//   level >= 21, quality >= 20, corrupted, 5 gem sockets ("5-link").
// level >= 21 (not 20): an uncorrupted gem caps at 20, so level 21 is the genuine
// max + corruption. A min of 20 would also surface level-19 bases corrupted up to
// 20, which players don't want. PoE2 has no "links" — gem_sockets is the support-
// gem slot count, so "5-link" = gem_sockets >= 5. Ids verified against
// /api/trade2/data/filters.
const GEM_FILTERS = {
  misc_filters: {
    filters: {
      gem_level: { min: 21 },
      gem_sockets: { min: 5 },
      corrupted: { option: 'true' },
    },
  },
  type_filters: { filters: { quality: { min: 20 } } },
};

// Build a trade-search URL for one item. `kind` ∈ 'unique' | 'base' | 'gem'.
// - unique: pins `name` (unique name) + `type` (base type) for precision.
// - base:   searches `type` (base name) alone.
// - gem:    searches `type` (gem name) + the gem default filters above.
// Returns null when there's nothing to search on (no type), so callers can omit
// the affordance rather than render a broken link.
export function tradeUrl({ kind, name, type } = {}) {
  if (!type) return null;

  const query = { status: STATUS };
  if (kind === 'unique' && name) query.name = name;
  query.type = type;
  if (kind === 'gem') query.filters = GEM_FILTERS;
  query.stats = [{ type: 'and', filters: [] }];

  const q = encodeURIComponent(JSON.stringify({ query }));
  return `${SEARCH_BASE}${encodeURIComponent(TRADE_LEAGUE)}?q=${q}`;
}
