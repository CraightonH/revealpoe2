# repoe-poe2/ — RePoE-fork game data (primary source)

The main upstream: a pre-rendered JSON export of PoE2 game data (base items, gems,
skills, mods, stat translations, passive-tree relationships, per-item Metadata).
**Regenerable mirror — never hand-edit** (see `../CLAUDE.md`).

## Regenerate (empty or stale)

```
python scripts/scrape.py                 # mirror everything
python scripts/scrape.py --only repoe-poe2
python scripts/scrape.py --dry-run       # discover + count, download nothing
```

Upstream `https://repoe-fork.github.io/poe2/` regenerates on every game patch;
re-run to re-mirror. Stdlib-only (no pip install). ~259M, ~2100 files.

## Working with the data

Consumed at build time by `scripts/graph/*` (gems, bases, uniques, affixes,
keywords, passives) → `build/graph.json`. **`src/` never reads it at runtime** —
traverse graph nodes/edges instead of re-parsing these files.

Most-used tables:

| File | Contents |
|---|---|
| `base_items.json` | base types — item class, tags, reqs, `visual_identity.dds_file` (icons) |
| `skill_gems.json` | skill/support gems — color, crafting, `recommended_supports[]`, `icon_dds_file` |
| `skills.json` | skill effects (active + granted-by-mod) |
| `mods.json` | mod definitions with stat ranges + item eligibility |
| `stat_translations/` | stat-id → display text (human-readable mods) |
| `Metadata/Items/…` | per-item files keyed by `base_items.json` `Metadata/Items/...` ids |

Cross-references: `mods.json` ↔ `base_items.json` via tags + `mods_by_base.json`;
stat ids → text via `stat_translations/`. **Load on demand:**
`stat_translations/specific_skill_stat_descriptions/` is 559 per-skill files —
don't load at startup.

The passive **tree render** is NOT sourced here (that's `../ggg-poe2/`), but
`passive_skill_trees/` here backs the passive graph **relationships**. See
`docs/passive-tree.md`.
