# In-game UI art inventory (Build Planner, Phase 3)

Catalog of real Path of Exile 2 in-game UI textures earmarked for the future
build editor/planner (Phase 4). Every asset below was independently verified
during this task — enumerated via the ggpk.exposed VueFinder API (so filenames
are exact, not guessed) and probed for webp-convertibility
(`https://image.ggpk.exposed/poe2/<path>.dds?format=webp` → `200`). Only
assets that returned `200` are listed as "Real art"; everything else drops to
the CSS-recreation Fallback section at the bottom.

**Source & licensing.** Same basis as every other piece of art in this repo
(see `NOTICES.md`): the underlying `.dds` textures are Grinding Gear Games'
intellectual property, used under fan-content fair use for this non-commercial
wiki. **Self-hosted, never hotlinked** — `scripts/fetch-images.js` mirrors each
referenced texture from ggpk.exposed into `public/img/<path>.webp` at build
time (`npm run build:images`); the live site only ever serves same-origin
`/static/img/...webp` URLs. This doc records *which* upstream assets are
referenced; the ingestion trigger is a `url()` ref in
`public/css/planner-art.css` (Task 2 of this phase), not this file.

**Path convention.** Full path
`Art/Textures/Interface/2D/2DArt/UIImages/InGame/<Subdir>/<file>.dds`, matching
the existing `SmartHover/GemHoverTitle.dds` convention already used by
`gem-card.css`. Subdirectory names are CamelCase; filenames are lowercase
(their real on-disk casing in the GGPK — the CDN is case-insensitive, but the
catalog/CSS use the same lowercase spelling for a byte-exact reverse-mapping).
All assets below are **Standalone** `.dds` files — none are packed into a
sprite atlas, so no crop step is required in `fetch-images.js`.

**Probe results:** 75/75 candidate assets returned `200` (verified
`2026-07-06` via a scratch enumerate+probe script; see the task report for the
raw log). Nothing had to be dropped to fallback.

---

## Skill Gems menu

