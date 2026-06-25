1. Make a Build Planner (save groups of items, skills, supports, etc.)
2. Make an Item Crafter
3. Expand Theory Craft page to allow pinning items across searches
4. All tooltips/cards get clickable icons for: 1. Search on PoE Trade site, 2. Add to Theory Craft
5. Add full passive tree as seen in game (big map of passives with correct shape)
6. Ingest charm/flask/jewel base items into the graph so they get browsable base pages. These item classes are currently absent from the 1027 base nodes, so legitimate uniques of those categories (e.g. charm/flask/jewel uniques) link to nonexistent `/base/<slug>` pages. As a stopgap, `src/data/uniques.js` emits `baseSlug: null` and the unique-card macro renders the base as plain text instead of a dead link — replace that with real base pages once these classes are ingested.
