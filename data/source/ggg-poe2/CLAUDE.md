# ggg-poe2/ — GGG official passive-tree data + sprite atlases

The **passive tree render** source: GGG's own processed tree dataset (the exact
data their official web renderer consumes) plus the web sprite atlases. Used
because RePoE lacks the precomputed per-edge arc geometry and the atlases.
Regenerable mirror — **never hand-edit** (see `../CLAUDE.md`).

## Regenerate (empty or stale)

```
npm run fetch:tree     # scripts/fetch-ggg-tree.js
```

Also part of `npm run build:static`. Run once on a fresh checkout for dev, and
after a game patch to refresh tree geometry/atlases. Writes:
- `passive-tree.json` — nodes / edges / groups / classes (+ arc geometry)
- `atlas/<name>.json` — sprite atlas frame maps (build input)
- and `public/img/passive-atlas/<name>.webp` — the atlas images (self-hosted)

Upstream: `https://pathofexile2.com/internal-api/content/game-passive-skill-tree`
and the versioned atlas asset URLs it references.

## leagues.json — current PoE2 league list

```
npm run fetch:leagues  # scripts/fetch-ggg-leagues.js
```

GGG's PoE2 trade league list (`/api/trade2/data/leagues` — the public `/leagues`
API ignores `realm=poe2`). Consumed by `scripts/graph/gameMeta.js`: the first
softcore, non-permanent entry is "the current league" for the header's patch
badge, and its wordmark is derived as `Art/2DArt/Logos/POELeagueLogo<Name>.dds`.
Run it with `scrape.py` so the label is captured with the data it labels; it warns
and keeps the previous file if GGG is unreachable.

## Working with the data

This backs the interactive tree **render only** (geometry, node icons/frames,
connector arcs, class art). The passive **pages/relationships** (the graph) are
still sourced from `../repoe-poe2/passive_skill_trees/`. Consumed at build time by
`scripts/build-passive-tree.js`. **Read `docs/passive-tree.md` before touching the
tree.**
