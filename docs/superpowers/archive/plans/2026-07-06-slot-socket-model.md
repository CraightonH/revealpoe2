# Slot & Socket Data Model (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the build-time game-knowledge layer for the Build Planner — a gear-slot taxonomy, class→slot rules expanded into `fits_slot` edges, a lean runtime `planner-data.json` artifact, and a pure `build-rules.js` module for slot/socket legality — with zero edits to `data/source/`.

**Architecture:** A hand-authored overlay `data/manual/gear-slots.json` declares slot nodes and class→slot rules; `scripts/graph/manual.js` expands them into `gear-slot` nodes + `derived` `fits_slot` edges (one per base in each mapped class), following the existing `weapon-default-skills` precedent. A runtime adapter `src/data/planner.js` reads those graph nodes/edges and emits `public/generated/planner-data.json`. A pure ES module `public/js/build-rules.js` (dual-use, node + browser) consumes that artifact for slot/socket validation.

**Tech Stack:** Node ESM, `node:test`, the in-repo property-graph build pipeline (`scripts/graph/*`), Nunjucks-free artifact emission (`scripts/build-index.js`).

## Global Constraints

- **NEVER edit `data/source/`** — hand data lives only in `data/manual/*.json`.
- **Author rules, not enumerations** — one line per item class, expanded per base by the builder. Never hand-write per-base edges.
- **Provenance mandatory** — `gear-slot` nodes are `source: 'manual'`; `fits_slot` edges are `source: 'derived'` with `via: 'manual:gear-slots'`.
- **Referential integrity fails the build** — a `classRules.class` naming a nonexistent item class is an ERROR (not a silent drop); an unknown slot id in a rule is an ERROR.
- **Coverage gaps are visible** — item classes present in source but unmapped produce a build-time WARNING (not silent), auditable via `console.warn`.
- **Pure cores, dual-use** — `build-rules.js` has no `node:`/DOM imports at module scope; importable by `node --test` (relative path) and the browser (`/static/js/build-rules.js`).
- **Keep `planner-data.json` lean** — planner needs only (slots, per-item slot mapping + flags, per-gem setup facts); not a graph dump.
- **`npm test` stays green** (baseline: 414 tests, 0 failures).
- **Socket counts:** source (`skill_gems.json`) has NO per-gem socket-count field — `maxSupports` defaults to **5** for active/spirit gems. Do NOT hand-author per-gem numbers.
- **Spirit gems** are identified by `gemType === 'spirit'` (source `gem_type`), not stored/hand-authored.

---

## Reference facts (verified against the current worktree)

**Item classes present in source (34)** — `itemClass` | `classSlug` | #bases:

```
Amulet|amulet  Belt|belt  Body Armour|body-armour  Boots|boots  Bow|bow  Buckler|buckler
Claw|claw  Crossbow|crossbow  Dagger|dagger  FishingRod|fishingrod  Flail|flail  Focus|focus
Gloves|gloves  Helmet|helmet  Jewel|jewel  LifeFlask|lifeflask  ManaFlask|manaflask
One Hand Axe|one-hand-axe  One Hand Mace|one-hand-mace  One Hand Sword|one-hand-sword
Quiver|quiver  Ring|ring  Sceptre|sceptre  Shield|shield  Spear|spear  Staff|staff
Talisman|talisman  TrapTool|traptool  Two Hand Axe|two-hand-axe  Two Hand Mace|two-hand-mace
Two Hand Sword|two-hand-sword  UtilityFlask|utilityflask(display "Charms")  Wand|wand  Warstaff|warstaff
```

