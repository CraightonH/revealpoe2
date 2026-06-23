# Base Items → Graph Foundation + App-Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the `base` node kind into the build-time graph (base/class/tag nodes + `in_class`/`tagged` edges) and cut `src/data/baseItems.js` over to read the artifact, keeping its public API and all rendered output identical.

**Architecture:** A new kind resolver `scripts/graph/bases.js` reads only `$POE2DATADIR` (`base_items.json` + `item_classes.json`), re-derives the app's base selection/slugs/props/rune-fold, and emits base/class/tag nodes and base edges. It folds into the existing `buildGraph()`. Then `baseItems.js` is rewritten into a presentation adapter over `src/data/graph.js` (reused unchanged), resolving the deferred mod/unique pieces (`resolveImplicits`, affix tables, `uniquesOnBase`) on source exactly as today — a partial cutover mirroring the gem slice.

**Tech Stack:** Node ≥20 ESM, `node:test` + `node:assert/strict`, zero new dependencies. JSON artifact.

## Global Constraints

- **Source-only lineage.** The builder reads **only** `$POE2DATADIR` via `loadJson`. It MAY import pure leaf resolvers that take raw source as input — `slugify` (`src/data/slug.js`), `computeProperties` (`src/data/itemStats.js`), the `ATTR_ABBR` constant (`src/data/attributes.js`). It MUST NOT import or consume app view-models or `baseItems.js`.
- **ESM only** — `import`/`export`, no `require`.
- **Node ≥20**, no new dependencies. Artifact is plain JSON.
- **Node identity = source id.** Base nodes are keyed by their source Metadata key. Class/tag nodes have no Metadata key, so use synthetic ids `Class/<classId>` and `Tag/<tag>`.
- **Slugs unique per kind** (validated). A base and a class may share a slug; that is allowed.
- **No dangling edges** — an edge is emitted only when both endpoints exist as nodes.
- **Edge type is fixed by source field** (the mapping table): `base.item_class` → `in_class`; `base.tags[]` → `tagged`.
- Builder tests live in `test/graph/*.test.js` and import from `../../scripts/graph/...`.
- `test/baseItems.test.js`, `test/uniques.test.js`, `test/theorycraft.test.js`, `test/search.test.js` must stay **green unchanged** throughout (rendered output is byte-for-byte identical; only the data source moves).
- `schema.js` (`KINDS`, `EDGE_TYPES`, `makeNode`, `makeEdge`) and `validate.js` are **reused as-is** — `base`/`class`/`tag` and `in_class`/`tagged`/`grants` already exist in them.
- Frequent commits — one per task. No `Co-Authored-By` line.

## File Structure

- Create `scripts/graph/bases.js` — the base-kind resolver: `selectBaseRecords`, `baseNodes`, `classNodes`, `tagNodes`, `baseEdges` (re-derived from raw source). Owns rune-variant selection.
- Create `test/graph/bases.test.js` — durable builder tests (fixed source facts + structural invariants).
- Create `test/graph/parity.test.js` — **temporary** comprehensive parity vs the current `baseItems.js`; deleted in Task 6.
- Modify `scripts/graph/build.js` — fold base/class/tag nodes + base edges into `buildGraph()`; add `item_classes.json` to `SOURCE_FILES`.
- Modify `src/data/baseItems.js` — rewrite internals to read `graph.js`; keep the public API.
- Reused unchanged: `src/data/graph.js`, `scripts/graph/schema.js`, `scripts/graph/validate.js`, `package.json` (the `prestart`/`pretest`/`predev` → `build:graph` hooks already exist).

### Reference: source field shapes (verified from `$POE2DATADIR`)

```jsonc
// base_items.json record (key = Metadata id, e.g. "Metadata/Items/Amulets/FourAmulet8")
{
  "domain": "item", "release_state": "released", "item_class": "Amulet",
  "name": "Stellar Amulet", "drop_level": 25,
  "inventory_width": 1, "inventory_height": 1,
  "tags": ["amulet", "default"],
  "implicits": ["AmuletImplicitAllAttributes1"],
  "requirements": null,                 // or { "strength": 7, "dexterity": 7, "intelligence": 7, "level": 20 }
  "skills_granted": null,               // or ["Metadata/Items/Gems/SkillGemChaosbolt"]
  "properties": { "physical_damage_min": null, "attack_time": null, ... },
  "visual_identity": { "dds_file": "Art/2DItems/Amulets/Basetypes/StellarAmulet.dds", "id": "FourAmulet8___" }
}
// item_classes.json record (key = item_class string)
"Amulet": { "category": "Amulet", "name": "Amulets", "influence_tags": null }
// rune variant example: name "Runemastered Torment Club", item_class "One Hand Mace",
//   implicits ["OlrovasaraVerisiumImplicitLightningToCold1", "OlrovasaraVerisiumWeaponImplicitDamageIsCold1"]
// disambiguation example: "Energy Blade" exists in both "One Hand Sword" and "Two Hand Sword"
```

---

### Task 1: Base record selection (identity + slug + rune split)

**Files:**
- Create: `scripts/graph/bases.js`
- Test: `test/graph/bases.test.js`