| Asset path | What it is | Phase-4 component | Standalone/Atlas | Real art / Fallback | 4k variant? |
|---|---|---|---|---|---|
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillgempanelbg.dds` | Panel body background fill | Skill panel background | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillgempanelbgtop.dds` | Panel background — top cap | Skill panel background | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillgempanelbgbottom.dds` | Panel background — bottom cap | Skill panel background | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillgempanelbgfill.dds` | Panel background — tileable fill strip | Skill panel background | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelframe.dds` | Ornate outer panel border/frame | Skill panel frame | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelframe2.dds` | Alternate/secondary panel frame | Skill panel frame (alt state) | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelskilliconframe.dds` | Frame ring drawn around a skill gem's icon | Gem-icon frame | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillssocketempty.dds` | Empty support-gem socket ring | Support socket — empty | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillssocketblue.dds` | Filled support socket ring — blue (intelligence) | Support socket — blue | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillssocketgreen.dds` | Filled support socket ring — green (dexterity) | Support socket — green | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillssocketred.dds` | Filled support socket ring — red (strength) | Support socket — red | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillssocketwhite.dds` | Filled support socket ring — white (agnostic) | Support socket — white | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillssocketbluegreen.dds` | Dual-color socket ring — blue/green | Support socket — dual (int/dex) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillssocketgreenred.dds` | Dual-color socket ring — green/red | Support socket — dual (dex/str) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillssocketredblue.dds` | Dual-color socket ring — red/blue | Support socket — dual (str/int) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillssocketaura.dds` | Socket ring — aura-linked variant | Support socket — aura state | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillssocketglow.dds` | Socket ring glow overlay (hover/active) | Support socket — glow/hover state | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelcollapsedefault.dds` | Collapse chevron — default section | Section collapse/expand chevron | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelexpanddefault.dds` | Expand chevron — default section | Section collapse/expand chevron | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelcollapsegem.dds` | Collapse chevron — gem section | Section collapse/expand chevron | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelexpandgem.dds` | Expand chevron — gem section | Section collapse/expand chevron | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelcollapseitem.dds` | Collapse chevron — item section | Section collapse/expand chevron | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelexpanditem.dds` | Expand chevron — item section | Section collapse/expand chevron | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelcollapsegranted.dds` | Collapse chevron — granted-skill section | Section collapse/expand chevron | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelexpandgranted.dds` | Expand chevron — granted-skill section | Section collapse/expand chevron | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelcollapseascendancy.dds` | Collapse chevron — ascendancy section | Section collapse/expand chevron | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelexpandascendancy.dds` | Expand chevron — ascendancy section | Section collapse/expand chevron | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelexpandsockets.dds` | Expand chevron — sockets section | Section collapse/expand chevron | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelamountbg.dds` | Level/quality readout background pill | Gem level badge background | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelexpbar.dds` | Gem XP bar track | Gem XP bar (track) | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelexpbarfill.dds` | Gem XP bar fill | Gem XP bar (fill) | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/itemslotamulet.dds` | Equipment-slot silhouette — amulet | Equipped-item silhouette (amulet) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/itemslotbelt.dds` | Equipment-slot silhouette — belt | Equipped-item silhouette (belt) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/itemslotbody.dds` | Equipment-slot silhouette — body armour | Equipped-item silhouette (body) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/itemslotboots.dds` | Equipment-slot silhouette — boots | Equipped-item silhouette (boots) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/itemslotgloves.dds` | Equipment-slot silhouette — gloves | Equipped-item silhouette (gloves) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/itemslothelmet.dds` | Equipment-slot silhouette — helmet | Equipped-item silhouette (helmet) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/itemslotring.dds` | Equipment-slot silhouette — ring | Equipped-item silhouette (ring) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/itemslotweapon.dds` | Equipment-slot silhouette — weapon | Equipped-item silhouette (weapon) | Standalone | Real art | No |

## Inventory paper-doll

| Asset path | What it is | Phase-4 component | Standalone/Atlas | Real art / Fallback | 4k variant? |
|---|---|---|---|---|---|
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/InventoryPanel/inventorysquare.dds` | Single inventory-grid cell well | Inventory grid cell / equipment slot well | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/InventoryPanel/inventoryareaframe.dds` | Border frame around the grid area | Inventory grid area frame | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/InventoryPanel/inventorypanelupperbackground.dds` | Paper-doll upper-body background panel | Paper-doll backdrop (upper) | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/InventoryPanel/panelbottom.dds` | Panel lower background/footer | Paper-doll backdrop (lower) | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/InventoryPanel/inventorypanelringslot.dds` | Ring-slot well (round) | Equipment slot — ring | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/InventoryPanel/inventorypanelcharmslots3x1.dds` | Charm slot strip, 1-row layout | Equipment slot — charms (1-row) | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/InventoryPanel/inventorypanelcharmslots3x2.dds` | Charm slot strip, 2-row layout | Equipment slot — charms (2-row) | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/InventoryPanel/inventorypanelpotionlifeleft.dds` | Life-flask slot, left half | Equipment slot — life flask | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/InventoryPanel/inventorypanelpotionliferight.dds` | Life-flask slot, right half | Equipment slot — life flask | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/InventoryPanel/inventorypanelpotionmanaleft.dds` | Mana-flask slot, left half | Equipment slot — mana flask | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/InventoryPanel/inventorypanelpotionmanaright.dds` | Mana-flask slot, right half | Equipment slot — mana flask | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/InventoryPanel/potionsareaframe.dds` | Border frame around the flask/charm row | Flask row area frame | Standalone | Real art | Yes |

## Build Planner chrome

GGG ships its own in-game build-planner panel under `BuildPlanner/` — on-theme
chrome we can reuse for our own planner UI (optional/decorative; not required
for MVP fidelity, but free and on-brand).

| Asset path | What it is | Phase-4 component | Standalone/Atlas | Real art / Fallback | 4k variant? |
|---|---|---|---|---|---|
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/BuildPlanner/plannerbgexpanded.dds` | Planner panel background — expanded state | Planner panel background | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/BuildPlanner/plannerbgcollapsed.dds` | Planner panel background — collapsed state | Planner panel background (collapsed) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/BuildPlanner/plannerbuttonregular.dds` | Planner button — default state | Planner action button | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/BuildPlanner/plannerbuttonhover.dds` | Planner button — hover state | Planner action button (hover) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/BuildPlanner/plannerbuttonpressed.dds` | Planner button — pressed state | Planner action button (pressed) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/BuildPlanner/plannernodeoverlaysmall.dds` | Node highlight overlay — small | Planned-node highlight (small) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/BuildPlanner/plannernodeoverlaymedium.dds` | Node highlight overlay — medium | Planned-node highlight (medium) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/BuildPlanner/plannernodeoverlaylarge.dds` | Node highlight overlay — large | Planned-node highlight (large/keystone) | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/BuildPlanner/iconplannerblue.dds` | Planner glyph icon (blue) | Planner nav/tab icon | Standalone | Real art | No |

