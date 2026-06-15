# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

A modern, beginner-friendly Path of Exile 2 wiki. The target experience is the opposite of poe2db.tw — surfaces relationships between data (e.g. which support gems work with a skill gem) without requiring the user to already know those relationships. Data lives in a sibling repo (`~/git/poe2data`, path set via `POE2DATADIR` in `.env`).

## Data Sources

All game data is in `$POE2DATADIR/data/` — never committed to this repo.

### Primary tables (most-used)

| File | Contents |
|------|----------|
| `repoe-poe2/base_items.json` | All base item types — inventory size, item class, tags, attribute reqs, `visual_identity.dds_file` for icons |
| `repoe-poe2/skill_gems.json` | Skill/support gems — color, crafting_level, crafting_types, grants_skills, recommended_supports, icon_dds_file |
| `repoe-poe2/skills.json` | Skill effects (active + granted-by-mod) |
| `repoe-poe2/mods.json` | Mod definitions with stat ranges and item eligibility |
| `repoe-poe2/stat_translations/` | Stat-id → display text (human-readable mod descriptions) |
| `pob-uniques/*.json` | Full unique item stats (PoB hand-maintained); each file is a list of raw text blocks |

### Key cross-references

- `base_items.json` keys (`Metadata/Items/...`) → files under `repoe-poe2/Metadata/Items/`
- `skill_gems.json` `recommended_supports[]` → other keys in `skill_gems.json`
- `mods.json` ↔ `base_items.json` via item tags and `mods_by_base.json`
- Stat ids on mods/skills → display text via `stat_translations/`
- PoB unique name (line 1) → `repoe-poe2/uniques.json` for `dds_file`

### Icons

CDN pattern (online, lazy-loaded): `https://image.ggpk.exposed/poe2/{dds_file}?format=webp`

For items: `visual_identity.dds_file` on `base_items.json` records.
For skill gems: `icon_dds_file` directly on `skill_gems.json` records.

Offline fallback: render a placeholder using `visual_identity.id`/`name` — deterministic color from hash, initials as label. See `$POE2DATADIR/docs/image-assets.md` for the full pattern including CSS and onerror handling.

## UI Fidelity Goal

Item and gem tooltips should imitate the in-game look and feel as closely as possible. The reference implementation is **poe2db.tw** — inspect its HTML/CSS for layout patterns before building new popup styles.

Key layout patterns already established (do not drift from these):
- `.newItemPopup` — outer popup wrapper; `--card-border` / `--card-glow` CSS variables set per rarity
- `.itemHeader.doubleLine` — header banner with item name and type line; gems use `GemHoverTitle.dds` background, unique items override with a dark gradient header
- `.Stats` / `.explicitMod` / `.implicitMod` / `.separator` / `.FlavourText` — inner content structure matching poe2db class names exactly
- **Item art goes outside the popup** in `.itemboximage` beside `.newItemPopup` (poe2db pattern) — not inside the header
- poe2db URL pattern: `https://poe2db.tw/us/{ItemName_snake_case}` — use to cross-reference layout and class names

## Architecture Decisions

This wiki is a greenfield project — no framework has been chosen yet. When building:

- **Data access layer** should be a thin module that reads the JSON files from `POE2DATADIR` and exposes typed query functions (by name, by tag, by item class, etc.) rather than raw JSON access scattered through the codebase.
- **Relationships** are the primary UX value — skill gem → recommended supports → what those supports do → which weapon types they apply to. Make these traversable.
- **Beginner-first**: surface `gem_tags.json` display names, `keywords.json` glossary, and stat translation text so users never see raw stat IDs.
- **Search** needs to work across gem names, item names, and stat descriptions — the data is local so full-text search over pre-indexed JSON is feasible without a backend.

## Data Notes

- `pob-uniques/*.json` format: each file is a list of strings. Each string is a multi-line block where line 1 = unique name, rest = PoB text format with `{tags:...}` and `{variant:...}` annotations.
- `stat_translations/specific_skill_stat_descriptions/` has 559 per-skill files — load on demand, not at startup.
- The passive skill trees are in `repoe-poe2/passive_skill_trees/` — the Default tree is the character passive tree; Atlas/EndgameMap are endgame.
- Data was scraped 2026-06-03 from RePoE-fork. Re-scrape with `$POE2DATADIR/scrape.py` after game patches.

## Environment

```bash
# .env
POE2DATADIR=~/git/poe2data
```

Load `.env` in any scripts/tooling before referencing the data path.