**Interfaces:**
- Consumes: `loadJson` (`src/data/loader.js`), `REPOE` (`src/config.js`), `slugify` (`src/data/slug.js`).
- Produces: `selectBaseRecords()` → `{ records: Array<{ id, slug, itemClass, raw }>, runeRaw: RawBase[], byNameClass: Map<string, Record> }`. `records` are the browsable, name|class-deduped, rune-excluded bases keyed by source id with the collision-suffixed slug. `runeRaw`/`byNameClass` feed the rune-variant fold in Task 2. Re-derives the same selection as the current `baseItems.js` `buildIndex` — from raw source.

- [ ] **Step 1: Write the failing test**

```js
// test/graph/bases.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectBaseRecords } from '../../scripts/graph/bases.js';

test('selectBaseRecords keys bases by source id and resolves known slugs', () => {
  const { records } = selectBaseRecords();
  const byId = new Map(records.map((r) => [r.id, r]));
  const stellar = byId.get('Metadata/Items/Amulets/FourAmulet8');
  assert.ok(stellar, 'Stellar Amulet present');
  assert.equal(stellar.slug, 'stellar-amulet');
  assert.equal(stellar.itemClass, 'Amulet');
  assert.equal(stellar.raw.name, 'Stellar Amulet');
  assert.ok(records.every((r) => r.id.startsWith('Metadata/')), 'ids are source Metadata keys');
});

test('selectBaseRecords excludes rune variants from records and collects them', () => {
  const { records, runeRaw } = selectBaseRecords();
  assert.ok(!records.some((r) => /^Rune(forged|mastered) /.test(r.raw.name)), 'no rune variants in records');
  assert.ok(runeRaw.length > 0, 'rune variants collected separately');
  assert.ok(runeRaw.every((v) => /^Rune(forged|mastered) /.test(v.name)));
});

test('selectBaseRecords disambiguates a name spanning multiple classes', () => {
  const { records } = selectBaseRecords();
  const slugs = new Set(records.map((r) => r.slug));
  // "Energy Blade" exists as both One Hand Sword and Two Hand Sword → class-suffixed.
  assert.ok(slugs.has('energy-blade--one-hand-sword'));
  assert.ok(slugs.has('energy-blade--two-hand-sword'));
  assert.ok(!slugs.has('energy-blade'), 'undisambiguated slug must not exist');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/graph/bases.test.js`
Expected: FAIL — cannot find module `../../scripts/graph/bases.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/graph/bases.js
import { loadJson } from '../../src/data/loader.js';
import { REPOE } from '../../src/config.js';
import { slugify } from '../../src/data/slug.js';

// Browsable item classes — mirrors src/data/baseItems.js GROUPS (the only bases
// that get pages/cards). Keep in sync with the app's GROUPS taxonomy.
export const BROWSABLE_CLASSES = new Set([
  'Bow', 'Claw', 'Crossbow', 'Dagger', 'Flail', 'FishingRod', 'One Hand Axe', 'One Hand Mace',
  'One Hand Sword', 'Sceptre', 'Spear', 'Staff', 'TrapTool', 'Two Hand Axe', 'Two Hand Mace',
  'Two Hand Sword', 'Wand', 'Warstaff',
  'Body Armour', 'Boots', 'Buckler', 'Focus', 'Gloves', 'Helmet', 'Shield',
  'Amulet', 'Belt', 'Quiver', 'Ring', 'Talisman',
]);

// Runeforged/Runemastered reissues are folded onto their parent base (Task 2),
// never their own node — mirrors src/data/baseItems.js.
const RUNE_VARIANT_RE = /^Rune(forged|mastered) /;

// A name appearing in >1 distinct browsable class gets a class-suffixed slug.
function buildSlug(name, classId, nameAcrossClasses) {
  const base = slugify(name);
  return (nameAcrossClasses[name] ?? 1) > 1 ? `${base}--${slugify(classId)}` : base;
}

export function selectBaseRecords() {
  const raw = loadJson(`${REPOE}/base_items.json`);

  // Count distinct browsable classes per name (deduped by name|class) for slug
  // disambiguation — matches baseItems.js nameAcrossClassesDeduped.
  const nameClassSeen = new Set();
  const nameAcrossClasses = {};
  for (const v of Object.values(raw)) {
    if (v.domain !== 'item' || v.release_state !== 'released') continue;
    if (!BROWSABLE_CLASSES.has(v.item_class)) continue;
    const key = `${v.name}|${v.item_class}`;
    if (nameClassSeen.has(key)) continue;
    nameClassSeen.add(key);
    nameAcrossClasses[v.name] = (nameAcrossClasses[v.name] ?? 0) + 1;
  }

  const records = [];
  const byNameClass = new Map(); // `${name}|${class}` -> record (rune parent join)
  const runeRaw = [];
  const seenNameClass = new Set();
  for (const [id, v] of Object.entries(raw)) {
    if (v.domain !== 'item' || v.release_state !== 'released') continue;
    if (!BROWSABLE_CLASSES.has(v.item_class)) continue;
    if (RUNE_VARIANT_RE.test(v.name)) { runeRaw.push(v); continue; }
    const nameClassKey = `${v.name}|${v.item_class}`;
    if (seenNameClass.has(nameClassKey)) continue;
    seenNameClass.add(nameClassKey);
    const rec = { id, slug: buildSlug(v.name, v.item_class, nameAcrossClasses), itemClass: v.item_class, raw: v };
    records.push(rec);
    byNameClass.set(nameClassKey, rec);
  }
  return { records, runeRaw, byNameClass };
}

export { RUNE_VARIANT_RE };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/graph/bases.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/bases.js test/graph/bases.test.js
git commit -m "feat: re-derive base node selection and slugs from source"
```

