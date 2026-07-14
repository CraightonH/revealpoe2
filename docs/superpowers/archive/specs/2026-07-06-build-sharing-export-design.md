# Phase 8 — Sharing & In-Game Export

Part of the Build Planner roadmap (`2026-07-06-build-planner-roadmap.md`). Depends on Phases 4 (editor) and 5 (notable priority ordering). Three independent deliverables, in value order.

## 1. Share-URL flow

Phase 1 shipped the codec (`build-code.js`); this wires the UX.

- **Export:** editor "Share" action → `encodeBuild` → copy `https://<site>/builds#/import/<code>` to clipboard (the /passives copy-link pattern).
- **Import:** `/builds` client router handles `#/import/<code>` → decode → **read-only preview** of the build (name, paper-doll, setups, tree summary) with a "Save a copy" button → new local build (fresh id/timestamps). Decode failures show a friendly error, never a blank page.
- No server involvement; the fragment never hits Cloudflare logs. Codes are version-prefixed (codec v1) for future schema evolution.

## 2. Official `.build` file export

PoE2 0.5.0's in-game Build Planner reads JSON `.build` files (v1 Experimental) from `Documents/My Games/Path of Exile 2/BuildPlanner/` and highlights passives/gems/items in-game. Root `Build` object: `name`, `author?`, `description?`, `ascendancy?`, `passives[]` (ids or `BuildPassive` objects with `level_interval`/`weapon_set`/`additional_text`), `skills[]` (`BuildSkill`: id + `support_skills[]`), `inventory_slots[]` (`BuildInventorySlot`: `inventory_id` + hints), plus a small text-markup language (`<red>` etc.). Authoritative schema: GGG developer docs (pathofexile.com/developer/docs/game) — **re-verify at plan time**; the format is marked Experimental and our scraped data may postdate this spec.

### Research spike (first task of the phase)

Confirm ID spaces against **fixture files** (export real characters via poe.ninja's .build export and/or hand-make files the game accepts — the same fixture-oracle method that cracked the v7 share code in `passive-code.js`):

- `passives[]` ids — expected to be the same node hashes our tree uses; confirm.
- `skills[]` ids — determine which id space (metadata id? display name? numeric?) and map from our gem slugs; record the mapping rule.
- `inventory_slots[].inventory_id` — enumerate the official slot strings and map from Phase 2's slotIds.
- Weapon-set passives and ascendancy expression; meta gems are documented as unsupported — skip them gracefully.

Fixtures land in `test/fixtures/build-files/` with a short findings note in the spec's completion entry.

### Codec + UX

- `public/js/build-file.js` — pure `buildToBuildFile(build, plannerData)`; unit-tested against fixtures. Ordering: `passives[]` follows `notablePriority` order for prioritized nodes (this is what drives the in-game "allocate next" line), remaining allocated nodes after. Wishlist affixes become `inventory_slots[].additional_text` hints using the official markup.
- Editor "Export for game" action → download `<name>.build` + a one-line instruction popover (file goes in the BuildPlanner folder; PC only — console can't import files).

## 3. Wishlist → trade links (stretch)

Extend `tradeUrl` so a slot with a wishlist yields a trade search with **stat filters**, not just the base type. Requires mapping our mod ids → trade-API stat ids (`api/trade2/data/stats`) — volatile trade-service state, so it follows the `lineage-exchange-ids.json` precedent exactly: committed mapping file + `npm run fetch:trade-stats` refresh script + coverage report; presentation-layer, not a graph overlay. If the id-matching proves unreliable across the board, ship base-type-only links from wishlist slots and record the gap — do not fabricate mappings.

## Testing & acceptance

- [ ] Share round trip on the static site: export URL in browser A (or profile), open in a clean profile, preview renders, save-a-copy works.
- [ ] A generated `.build` file **imports successfully in-game** (manual verification by the owner — the only true oracle) and highlights tree nodes in priority order.
- [ ] Codec unit tests green against fixtures; malformed/oversized codes rejected cleanly.
- [ ] Trade stat-filter links (if shipped) open prefilled searches for a wishlist slot; refresh script prints a coverage report.
- [ ] TODO.md item 1 marked complete — roadmap done.