## Character/stat chrome

Reference for a later light-math stat readout (planned Phase 7); catalogued
now while the directory is already enumerated.

| Asset path | What it is | Phase-4 component | Standalone/Atlas | Real art / Fallback | 4k variant? |
|---|---|---|---|---|---|
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/CharacterPanel/characterpanelframe.dds` | Outer frame for the character stat panel | Stat panel frame | Standalone | Real art | Yes |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/CharacterPanel/mainstathealth.dds` | Health orb/bar chrome | Stat readout — health | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/CharacterPanel/mainstatmana.dds` | Mana orb/bar chrome | Stat readout — mana | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/CharacterPanel/mainstatenergyshield.dds` | Energy shield bar chrome | Stat readout — energy shield | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/CharacterPanel/mainstatsbg.dds` | Background strip behind the three main-stat bars | Stat readout — main-stats background | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/CharacterPanel/resistancestatsbg.dds` | Background strip behind resistance icons | Stat readout — resistances background | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/CharacterPanel/defensivestatsbg.dds` | Background strip behind defensive stats (block/dodge/evasion/armour) | Stat readout — defensive-stats background | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/CharacterPanel/iconfire.dds` | Fire resistance icon | Resistance icon — fire | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/CharacterPanel/iconcold.dds` | Cold resistance icon | Resistance icon — cold | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/CharacterPanel/iconlightning.dds` | Lightning resistance icon | Resistance icon — lightning | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/CharacterPanel/iconchaos.dds` | Chaos resistance icon | Resistance icon — chaos | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/CharacterPanel/iconblock.dds` | Block-chance icon | Defensive stat icon — block | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/CharacterPanel/icondodge.dds` | Dodge/spell-suppression icon | Defensive stat icon — dodge | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/CharacterPanel/iconevasion.dds` | Evasion icon | Defensive stat icon — evasion | Standalone | Real art | No |
| `Art/Textures/Interface/2D/2DArt/UIImages/InGame/CharacterPanel/iconphysicalreduction.dds` | Physical damage reduction (armour) icon | Defensive stat icon — armour | Standalone | Real art | No |

---

## Fallback (CSS recreation)

Elements planned for the build editor that have **no usable in-game texture**
under `UIImages/InGame/` — recreate with CSS, don't reference a `.dds`:

- **Paper-doll character mannequin/statue backdrop.** In-game, the equipped
  paper-doll silhouette sits in front of a 3D-rendered character model/statue,
  not a 2D UI texture — nothing under this asset tree corresponds to it, and
  it's purely decorative framing. **Omit or approximate** with a CSS
  radial-gradient/vignette behind the equipment-slot silhouettes (see
  `gem-card.css`'s unique-header gradient precedent) rather than chasing a
  non-existent asset.
- **Socket connector lines** between a skill gem and its linked supports.
  `SkillPanel/itemssocketconnection.dds` exists upstream but wasn't part of
  this task's probed/confirmed set (out of scope for the Task-2 skeleton); if
  Phase 4 needs it, probe it first per "How to extend" below, otherwise draw
  the link with an SVG/CSS line.

## Out of scope for Phase 4 MVP

- **Weapon-swap tabs, cosmetics tabs, druid/shaman spirit slot, crossbow
  attachment chrome** (present in the full `InventoryPanel`/`SkillPanel`
  listings — 114 and 47 files total respectively, only a subset of which is
  cataloged above) are out of scope for the Phase 4 MVP — not a CSS-fallback
  case, just not yet needed. Add rows to the catalog above if a later phase
  picks them up.

## How to extend

1. Confirm the asset exists and converts: enumerate its directory via
   `https://ggpk.exposed/files?q=index&adapter=poe2&path=poe2://<lowercase-dir>`
   and probe `https://image.ggpk.exposed/poe2/<path>.dds?format=webp` for a
   `200` (run any probe script with
   `env -u SSL_CERT_FILE -u NODE_EXTRA_CA_CERTS node ...` — never `curl`,
   corporate TLS interception breaks it).
2. Add a `url(/static/img/<path>.webp)` reference in
   `public/css/planner-art.css`.
3. Add a row to this table (same path, lowercase filename, CamelCase subdir).
4. Run `npm run build:images` — the new `.dds` is auto-discovered via
   `ddsFromCss()` in `scripts/fetch-images.js` and mirrored into
   `public/img/<path>.webp`.