---

### Task 2: Base nodes + class nodes + tag nodes (complete data)

**Files:**
- Modify: `scripts/graph/bases.js`
- Test: `test/graph/bases.test.js`

**Interfaces:**
- Consumes: `selectBaseRecords`, `RUNE_VARIANT_RE`, `BROWSABLE_CLASSES` (Task 1); `makeNode`, `KINDS` (`scripts/graph/schema.js`); `slugify` (`src/data/slug.js`); `computeProperties` (`src/data/itemStats.js`); `ATTR_ABBR` (`src/data/attributes.js`).
- Produces:
  - `baseNodes()` → `{ nodes: Node[], records: SelectedBase[] }`. One `base` node per record, keyed by source id, with `props`: `{ itemClass, className, classSlug, dropLevel, inventorySize {w,h}, tags[], attr, iconDds, implicitIds[], skillsGranted[], requirements[] (plain strings), properties (computeProperties output, no labelHtml), rawProperties, runeVariants[{ name, optionIdSets: string[][] }] }`. `search` = lowercased `name + className + tags`.
  - `classNodes()` → `Node[]`. One `class` node per browsable class, id `Class/<classId>`, `props: { classId }`.
  - `tagNodes(records)` → `Node[]`. One `tag` node per distinct tag across the selected bases, id `Tag/<tag>`.

- [ ] **Step 1: Write the failing test (append to test/graph/bases.test.js)**

```js
import { baseNodes, classNodes, tagNodes } from '../../scripts/graph/bases.js';

test('baseNodes carry resolved props for a known base', () => {
  const { nodes, records } = baseNodes();
  assert.equal(nodes.length, records.length, 'one node per record');
  assert.ok(nodes.every((n) => n.kind === 'base'));
  const stellar = nodes.find((n) => n.id === 'Metadata/Items/Amulets/FourAmulet8');
  assert.ok(stellar);
  const p = stellar.props;
  assert.equal(p.itemClass, 'Amulet');
  assert.equal(p.className, 'Amulets');
  assert.equal(p.classSlug, 'amulet');
  assert.equal(p.dropLevel, 25);
  assert.deepEqual(p.inventorySize, { w: 1, h: 1 });
  assert.ok(p.tags.includes('amulet'));
  assert.deepEqual(p.implicitIds, ['AmuletImplicitAllAttributes1']);
  assert.equal(p.iconDds, 'Art/2DItems/Amulets/Basetypes/StellarAmulet.dds');
  assert.ok(stellar.search.includes('stellar amulet'));
});

test('baseNodes compute structured properties for a weapon', () => {
  const { nodes } = baseNodes();
  const club = nodes.find((n) => n.name === 'Wooden Club' && n.props.itemClass === 'One Hand Mace');
  assert.ok(club, 'wooden club present');
  const labels = club.props.properties.map((pr) => pr.label);
  assert.ok(labels.includes('Physical Damage'));
  assert.ok(club.props.properties.every((pr) => pr.labelHtml === undefined), 'no presentation labelHtml in the node');
});

test('baseNodes fold rune variants onto the parent base as raw id-sets', () => {
  const { nodes } = baseNodes();
  // "Torment Club" (One Hand Mace) is the parent of "Runemastered Torment Club".
  const parent = nodes.find((n) => n.name === 'Torment Club' && n.props.itemClass === 'One Hand Mace');
  assert.ok(parent, 'parent base present');
  const rv = parent.props.runeVariants;
  assert.ok(Array.isArray(rv) && rv.length > 0, 'has rune variants');
  assert.ok(rv.some((v) => /^Rune(forged|mastered) /.test(v.name)));
  assert.ok(rv.every((v) => Array.isArray(v.optionIdSets) && v.optionIdSets.every(Array.isArray)));
});

test('classNodes cover browsable classes with synthetic ids', () => {
  const cnodes = classNodes();
  const amulet = cnodes.find((n) => n.id === 'Class/Amulet');
  assert.ok(amulet);
  assert.equal(amulet.kind, 'class');
  assert.equal(amulet.name, 'Amulets');
  assert.equal(amulet.slug, 'amulet');
  assert.equal(amulet.props.classId, 'Amulet');
});

test('tagNodes are distinct and synthetic-id keyed', () => {
  const { records } = baseNodes();
  const tnodes = tagNodes(records);
  const ids = tnodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate tag ids');
  assert.ok(tnodes.every((n) => n.kind === 'tag' && n.id.startsWith('Tag/')));
  assert.ok(tnodes.some((n) => n.id === 'Tag/amulet'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/graph/bases.test.js`
Expected: FAIL — `baseNodes`/`classNodes`/`tagNodes` not exported.

- [ ] **Step 3: Write minimal implementation (add to scripts/graph/bases.js)**

Add imports at the top, alongside the existing ones:

```js
import { makeNode, KINDS } from './schema.js';
import { computeProperties } from '../../src/data/itemStats.js';
import { ATTR_ABBR } from '../../src/data/attributes.js';
```

Append the resolvers:

