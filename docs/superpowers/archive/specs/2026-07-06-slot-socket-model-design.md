# Phase 2 — Slot & Socket Data Model

Part of the Build Planner roadmap (`2026-07-06-build-planner-roadmap.md`). Graph/build-time work; no planner UI yet.

## Purpose

The game-knowledge layer the build editor renders from: which gear slots exist, which item classes fit which slots, and what a legal skill setup looks like. Follows the data-provenance policy: hand-authored **rules** in `data/manual/`, expanded by the builder into `derived` edges — never per-base enumeration, never edits to `data/source/`.

## Gear slot taxonomy

New overlay `data/manual/gear-slots.json`:

```jsonc
{
  "slots": [
    // id, display name, paper-doll position hint, exclusivity group
    { "id": "weapon1a", "name": "Main Hand (Set I)", "group": "weaponset1" },
    { "id": "weapon1b", "name": "Off Hand (Set I)",  "group": "weaponset1" },
    { "id": "weapon2a", "name": "Main Hand (Set II)", "group": "weaponset2" },
    { "id": "weapon2b", "name": "Off Hand (Set II)",  "group": "weaponset2" },
    { "id": "helmet", "name": "Helmet" },
    { "id": "body",   "name": "Body Armour" },
    { "id": "gloves", "name": "Gloves" },
    { "id": "boots",  "name": "Boots" },
    { "id": "belt",   "name": "Belt" },
    { "id": "amulet", "name": "Amulet" },
    { "id": "ring1",  "name": "Ring 1" }, { "id": "ring2", "name": "Ring 2" },
    { "id": "flask1", "name": "Life Flask" }, { "id": "flask2", "name": "Mana Flask" },
    { "id": "charm1", "name": "Charm" }       // charm count scales with belt; editor may show up to 3
  ],
  "classRules": [
    // item class → slots + occupancy. Verify class names against
    // listItemClasses() during implementation; FAIL the build on a dangling name.
    { "class": "Body Armour", "slots": ["body"] },
    { "class": "Two Hand Mace", "slots": ["weapon1a", "weapon2a"], "occupies": "bothHands" },
    { "class": "Quiver", "slots": ["weapon1b", "weapon2b"], "requiresMainhand": ["Bow"] }
    // … full table authored in implementation, one line per item class
  ]
}
```

- `scripts/graph/manual.js` gains a handler emitting **`derived` `fits_slot` edges** (base → slot) for every base in a rule's class, `via: manual:gear-slots`. Uniques inherit through their `has_base` edge — resolve at read time in the adapter, don't duplicate edges.
- Slot metadata (paper-doll layout, occupancy, exclusivity) rides on **slot nodes** (`kind: 'gear-slot'`, `source: manual`).
- Referential integrity: a `classRules.class` naming a nonexistent item class **fails the build** (policy). Retirement detection warns if source ever ships slot data.

## Skill setup rules

- **Socket counts:** a skill gem's max support sockets comes from source where available (verify `skill_gems.json` fields during implementation; poe2db shows per-gem socket counts). If source lacks it, default to 5 and note the gap — do not hand-author per-gem numbers (high churn).
- **Duplicate-support rule:** the same support gem cannot appear in more than one setup in a build (PoE2 rule). This is a *validation rule*, encoded in the shared rules module, not data.
- **Spirit gems:** identified by existing gem type (`gemType === 'spirit'`); they occupy setups like skills. Spirit *reservation totals* are Phase 7 (light math).
- Deliverable: `public/js/build-rules.js` — pure module: `legalSlots(itemRef, graphExtract)`, `setupViolations(build, gemData)` (duplicate supports, socket overflow), unit-tested. Data it needs at runtime ships in a small generated artifact (see below).

## Runtime artifact

The browser can't read the graph. `scripts/build-index.js` (or a sibling) additionally emits **`public/generated/planner-data.json`**:

- `slots` (ordered, with layout/occupancy metadata),
- `slugToSlots` (item slug → legal slotIds, uniques resolved through their base),
- per-gem: `{ maxSupports, gemType, reqs }` for setup validation and later math.

Keep it lean (planner needs only; not a graph dump). Prerender note: reference it from the /builds shell with a crawlable attribute or extend `extractLinks()` — see roadmap principles.

## Testing & acceptance

- [ ] Graph build: `fits_slot` edges exist for every base of every mapped class; unmapped classes produce a build-time **warning list** (visible, not silent) so coverage gaps are auditable.
- [ ] Dangling class name in the overlay fails `npm run build:graph`.
- [ ] `build-rules.js` unit tests: two-hander occupancy, quiver-requires-bow, duplicate-support detection, socket overflow.
- [ ] `meta.provenance` counts reflect the new manual/derived contributions.
