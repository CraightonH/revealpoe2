# Phase 4 — Builds Pages + Add-to-Build Everywhere

Part of the Build Planner roadmap (`2026-07-06-build-planner-roadmap.md`). Depends on Phases 1 (store), 2 (slot model), 3 (UI art). The largest phase — split into milestones 4a and 4b; expect two sessions.

## Purpose

The user-facing planner: a `/builds` page (list + editor) and an "Add to Build" affordance on every card/tooltip site-wide. Client-rendered on a prerendered shell — the `/search` / `/theorycraft` static pattern.

## Routing (static-site constraint)

- **One prerendered shell page: `/builds`**, linked from site nav (crawler finds it). Client-side view switching via `location.hash`: no hash → build list; `#/b/<id>` → editor for a local build. Per-build server routes are impossible (builds exist only in the visitor's localStorage) — do not add them.
- The shell includes a no-JS notice (`<noscript>`); the planner is inherently JS-dependent, unlike browse pages.
- Client fetches: `search-index.json`, `browse-cards.json` (already crawled/copied), plus Phase 2's `planner-data.json` — ensure it's discoverable (crawlable attribute on the shell or `extractLinks()` extension) per roadmap principles.
- Keep dev-server parity: the Express route renders the same shell; all behavior is client JS reading the store. htmx is not used here (nothing server-round-trip-able).

## Milestone 4a — build list + Add-to-Build affordance

### /builds list view

- Cards for each stored build: name, class/ascendancy, item/setup counts, updated date. Actions: open, rename, duplicate, delete (confirm), create new. All via `build-store.js`.
- Empty state explains the feature + the per-browser storage caveat (one sentence, beginner-friendly).

### Add-to-Build on every card/tooltip

- Extend `views/macros/card-actions.njk` with the third affordance pair (the file's comment already anticipates this): `addBuildLink(kind, slug)` for full popups, `addBuildButton(kind, slug)` for condensed cards — emitting `data-add-build-kind` / `data-add-build-slug` attributes. Wire into the same adapters that attach `tradeUrl` (`uniques.js`, `baseItems.js`, `gems.js` view models).
- New delegated handler `public/js/add-to-build.js` (pattern: `trade-link.js`): click → popover anchored to the icon listing existing builds + "New build…"; selection appends the item ref to that build's `unassigned` bucket (gear) or, for gems, to `unassigned` too — placement into slots/setups happens in the editor. Toast confirms ("Added to <build> — open"). Works on every prerendered page (localStorage is origin-wide).
- Icon: a simple inline SVG (e.g. bag/plus) mirroring `scaleIcon()`'s self-contained style.

### Milestone 4a acceptance

- [ ] Create/rename/duplicate/delete builds on `/builds`; state survives reload.
- [ ] Add-to-Build works from a gem page popup, a unique browse card, and a theorycraft result, on the **static build** (`npm run build:static` + serve `dist/`).
- [ ] No regression to trade-link affordances; `npm test` green.

## Milestone 4b — build editor

Hash view `#/b/<id>`, three sections (tree section is Phase 5's slot — render a placeholder panel with the build's share code + link to /passives for now).

### Item section — in-game Inventory paper-doll

- CSS-grid paper-doll matching the in-game Inventory screen (Phase 3 art): weapon set panels left/right, helmet/body/gloves/boots/belt/amulet/ring wells centered, flasks/charms bottom row. Weapon-set II accessible via the in-game-style set toggle.
- Slot layout/occupancy driven by `planner-data.json` slots (Phase 2), **not** hardcoded in the template.
- Slot interactions: click empty slot → picker pre-filtered to legal items (`slugToSlots` reversed); filled slot → item card popup (reuse existing card partials/`data-card-url` flow) + remove/replace; two-hander occupies both hands visually. `unassigned` bucket renders as a tray under the doll ("stash" affordance, mirrors the in-game bag icon) with drag-or-click placement into legal slots.
- **Affix wishlist:** per slot, an "wanted affixes" chip list; adding opens the picker scoped to `type:affix` filtered to affixes that roll on the slotted/legal bases (`affixBaseTargets` data comes through the affix docs). Stored as `wishlist: [typeSlug]`. Trade-link integration is Phase 8.

### Skill section — in-game Skill Gems menu

- Stacked setup rows imitating the in-game panel (Phase 3 art): gem icon well, name banner, optional level stepper (stored `level`, no validation math yet), then circular support sockets — filled sockets show the support gem icon in the ring, empty sockets are dark rings, socket count from `planner-data.json` (`maxSupports`).
- Click empty gem well → picker scoped `type:gem` / `type:spirit`; click empty socket → picker scoped `type:support` (recommended supports for the row's skill sorted first — the graph's `recommends_support` data via browse cards; exact ranking mechanism decided at plan time).
- Setup violations from `build-rules.js` (duplicate support across setups, overflow) render as inline warnings — never hard blocks.
- Add/remove/reorder setups; spirit gems visually flagged (they're just setups whose gem is a spirit gem).

### Picker (shared by both sections)

- An overlay/panel embedding the theorycraft engine: `query-core.js` + `search-index.json` + `browse-cards.json` (the `theorycraft-client.js` rendering approach, extracted into a reusable module rather than copy-pasted). Context supplies a base query (e.g. `type:support`) the user can refine; result click adds to the invoking slot/socket.

### Milestone 4b acceptance

- [ ] Full loop on the static build: create build → add items from browse pages → place into slots → build skill setups with supports → reload → everything persists.
- [ ] Paper-doll and skill panel visually match the reference screenshots (art from Phase 3; side-by-side eyeball check).
- [ ] Legality: a body armour can't be placed in a ring slot; two-hander blocks offhand; duplicate support warns.
- [ ] `npm run build:static` passes; picker works with no server (dist served statically).