```js
// Armour defence/attribute subtype, derived from base-item tags (no hand map) —
// mirrors src/data/baseItems.js ATTR_ORDER/attrOf.
const ATTR_SUBTYPE_ORDER = [
  'str_armour', 'dex_armour', 'int_armour', 'str_dex_armour', 'str_int_armour', 'dex_int_armour',
];
const attrOf = (tags) => ATTR_SUBTYPE_ORDER.find((t) => tags.includes(t)) ?? null;

// Plain requirement display strings (pre-linkify; the app linkifies). Level from
// drop_level, then Str/Dex/Int in ATTR_ABBR order — mirrors baseItems.js buildRequirements.
function requirementStrings(req, dropLevel) {
  const out = [];
  if (dropLevel != null && dropLevel > 0) out.push(`Level ${dropLevel}`);
  if (req) {
    for (const [attr, label] of Object.entries(ATTR_ABBR)) {
      if (req[attr]) out.push(`${req[attr]} ${label}`);
    }
  }
  return out;
}

// Fold rune-system reissues onto the base they're variants of, keyed by parent
// source id. A variant ("Runemastered Torment Club") maps to its parent ("Torment
// Club") by stripping the prefix and matching within the same item class. Each
// distinct implicit-id set is kept once (the app resolves the text later). Mirrors
// baseItems.js buildRuneVariants, but stores RAW id-sets (resolveImplicits is deferred).
function buildRuneVariants(runeRaw, byNameClass) {
  const byParent = new Map(); // parentId -> Map(variantName -> { name, seen, optionIdSets })
  for (const v of runeRaw) {
    const parent = byNameClass.get(`${v.name.replace(RUNE_VARIANT_RE, '')}|${v.item_class}`);
    if (!parent) continue;
    if (!byParent.has(parent.id)) byParent.set(parent.id, new Map());
    const variants = byParent.get(parent.id);
    if (!variants.has(v.name)) variants.set(v.name, { name: v.name, seen: new Set(), optionIdSets: [] });
    const entry = variants.get(v.name);
    const ids = v.implicits ?? [];
    const key = ids.join(',');
    if (entry.seen.has(key)) continue;
    entry.seen.add(key);
    entry.optionIdSets.push(ids);
  }
  const out = new Map();
  for (const [pid, variants] of byParent) {
    out.set(pid, [...variants.values()]
      .map((e) => ({ name: e.name, optionIdSets: e.optionIdSets }))
      .sort((a, b) => a.name.localeCompare(b.name)));
  }
  return out;
}

export function baseNodes() {
  const { records, runeRaw, byNameClass } = selectBaseRecords();
  const classes = loadJson(`${REPOE}/item_classes.json`);
  const runeByParent = buildRuneVariants(runeRaw, byNameClass);
  const nodes = records.map((r) => {
    const v = r.raw;
    const tags = v.tags ?? [];
    const className = classes[r.itemClass]?.name || r.itemClass;
    const props = {
      itemClass: r.itemClass,
      className,
      classSlug: slugify(r.itemClass),
      dropLevel: v.drop_level ?? null,
      inventorySize: { w: v.inventory_width, h: v.inventory_height },
      tags,
      attr: attrOf(tags),
      iconDds: v.visual_identity?.dds_file ?? null,
      implicitIds: v.implicits ?? [],
      skillsGranted: v.skills_granted ?? [],
      requirements: requirementStrings(v.requirements, v.drop_level),
      properties: computeProperties(v.properties),
      rawProperties: v.properties ?? null,
      runeVariants: runeByParent.get(r.id) ?? [],
    };
    const search = [v.name, className, ...tags].join(' ').toLowerCase();
    return makeNode({ id: r.id, kind: KINDS.BASE, name: v.name, slug: r.slug, props, search });
  });
  return { nodes, records };
}

export function classNodes() {
  const classes = loadJson(`${REPOE}/item_classes.json`);
  const nodes = [];
  for (const classId of BROWSABLE_CLASSES) {
    const info = classes[classId];
    nodes.push(makeNode({
      id: `Class/${classId}`, kind: KINDS.CLASS,
      name: info?.name || classId, slug: slugify(classId), props: { classId },
    }));
  }
  return nodes;
}

export function tagNodes(records) {
  const seen = new Set();
  const nodes = [];
  for (const r of records) {
    for (const tag of r.raw.tags ?? []) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      nodes.push(makeNode({
        id: `Tag/${tag}`, kind: KINDS.TAG, name: tag, slug: slugify(tag), search: tag.toLowerCase(),
      }));
    }
  }
  return nodes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/graph/bases.test.js`
