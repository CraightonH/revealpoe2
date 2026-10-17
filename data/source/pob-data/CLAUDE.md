# pob-data/ — Path of Building community data export (repoe-fork JSON mirror)

JSON conversions of PoB2's Lua data tables (`PathOfBuildingCommunity/PathOfBuilding-PoE2`,
`dev` branch, via `src/Export`). The **metadata/curation authority for build
entities**: display text, affix names/groups, gem metadata, trade hashes.
Regenerable mirror — **never hand-edit** (see `../CLAUDE.md`); corrections go
upstream to PoB, not here.

## Regenerate (empty or stale)

```
python scripts/scrape.py --only pob-data
```

Upstream `https://repoe-fork.github.io/pob-data/poe2/`. `Uniques/` is excluded
from this mirror (already mirrored separately as `../pob-uniques/`).

## Working with the data

- `ModItem.json`, `ModItemExclusive.json`, `ModFlask.json`, `ModJewel.json`,
  `ModCharm.json`, `ModVeiled.json`, `ModCorrupted.json`, `ModRunes.json` —
  item mod pools, keyed by **mod id** (same ids as RePoE `mods.json`). Each
  entry carries the affix display name (`affix`), PoB group (`group`, identical
  vocabulary to RePoE's mod `type`), required level (`level`), tier display
  text (numeric string keys `"1"`, `"2"`, … — join sorted numerically with
  `"\n"`), spawn-weight tags/values (`weightKey`/`weightVal`), implicit tags
  (`modTags`), and trade-site hashes (`tradeHashes`).
- `Gems.json` — gem metadata keyed by gem name. `Skills/` — per-level skill
  data in PoB's calc format (levels are **interpolated** via
  `incrementalEffectiveness`, not explicit tables — do not treat as ground
  truth for wiki values; RePoE `skills.json` keeps the explicit per-level
  tables).
- `Bases/` — base item definitions keyed by **name** (not RePoE id).
- `FlavourText.json` — flavour text lines.
- `Bosses.json`, `BossSkills.json`, `Spectres.json`, `WorldAreas.json`, … —
  enemy data (no RePoE equivalent; currently unconsumed, reserved for future
  calc work).

## Authority split (deliberate)

PoB's export is display-oriented: tier text bakes numeric ranges into strings
and `statOrder` is a **display sort key**, not a stat id — there are no
structured `{statId: min/max}` records. So PoB is the authority for
*display/curation* (names, text, groups, trade hashes) while RePoE's
`mods.json` remains the authority for *mechanics* (structured stats, domains,
eligibility). `scripts/graph/affixes.js` joins the two on mod id. As always,
read via the graph at runtime, not these files.
