# `.build` fixtures — the id-space oracle

Two **real** PoE2 in-game Build Planner files (JSON, v1 Experimental), exported
from mobalytics.gg by build author `animeprincess` and supplied by the repo owner
2026-07-24. `author` and `link` are retained verbatim as provenance.

They are the oracle for Phase 8's export mapping — the same fixture-oracle method
that cracked the v7 passive share code. What they settle:

| Question | Answer they give |
|---|---|
| `passives[].id` id space | PassiveSkills **string** ids (`"spells18"`), not node hashes. All 208 + 203 ids resolve in `data/source/repoe-poe2/passive_skill_trees/Default.json` |
| `skills[].id` id space | BaseItemTypes metadata ids, mixing `Metadata/Items/Gem/` and `Metadata/Items/Gems/` — matching our source's two disjoint 593-gem prefix sets, so **no normalization** |
| `ascendancy` | GGG ascendancy id (`"Mercenary3"`) |
| `weapon_set` | `1` or `2` |
| `inventory_id` | `Weapon1`, `Weapon2`, `Offhand1`, `Helm1`, `BodyArmour1`, `Gloves1`, `Boots1`, `Belt1`, `Amulet1`, `Ring1`, `Ring2`, `Flask1`, `Charm1` |
| planned-item hint format | `additional_text` = base name, then `1.`-numbered mod lines |

**Known gap:** neither fixture exercises `Offhand2` or `Flask2`; we emit those by
pattern. Confirmed only by an in-game import test.