Expected: PASS (8 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/bases.js test/graph/bases.test.js
git commit -m "feat: base/class/tag nodes with resolved base data"
```

---

### Task 3: Base edges (in_class + tagged)

**Files:**
- Modify: `scripts/graph/bases.js`
- Test: `test/graph/bases.test.js`

**Interfaces:**
- Consumes: `makeEdge`, `EDGE_TYPES` (`scripts/graph/schema.js`); the `records` from `baseNodes` and the full node-id set.
- Produces: `baseEdges(records, nodeIds)` → `Edge[]`. For each base record: one `in_class` edge to `Class/<itemClass>` and one `tagged` edge per tag to `Tag/<tag>`, emitted only when the target id exists in `nodeIds` (no dangling).

- [ ] **Step 1: Write the failing test (append to test/graph/bases.test.js)**

```js
import { baseEdges } from '../../scripts/graph/bases.js';

test('baseEdges link a base to its class and tags, with no dangling endpoints', () => {
  const { nodes, records } = baseNodes();
  const allNodes = [...nodes, ...classNodes(), ...tagNodes(records)];
  const nodeIds = new Set(allNodes.map((n) => n.id));
  const edges = baseEdges(records, nodeIds);
  assert.ok(edges.length > 0);
  assert.ok(edges.every((e) => nodeIds.has(e.from) && nodeIds.has(e.to)), 'no dangling');

  const stellarId = 'Metadata/Items/Amulets/FourAmulet8';
  const inClass = edges.filter((e) => e.type === 'in_class' && e.from === stellarId);
  assert.equal(inClass.length, 1);
  assert.equal(inClass[0].to, 'Class/Amulet');
  const tagged = edges.filter((e) => e.type === 'tagged' && e.from === stellarId).map((e) => e.to);
  assert.ok(tagged.includes('Tag/amulet'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/graph/bases.test.js`
Expected: FAIL — `baseEdges` not exported.

- [ ] **Step 3: Write minimal implementation (add to scripts/graph/bases.js)**

Extend the schema import line to add `makeEdge`, `EDGE_TYPES`:

```js
import { makeNode, makeEdge, KINDS, EDGE_TYPES } from './schema.js';
```

Append:

```js
export function baseEdges(records, nodeIds) {
  const edges = [];
  for (const r of records) {
    const classId = `Class/${r.itemClass}`;
    if (nodeIds.has(classId)) {
      edges.push(makeEdge({ type: EDGE_TYPES.IN_CLASS, from: r.id, to: classId }));
    }
    for (const tag of r.raw.tags ?? []) {
      const tagId = `Tag/${tag}`;
      if (nodeIds.has(tagId)) {
        edges.push(makeEdge({ type: EDGE_TYPES.TAGGED, from: r.id, to: tagId }));
      }
    }
  }
  return edges;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/graph/bases.test.js`
Expected: PASS (9 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/bases.js test/graph/bases.test.js
git commit -m "feat: base in_class/tagged edges"
```

---

### Task 4: Fold bases into buildGraph + comprehensive parity test

**Files:**
- Modify: `scripts/graph/build.js`
- Test: `test/graph/build.test.js` (extend), `test/graph/parity.test.js` (create, temporary)

**Interfaces:**
- Consumes: `baseNodes`, `classNodes`, `tagNodes`, `baseEdges` (`scripts/graph/bases.js`); the existing gem resolvers; `validateGraph`.
- Produces: `buildGraph()` now assembles gem + skill + base + class + tag nodes and gem + base edges, validates clean, and hashes `base_items.json` + `item_classes.json` (added to `SOURCE_FILES`) alongside the gem sources.

- [ ] **Step 1: Write the failing tests**

Append to `test/graph/build.test.js`:

```js
test('buildGraph includes base, class, and tag nodes with base edges', () => {
  const g = buildGraph();
  assert.ok(g.nodes.some((n) => n.kind === 'base'));
  assert.ok(g.nodes.some((n) => n.kind === 'class'));
  assert.ok(g.nodes.some((n) => n.kind === 'tag'));
  assert.ok(g.edges.some((e) => e.type === 'in_class'));
  assert.ok(g.edges.some((e) => e.type === 'tagged'));
});
```

Create `test/graph/parity.test.js` (temporary — deleted in Task 6; compares the builder's base output to the current source-derived `baseItems.js`):

```js
// TEMPORARY parity harness — deleted in Task 6 after baseItems.js reads the
// artifact (the comparison becomes circular). While baseItems.js still derives
// bases from source independently, this proves the builder reproduces it exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseNodes } from '../../scripts/graph/bases.js';
import { listItemClasses, getItemClass } from '../../src/data/baseItems.js';
import { ddsUrl } from '../../src/data/images.js';
import { getGemRefByKey } from '../../src/data/gems.js';

// Every current app base record, keyed by metadataKey.
function appBasesByKey() {
  const map = new Map();
  for (const group of listItemClasses()) {
    for (const c of group.classes) {
      for (const b of getItemClass(c.classSlug).bases) map.set(b.metadataKey, b);
    }
  }
  return map;
}

test('base node set matches the current app base records', () => {
  const { nodes } = baseNodes();
  const app = appBasesByKey();
  const nodeKeys = new Set(nodes.map((n) => n.id));
  assert.equal(nodes.length, app.size, 'same base count');
  for (const k of app.keys()) assert.ok(nodeKeys.has(k), `graph missing base ${k}`);
});

test('base node props match the current app fields field-for-field', () => {
  const { nodes } = baseNodes();
  const app = appBasesByKey();
  for (const n of nodes) {
    const b = app.get(n.id);
    if (!b) continue;
    const p = n.props;
    assert.equal(n.name, b.name, `name ${n.id}`);
    assert.equal(n.slug, b.slug, `slug ${n.id}`);
    assert.equal(p.itemClass, b.itemClass, `itemClass ${n.id}`);
    assert.equal(p.className, b.className, `className ${n.id}`);
    assert.equal(p.classSlug, b.classSlug, `classSlug ${n.id}`);
    assert.equal(p.dropLevel, b.dropLevel, `dropLevel ${n.id}`);
    assert.deepEqual(p.inventorySize, b.inventorySize, `inventorySize ${n.id}`);
    assert.deepEqual(p.tags, b.tags, `tags ${n.id}`);
    assert.equal(p.attr, b.attr, `attr ${n.id}`);
    assert.equal(ddsUrl(p.iconDds), b.iconUrl, `iconUrl ${n.id}`);
    assert.deepEqual(p.implicitIds, b.implicitIds, `implicitIds ${n.id}`);
    assert.deepEqual(p.rawProperties, b.rawProperties, `rawProperties ${n.id}`);
    // node.properties is computeProperties output without the app's labelHtml.
    assert.deepEqual(
      p.properties,
      b.properties.map(({ labelHtml, ...rest }) => rest),
      `properties ${n.id}`,
    );
    // skills_granted resolves through the (already graph-backed) gem ref helper.
    const refs = (p.skillsGranted ?? []).map(getGemRefByKey).filter(Boolean);
    assert.deepEqual(refs, b.grantedSkills, `grantedSkills ${n.id}`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/graph/build.test.js test/graph/parity.test.js`
Expected: FAIL — `buildGraph` has no base nodes yet (build.test new case fails; parity fails on count).

- [ ] **Step 3: Write the implementation**

Edit `scripts/graph/build.js`. Add the bases import below the gems import:

```js
import { baseNodes, classNodes, tagNodes, baseEdges } from './bases.js';
```

Extend `SOURCE_FILES`:

```js
const SOURCE_FILES = [
  `${REPOE}/skill_gems.json`,
  `${REPOE}/skills.json`,
  `${REPOE}/base_items.json`,
  `${REPOE}/item_classes.json`,
];
```

Replace the body of `buildGraph()`:

```js
export function buildGraph() {
  const { nodes: gNodes, records: gemRecs } = gemNodes();
  const sNodes = skillNodes(gemRecs);
  const { nodes: bNodes, records: baseRecs } = baseNodes();
  const cNodes = classNodes();
  const tNodes = tagNodes(baseRecs);

  const nodes = [...gNodes, ...sNodes, ...bNodes, ...cNodes, ...tNodes];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = [...gemEdges(gemRecs, nodeIds), ...baseEdges(baseRecs, nodeIds)];

  const errors = validateGraph({ nodes, edges });
  if (errors.length) throw new Error(`graph validation failed:\n${errors.join('\n')}`);

  return { meta: { sourceHash: hashSources(), schema: 1 }, nodes, edges };
}
```

- [ ] **Step 4: Run the tests and the CLI to verify**

Run: `node --test test/graph/build.test.js test/graph/parity.test.js test/graph/bases.test.js`
Expected: PASS (build: 3 tests; parity: 2 tests; bases: 9 tests).

Run: `npm run build:graph`
Expected: prints `graph.json: <N> nodes, <M> edges -> .../build/graph.json` with N/M larger than the gem-only counts; no validation error.

Run: `node --test`
Expected: PASS — the whole suite green (existing app tests unaffected; builder still reads source independently).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/build.js test/graph/build.test.js test/graph/parity.test.js
git commit -m "feat: fold base/class/tag nodes and edges into buildGraph, add base parity test"
```

---

### Task 5: App cutover — baseItems.js reads the graph

**Files:**
- Modify: `src/data/baseItems.js` (rewrite internals; public API unchanged)

**Interfaces:**
- Consumes: `getNode`/`nodesByKind`/`nodeBySlug` (`src/data/graph.js`); `resolveImplicits`/`getModsForClass`/`getCorruptedForClass`/`getDesecratedForTags` (`src/data/mods.js`, deferred); `getGemRefByKey` (`src/data/gems.js`, graph-backed); `listUniques` (`src/data/uniques.js`, deferred); `ddsUrl`, `linkifyRequirement`, `linkifyPhrases`, `hasDefinition`.
- Produces: unchanged public API — `listItemClasses`, `getItemClass`, `listBaseNav`, `getBaseItem`, `getBaseByName`, `buildBaseItemViewModel`, `affixBaseTargets`. `getBaseItem`/`getBaseByName` return the same record shape as today (consumers `uniques.js`/`theorycraft.js` and `test/baseItems.test.js` depend on it).

This rewrites identity/selection/property/rune resolution to read graph nodes. The deferred mod/unique pieces (`resolveImplicits`, the affix tables, `uniquesOnBase`) keep reading source exactly as today. After this task `baseItems.js` performs **zero** reads of `base_items.json`/`item_classes.json`.

- [ ] **Step 1: Replace the top of the file (imports → end of `buildIndex`)**

Replace lines 1 through the end of `buildIndex` (the original line 164, the closing brace of `buildIndex`) — i.e. everything from the imports down through `buildRuneVariants`'s predecessor — with the following. Keep everything from `listItemClasses` onward **unchanged except** `listItemClasses` and the deletion of the now-unused `buildRuneVariants` (handled in Step 2).

```js
import { ddsUrl } from './images.js';
import { listUniques } from './uniques.js';
import { getModsForClass, getCorruptedForClass, getDesecratedForTags, resolveImplicits } from './mods.js';
import { getGemRefByKey } from './gems.js';
import { hasDefinition } from './keywordDefs.js';
import { linkifyRequirement, linkifyPhrases } from './keywords.js';
import { nodesByKind, nodeBySlug } from './graph.js';

// Presentation adapter over the graph artifact (build/graph.json). Base identity,
// selection, slugs, props, and rune-variant folding live in the build-time graph
// (scripts/graph/bases.js); this module reads nodes and owns the view layer. It
// performs NO reads of base_items.json/item_classes.json. Mod/affix resolution
// (resolveImplicits, the affix tables) and uniquesOnBase still read source — those
// kinds are migrated in later plans (a deliberate partial cutover).

const GROUPS = [
  {
    label: 'Weapons',
    classes: ['Bow', 'Claw', 'Crossbow', 'Dagger', 'Flail', 'FishingRod',
              'One Hand Axe', 'One Hand Mace', 'One Hand Sword', 'Sceptre',
              'Spear', 'Staff', 'TrapTool', 'Two Hand Axe', 'Two Hand Mace',
              'Two Hand Sword', 'Wand', 'Warstaff'],
  },
  {
    label: 'Armour',
    classes: ['Body Armour', 'Boots', 'Buckler', 'Focus', 'Gloves', 'Helmet', 'Shield'],
  },
  {
    label: 'Accessories',
    classes: ['Amulet', 'Belt', 'Quiver', 'Ring', 'Talisman'],
  },
];

const BROWSABLE_CLASSES = new Set(GROUPS.flatMap((g) => g.classes));

// Armour defence/attribute subtypes — player-facing labels and stable display
// order (pure types, then hybrids). The per-base `attr` is resolved in the graph.
const ATTR_ORDER = ['str_armour', 'dex_armour', 'int_armour', 'str_dex_armour', 'str_int_armour', 'dex_int_armour'];
const ATTR_LABELS = {
  str_armour: 'Armour',
  dex_armour: 'Evasion',
  int_armour: 'Energy Shield',
  str_dex_armour: 'Armour/Evasion',
  str_int_armour: 'Armour/Energy Shield',
  dex_int_armour: 'Evasion/Energy Shield',
};

let _index = null;
let _byClass = null;
let _byName = null;
let _classInfo = null;
let _runeByParent = null;

// Normalize a base node into the record shape the rest of the app reads. Field
// names mirror the original raw-derived record so consumers (uniques.js,
// theorycraft.js) and tests need no change; values come from the graph node.
// Presentation is applied here: requirement linkification, property labelHtml,
// icon URL, implicit-text resolution (deferred → mods.js), and granted-skill refs
// (graph-backed → gems.js).
function toBase(node) {
  const p = node.props;
  return {
    slug: node.slug,
    metadataKey: node.id,
    name: node.name,
    itemClass: p.itemClass,
    className: p.className,
    classSlug: p.classSlug,
    dropLevel: p.dropLevel,
    inventorySize: p.inventorySize,
    tags: p.tags ?? [],
    implicits: resolveImplicits(p.implicitIds),
    requirements: (p.requirements ?? []).map((r) => linkifyRequirement(r, hasDefinition)),
    properties: (p.properties ?? []).map((pr) => ({ ...pr, labelHtml: linkifyPhrases(pr.label, hasDefinition) })),
    rawProperties: p.rawProperties,
    iconUrl: ddsUrl(p.iconDds),
    attr: p.attr,
    implicitIds: p.implicitIds,
    grantedSkills: (p.skillsGranted ?? []).map(getGemRefByKey).filter(Boolean),
  };
}

function buildIndex() {
  if (_index) return;

  _index = new Map();
  _byClass = new Map();
  _byName = new Map();
  _classInfo = new Map();
  _runeByParent = new Map();

  for (const cnode of nodesByKind('class')) {
    _classInfo.set(cnode.props.classId, { name: cnode.name, classSlug: cnode.slug });
    _byClass.set(cnode.props.classId, []);
  }

  for (const bnode of nodesByKind('base')) {
    const rec = toBase(bnode);
    if (!_index.has(rec.slug)) _index.set(rec.slug, rec);
    if (!_byName.has(rec.name)) _byName.set(rec.name, rec);
    _byClass.get(rec.itemClass)?.push(rec);

    // Rune variants: resolve each raw implicit-id set to display lines now
    // (resolveImplicits is the deferred mod path); drop sets that resolve empty.
    const rv = bnode.props.runeVariants ?? [];
    if (rv.length) {
      _runeByParent.set(rec.slug, rv.map((v) => ({
        name: v.name,
        options: v.optionIdSets.map((ids) => resolveImplicits(ids)).filter((o) => o.length),
      })));
    }
  }

  for (const [, list] of _byClass) {
    list.sort((a, b) => (a.dropLevel ?? 0) - (b.dropLevel ?? 0) || a.name.localeCompare(b.name));
  }
}
```

- [ ] **Step 2: Delete the now-dead helpers and update `listItemClasses`**

Delete the original `buildRequirements`, `buildSlug`, and `buildRuneVariants` functions (their logic moved to the builder), and the `RUNE_VARIANT_RE` constant that only `buildRuneVariants`/`topTierBases` referenced — **but** `topTierBases` still references `RUNE_VARIANT_RE` only inside a comment; verify by search and keep the constant only if a live reference remains. (Search: `grep -n RUNE_VARIANT_RE src/data/baseItems.js` — if the only hit is a comment, delete the constant.)

In `listItemClasses`, the class slug now comes from the class node (no `slugify`). Change the per-class map object from `classSlug: slugify(c)` to:

```js
        classSlug: _classInfo.get(c)?.classSlug ?? c,
```

Leave `getItemClass`, `subtypesOf`, `normImplicit`, `modeProp`, `topTierBases`, `affixBaseTargets`, `buildAffixTargets`, `OFFHAND_CLASSES`, `listBaseNav`, `getBaseItem`, `getBaseByName`, and `buildBaseItemViewModel` **unchanged** — they already operate on the record fields `toBase` produces (`metadataKey`, `tags`, `attr`, `rawProperties`, `implicitIds`, `dropLevel`, `iconUrl`) and on `_byClass`/`_classInfo`/`_runeByParent`, and the affix tables / `uniquesOnBase` keep their source reads.

- [ ] **Step 3: Verify no stale source reads remain**

Run: `grep -n "loadJson\|computeProperties\|slugify\|REPOE\|item_classes\|base_items" src/data/baseItems.js`
Expected: **no** matches for `loadJson`, `computeProperties`, `REPOE`, `item_classes`, `base_items`, or `slugify` (all base-source resolution moved to the builder). Matches only inside comments are acceptable; a live `import`/call is a failure — remove it.

- [ ] **Step 4: Run the full suite**

Run: `node --test`
Expected: PASS — `test/baseItems.test.js`, `test/uniques.test.js`, `test/theorycraft.test.js`, `test/search.test.js`, and all `test/graph/*` stay green. (`test/graph/parity.test.js` now compares the artifact to a graph-backed `baseItems.js` — still passes, but is circular and removed in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add src/data/baseItems.js
git commit -m "feat: base app-cutover — read base data from the graph artifact"
```

---

### Task 6: Delete the temporary parity test + final verification

**Files:**
- Delete: `test/graph/parity.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing — cleanup + end-to-end verification.

- [ ] **Step 1: Delete the parity harness**

Once `baseItems.js` reads *from* the artifact, comparing artifact↔app is circular (per the file's own header). Remove it:

```bash
git rm test/graph/parity.test.js
```

- [ ] **Step 2: Rebuild the artifact and run the full suite**

Run: `npm run build:graph`
Expected: prints node/edge counts, no validation error.

Run: `node --test`
Expected: PASS — full suite green without the parity file.

- [ ] **Step 3: Manual boot check**

Run: `npm start` (the `prestart` hook rebuilds the artifact), then in another shell:

```bash
curl -s localhost:3000/bases | grep -c 'bases'
curl -s localhost:3000/bases/amulet | grep -ci 'Stellar Amulet'
curl -s localhost:3000/base/stellar-amulet | grep -ci 'Amulet'
curl -s localhost:3000/base/bombard-crossbow | grep -ci 'Grenade'
```

Expected: `/bases` renders the landing nav; `/bases/amulet` lists bases and the affix tables (deferred source path) render; `/base/stellar-amulet` shows the tooltip with uniques-on-base; `/base/bombard-crossbow` shows the resolved implicit ("Grenade") — confirming the deferred `resolveImplicits` path still works. Stop the server.

(Adjust the port if `src/index.js` uses a non-default one — check its `listen` call.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove temporary base parity test after cutover"
```

---

## Self-Review

- **Spec coverage:**
  - Base/class/tag nodes + props (spec "In scope") → Task 2 ✓
  - `in_class`/`tagged` edges (spec) → Task 3 ✓
  - Synthetic `Class/`/`Tag/` ids (spec, Global Constraints) → Tasks 2–3 ✓
  - Builder owns rune-variant selection; raw `optionIdSets` on parent (spec decision) → Task 2 (`buildRuneVariants`) ✓
  - `skills_granted` as prop, resolved via `getGemRefByKey`, no `grants` edge (spec) → Task 2 prop + Task 5 `toBase` ✓
  - Deferred on source: implicit text, rune text, affix tables, `affixBaseTargets`, `uniquesOnBase` (spec) → Task 5 (unchanged `getItemClass`/`buildBaseItemViewModel`, `resolveImplicits`) ✓
  - `graph.js` reused unchanged (spec) → no task touches it ✓
  - `sourceHash` covers builder inputs incl. `item_classes.json` (spec) → Task 4 `SOURCE_FILES` ✓
  - Public API stable; consumers/tests unchanged (spec) → Task 5 + Global Constraints ✓
  - Temporary parity test, deleted at end (spec) → Tasks 4 + 6 ✓
  - Artifact gitignored, rebuilt by hooks (spec) → existing `prestart`/`pretest` (no change needed) ✓
  - Boot check `/bases`, `/bases/:classSlug`, `/base/:slug` (spec "Done =") → Task 6 ✓
- **Placeholder scan:** none — every code/test step has complete content. The two manual "verify by grep" steps (Task 5 Step 3, Task 6 Step 3) give exact commands and expected results.
- **Type consistency:** `selectBaseRecords()` returns `{ records, runeRaw, byNameClass }` consumed by `baseNodes`; `baseNodes()` returns `{ nodes, records }` consumed by `tagNodes`/`baseEdges` and `buildGraph`; base node `props` shape produced in Task 2 is consumed verbatim by `toBase` in Task 5 (`itemClass`, `className`, `classSlug`, `dropLevel`, `inventorySize`, `tags`, `attr`, `iconDds`, `implicitIds`, `skillsGranted`, `requirements`, `properties`, `rawProperties`, `runeVariants[].optionIdSets`); `makeNode`/`makeEdge` signatures match the reused `schema.js`; class node `props.classId` produced in Task 2 is read by `buildIndex` in Task 5.
