// public/js/trade-core.js
//
// Turns a Build Planner gear cell into official-trade-site search filters, and
// merges them into the trade URL the prerendered wiki card already carries. No
// DOM/window imports — importable by node:test (relative path) and by the
// browser at /static/js/trade-core.js. Never throws on malformed input (mirrors
// mod-core.js / build-rules.js philosophy).
//
// The affix → trade stat id map is trade-service state, not game data: it is
// refreshed by `npm run fetch:trade-stats` into src/data/trade-stat-ids.json and
// copied to /static/generated/trade-stat-ids.json for the client. See
// docs/trade-integration.md.

/**
 * Filters for one crafted cell.
 *
 * Value bounds are deliberately NOT emitted — the tier a player modelled is a
 * planning target, not a purchase requirement, so every stat filter matches any
 * roll. Rarity is `nonunique` rather than the planner's magic/rare re-skin: a
 * player who modelled "life + strength" is happy to buy a rare that also has
 * four other mods, and the stat filters do the real narrowing.
 *
 * @param {object}  cell      the build's gear cell ({ mods, corrupted })
 * @param {object}  pools     parsed mod-pools.json
 * @param {object}  statIds   parsed trade-stat-ids.json (or its inner `map`)
 * @param {boolean} isUnique  uniques pin `name` already, so no rarity filter
 * @returns {{filters: object|null, stats: array|null, mapped: number, unmapped: string[]}}
 */
export function tradeQueryFilters({ cell, pools, statIds, isUnique = false } = {}) {
  const map = statIds?.map ?? statIds ?? {};
  const families = pools?.families ?? {};
  const ids = [];
  const unmapped = [];
  let mapped = 0;
  let hasExplicit = false;
  let hasDesecrated = false;

  // A family counts as mapped when it yields at least one trade stat id. Hybrid
  // mods whose lines only partly resolve still count: filtering on one line of
  // "#% increased Trap Damage / +# to maximum Mana" returns a superset that
  // includes every item carrying the hybrid, which is what the player wants.
  const take = (affix) => {
    const fam = families[affix];
    const got = map[affix];
    if (Array.isArray(got) && got.length) {
      for (const id of got) if (!ids.includes(id)) ids.push(id);
      mapped++;
    } else {
      unmapped.push(fam?.name || affix);
    }
  };

  for (const m of cell?.mods ?? []) {
    const affix = m?.affix;
    if (!affix) continue;
    hasExplicit = true;
    if (families[affix]?.origin === 'desecrated') hasDesecrated = true;
    take(affix);
  }
  const corruptedAffix = cell?.corrupted?.affix ?? null;
  if (corruptedAffix) take(corruptedAffix);

  const groups = {};
  const misc = {};
  if (corruptedAffix) misc.corrupted = { option: 'true' };
  if (hasDesecrated) misc.desecrated = { option: 'true' };
  if (Object.keys(misc).length) groups.misc_filters = { filters: misc };
  if (hasExplicit && !isUnique) groups.type_filters = { filters: { rarity: { option: 'nonunique' } } };

  return {
    filters: Object.keys(groups).length ? groups : null,
    stats: ids.length ? [{ type: 'and', filters: ids.map((id) => ({ id, disabled: false })) }] : null,
    mapped,
    unmapped,
  };
}

/**
 * Merge filters/stats into an existing trade-search URL, preserving everything
 * the server already put there (league in the path, name/type, status).
 *
 * The `q` payload is re-encoded with encodeURIComponent rather than through
 * URLSearchParams, which would spell spaces as `+` and diverge from every other
 * trade link on the site. Returns the input untouched if it isn't a trade
 * search URL we can parse, so a caller never renders a broken link.
 */
export function mergeTradeQuery(href, { filters, stats } = {}) {
  if (!href || (!filters && !stats)) return href;
  const m = /^([^?]*)\?(.*)$/.exec(href);
  if (!m) return href;
  const [, base, search] = m;
  const qm = /(?:^|&)q=([^&]*)/.exec(search);
  if (!qm) return href;
  let payload;
  try {
    payload = JSON.parse(decodeURIComponent(qm[1]));
  } catch {
    return href;
  }
  const query = payload?.query;
  if (!query || typeof query !== 'object') return href;

  if (filters) {
    query.filters = query.filters ?? {};
    for (const [group, body] of Object.entries(filters)) {
      const prev = query.filters[group]?.filters ?? {};
      query.filters[group] = { ...query.filters[group], filters: { ...prev, ...body.filters } };
    }
  }
  // The server seeds an empty `stats` group; ours replaces it wholesale.
  if (stats) query.stats = stats;

  return `${base}?q=${encodeURIComponent(JSON.stringify(payload))}`;
}

/**
 * Label + tooltip for the card's Trade action once filters are applied.
 * Silence when everything mapped; an explicit count when it didn't, so the link
 * never quietly under-filters (see docs/trade-integration.md).
 */
export function tradeActionLabel({ mapped, unmapped }) {
  const total = mapped + (unmapped?.length ?? 0);
  if (!total) return null;
  if (!unmapped?.length) {
    return { label: 'Trade', title: `Search PoE Trade for this item with all ${total} chosen mod${total === 1 ? '' : 's'}` };
  }
  return {
    label: `Trade (${mapped} of ${total})`,
    title: 'The trade site has no filter for: ' + unmapped.join(', ')
      + '. The search covers the other mods.',
  };
}
