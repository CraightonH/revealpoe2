# poe2data

Offline mirror of **Path of Exile 2** item / entity data from the
[RePoE-fork](https://repoe-fork.github.io/) project, for building a local wiki.

- **Source:** <https://repoe-fork.github.io/> (game version is recorded in each
  source's `_manifest.json`).
- **Scope:** PoE **2** only. Game data + Path of Building's hand-maintained
  Uniques. Image assets are *not* mirrored — see
  [docs/image-assets.md](docs/image-assets.md) for how to reference them.
- **License / ownership:** the data describes Grinding Gear Games' content and
  belongs to them. RePoE just exports it. Treat as fan/tooling data.

## Re-scraping (the data changes every patch)

Upstream regenerates on each game patch, so re-mirror with:

```bash
./scrape.py                 # mirror everything into ./data
./scrape.py --dry-run       # discover + count, download nothing
./scrape.py --only pob-uniques
./scrape.py --include-min   # also keep the .min.json twins
./scrape.py --help          # all options
```

Stdlib-only Python 3 (no `pip install`). The scraper stages each source in a
temp dir and only swaps it into place on a clean run, so a failed/partial pull
never clobbers your good copy. Run summary lands in `data/SCRAPE_INFO.json`; a
per-source `_manifest.json` (game version, file list, fetch time, byte count)
lands in each source dir.

### What the scraper keeps / drops

| | |
|---|---|
| ✅ keep | `*.json` (pretty), the few rendered `*.html` views |
| ⏭️ skip | `*.min.json` (identical minified twins — `--include-min` to keep) |
| 🚫 exclude | `Art/` (image assets — referenced via ggpk-exposed instead) |

---

## Layout

```
poe2data/
├── scrape.py              # re-runnable mirror script
├── docs/
│   └── image-assets.md    # how to build icon URLs (ggpk-exposed)
└── data/
    ├── SCRAPE_INFO.json   # last-run summary
    ├── repoe-poe2/        # full PoE2 game-data export  (~251 MB, 2125 json)
    └── pob-uniques/       # PoB hand-maintained Uniques  (~220 KB, 34 json)
```

---

## `data/repoe-poe2/` — game-data export

Generated from the game files. The big, frequently-referenced tables live at the
top level; bulky per-entity definitions live under `Metadata/`.

### Core tables (top-level `.json`)

| File | What it is |
|------|------------|
| `base_items.json` | **Base item types** — inventory size, item class, tags, attribute reqs, properties. Carries `visual_identity` (icon ref). The backbone table. |
| `mods.json` | **Mod definitions** — which items a mod can roll on, its stats and value ranges. |
| `mods_by_base.json` | Mods indexed by the base item they can appear on. |
| `skills.json` | **Skill effects** (active + granted-by-mod). |
| `skill_gems.json` | **Skill gems** — gem-specific metadata. |
| `active_skill_types.json` | Active skill type ids used in skills/gems. |
| `gem_tags.json` | Gem tag id → display name. |
| `stats_by_file.json` | Stat ids grouped by their source file. |
| `stat_value_handlers.json` | How raw stat values are transformed for display. |
| `tags.json` / `tag_details.json` | All item tags (used by `base_items` + `mods`). |
| `item_classes.json` | Item class ids and associated tags. |
| `keywords.json` | In-game keyword glossary (the `[Foo|bar]` link tokens in text). |
| `buffs.json` | Buff/debuff definitions. |
| `buff_visuals.json` | Buff visual/icon metadata. |
| `augments.json` | Augment definitions. |
| `ascendancies.json` | Ascendancy class definitions. |
| `characters.json` | Per-class base stat values. |
| `default_monster_stats.json` | Monster base stats by level. |
| `cost_types.json` | Resource cost types used by skills/gems. |
| `flavour.json` | Flavour-text table. |
| `audio.json` | Audio references. |
| `world_areas.json` | World/zone definitions. |
| `uniques.json` | Unique item names + art refs (game-file view; names/art only — full unique data lives in `pob-uniques/`). |

### Rendered views (`.html`)

`uniques.html`, `buff_visuals.html`, `buff_visuals_grid.html` — human-browsable
tables of the matching JSON. Handy to eyeball offline; not needed for code.

### Subdirectories

| Dir | Contents |
|-----|----------|
| `Metadata/Items/` | **Per-item-type definitions**, the bulk of the data (~118 MB). One folder per category: `Amulets Armours AtlasUpgrades Belts Brequel Currency Delve DivinationCards Expedition Flasks Gems Heist Incursion2 Jewels Legion MapFragments Maps MemoryLines MicrotransactionCurrency Omens QuestItems Quivers Relics Rings Sanctum Sceptres Sentinel SoulCores Staves TowerAugments TrapTools Ultimatum Wands Weapons`. Keyed by `Metadata/Items/...` paths — the same keys used in `base_items.json` and the `dds_file` refs. |
| `Metadata/Terrain/` | Area/terrain metadata: `CharacterSelection Gallows Hideouts Leagues Maps Missions TestAreas WorldMaps`. |
| `stat_translations/` | **Stat-id → human-readable text** (the text shown on items). Top level has category descriptions (`gem_…`, `passive_skill_…`, `monster_…`, `map_…`, etc.); `specific_skill_stat_descriptions/` has 559 per-skill statset files (one folder per skill). |
| `passive_skill_trees/` | Passive tree node/graph data: `Default`, `Atlas`, `EndgameMap`, `BrequelTree`, `Royale`. |

---

## `data/pob-uniques/` — Path of Building Uniques

Hand-maintained by the PoB team — **this is not in the game files and cannot be
data-mined.** One file per equipment slot, listing unique items and their mods:

`amulet axe belt body boots bow claw crossbow dagger fishing flail flask focus
gloves helmet incursionlimb jewel mace quiver ring sceptre shield soulcore spear
staff sword talisman tincture traptool wand`

Plus `Special/` (`Generated`, `New`, `race`).

This is the authoritative source for **full unique item details** (the
top-level `repoe-poe2/uniques.json` only carries names + art).

---

## Cross-references / how the data joins

- `base_items.json` keys (`Metadata/Items/...`) → matching files under
  `Metadata/Items/`.
- `mods.json` ↔ `base_items.json` via item tags (`tags.json`) and
  `mods_by_base.json`.
- Stat ids on mods/skills → human text via `stat_translations/`.
- Any record's `visual_identity.dds_file` → icon URL via ggpk-exposed
  ([docs/image-assets.md](docs/image-assets.md)).
- Unique names in `repoe-poe2/uniques.json` → full stats in `pob-uniques/`.
