# Graph Foundation + Gems Vertical Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a deterministic build-time graph pipeline and prove it end-to-end on the gems vertical slice — gem + skill nodes, `grants` and `recommends_support` edges — verified against the current app's output by parity tests.

**Architecture:** A build script (`scripts/graph/`) reads raw source from `$POE2DATADIR` only, resolves gem/skill nodes and their edges, validates the result, and serializes a complete-data `graph.json`. The running app is **not** touched in this plan — parity is asserted in tests by comparing the graph's output to the current `src/data/*.js` modules. App cutover and the remaining node kinds are follow-on plans (see end).

**Tech Stack:** Node ≥20 ESM, `node:test` + `node:assert/strict`, zero new dependencies. JSON artifact.

## Global Constraints

- **Source-only lineage.** The build reads **only** `$POE2DATADIR` (via `src/data/loader.js`'s `loadJson`/`listDataDir`, which are pure source readers). You MAY import *pure leaf resolvers* that take raw source as input — `slugify` (`src/data/slug.js`), `buildSections` (`src/data/statText.js`), the `ATTR_*` constants (`src/data/attributes.js`), `grantedSkillNames` (`src/data/grantedSkills.js`). You MUST NOT import or consume index/view-model builders or any app-produced output (e.g. `index()`, `buildGemViewModel`, `allDocs`) as a data source.
- **ESM only** — the repo is `"type": "module"`; use `import`/`export`, no `require`.
- **Node ≥20**, no new dependencies. The artifact is plain JSON.
- **Node identity = source id.** Nodes are keyed by their source Metadata key, never by display name.
- **Slugs unique per kind** (a skill and a gem may share a slug; that is allowed).
- **No dangling edges** — an edge is emitted only when both endpoints exist as nodes.
- **Edge type is fixed by source field** (the mapping table), not per-instance choice.
- Tests live in `test/graph/*.test.js` and import from `../../scripts/graph/...`.
- Frequent commits — one per task.

## File Structure

- Create `scripts/graph/schema.js` — `KINDS`, `EDGE_TYPES` constants; `makeNode`/`makeEdge` factories that validate shape. One responsibility: the node/edge contract.
- Create `scripts/graph/validate.js` — `validateGraph({nodes, edges})`; structural integrity checks (dup ids, unknown kinds, per-kind slug uniqueness, dangling edges).
- Create `scripts/graph/gems.js` — gem record selection, gem nodes, skill nodes, and gem edges. The gems-kind resolver (re-derived from raw source).
- Create `scripts/graph/build.js` — `buildGraph()` orchestrator (assemble → validate → hash) and `toArtifact(graph)` serializer shape.
- Create `scripts/graph/cli.js` — npm entry: build, serialize, write `build/graph.json`.
- Modify `package.json` — add `build:graph` script.
- Modify `.gitignore` — ignore `build/`.
- Create `test/graph/schema.test.js`, `test/graph/validate.test.js`, `test/graph/gems.test.js`, `test/graph/build.test.js`.

---

### Task 1: Schema factories

**Files:**
- Create: `scripts/graph/schema.js`
- Test: `test/graph/schema.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `KINDS` — object; values include `gem`, `skill`, `base`, `unique`, `affix`, `tag`, `keyword`, `class`, `passive`.
  - `EDGE_TYPES` — object; values include `grants`, `recommends_support`, `rolls_on`, `has_base`, `tagged`, `references_keyword`, `in_class`.
  - `makeNode({id, kind, name, slug, props?, search?})` → `{id, kind, name, slug, props, search}`; throws on missing `id`/`name`/`slug` or invalid `kind`.
  - `makeEdge({type, from, to, props?})` → `{type, from, to}` (plus `props` when given); throws on invalid `type` or missing `from`/`to`.

- [ ] **Step 1: Write the failing test**

```js
// test/graph/schema.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, EDGE_TYPES, makeNode, makeEdge } from '../../scripts/graph/schema.js';

test('makeNode returns a normalized node with defaults', () => {
  const n = makeNode({ id: 'X', kind: KINDS.GEM, name: 'Fireball', slug: 'fireball' });
  assert.deepEqual(n, { id: 'X', kind: 'gem', name: 'Fireball', slug: 'fireball', props: {}, search: '' });
});

test('makeNode rejects an invalid kind', () => {
  assert.throws(() => makeNode({ id: 'X', kind: 'nope', name: 'n', slug: 's' }), /invalid kind/);
});

test('makeNode requires id, name, slug', () => {
  assert.throws(() => makeNode({ kind: KINDS.GEM, name: 'n', slug: 's' }), /id required/);
  assert.throws(() => makeNode({ id: 'X', kind: KINDS.GEM, slug: 's' }), /name required/);
  assert.throws(() => makeNode({ id: 'X', kind: KINDS.GEM, name: 'n' }), /slug required/);
});

test('makeEdge omits props when not given, keeps it when given', () => {
  assert.deepEqual(makeEdge({ type: EDGE_TYPES.GRANTS, from: 'A', to: 'B' }), { type: 'grants', from: 'A', to: 'B' });
  assert.deepEqual(
    makeEdge({ type: EDGE_TYPES.ROLLS_ON, from: 'A', to: 'B', props: { tiers: [1] } }),
    { type: 'rolls_on', from: 'A', to: 'B', props: { tiers: [1] } },
  );
});

test('makeEdge rejects an invalid type and missing endpoints', () => {
  assert.throws(() => makeEdge({ type: 'nope', from: 'A', to: 'B' }), /invalid type/);
  assert.throws(() => makeEdge({ type: EDGE_TYPES.GRANTS, from: 'A' }), /from and to required/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/graph/schema.test.js`
Expected: FAIL — cannot find module `../../scripts/graph/schema.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/graph/schema.js
export const KINDS = {
  GEM: 'gem', SKILL: 'skill', BASE: 'base', UNIQUE: 'unique', AFFIX: 'affix',
  TAG: 'tag', KEYWORD: 'keyword', CLASS: 'class', PASSIVE: 'passive',
};

export const EDGE_TYPES = {
  GRANTS: 'grants', RECOMMENDS_SUPPORT: 'recommends_support', ROLLS_ON: 'rolls_on',
  HAS_BASE: 'has_base', TAGGED: 'tagged', REFERENCES_KEYWORD: 'references_keyword',
  IN_CLASS: 'in_class',
};

const KIND_SET = new Set(Object.values(KINDS));
const EDGE_SET = new Set(Object.values(EDGE_TYPES));

export function makeNode({ id, kind, name, slug, props = {}, search = '' }) {
  if (!id) throw new Error('makeNode: id required');
  if (!KIND_SET.has(kind)) throw new Error(`makeNode: invalid kind '${kind}'`);
  if (!name) throw new Error(`makeNode: name required (${id})`);
  if (!slug) throw new Error(`makeNode: slug required (${id})`);
  return { id, kind, name, slug, props, search };
}

export function makeEdge({ type, from, to, props }) {
  if (!EDGE_SET.has(type)) throw new Error(`makeEdge: invalid type '${type}'`);
  if (!from || !to) throw new Error('makeEdge: from and to required');
  return props ? { type, from, to, props } : { type, from, to };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/graph/schema.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/schema.js test/graph/schema.test.js
git commit -m "feat: graph schema node/edge factories"
```

---

### Task 2: Graph validator

**Files:**
- Create: `scripts/graph/validate.js`
- Test: `test/graph/validate.test.js`

**Interfaces:**
- Consumes: `KINDS`, `EDGE_TYPES` from `scripts/graph/schema.js`.
- Produces: `validateGraph({nodes, edges})` → `string[]` (empty array = valid). Detects: duplicate node id, unknown kind, missing name/slug, **per-kind** duplicate slug, unknown edge type, dangling edge endpoint (`from`/`to` not a node id).

- [ ] **Step 1: Write the failing test**

```js
// test/graph/validate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGraph } from '../../scripts/graph/validate.js';

const node = (id, kind, slug) => ({ id, kind, name: id, slug, props: {}, search: '' });

test('clean graph returns no errors', () => {
  const nodes = [node('g1', 'gem', 'fireball'), node('s1', 'skill', 'fireball')];
  const edges = [{ type: 'grants', from: 'g1', to: 's1' }];
  assert.deepEqual(validateGraph({ nodes, edges }), []);
});

test('per-kind slug uniqueness: same slug across kinds is allowed', () => {
  // gem 'fireball' and skill 'fireball' share a slug — not an error.
  const nodes = [node('g1', 'gem', 'fireball'), node('s1', 'skill', 'fireball')];
  assert.deepEqual(validateGraph({ nodes, edges: [] }), []);
});

test('duplicate slug within a kind is an error', () => {
  const nodes = [node('g1', 'gem', 'dup'), node('g2', 'gem', 'dup')];
  const errors = validateGraph({ nodes, edges: [] });
  assert.ok(errors.some((e) => /duplicate slug 'dup'/.test(e)));
});

test('dangling edge endpoint is an error', () => {
  const nodes = [node('g1', 'gem', 'fireball')];
  const edges = [{ type: 'grants', from: 'g1', to: 'missing' }];
  const errors = validateGraph({ nodes, edges });
  assert.ok(errors.some((e) => /dangling edge grants: to 'missing'/.test(e)));
});

test('unknown kind and edge type are errors', () => {
  const nodes = [node('g1', 'bogus', 's')];
  const edges = [{ type: 'bogus', from: 'g1', to: 'g1' }];
  const errors = validateGraph({ nodes, edges });
  assert.ok(errors.some((e) => /unknown kind 'bogus'/.test(e)));
  assert.ok(errors.some((e) => /unknown edge type 'bogus'/.test(e)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/graph/validate.test.js`
Expected: FAIL — cannot find module `../../scripts/graph/validate.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/graph/validate.js
import { KINDS, EDGE_TYPES } from './schema.js';

const KIND_SET = new Set(Object.values(KINDS));
const EDGE_SET = new Set(Object.values(EDGE_TYPES));

export function validateGraph({ nodes, edges }) {
  const errors = [];
  const ids = new Set();
  const slugByKind = new Map(); // `${kind}|${slug}` -> first id seen

  for (const n of nodes) {
    if (ids.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    ids.add(n.id);
    if (!KIND_SET.has(n.kind)) errors.push(`unknown kind '${n.kind}' on node ${n.id}`);
    if (!n.name) errors.push(`missing name on node ${n.id}`);
    if (!n.slug) errors.push(`missing slug on node ${n.id}`);
    const key = `${n.kind}|${n.slug}`;
    if (slugByKind.has(key)) {
      errors.push(`duplicate slug '${n.slug}' for kind ${n.kind} (${n.id} & ${slugByKind.get(key)})`);
    } else {
      slugByKind.set(key, n.id);
    }
  }

  for (const e of edges) {
    if (!EDGE_SET.has(e.type)) errors.push(`unknown edge type '${e.type}'`);
    if (!ids.has(e.from)) errors.push(`dangling edge ${e.type}: from '${e.from}' not a node`);
    if (!ids.has(e.to)) errors.push(`dangling edge ${e.type}: to '${e.to}' not a node`);
  }

  return errors;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/graph/validate.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/validate.js test/graph/validate.test.js
git commit -m "feat: graph structural validator"
```

---

### Task 3: Gem record selection (identity + slug)

**Files:**
- Create: `scripts/graph/gems.js`
- Test: `test/graph/gems.test.js`

**Interfaces:**
- Consumes: `loadJson` (`src/data/loader.js`), `REPOE` (`src/config.js`), `slugify` (`src/data/slug.js`), `grantedSkillNames` (`src/data/grantedSkills.js`).
- Produces: `selectGemRecords()` → `Array<{ id, slug, origin, raw }>` where `id` is the source Metadata key, `slug` is the collision-suffixed routing slug, `origin` is `'gem'|'item'|'other'`, `raw` is the raw `skill_gems.json` record. Re-derives the same node set and slugs as the current app's `listGems()` — but from raw source.

This re-implements (does not import) the identity logic currently entangled in `src/data/gems.js` `index()` / `classifyOrigin`, per the source-only lineage rule.

- [ ] **Step 1: Write the failing test**

```js
// test/graph/gems.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectGemRecords } from '../../scripts/graph/gems.js';
import { listGems } from '../../src/data/gems.js';

test('selectGemRecords reproduces the current gem slug set', () => {
  const graphSlugs = new Set(selectGemRecords().map((r) => r.slug));
  const appSlugs = new Set(listGems().map((g) => g.slug));
  assert.equal(graphSlugs.size, appSlugs.size, 'same number of gems');
  for (const s of appSlugs) assert.ok(graphSlugs.has(s), `graph missing slug ${s}`);
});

test('selectGemRecords keys nodes by source id and excludes DNT/garbage', () => {
  const recs = selectGemRecords();
  assert.ok(recs.every((r) => r.id.startsWith('Metadata/')), 'ids are source Metadata keys');
  assert.ok(!recs.some((r) => r.raw.base_item.display_name.includes('[DNT')), 'no DNT entries');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/graph/gems.test.js`
Expected: FAIL — `selectGemRecords` is not exported / module missing.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/graph/gems.js
import { loadJson } from '../../src/data/loader.js';
import { REPOE } from '../../src/config.js';
import { slugify } from '../../src/data/slug.js';
import { grantedSkillNames } from '../../src/data/grantedSkills.js';

// Mirrors src/data/gems.js — placeholder/unreleased gem-table entries to drop.
const GARBAGE_RE = /Coming Soon|Removed Skill|Playtest|\{0\}/;
const SLUG_PRECEDENCE = ['active', 'support', 'spirit'];

// How a gem enters the game (see src/data/gems.js classifyOrigin for rationale).
function classifyOrigin(rec, baseTags) {
  if (rec.crafting_types != null) return 'gem';
  if (baseTags?.some((t) => t !== 'gem' && t.endsWith('_gem'))) return 'gem';
  if (rec.base_item.id?.includes('SkillGemPlayerDefault')) return 'item';
  if (grantedSkillNames().has(rec.base_item.display_name)) return 'item';
  return 'other';
}

export function selectGemRecords() {
  const gems = loadJson(`${REPOE}/skill_gems.json`);
  const baseItems = loadJson(`${REPOE}/base_items.json`);

  const byCombo = new Map();      // `${baseSlug}|${gem_type}` -> staged record
  const typesBySlug = new Map();  // baseSlug -> Set<gem_type>
  for (const [id, rec] of Object.entries(gems)) {
    const name = rec?.base_item?.display_name;
    if (!name) continue;
    if (name.includes('[DNT')) continue;
    if (GARBAGE_RE.test(name)) continue;
    const baseSlug = slugify(name);
    const combo = `${baseSlug}|${rec.gem_type}`;
    if (byCombo.has(combo)) continue;
    const origin = classifyOrigin(rec, baseItems[rec.base_item.id]?.tags);
    byCombo.set(combo, { id, origin, baseSlug, raw: rec });
    if (!typesBySlug.has(baseSlug)) typesBySlug.set(baseSlug, new Set());
    typesBySlug.get(baseSlug).add(rec.gem_type);
  }

  const out = [];
  for (const rec of byCombo.values()) {
    const types = typesBySlug.get(rec.baseSlug);
    let slug = rec.baseSlug;
    if (types.size > 1) {
      const primary = SLUG_PRECEDENCE.find((t) => types.has(t)) ?? rec.raw.gem_type;
      if (rec.raw.gem_type !== primary) slug = `${rec.baseSlug}-${rec.raw.gem_type}`;
    }
    out.push({ id: rec.id, slug, origin: rec.origin, raw: rec.raw });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/graph/gems.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/gems.js test/graph/gems.test.js
git commit -m "feat: re-derive gem node identity from source"
```

---

### Task 4: Gem nodes + skill nodes (complete data)

**Files:**
- Modify: `scripts/graph/gems.js`
- Test: `test/graph/gems.test.js`

**Interfaces:**
- Consumes: `selectGemRecords` (Task 3); `makeNode`, `KINDS` (`scripts/graph/schema.js`); `buildSections` (`src/data/statText.js`); `slugify` (`src/data/slug.js`).
- Produces:
  - `gemNodes()` → `{ nodes: Node[], records: SelectedGem[] }`. Each gem node carries `props`: `{ color, gemType, origin, tags, requirementWeights, craftingLevel, iconDds, grantsSkills, effectSections }` where `effectSections` is `[{ label, lines, quality }]` (plain strings — resolved data, not HTML). `search` is lowercased `name + gemType + effect lines`.
  - `skillNodes(records)` → `Node[]`. One node per distinct `grants_skills` key that exists in `skills.json`; id = the skill key; `props`: `{ types, description }`.

- [ ] **Step 1: Write the failing test (append to test/graph/gems.test.js)**

```js
import { gemNodes, skillNodes } from '../../scripts/graph/gems.js';
import { buildSections } from '../../src/data/statText.js';
import { loadJson } from '../../src/data/loader.js';
import { REPOE } from '../../src/config.js';

test('gemNodes carry resolved effect sections matching buildSections', () => {
  const { nodes, records } = gemNodes();
  assert.equal(nodes.length, records.length, 'one node per record');
  assert.ok(nodes.every((n) => n.kind === 'gem'));
  // Pick a gem that grants a skill, compare its effectSections to the source resolution.
  const skills = loadJson(`${REPOE}/skills.json`);
  const withSkill = records.find((r) => skills[r.raw.grants_skills?.[0]]);
  const node = nodes.find((n) => n.id === withSkill.id);
  const expected = buildSections(skills[withSkill.raw.grants_skills[0]], 20)
    .map((s) => ({ label: s.label, lines: s.lines, quality: s.quality }));
  assert.deepEqual(node.props.effectSections, expected);
  assert.ok(node.search.includes(node.name.toLowerCase()), 'search includes the name');
});

test('skillNodes are deduped and keyed by skill source key', () => {
  const { records } = gemNodes();
  const sNodes = skillNodes(records);
  const ids = sNodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate skill ids');
  assert.ok(sNodes.every((n) => n.kind === 'skill'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/graph/gems.test.js`
Expected: FAIL — `gemNodes`/`skillNodes` not exported.

- [ ] **Step 3: Write minimal implementation (add to scripts/graph/gems.js)**

```js
import { makeNode, KINDS } from './schema.js';
import { buildSections } from '../../src/data/statText.js';

const GEM_LEVEL_CAP = 20; // matches src/data/gems.js display cap

function effectSections(skill) {
  return buildSections(skill, GEM_LEVEL_CAP)
    .map((s) => ({ label: s.label, lines: s.lines, quality: s.quality }));
}

export function gemNodes() {
  const records = selectGemRecords();
  const skills = loadJson(`${REPOE}/skills.json`);
  const nodes = records.map((r) => {
    const skill = skills[r.raw.grants_skills?.[0]] ?? null;
    const sections = effectSections(skill);
    const props = {
      color: r.raw.color,
      gemType: r.raw.gem_type,
      origin: r.origin,
      tags: r.raw.tags ?? [],
      requirementWeights: r.raw.requirement_weights ?? null,
      craftingLevel: r.raw.crafting_level ?? null,
      iconDds: r.raw.icon_dds_file ?? null,
      grantsSkills: r.raw.grants_skills ?? [],
      effectSections: sections,
    };
    const search = [r.raw.base_item.display_name, r.raw.gem_type, ...sections.flatMap((s) => s.lines)]
      .join(' ').toLowerCase();
    return makeNode({
      id: r.id, kind: KINDS.GEM, name: r.raw.base_item.display_name, slug: r.slug, props, search,
    });
  });
  return { nodes, records };
}

export function skillNodes(records) {
  const skills = loadJson(`${REPOE}/skills.json`);
  const seen = new Set();
  const out = [];
  for (const r of records) {
    for (const key of r.raw.grants_skills ?? []) {
      if (seen.has(key)) continue;
      const skill = skills[key];
      if (!skill) continue;
      seen.add(key);
      const name = skill.active_skill?.display_name ?? key;
      out.push(makeNode({
        id: key, kind: KINDS.SKILL, name, slug: slugify(name),
        props: { types: skill.active_skill?.types ?? [], description: skill.active_skill?.description ?? null },
        search: name.toLowerCase(),
      }));
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/graph/gems.test.js`
Expected: PASS (4 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/gems.js test/graph/gems.test.js
git commit -m "feat: gem and skill nodes with resolved effect data"
```

---

### Task 5: Gem edges (grants + recommends_support), parity-tested

**Files:**
- Modify: `scripts/graph/gems.js`
- Test: `test/graph/gems.test.js`

**Interfaces:**
- Consumes: `makeEdge`, `EDGE_TYPES` (`scripts/graph/schema.js`); the `records` and node-id set from Tasks 3–4.
- Produces: `gemEdges(records, nodeIds)` → `Edge[]`. For each gem record: a `grants` edge to every `grants_skills` key present in `nodeIds`; a `recommends_support` edge to every `recommended_supports` key present in `nodeIds`. Edges are emitted only when the target id exists (no dangling), matching the current app's skip-on-unresolved behavior.

- [ ] **Step 1: Write the failing test (append to test/graph/gems.test.js)**

```js
import { gemEdges } from '../../scripts/graph/gems.js';
import { getGem, getRecommendedSupports } from '../../src/data/gems.js';

test('recommends_support edges match the current app resolution', () => {
  const { nodes, records } = gemNodes();
  const sNodes = skillNodes(records);
  const all = [...nodes, ...sNodes];
  const nodeIds = new Set(all.map((n) => n.id));
  const idToSlug = new Map(all.map((n) => [n.id, n.slug]));
  const edges = gemEdges(records, nodeIds);

  // Pick a gem known to have recommended supports.
  const rec = records.find((r) => (r.raw.recommended_supports ?? []).length);
  const graphTargets = edges
    .filter((e) => e.type === 'recommends_support' && e.from === rec.id)
    .map((e) => idToSlug.get(e.to))
    .sort();
  const appTargets = getRecommendedSupports(getGem(rec.slug)).map((s) => s.slug).sort();
  assert.deepEqual(graphTargets, appTargets);
});

test('every edge endpoint resolves to a node (no dangling)', () => {
  const { nodes, records } = gemNodes();
  const sNodes = skillNodes(records);
  const nodeIds = new Set([...nodes, ...sNodes].map((n) => n.id));
  const edges = gemEdges(records, nodeIds);
  assert.ok(edges.length > 0);
  assert.ok(edges.every((e) => nodeIds.has(e.from) && nodeIds.has(e.to)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/graph/gems.test.js`
Expected: FAIL — `gemEdges` not exported.

- [ ] **Step 3: Write minimal implementation (add to scripts/graph/gems.js)**

```js
import { makeEdge, EDGE_TYPES } from './schema.js';

export function gemEdges(records, nodeIds) {
  const edges = [];
  for (const r of records) {
    for (const skillKey of r.raw.grants_skills ?? []) {
      if (nodeIds.has(skillKey)) {
        edges.push(makeEdge({ type: EDGE_TYPES.GRANTS, from: r.id, to: skillKey }));
      }
    }
    for (const supKey of r.raw.recommended_supports ?? []) {
      if (nodeIds.has(supKey)) {
        edges.push(makeEdge({ type: EDGE_TYPES.RECOMMENDS_SUPPORT, from: r.id, to: supKey }));
      }
    }
  }
  return edges;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/graph/gems.test.js`
Expected: PASS (6 tests total in the file).

> Note: `makeEdge`/`EDGE_TYPES` and the earlier `makeNode`/`KINDS` imports may be merged into a single `import { makeNode, makeEdge, KINDS, EDGE_TYPES } from './schema.js';` line — consolidate the imports at the top of the file.

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/gems.js test/graph/gems.test.js
git commit -m "feat: gem grants/recommends_support edges with parity test"
```

---

### Task 6: Build orchestrator + CLI + artifact

**Files:**
- Create: `scripts/graph/build.js`
- Create: `scripts/graph/cli.js`
- Modify: `package.json` (add `build:graph` script)
- Modify: `.gitignore` (add `build/`)
- Test: `test/graph/build.test.js`

**Interfaces:**
- Consumes: `gemNodes`, `skillNodes`, `gemEdges` (`scripts/graph/gems.js`); `validateGraph` (`scripts/graph/validate.js`); `getDataDir`, `REPOE` (`src/config.js`).
- Produces:
  - `buildGraph()` → `{ meta: { sourceHash, schema }, nodes: Node[], edges: Edge[] }`. Assembles gem + skill nodes and gem edges, runs `validateGraph`, throws if it returns any errors, and computes `sourceHash` (sha256 over the source files read).
  - `toArtifact(graph)` → `{ meta, nodes: Record<id, NodeWithoutId>, edges }` — the serialized shape (nodes keyed by id).

- [ ] **Step 1: Write the failing test**

```js
// test/graph/build.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, toArtifact } from '../../scripts/graph/build.js';

test('buildGraph validates clean and stamps meta', () => {
  const g = buildGraph(); // throws if validation fails
  assert.equal(g.meta.schema, 1);
  assert.match(g.meta.sourceHash, /^[0-9a-f]{64}$/);
  assert.ok(g.nodes.some((n) => n.kind === 'gem'));
  assert.ok(g.nodes.some((n) => n.kind === 'skill'));
  assert.ok(g.edges.some((e) => e.type === 'grants'));
  assert.ok(g.edges.some((e) => e.type === 'recommends_support'));
});

test('toArtifact keys nodes by id and drops the inline id', () => {
  const g = buildGraph();
  const art = toArtifact(g);
  const [id, node] = Object.entries(art.nodes)[0];
  assert.ok(id.startsWith('Metadata/'));
  assert.equal(node.id, undefined, 'id is the map key, not a field');
  assert.equal(Object.keys(art.nodes).length, g.nodes.length);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/graph/build.test.js`
Expected: FAIL — module `../../scripts/graph/build.js` missing.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/graph/build.js
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir, REPOE } from '../../src/config.js';
import { gemNodes, skillNodes, gemEdges } from './gems.js';
import { validateGraph } from './validate.js';

// Source files this build reads — the sourceHash covers exactly these.
const SOURCE_FILES = [
  `${REPOE}/skill_gems.json`,
  `${REPOE}/skills.json`,
  `${REPOE}/base_items.json`,
];

function hashSources() {
  const h = crypto.createHash('sha256');
  for (const rel of SOURCE_FILES) h.update(fs.readFileSync(path.join(getDataDir(), rel)));
  return h.digest('hex');
}

export function buildGraph() {
  const { nodes: gNodes, records } = gemNodes();
  const sNodes = skillNodes(records);
  const nodes = [...gNodes, ...sNodes];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = gemEdges(records, nodeIds);

  const errors = validateGraph({ nodes, edges });
  if (errors.length) throw new Error(`graph validation failed:\n${errors.join('\n')}`);

  return { meta: { sourceHash: hashSources(), schema: 1 }, nodes, edges };
}

export function toArtifact(graph) {
  const nodes = {};
  for (const { id, ...rest } of graph.nodes) nodes[id] = rest;
  return { meta: graph.meta, nodes, edges: graph.edges };
}
```

```js
// scripts/graph/cli.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, toArtifact } from './build.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'build');
fs.mkdirSync(outDir, { recursive: true });

const artifact = toArtifact(buildGraph());
const outPath = path.join(outDir, 'graph.json');
fs.writeFileSync(outPath, JSON.stringify(artifact));
console.log(`graph.json: ${Object.keys(artifact.nodes).length} nodes, ${artifact.edges.length} edges -> ${outPath}`);
```

- [ ] **Step 4: Add the npm script and gitignore entry**

In `package.json`, add to `"scripts"`:

```json
    "build:graph": "node scripts/graph/cli.js",
```

Append to `.gitignore`:

```
build/
```

- [ ] **Step 5: Run the test, the full suite, and the CLI to verify**

Run: `node --test test/graph/build.test.js`
Expected: PASS (2 tests).

Run: `node --test`
Expected: PASS — the whole suite, including the existing `src/data` tests, still green.

Run: `npm run build:graph`
Expected: prints e.g. `graph.json: <N> nodes, <M> edges -> .../build/graph.json`, and `build/graph.json` exists.

- [ ] **Step 6: Commit**

```bash
git add scripts/graph/build.js scripts/graph/cli.js package.json .gitignore test/graph/build.test.js
git commit -m "feat: graph build orchestrator, CLI, and JSON artifact"
```

---

## Self-Review

- **Spec coverage (for this slice):** build-time script reading source only (Tasks 3–6, Global Constraints) ✓; complete-data resolution incl. effect sections (Task 4) ✓; typed edges from a fixed mapping (Task 5) ✓; one-node-per-source-record keyed by id (Tasks 3–4) ✓; per-kind slug uniqueness + no dangling edges validation (Task 2, enforced Task 6) ✓; sourceHash staleness anchor (Task 6) ✓; parity-as-test, never as build input (Tasks 3, 5) ✓; JSON artifact, zero deps (Task 6) ✓. Deferred to follow-on plans: app cutover, remaining kinds, boot-time staleness warning, the full mapping table beyond gems.
- **Placeholder scan:** none — every code/test step is complete.
- **Type consistency:** `selectGemRecords → {id, slug, origin, raw}` consumed unchanged by `gemNodes`/`skillNodes`/`gemEdges`; `makeNode`/`makeEdge` signatures stable across schema, gems, build; `buildGraph` returns array-form nodes, `toArtifact` keys them by id (matches build.test expectations).

## Follow-On Plans (not in scope here)

1. **App cutover for gems** — a graph-backed read layer (load `graph.json`, generic traversal helpers), reskin `buildGemViewModel`/gem search to render from the artifact, delete the gem-specific source reads from the request path, add the boot-time `sourceHash` mismatch warning, decide commit-vs-gitignore for the artifact.
2. **Bases → affixes → uniques → passives → keywords** — one plan per kind, each adding its resolver, its edge types to the mapping table, its parity tests, and folding into `buildGraph`.
3. **Search/theorycraft on the graph** — rebuild the doc set from node `search` fields + edges; retire `theorycraft.js`'s ad-hoc joins.