**Handedness is in source tags** (`twohand` / `onehand` on each base) — so **occupancy is DERIVED, not hand-authored** (more policy-aligned than the spec's illustrative `occupies` field). Two-handed classes (tagged `twohand`): Bow, Crossbow, FishingRod, Staff, TrapTool, Two Hand Axe/Mace/Sword, Warstaff, **Talisman** (source tags it `two_hand_weapon`).

**Deferred / unmapped (accepted holes, surfaced as warnings):**
- `Jewel` — goes in passive-tree jewel sockets, not a gear slot. Not in this taxonomy.
- `Talisman` — source data is contradictory (grouped under Accessories in `itemTaxonomy.js` but tagged as a two-hand weapon). Rather than fabricate a wrong slot, leave unmapped and document; revisit when source clarifies.

**Gem node props** (`build/graph.json`, `kind: 'gem'`): `props.gemType` ∈ {`active`,`spirit`,`support`}, `props.color` ('r'/'g'/'b'), `props.requirementWeights` (`{strength,dexterity,intelligence}`). No socket-count field.

**Static delivery:** `scripts/prerender.js` `copyPublic()` mirrors all of `public/` → `dist/static/` recursively. So `public/generated/planner-data.json` is served at `/static/generated/planner-data.json` with **no crawler change** — Phase 4's `/builds` shell wires the fetch.

**Env note:** this worktree has `data/source` symlinked from the main checkout so the graph build works.

---

## File structure

- **Modify** `scripts/graph/schema.js` — add `GEAR_SLOT: 'gear-slot'` to `KINDS`, `FITS_SLOT: 'fits_slot'` to `EDGE_TYPES`. Sets auto-derive.
- **Create** `data/manual/gear-slots.json` — slot definitions + class→slot rules (committed hand data).
- **Modify** `scripts/graph/manual.js` — add `expandGearSlots` handler, extend `ctx` (`basesByClassId`, `classIds`), register in `HANDLERS`.
- **Create** `src/data/planner.js` — runtime adapter: reads graph, returns the planner-data object.
- **Modify** `scripts/build-index.js` — emit `public/generated/planner-data.json`.
- **Create** `public/js/build-rules.js` — pure module: `legalSlots`, `gearViolations`, `setupViolations`.
- **Modify** `test/graph/schema.test.js` — assert new kind/type registered.
- **Modify** `test/graph/manual.test.js` — unit tests for `expandGearSlots` (pure `applyOverlays`).
- **Modify** `test/graph/build.test.js` — integration: `gear-slot` nodes + `fits_slot` edges present with provenance.
- **Create** `test/planner-data.test.js` — adapter end-to-end over the real graph.
- **Create** `test/build-rules.test.js` — pure-module tests (two-hander occupancy, quiver-requires-bow, duplicate support, socket overflow).

**API contract (used across tasks):**

- `planner-data.json` shape (produced by `plannerData()`, consumed by `build-rules.js`):
  ```js
  {
    slots: [ { id, name, group, accepts, order } ],           // ordered by `order`
    items: { [slug]: { slots: [slotId], twoHanded: bool, class: classSlug, requiresMainhand?: [classSlug] } },
    gems:  { [slug]: { gemType, maxSupports, color, reqs } }  // reqs = requirementWeights|null
  }
  ```
  (`items[slug].slots` realizes the spec's "slugToSlots"; the extra flags drive occupancy/quiver rules.)
- `build-rules.js` exports:
  - `legalSlots(itemRef, plannerData) -> string[]` — `itemRef = { kind, slug }`; returns `plannerData.items[slug]?.slots ?? []`.
  - `gearViolations(build, plannerData) -> Violation[]` — illegal-slot, two-hander-blocks-offhand, requires-mainhand.
  - `setupViolations(build, gemData) -> Violation[]` — `gemData = plannerData.gems`; socket-overflow, duplicate-support.
  - `Violation = { code, slotId?, setup?, support?, message }`.

---

### Task 1: Register `gear-slot` kind and `fits_slot` edge type

**Files:**
- Modify: `scripts/graph/schema.js:1-12`
- Test: `test/graph/schema.test.js`

**Interfaces:**
- Produces: `KINDS.GEAR_SLOT === 'gear-slot'`, `EDGE_TYPES.FITS_SLOT === 'fits_slot'` — consumed by Tasks 2–5.

- [ ] **Step 1: Write the failing test** — append to `test/graph/schema.test.js`:

```js
test('gear-slot kind and fits_slot edge type are registered', () => {
  assert.equal(KINDS.GEAR_SLOT, 'gear-slot');
  assert.equal(EDGE_TYPES.FITS_SLOT, 'fits_slot');
  // Factories accept them (KIND_SET/EDGE_SET auto-derive from the enums).
  const n = makeNode({ id: 'Slot/helmet', kind: KINDS.GEAR_SLOT, name: 'Helmet', slug: 'helmet', source: SOURCES.MANUAL });
  assert.equal(n.kind, 'gear-slot');
  const e = makeEdge({ type: EDGE_TYPES.FITS_SLOT, from: 'Base/X', to: 'Slot/helmet', source: SOURCES.DERIVED, via: 'manual:gear-slots' });
  assert.equal(e.type, 'fits_slot');
  assert.equal(e.via, 'manual:gear-slots');
});
```

Check the top of `test/graph/schema.test.js` imports `KINDS, EDGE_TYPES, SOURCES, makeNode, makeEdge` from `../../scripts/graph/schema.js`; add any missing name to the existing import.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/graph/schema.test.js`
Expected: FAIL — `KINDS.GEAR_SLOT` is `undefined` (assert.equal mismatch).

- [ ] **Step 3: Add the enum entries** in `scripts/graph/schema.js`:

```js
export const KINDS = {
  GEM: 'gem', SKILL: 'skill', BASE: 'base', UNIQUE: 'unique', AFFIX: 'affix',
  TAG: 'tag', KEYWORD: 'keyword', CLASS: 'class', PASSIVE: 'passive',
  ASCENDANCY: 'ascendancy', GEAR_SLOT: 'gear-slot',
};

export const EDGE_TYPES = {
  GRANTS: 'grants', RECOMMENDS_SUPPORT: 'recommends_support', ROLLS_ON: 'rolls_on',
  HAS_BASE: 'has_base', TAGGED: 'tagged', REFERENCES_KEYWORD: 'references_keyword',
  IN_CLASS: 'in_class', IN_ASCENDANCY: 'in_ascendancy',
  DEFAULT_SKILL: 'default_skill', FITS_SLOT: 'fits_slot',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/graph/schema.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/schema.js test/graph/schema.test.js
git commit -m "feat(graph): register gear-slot kind and fits_slot edge type"
```

---

### Task 2: `gear-slots.json` overlay + `expandGearSlots` handler

**Files:**
- Create: `data/manual/gear-slots.json`
- Modify: `scripts/graph/manual.js` (import `makeNode`/`KINDS`; add `expandGearSlots`; extend `ctx`; register handler)
- Test: `test/graph/manual.test.js`

**Interfaces:**
- Consumes: `KINDS.GEAR_SLOT`, `EDGE_TYPES.FITS_SLOT` (Task 1); `ctx.basesByClassId(classId)`, `ctx.classIds()` (added here).
- Produces: `gear-slot` nodes (`Slot/<id>`, `source: 'manual'`) and `fits_slot` edges (`base.id -> Slot/<slotId>`, `source: 'derived'`, `via: 'manual:gear-slots'`, optional `props.requiresMainhand`). Consumed by Tasks 3–4.

- [ ] **Step 1: Write the failing unit tests** — append to `test/graph/manual.test.js`:

```js
// --- gear-slots overlay -----------------------------------------------------
const gearNodes = [
  { id: 'Base/Helm1', kind: 'base', name: 'Iron Helm', slug: 'iron-helm', props: { itemClass: 'Helmet', classSlug: 'helmet', tags: ['helmet','armour'] }, source: 'repoe' },
  { id: 'Base/2HMace1', kind: 'base', name: 'Great Mace', slug: 'great-mace', props: { itemClass: 'Two Hand Mace', classSlug: 'two-hand-mace', tags: ['mace','twohand','weapon'] }, source: 'repoe' },
  { id: 'Base/Quiver1', kind: 'base', name: 'Broadhead Quiver', slug: 'broadhead-quiver', props: { itemClass: 'Quiver', classSlug: 'quiver', tags: ['quiver'] }, source: 'repoe' },
];
const gearOverlay = (data) => [{ name: 'gear-slots', data: { kind: 'gear-slots', ...data } }];
const SLOTS = [
  { id: 'helmet', name: 'Helmet', accepts: 'helmet', order: 5 },
  { id: 'weapon1a', name: 'Main Hand (Set I)', group: 'weaponset1', accepts: 'weapon', order: 1 },
  { id: 'weapon2a', name: 'Main Hand (Set II)', group: 'weaponset2', accepts: 'weapon', order: 3 },
  { id: 'weapon1b', name: 'Off Hand (Set I)', group: 'weaponset1', accepts: 'offhand', order: 2 },
  { id: 'weapon2b', name: 'Off Hand (Set II)', group: 'weaponset2', accepts: 'offhand', order: 4 },
];

test('gear-slots: emits gear-slot nodes and derived fits_slot edges per base', () => {
  const r = applyOverlays({
    nodes: gearNodes, edges: [],
    overlays: gearOverlay({ slots: SLOTS, classRules: [{ class: 'Helmet', slots: ['helmet'] }] }),
  });
  assert.equal(r.errors.length, 0, r.errors.join('\n'));
  const slotNodes = r.nodes.filter((n) => n.kind === 'gear-slot');
  assert.equal(slotNodes.length, 5);
  const helmetNode = slotNodes.find((n) => n.slug === 'helmet');
  assert.equal(helmetNode.id, 'Slot/helmet');
  assert.equal(helmetNode.source, 'manual');
  const fits = r.edges.filter((e) => e.type === 'fits_slot');
  assert.equal(fits.length, 1);
  assert.equal(fits[0].from, 'Base/Helm1');
  assert.equal(fits[0].to, 'Slot/helmet');
  assert.equal(fits[0].source, 'derived');
  assert.equal(fits[0].via, 'manual:gear-slots');
});

test('gear-slots: a weapon class maps to both main-hand slots', () => {
  const r = applyOverlays({
    nodes: gearNodes, edges: [],
    overlays: gearOverlay({ slots: SLOTS, classRules: [{ class: 'Two Hand Mace', slots: ['weapon1a', 'weapon2a'] }] }),
  });
  assert.equal(r.errors.length, 0);
  const to = r.edges.filter((e) => e.type === 'fits_slot').map((e) => e.to).sort();
  assert.deepEqual(to, ['Slot/weapon1a', 'Slot/weapon2a']);
});

test('gear-slots: requiresMainhand rides on the fits_slot edge props', () => {
  const r = applyOverlays({
    nodes: gearNodes, edges: [],
    overlays: gearOverlay({ slots: SLOTS, classRules: [{ class: 'Quiver', slots: ['weapon1b', 'weapon2b'], requiresMainhand: ['bow'] }] }),
  });
  assert.equal(r.errors.length, 0);
  const fits = r.edges.filter((e) => e.type === 'fits_slot');
  assert.ok(fits.length === 2 && fits.every((e) => Array.isArray(e.props?.requiresMainhand) && e.props.requiresMainhand[0] === 'bow'));
});

test('gear-slots: a class with no bases in source is a build error', () => {
  const r = applyOverlays({
    nodes: gearNodes, edges: [],
    overlays: gearOverlay({ slots: SLOTS, classRules: [{ class: 'Nonexistent Class', slots: ['helmet'] }] }),
  });
  assert.ok(r.errors.some((e) => /item class 'Nonexistent Class' has no bases/.test(e)));
});

test('gear-slots: a rule referencing an unknown slot id is a build error', () => {
  const r = applyOverlays({
    nodes: gearNodes, edges: [],
    overlays: gearOverlay({ slots: SLOTS, classRules: [{ class: 'Helmet', slots: ['nonexistent-slot'] }] }),
  });
  assert.ok(r.errors.some((e) => /unknown slot 'nonexistent-slot'/.test(e)));
});

test('gear-slots: unmapped item classes produce a coverage warning', () => {
  const r = applyOverlays({
    nodes: gearNodes, edges: [],
    overlays: gearOverlay({ slots: SLOTS, classRules: [{ class: 'Helmet', slots: ['helmet'] }] }),
  });
  // Two Hand Mace and Quiver are present in nodes but unmapped here.
  assert.ok(r.warnings.some((w) => /unmapped item class 'Two Hand Mace'/.test(w)));
  assert.ok(r.warnings.some((w) => /unmapped item class 'Quiver'/.test(w)));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/graph/manual.test.js`
Expected: FAIL — `unknown overlay kind 'gear-slots'` (handler not registered yet).

- [ ] **Step 3: Extend `ctx` in `applyOverlays`** (`scripts/graph/manual.js`). Inside the loop that builds `basesByClass`, also index by class id and collect class ids; then add the two accessors to `ctx`:

```js
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const basesByClass = new Map();
  const basesByClassId = new Map();
  const classIdSet = new Set();
  for (const n of nodes) {
    if (n.kind !== 'base') continue;
    const cs = n.props?.classSlug;
    if (cs) {
      if (!basesByClass.has(cs)) basesByClass.set(cs, []);
      basesByClass.get(cs).push(n);
    }
    const ci = n.props?.itemClass;
    if (ci) {
      classIdSet.add(ci);
      if (!basesByClassId.has(ci)) basesByClassId.set(ci, []);
      basesByClassId.get(ci).push(n);
    }
  }
  const ctx = {
    node: (id) => byId.get(id) ?? null,
    basesByClassSlug: (slug) => basesByClass.get(slug) ?? [],
    basesByClassId: (id) => basesByClassId.get(id) ?? [],
    classIds: () => [...classIdSet],
  };
```

- [ ] **Step 4: Add the handler and register it.** Update the import at the top of `scripts/graph/manual.js`:

```js
import { makeNode, makeEdge, KINDS, EDGE_TYPES, SOURCES } from './schema.js';
```

Add the handler (place it after `expandWeaponDefaultSkills`):

```js
// "Gear slot taxonomy + class→slot rules." Overlay shape:
//   { "kind": "gear-slots",
//     "slots": [ { id, name, group?, accepts?, order? }, ... ],
//     "classRules": [ { class: "<item class id>", slots: [slotId,...], requiresMainhand?: [classSlug,...] }, ... ] }
// Emits a gear-slot node per slot (source:manual) and a derived fits_slot edge
// from every base in each rule's class to each listed slot. Two-hand occupancy
// is NOT authored here — it is derived from the source `twohand` tag downstream.
function expandGearSlots(data, ctx, via) {
  const nodes = [];
  const edges = [];
  const errors = [];
  const warnings = [];

  const slotIds = new Set();
  for (const s of data.slots ?? []) {
    if (!s.id || !s.name) { errors.push(`${via}: slot entry missing id/name (${JSON.stringify(s)})`); continue; }
    slotIds.add(s.id);
    nodes.push(makeNode({
      id: `Slot/${s.id}`,
      kind: KINDS.GEAR_SLOT,
      name: s.name,
      slug: s.id,
      source: SOURCES.MANUAL,
      props: {
        group: s.group ?? null,
        accepts: s.accepts ?? null,
        order: s.order ?? null,
      },
    }));
  }

  const mapped = new Set();
  for (const rule of data.classRules ?? []) {
    const bases = ctx.basesByClassId(rule.class);
    if (!bases.length) {
      errors.push(`${via}: item class '${rule.class}' has no bases (renamed/removed in source?)`);
      continue;
    }
    mapped.add(rule.class);
    for (const slotId of rule.slots ?? []) {
      if (!slotIds.has(slotId)) {
        errors.push(`${via}: class '${rule.class}' references unknown slot '${slotId}'`);
        continue;
      }
      const props = rule.requiresMainhand ? { requiresMainhand: rule.requiresMainhand } : undefined;
      for (const base of bases) {
        edges.push(makeEdge({
          type: EDGE_TYPES.FITS_SLOT,
          from: base.id,
          to: `Slot/${slotId}`,
          source: SOURCES.DERIVED,
          via,
          props,
        }));
      }
    }
  }

  // Coverage audit: any source item class not mapped to a slot is surfaced (not silent).
  for (const classId of ctx.classIds()) {
    if (!mapped.has(classId)) warnings.push(`${via}: unmapped item class '${classId}' — no gear slot assigned`);
  }

  return { nodes, edges, errors, warnings };
}
```

Register it:

```js
const HANDLERS = {
  'weapon-default-skills': expandWeaponDefaultSkills,
  'gear-slots': expandGearSlots,
};
```

- [ ] **Step 5: Author `data/manual/gear-slots.json`** (complete, all 15 slots + 32 mapped classes; Jewel & Talisman deliberately unmapped):

```json
{
  "kind": "gear-slots",
  "description": "Gear-slot taxonomy and item-class -> slot rules for the Build Planner. NOT in RePoE source. `slots` is the irreducible slot list (paper-doll positions + weapon-set exclusivity groups); `classRules` maps each source item class to the slot(s) it fits. The builder expands each rule into a `derived` fits_slot edge per base in that class, and derives two-hand occupancy from the source `twohand` tag (not authored here). Uniques inherit slot legality at read time through their has_base edge. Verify class names against listItemClasses() before editing; a dangling class name FAILS the build.",
  "slots": [
    { "id": "weapon1a", "name": "Main Hand (Set I)", "group": "weaponset1", "accepts": "weapon", "order": 1 },
    { "id": "weapon1b", "name": "Off Hand (Set I)", "group": "weaponset1", "accepts": "offhand", "order": 2 },
    { "id": "weapon2a", "name": "Main Hand (Set II)", "group": "weaponset2", "accepts": "weapon", "order": 3 },
    { "id": "weapon2b", "name": "Off Hand (Set II)", "group": "weaponset2", "accepts": "offhand", "order": 4 },
    { "id": "helmet", "name": "Helmet", "accepts": "helmet", "order": 5 },
    { "id": "body", "name": "Body Armour", "accepts": "body", "order": 6 },
    { "id": "gloves", "name": "Gloves", "accepts": "gloves", "order": 7 },
    { "id": "boots", "name": "Boots", "accepts": "boots", "order": 8 },
    { "id": "belt", "name": "Belt", "accepts": "belt", "order": 9 },
    { "id": "amulet", "name": "Amulet", "accepts": "amulet", "order": 10 },
    { "id": "ring1", "name": "Ring 1", "accepts": "ring", "order": 11 },
    { "id": "ring2", "name": "Ring 2", "accepts": "ring", "order": 12 },
    { "id": "flask1", "name": "Life Flask", "accepts": "flask", "order": 13 },
    { "id": "flask2", "name": "Mana Flask", "accepts": "flask", "order": 14 },
    { "id": "charm1", "name": "Charm", "accepts": "charm", "order": 15 }
  ],
  "classRules": [
    { "class": "Bow", "slots": ["weapon1a", "weapon2a"] },
    { "class": "Claw", "slots": ["weapon1a", "weapon2a"] },
    { "class": "Crossbow", "slots": ["weapon1a", "weapon2a"] },
    { "class": "Dagger", "slots": ["weapon1a", "weapon2a"] },
    { "class": "FishingRod", "slots": ["weapon1a", "weapon2a"] },
    { "class": "Flail", "slots": ["weapon1a", "weapon2a"] },
    { "class": "One Hand Axe", "slots": ["weapon1a", "weapon2a"] },
    { "class": "One Hand Mace", "slots": ["weapon1a", "weapon2a"] },
    { "class": "One Hand Sword", "slots": ["weapon1a", "weapon2a"] },
    { "class": "Sceptre", "slots": ["weapon1a", "weapon2a"] },
    { "class": "Spear", "slots": ["weapon1a", "weapon2a"] },
    { "class": "Staff", "slots": ["weapon1a", "weapon2a"] },
    { "class": "TrapTool", "slots": ["weapon1a", "weapon2a"] },
    { "class": "Two Hand Axe", "slots": ["weapon1a", "weapon2a"] },
    { "class": "Two Hand Mace", "slots": ["weapon1a", "weapon2a"] },
    { "class": "Two Hand Sword", "slots": ["weapon1a", "weapon2a"] },
    { "class": "Wand", "slots": ["weapon1a", "weapon2a"] },
    { "class": "Warstaff", "slots": ["weapon1a", "weapon2a"] },
    { "class": "Shield", "slots": ["weapon1b", "weapon2b"] },
    { "class": "Buckler", "slots": ["weapon1b", "weapon2b"] },
    { "class": "Focus", "slots": ["weapon1b", "weapon2b"] },
    { "class": "Quiver", "slots": ["weapon1b", "weapon2b"], "requiresMainhand": ["bow"] },
    { "class": "Body Armour", "slots": ["body"] },
    { "class": "Helmet", "slots": ["helmet"] },
    { "class": "Gloves", "slots": ["gloves"] },
    { "class": "Boots", "slots": ["boots"] },
    { "class": "Belt", "slots": ["belt"] },
    { "class": "Amulet", "slots": ["amulet"] },
    { "class": "Ring", "slots": ["ring1", "ring2"] },
    { "class": "LifeFlask", "slots": ["flask1", "flask2"] },
    { "class": "ManaFlask", "slots": ["flask1", "flask2"] },
    { "class": "UtilityFlask", "slots": ["charm1"] }
  ],
  "_deferred": {
    "note": "Intentionally unmapped — surfaced as build warnings by design (coverage audit).",
    "cases": {
      "Jewel": "Passive-tree jewel sockets, not a gear slot.",
      "Talisman": "Source is contradictory: grouped under Accessories in itemTaxonomy.js but tagged two_hand_weapon. Not mapped until the intended slot is confirmed rather than fabricated."
    }
  }
}
```

- [ ] **Step 6: Run the unit tests to verify they pass**

Run: `node --test test/graph/manual.test.js`
Expected: PASS (all existing + 6 new gear-slots tests).

- [ ] **Step 7: Commit**

```bash
git add scripts/graph/manual.js data/manual/gear-slots.json test/graph/manual.test.js
git commit -m "feat(graph): gear-slots overlay + expandGearSlots handler (fits_slot edges)"
```

---

### Task 3: Build integration — real graph carries slot nodes & edges

**Files:**
- Test: `test/graph/build.test.js`
- (No source change expected — `manualOverlay` is already applied last in `build.js`, and `validateGraph` already accepts the new kind/type from Task 1.)

**Interfaces:**
- Consumes: `buildGraph()` output including Task 2's overlay against the real 34-class source graph.

- [ ] **Step 1: Write the failing integration test** — append to `test/graph/build.test.js`:

```js
test('buildGraph includes gear-slot nodes and derived fits_slot edges', () => {
  const g = buildGraph();
  const slots = g.nodes.filter((n) => n.kind === 'gear-slot');
  assert.equal(slots.length, 15, 'all 15 gear slots emitted');
  assert.ok(slots.every((n) => n.source === 'manual'), 'slot nodes are manual-sourced');

  const fits = g.edges.filter((e) => e.type === 'fits_slot');
  assert.ok(fits.length > 0, 'fits_slot edges present');
  assert.ok(fits.every((e) => e.source === 'derived' && e.via === 'manual:gear-slots'), 'derived + via stamped');

  // Every base of a mapped class has an edge: e.g. all 152 body armours fit `body`.
  const bodyEdges = fits.filter((e) => e.to === 'Slot/body');
  const bodyBases = g.nodes.filter((n) => n.kind === 'base' && n.props.itemClass === 'Body Armour');
  assert.equal(bodyEdges.length, bodyBases.length, 'one fits_slot edge per body-armour base');
  assert.ok(bodyEdges.every((e) => g.nodes.find((n) => n.id === e.from)?.kind === 'base'), 'edges originate at base nodes');

  // Quiver rule carries requiresMainhand on its edge props.
  const quiverEdge = fits.find((e) => e.to === 'Slot/weapon1b' && g.nodes.find((n) => n.id === e.from)?.props.itemClass === 'Quiver');
  assert.ok(quiverEdge && quiverEdge.props?.requiresMainhand?.[0] === 'bow', 'quiver edge requires a bow main-hand');
});

test('buildGraph provenance summary counts the new manual/derived contributions', () => {
  const g = buildGraph();
  assert.ok(g.meta.provenance.nodes.manual >= 15, 'gear-slot nodes counted as manual');
  assert.ok(g.meta.provenance.edges.derived > 0, 'fits_slot edges counted as derived');
});
```

- [ ] **Step 2: Run to verify it fails or passes**

Run: `node --test test/graph/build.test.js`
Expected: PASS (Tasks 1–2 already make this true). If it FAILS, the failure is a real integration bug — do NOT weaken the test; fix `manual.js`/`schema.js`. Likely failure modes to check: a `classRules.class` name mismatch (a real dangling name would throw `graph validation`/`manual overlay failed` — reconcile the overlay against the reference class list), or the provenance summary not tallying `manual` node counts.

- [ ] **Step 3: Confirm the coverage warnings surface** (manual verification, no code):

Run: `npm run build:graph 2>&1 | grep "unmapped item class"`
Expected: exactly two lines — `Jewel` and `Talisman`. If any *other* class appears, that class is missing from `classRules` — add it (unless it's a genuine new hole to defer, in which case document it in `_deferred`).

- [ ] **Step 4: Full test run**

Run: `npm test`
Expected: all green (baseline 414 + new tests).

- [ ] **Step 5: Commit**

```bash
git add test/graph/build.test.js
git commit -m "test(graph): assert gear-slot nodes + fits_slot edges in the built graph"
```

---

### Task 4: `planner-data.json` runtime artifact

**Files:**
- Create: `src/data/planner.js`
- Modify: `scripts/build-index.js` (import + emit)
- Test: `test/planner-data.test.js`

**Interfaces:**
- Consumes: `src/data/graph.js` (`nodesByKind`, `edgesTo`, `edgesFrom`, `getNode`).
- Produces: `plannerData()` returning `{ slots, items, gems }` (shape in the API contract above); written to `public/generated/planner-data.json`. Consumed by `build-rules.js` (Task 5) and Phase 4 UI.

- [ ] **Step 1: Write the failing adapter test** — create `test/planner-data.test.js`:

```js
// test/planner-data.test.js — the planner-data adapter over the real graph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannerData } from '../src/data/planner.js';
import { nodeBySlug, edgesFrom, getNode } from '../src/data/graph.js';

test('plannerData emits all 15 ordered slots', () => {
  const d = plannerData();
  assert.equal(d.slots.length, 15);
  const orders = d.slots.map((s) => s.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), 'slots are ordered by `order`');
  const helmet = d.slots.find((s) => s.id === 'helmet');
  assert.equal(helmet.accepts, 'helmet');
});

test('plannerData maps a body-armour base to the body slot', () => {
  const d = plannerData();
  const body = nodeBySlug('base', 'body-armour') || null; // sanity: not asserting a specific base slug
  // Pick any body-armour base slug from the items map instead:
  const bodySlug = Object.keys(d.items).find((slug) => d.items[slug].class === 'body-armour');
  assert.ok(bodySlug, 'at least one body-armour base present');
  assert.deepEqual(d.items[bodySlug].slots, ['body']);
  assert.equal(d.items[bodySlug].twoHanded, false);
});

test('plannerData flags two-handed weapons via the source twohand tag', () => {
  const d = plannerData();
  const twoHander = Object.values(d.items).find((it) => it.class === 'two-hand-mace');
  assert.ok(twoHander, 'a two-hand-mace base present');
  assert.equal(twoHander.twoHanded, true);
  assert.deepEqual(twoHander.slots.sort(), ['weapon1a', 'weapon2a']);
});

test('plannerData carries requiresMainhand for quivers', () => {
  const d = plannerData();
  const quiver = Object.values(d.items).find((it) => it.class === 'quiver');
  assert.ok(quiver);
  assert.deepEqual(quiver.requiresMainhand, ['bow']);
  assert.deepEqual(quiver.slots.sort(), ['weapon1b', 'weapon2b']);
});

test('plannerData: a unique inherits its base slot mapping via has_base', () => {
  const d = plannerData();
  // Find a unique in the items map whose has_base target is a mapped base.
  const uniqueSlug = Object.keys(d.items).find((slug) => {
    const n = getNode(nodeBySlug('unique', slug)?.id);
    return n && edgesFrom(n.id, 'has_base').length > 0;
  });
  assert.ok(uniqueSlug, 'at least one unique resolves through has_base');
  assert.ok(d.items[uniqueSlug].slots.length > 0, 'unique has inherited slots');
});

test('plannerData: active gems default to 5 support sockets; spirit gems tagged', () => {
  const d = plannerData();
  const gems = Object.values(d.gems);
  assert.ok(gems.some((g) => g.gemType === 'active' && g.maxSupports === 5));
  assert.ok(gems.some((g) => g.gemType === 'spirit' && g.maxSupports === 5));
  assert.ok(gems.some((g) => g.gemType === 'support' && g.maxSupports === 0));
});
```

Note: the `nodeBySlug('base','body-armour')` line above is a harmless sanity call; the real assertion picks a slug from `d.items`. Keep it simple — if you prefer, drop that first line and just use the `bodySlug` lookup.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/planner-data.test.js`
Expected: FAIL — `Cannot find module '../src/data/planner.js'`.

- [ ] **Step 3: Create `src/data/planner.js`:**

```js
// src/data/planner.js
//
// Presentation/runtime adapter that projects the gear-slot + skill-gem graph
// facts into the lean `planner-data.json` artifact the Build Planner consumes in
// the browser. Reads ONLY the graph (src/data/graph.js) — no source files.
//
//   slots  ordered gear-slot metadata (paper-doll layout + weapon-set groups)
//   items  slug -> { slots, twoHanded, class, requiresMainhand? }  (bases + uniques)
//   gems   slug -> { gemType, maxSupports, color, reqs }           (setup validation)
//
// Two-hand occupancy is derived here from the source `twohand` tag; uniques
// inherit their base's slot mapping through the has_base edge.
import { nodesByKind, edgesTo, edgesFrom, getNode } from './graph.js';

const SUPPORTABLE = new Set(['active', 'spirit']); // gem types that take support sockets
const DEFAULT_MAX_SUPPORTS = 5; // source has no per-gem socket count (see Phase 2 spec)

export function plannerData() {
  const slotNodes = nodesByKind('gear-slot');

  const slots = slotNodes
    .map((n) => ({
      id: n.slug,
      name: n.name,
      group: n.props.group ?? null,
      accepts: n.props.accepts ?? null,
      order: n.props.order ?? null,
    }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // Bases: walk fits_slot edges into each slot.
  const items = {};
  for (const slot of slotNodes) {
    for (const e of edgesTo(slot.id, 'fits_slot')) {
      const base = getNode(e.from);
      if (!base) continue;
      let rec = items[base.slug];
      if (!rec) {
        rec = items[base.slug] = {
          slots: [],
          twoHanded: (base.props.tags ?? []).includes('twohand'),
          class: base.props.classSlug ?? null,
        };
      }
      if (!rec.slots.includes(slot.slug)) rec.slots.push(slot.slug);
      if (e.props?.requiresMainhand) rec.requiresMainhand = e.props.requiresMainhand;
    }
  }

  // Uniques inherit their base's slot legality via has_base.
  for (const u of nodesByKind('unique')) {
    const baseEdge = edgesFrom(u.id, 'has_base')[0];
    if (!baseEdge) continue;
    const base = getNode(baseEdge.to);
    const baseRec = base ? items[base.slug] : null;
    if (!baseRec) continue;
    items[u.slug] = {
      slots: [...baseRec.slots],
      twoHanded: baseRec.twoHanded,
      class: baseRec.class,
      ...(baseRec.requiresMainhand ? { requiresMainhand: baseRec.requiresMainhand } : {}),
    };
  }

  // Gems: setup-validation facts. maxSupports defaults to 5 for supportable gems.
  const gems = {};
  for (const g of nodesByKind('gem')) {
    const gemType = g.props.gemType ?? null;
    gems[g.slug] = {
      gemType,
      maxSupports: SUPPORTABLE.has(gemType) ? DEFAULT_MAX_SUPPORTS : 0,
      color: g.props.color ?? null,
      reqs: g.props.requirementWeights ?? null,
    };
  }

  return { slots, items, gems };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/planner-data.test.js`
Expected: PASS.

- [ ] **Step 5: Emit the artifact from `scripts/build-index.js`.** Add the import near the others:

```js
import { plannerData } from '../src/data/planner.js';
```

Add emission after the `browse-cards.json` write (before the final `console.log`):

```js
const planner = plannerData();
fs.writeFileSync(path.join(OUT, 'planner-data.json'), JSON.stringify(planner));
```

And extend the final log line to mention it:

```js
console.log(
  `build-index: ${docs.length} docs, ${count} browse cards, ` +
  `${planner.slots.length} slots / ${Object.keys(planner.items).length} items / ${Object.keys(planner.gems).length} gems ` +
  `-> public/generated/`,
);
```

- [ ] **Step 6: Verify the artifact writes and is well-formed**

Run: `npm run build:index && node -e "const d=require('./public/generated/planner-data.json'); console.log('slots',d.slots.length,'items',Object.keys(d.items).length,'gems',Object.keys(d.gems).length); const q=Object.values(d.items).find(i=>i.class==='quiver'); console.log('quiver',JSON.stringify(q));"`
Expected: `slots 15`, items in the low thousands, gems ~1045; quiver shows `requiresMainhand:["bow"]` and off-hand slots.

- [ ] **Step 7: Commit**

```bash
git add src/data/planner.js scripts/build-index.js test/planner-data.test.js
git commit -m "feat(planner): emit public/generated/planner-data.json (slots/items/gems)"
```

---

### Task 5: `build-rules.js` pure validation module

**Files:**
- Create: `public/js/build-rules.js`
- Test: `test/build-rules.test.js`

**Interfaces:**
- Consumes: a parsed `planner-data.json` object (Task 4 shape) and a Build object (Phase 1 schema v1: `build.gear[slotId] = { item: {kind,slug}|null, wishlist }`, `build.skills[] = { gem:{slug}, level, supports:[{slug}] }`).
- Produces: `legalSlots`, `gearViolations`, `setupViolations` (signatures in the API contract). This module is the Phase 2 deliverable other phases import.

- [ ] **Step 1: Write the failing tests** — create `test/build-rules.test.js`:

```js
// test/build-rules.test.js — pure slot/socket legality rules (dual-use module).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legalSlots, gearViolations, setupViolations } from '../public/js/build-rules.js';

const PD = {
  slots: [
    { id: 'weapon1a' }, { id: 'weapon1b' }, { id: 'weapon2a' }, { id: 'weapon2b' }, { id: 'body' },
  ],
  items: {
    'great-mace': { slots: ['weapon1a', 'weapon2a'], twoHanded: true, class: 'two-hand-mace' },
    'war-bow': { slots: ['weapon1a', 'weapon2a'], twoHanded: true, class: 'bow' },
    'rusted-sword': { slots: ['weapon1a', 'weapon2a'], twoHanded: false, class: 'one-hand-sword' },
    'tower-shield': { slots: ['weapon1b', 'weapon2b'], twoHanded: false, class: 'shield' },
    'broadhead-quiver': { slots: ['weapon1b', 'weapon2b'], twoHanded: false, class: 'quiver', requiresMainhand: ['bow'] },
    'plate-vest': { slots: ['body'], twoHanded: false, class: 'body-armour' },
  },
  gems: {
    fireball: { gemType: 'active', maxSupports: 5 },
    'tiny-active': { gemType: 'active', maxSupports: 2 },
  },
};

const build = (over) => ({ gear: {}, skills: [], ...over });

test('legalSlots returns the item’s slot list; unknown slug -> []', () => {
  assert.deepEqual(legalSlots({ kind: 'base', slug: 'plate-vest' }, PD), ['body']);
  assert.deepEqual(legalSlots({ kind: 'base', slug: 'nope' }, PD), []);
});

test('gearViolations: two-hander in main hand blocks a filled off-hand', () => {
  const b = build({ gear: {
    weapon1a: { item: { kind: 'base', slug: 'great-mace' } },
    weapon1b: { item: { kind: 'base', slug: 'tower-shield' } },
  } });
  const v = gearViolations(b, PD);
  assert.ok(v.some((x) => x.code === 'two-hander-blocks-offhand' && x.slotId === 'weapon1b'));
});

test('gearViolations: one-hander + shield is legal', () => {
  const b = build({ gear: {
    weapon1a: { item: { kind: 'base', slug: 'rusted-sword' } },
    weapon1b: { item: { kind: 'base', slug: 'tower-shield' } },
  } });
  assert.equal(gearViolations(b, PD).length, 0);
});

test('gearViolations: quiver requires a bow in the same-set main hand', () => {
  const noBow = build({ gear: {
    weapon1a: { item: { kind: 'base', slug: 'rusted-sword' } },
    weapon1b: { item: { kind: 'base', slug: 'broadhead-quiver' } },
  } });
  assert.ok(gearViolations(noBow, PD).some((x) => x.code === 'requires-mainhand' && x.slotId === 'weapon1b'));

  const withBow = build({ gear: {
    weapon1a: { item: { kind: 'base', slug: 'war-bow' } },
    weapon1b: { item: { kind: 'base', slug: 'broadhead-quiver' } },
  } });
  // war-bow is two-handed, so quiver is satisfied on the bow requirement but the
  // two-hander still blocks the off-hand — assert the requires-mainhand rule passed.
  assert.ok(!gearViolations(withBow, PD).some((x) => x.code === 'requires-mainhand'));
});

test('gearViolations: item placed in a slot it does not fit', () => {
  const b = build({ gear: { body: { item: { kind: 'base', slug: 'great-mace' } } } });
  assert.ok(gearViolations(b, PD).some((x) => x.code === 'illegal-slot' && x.slotId === 'body'));
});

test('setupViolations: duplicate support across setups', () => {
  const b = build({ skills: [
    { gem: { slug: 'fireball' }, supports: [{ slug: 'faster-casting' }] },
    { gem: { slug: 'tiny-active' }, supports: [{ slug: 'faster-casting' }] },
  ] });
  const v = setupViolations(b, PD.gems);
  assert.ok(v.some((x) => x.code === 'duplicate-support' && x.support === 'faster-casting'));
});

test('setupViolations: socket overflow beyond the gem’s maxSupports', () => {
  const b = build({ skills: [
    { gem: { slug: 'tiny-active' }, supports: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }] },
  ] });
  const v = setupViolations(b, PD.gems);
  assert.ok(v.some((x) => x.code === 'socket-overflow' && x.setup === 0));
});

test('setupViolations: a legal setup yields no violations', () => {
  const b = build({ skills: [
    { gem: { slug: 'fireball' }, supports: [{ slug: 'a' }, { slug: 'b' }] },
  ] });
  assert.equal(setupViolations(b, PD.gems).length, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/build-rules.test.js`
Expected: FAIL — `Cannot find module '../public/js/build-rules.js'`.

- [ ] **Step 3: Create `public/js/build-rules.js`:**

```js
// public/js/build-rules.js
//
// Pure slot/socket legality rules for the Build Planner. No node:/DOM imports —
// importable by node:test (relative path) and by the browser at
// /static/js/build-rules.js. Operates on a parsed planner-data.json object and a
// build (schema v1). Returns violation lists; never throws on malformed input.
//
//   legalSlots(itemRef, plannerData)  -> string[]         which slots an item may occupy
//   gearViolations(build, plannerData)-> Violation[]      slot placement / occupancy
//   setupViolations(build, gemData)   -> Violation[]      skill-setup socket rules
//
// Violation = { code, slotId?, setup?, support?, message }

const WEAPON_SETS = [
  ['weapon1a', 'weapon1b'],
  ['weapon2a', 'weapon2b'],
];

export function legalSlots(itemRef, plannerData) {
  if (!itemRef || !plannerData) return [];
  return plannerData.items?.[itemRef.slug]?.slots ?? [];
}

export function gearViolations(build, plannerData) {
  const out = [];
  const gear = build?.gear ?? {};
  const items = plannerData?.items ?? {};
  const infoAt = (slotId) => {
    const slug = gear[slotId]?.item?.slug;
    return slug ? items[slug] ?? null : null;
  };

  // Item placed in a slot it does not fit.
  for (const [slotId, cell] of Object.entries(gear)) {
    const slug = cell?.item?.slug;
    if (!slug) continue;
    const info = items[slug];
    if (info && !info.slots.includes(slotId)) {
      out.push({ code: 'illegal-slot', slotId, message: `${slug} cannot be placed in ${slotId}` });
    }
  }

  // Per weapon set: two-hander occupancy + off-hand main-hand requirements.
  for (const [mainId, offId] of WEAPON_SETS) {
    const main = infoAt(mainId);
    const offFilled = Boolean(gear[offId]?.item?.slug);
    const off = infoAt(offId);

    if (main?.twoHanded && offFilled) {
      out.push({
        code: 'two-hander-blocks-offhand',
        slotId: offId,
        message: `a two-handed weapon in ${mainId} leaves no room for an off-hand`,
      });
    }
    if (off?.requiresMainhand) {
      const mainClass = main?.class ?? null;
      if (!mainClass || !off.requiresMainhand.includes(mainClass)) {
        out.push({
          code: 'requires-mainhand',
          slotId: offId,
          message: `off-hand in ${offId} requires a ${off.requiresMainhand.join('/')} in ${mainId}`,
        });
      }
    }
  }

  return out;
}

export function setupViolations(build, gemData) {
  const out = [];
  const setups = build?.skills ?? [];
  const gems = gemData ?? {};
  const seen = new Map(); // support slug -> first setup index

  setups.forEach((setup, i) => {
    const supports = setup?.supports ?? [];
    const gemSlug = setup?.gem?.slug;
    const max = (gemSlug && gems[gemSlug]?.maxSupports != null) ? gems[gemSlug].maxSupports : 5;

    if (supports.length > max) {
      out.push({ code: 'socket-overflow', setup: i, message: `${supports.length} supports exceed ${max} sockets` });
    }
    for (const s of supports) {
      const slug = s?.slug;
      if (!slug) continue;
      if (seen.has(slug)) {
        out.push({ code: 'duplicate-support', setup: i, support: slug, message: `support ${slug} already used in setup ${seen.get(slug)}` });
      } else {
        seen.set(slug, i);
      }
    }
  });

  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/build-rules.test.js`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add public/js/build-rules.js test/build-rules.test.js
git commit -m "feat(planner): build-rules.js — slot/socket legality (dual-use pure module)"
```

---

### Task 6: Full verification & roadmap checkbox

**Files:**
- Modify: `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md` (tick Phase 2)

- [ ] **Step 1: Full test suite green**

Run: `npm test`
Expected: all tests pass (baseline 414 + ~21 new). 0 failures.

- [ ] **Step 2: Static build succeeds** (catches static-only failure modes; emits + copies the artifact)

Run: `npm run build:static 2>&1 | tail -20`
Expected: completes without error; `dist/static/generated/planner-data.json` exists.
Verify: `node -e "const d=require('./dist/static/generated/planner-data.json'); console.log('dist artifact ok:', d.slots.length===15)"`
Expected: `dist artifact ok: true`.

(If `build:images`/`fetch:tree` are slow or rate-limited and unrelated to this change, `npm run build:static:cached` is an acceptable substitute for verifying the graph→index→prerender path; note which you ran.)

- [ ] **Step 3: Confirm acceptance criteria** (from the spec — verify each):
  - `fits_slot` edges exist for every base of every mapped class (Task 3 test).
  - Unmapped classes produce a visible warning list (Task 3 Step 3 — Jewel, Talisman).
  - A dangling class name would fail `npm run build:graph` (Task 2 test proves the error path).
  - `build-rules.js` unit tests: two-hander occupancy, quiver-requires-bow, duplicate-support, socket overflow (Task 5).
  - `meta.provenance` reflects new manual/derived counts (Task 3 test).

- [ ] **Step 4: Tick the roadmap checkbox.** In `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md`, change:

```
- [ ] Phase 2 — Slot & socket data model
```
to
```
- [x] Phase 2 — Slot & socket data model
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-07-06-build-planner-roadmap.md
git commit -m "docs(planner): Phase 2 (slot & socket data model) complete"
```

---

## Self-review notes

- **Spec coverage:** gear-slot taxonomy (Task 2 `gear-slots.json`); `fits_slot` derived edges + `via` (Task 2); slot metadata on slot nodes (Task 2); referential integrity fails build (Task 2 tests); retirement detection is inherited from the existing `applyOverlays` edge-dedup (no new code needed — `fits_slot` has no source counterpart today); socket counts default to 5 (Task 4); duplicate-support & spirit-gem handling (Tasks 4/5); `planner-data.json` with slots/slugToSlots(→`items[].slots`)/per-gem facts (Task 4); `build-rules.js` with `legalSlots`/`setupViolations` + the added `gearViolations` (Task 5); all four acceptance tests + provenance counts (Tasks 3/5/6).
- **Deviation from spec (documented):** occupancy (`bothHands`) is DERIVED from the source `twohand` tag, not hand-authored in `classRules` — this is strictly more policy-aligned ("rules not enumerations") than the spec's illustrative `occupies` field. `requiresMainhand` remains hand-authored (it is not in source).
- **Accepted holes (documented, surfaced as warnings):** `Jewel` (tree sockets) and `Talisman` (contradictory source signal) are intentionally unmapped per the "decide first: curate, or accept the hole" policy.
- **Naming consistency:** `plannerData()` / `planner-data.json` / `items[slug].slots` / `gems[slug].maxSupports` used identically across Tasks 4–5; `Violation` codes (`illegal-slot`, `two-hander-blocks-offhand`, `requires-mainhand`, `socket-overflow`, `duplicate-support`) used identically in module and tests.
