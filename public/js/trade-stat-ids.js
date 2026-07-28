// public/js/trade-stat-ids.js
//
// One shared, lazily-fetched copy of the affix → trade stat id map for the two
// places that render a planner item card (the gear-well hover tooltip in
// builds-page.js and the mod picker's live preview). Browser-only — the pure
// consumers of the map live in trade-core.js.
//
// Load failure is not an error: `get()` returns null and itemCardView falls
// back to the plain name/type trade link the server baked into the card.
let ids = null;
let loading = null;

export function loadTradeStatIds() {
  if (ids) return Promise.resolve(ids);
  loading ??= fetch('/static/generated/trade-stat-ids.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { ids = j; return j; })
    .catch(() => null);
  return loading;
}

/** The map if it has already arrived, else null. Never blocks a render. */
export function tradeStatIds() {
  return ids;
}
