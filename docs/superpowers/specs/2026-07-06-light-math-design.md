# Phase 7 — Light Math

Part of the Build Planner roadmap (`2026-07-06-build-planner-roadmap.md`). Depends on Phase 4 (editor to render into); benefits from Phase 5 (tree stats).

## Purpose

The approved "light math" tier: requirement totals, legality warnings, and a whitelisted set of stat aggregates. **Hard boundary: no DPS/damage/defence-effectiveness computation** — that's a modifier engine (PoB territory) and explicitly out of scope for TODO #1.

## Principle: parse at build time, sum in the browser

Stat-text parsing is fragile and belongs where it's testable against source — the build step. The browser only sums numbers.

- New build-step emission (extending Phase 2's `planner-data.json` or a sibling `public/generated/item-aggregates.json`): for every unique/base slug, the **parsed whitelisted contributions** extracted from its stat lines (e.g. `{ str: 20, fireRes: [30,40] }` — ranges kept as ranges); for every gem: `{ level, str, dex, int }` requirements (already in graph props); attribute/small-node contributions come from the existing passive-stats artifact via the Phase 5 component's aggregation (`passive-stats-agg.js` precedent — reuse its parsing, don't fork it).
- **Whitelist v1:** +Strength/+Dexterity/+Intelligence (and "all attributes"), maximum Life, maximum Mana, Spirit, elemental + chaos resistances. Everything else is ignored *silently in math* but still visible as item text. Extending the whitelist is a data change, not an engine change.
- Range-rolled values (e.g. a unique's `(30-40)%`) aggregate as min–max ranges and display as ranges.

## Computations (pure module `public/js/build-math.js`)

1. **Requirements check** — per attribute: the max requirement across equipped items + gems (with levels where set), vs. attributes available (class base + tree attribute nodes + gear attribute whitelist contributions). Output: `{ required, available, deficit }` per attribute — deficits render as warnings on the character summary and on the offending item/gem.
2. **Aggregates panel** — summed whitelist stats rendered as a compact character-sheet card in the editor (resists vs the 75% cap shown beginner-friendly, e.g. "Fire Res 45/75").
3. **Legality warnings** — surface Phase 2's `build-rules.js` violations (duplicate supports, socket overflow, slot mismatches) in one consolidated warnings strip. Spirit total: sum equipped spirit reservations vs available Spirit **only if** reservation numbers prove cleanly derivable from source at plan time — otherwise cut it (accept-the-hole policy) and note in the spec's completion entry.

All functions pure `(build, plannerData) → results`, node-tested with fixture builds; the editor just renders results.

## Testing & acceptance

- [ ] Parser unit tests against real source stat lines for every whitelist stat, incl. ranges, "all attributes", and negated/odd phrasings found in source (enumerate at plan time).
- [ ] Fixture-build tests: known gear+gems+tree → exact expected totals and deficits.
- [ ] Editor shows the summary card + warnings; totals update live on any build edit.
- [ ] A stat outside the whitelist demonstrably does not enter totals (test).
- [ ] `npm test` green; static build verified.
