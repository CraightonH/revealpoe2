# Full Passive Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the PoE2 character passive tree faithfully and interactively (pan/zoom, hover tooltips, click-to-allocate with connectivity + point counting, ascendancy + weapon-set support, round-trip official share codes), as a client-side app over a prebuilt static artifact — and consolidate passive parsing to a single source of truth.

**Architecture:** A new build-time module (`scripts/graph/passiveSource.js`) parses `Default.json` + `ascendancies.json` exactly once into a canonical intermediate `{ nodes, edges, meta }`, owning stat-id→English translation. Two sinks consume it: the existing `scripts/graph/passives.js` (refactored — its graph output stays byte-for-byte identical) and a new artifact emitter that writes `public/generated/passive-tree.json` (precomputed geometry: absolute x/y per node, edges classified arc-vs-line). At runtime a `/passives` page ships a `<canvas>` shell; `public/js/passive-tree.js` fetches the artifact and renders it, with allocation logic in a pure, unit-tested `public/js/passive-alloc.js` and share-code logic in a pure `public/js/passive-code.js`. No server compute, no new runtime dependencies.

**Tech Stack:** Node.js (build scripts, ES modules), `node:test` + `node:assert/strict`, Express + Nunjucks (page shell), vanilla browser JS modules (Canvas 2D), no third-party libs.

## Global Constraints

- **No new runtime third-party dependencies.** Canvas 2D + vanilla JS only; build scripts use Node built-ins + the existing `nunjucks`.
- **`src/` never reads `data/source/` at runtime.** All source parsing happens at build time in `scripts/graph/*` / `scripts/build-index.js`. Runtime reads only `build/graph.json` and `public/generated/*.json`.
- **Provenance discipline.** Passive data is `repoe` (straight from source) or `derived` (computed geometry); never hand-author tree facts.
- **Consolidation must not change graph output.** After refactoring `passives.js`, `build/graph.json` passive/ascendancy nodes + edges must be identical to before — existing `test/passiveTree.test.js` (and graph tests) stay green.
- **ES modules** (`import`/`export`), matching the existing `scripts/graph/*.js` and `src/data/*.js` style.
- **Geometry precomputed at build time**; the client does no orbit math.
- **`orbit_radii` is NOT monotonic** (`[0,82,162,335,493,662,846,251,1080,1332]`, index 7 = 251). Always index by the node's `radius` field; never assume sorted orbits.
- **Edge dedup:** connections are bidirectional; store each undirected edge once as `(min(a,b), max(a,b))`.
- **Arc rule:** an edge is an arc iff both endpoints share the same group AND the same orbit (`radius`); otherwise a straight line. Verified counts on current data: 1603 arcs / 4464 straight / 6067 total (a source self-loop hash 35653→35653 is filtered to preserve a<b).
- **Canonical source paths** (via `scripts/graph/source.js` `REPOE`): `${REPOE}/passive_skill_trees/Default.json`, `${REPOE}/ascendancies.json`, `${REPOE}/stat_translations/stat_descriptions.json`, `${REPOE}/stat_translations/passive_skill_stat_descriptions.json`.
- **Share codes** are URL-safe base64 (`-`→`+`, `_`→`/`), format version 7.

---

## File Structure

- **Create** `scripts/graph/passiveSource.js` — canonical parse: stat translation + geometry precompute. Pure functions returning plain data. (Tasks 1–4)
- **Modify** `scripts/graph/passives.js` — consume the canonical parse instead of re-reading `Default.json`; drop the duplicate `statMap`/`resolveStatLines`. (Task 5)
- **Create** `scripts/build-passive-tree.js` — emit `public/generated/passive-tree.json` from the canonical parse. Wired into `build:index` family. (Task 6)
- **Modify** `package.json` — add the emitter to the `build:index` / `predev` / `prestart` / `build:static` chain. (Task 6)
- **Create** `public/js/passive-alloc.js` — pure allocation engine (connectivity, points, ascendancy pool, weapon-set). (Tasks 7–9)
- **Create** `public/js/passive-code.js` — pure share-code decode/encode (round-trip). (Tasks 10–11)
- **Create** `public/js/passive-tree.js` — Canvas renderer: load artifact, pan/zoom, hit-test, draw, tooltip, wire allocation + hash import. (Tasks 12–14)
- **Create** `views/passives.njk` — page shell (canvas, tooltip container, controls). (Task 13)
- **Modify** `src/routes/pages.js` — add `GET /passives`. (Task 13)
- **Modify** a nav template (whichever holds the top nav) — add a `/passives` link so the page is crawl-reachable. (Task 13)
- **Create** `test/passiveSource.test.js`, `test/passiveTreeArtifact.test.js`, `test/passiveAlloc.test.js`, `test/passiveCode.test.js` — node:test suites. (Throughout)
- **Use** `test/fixtures/passive-tree-codes.json` — already committed; golden vectors for Task 10–11.

---

## Task 1: Canonical parse — stat translation

**Files:**
- Create: `scripts/graph/passiveSource.js`
- Test: `test/passiveSource.test.js`

**Interfaces:**
- Consumes: `loadJson` from `./loader.js`, `REPOE` from `./source.js`.
- Produces: `resolveStatLines(stats: object) → string[]` — value-substituted English lines for a `{ statId: value }` object, in source order, raw text (no HTML, no keyword linkification).

- [ ] **Step 1: Write the failing test**

```js
// test/passiveSource.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStatLines } from '../scripts/graph/passiveSource.js';

test('resolveStatLines substitutes a value into the English template', () => {
  // shock_chance_+% is a real passive stat id on hash 4 (Shock Chance, +15%)
  const lines = resolveStatLines({ 'shock_chance_+%': 15 });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /15/);
  assert.match(lines[0].toLowerCase(), /shock/);
});

test('resolveStatLines drops unknown stat ids', () => {
  assert.deepEqual(resolveStatLines({ not_a_real_stat_id_xyz: 3 }), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/passiveSource.test.js`
Expected: FAIL — `Cannot find module '../scripts/graph/passiveSource.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/graph/passiveSource.js
import { loadJson } from './loader.js';
import { REPOE } from './source.js';

let _statMap = null;
function statMap() {
  if (_statMap) return _statMap;
  const general = loadJson(`${REPOE}/stat_translations/stat_descriptions.json`);
  const passive = loadJson(`${REPOE}/stat_translations/passive_skill_stat_descriptions.json`);
  _statMap = new Map();
  for (const entry of general) {
    const eng = entry.English?.[0];
    if (!eng) continue;
    for (const id of entry.ids ?? []) _statMap.set(id, eng);
  }
  for (const entry of passive) {
    const eng = entry.English?.[0];
    if (!eng) continue;
    for (const id of entry.ids ?? []) _statMap.set(id, eng);
  }
  return _statMap;
}

function rawString(entry, val) {
  return entry.format?.[0] === 'ignore' ? entry.string : entry.string.replace('{0}', val);
}

export function resolveStatLines(stats) {
  const map = statMap();
  const lines = [];
  for (const [id, val] of Object.entries(stats ?? {})) {
    const entry = map.get(id);
    if (!entry) continue;
    for (const line of rawString(entry, val).split('\n')) {
      if (line.trim()) lines.push(line);
    }
  }
  return lines;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/passiveSource.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/passiveSource.js test/passiveSource.test.js
git commit -m "feat(passives): canonical stat translation in passiveSource"
```

---

## Task 2: Canonical parse — node geometry (absolute x/y)

**Files:**
- Modify: `scripts/graph/passiveSource.js`
- Test: `test/passiveSource.test.js`

**Interfaces:**
- Produces: `nodePosition(group, radiusIdx, posClockwise, orbitRadii, skillsPerOrbit) → {x, y}` — absolute world coordinates for a node. `group` is `{x, y}`; `radiusIdx` indexes `orbitRadii`; `posClockwise` is the slot index; orbit slot count comes from `skillsPerOrbit[radiusIdx]`.

- [ ] **Step 1: Write the failing test**

```js
// add to test/passiveSource.test.js
import { nodePosition } from '../scripts/graph/passiveSource.js';

test('nodePosition: radius 0 sits exactly at the group center', () => {
  const orbitRadii = [0, 82, 162, 335, 493, 662, 846, 251, 1080, 1332];
  const skillsPerOrbit = [1, 12, 24, 24, 72, 72, 72, 24, 72, 144];
  const p = nodePosition({ x: 100, y: 200 }, 0, 0, orbitRadii, skillsPerOrbit);
  assert.equal(Math.round(p.x), 100);
  assert.equal(Math.round(p.y), 200);
});

test('nodePosition: slot 0 of an orbit is straight up (12 o\'clock)', () => {
  const orbitRadii = [0, 82, 162, 335, 493, 662, 846, 251, 1080, 1332];
  const skillsPerOrbit = [1, 12, 24, 24, 72, 72, 72, 24, 72, 144];
  // orbit 1 (radius 82), slot 0 -> angle 0 measured from 12 o'clock => (cx, cy - 82)
  const p = nodePosition({ x: 0, y: 0 }, 1, 0, orbitRadii, skillsPerOrbit);
  assert.equal(Math.round(p.x), 0);
  assert.equal(Math.round(p.y), -82);
});

test('nodePosition: orbit 1 slot 3 is at 3 o\'clock (+x)', () => {
  const orbitRadii = [0, 82, 162, 335, 493, 662, 846, 251, 1080, 1332];
  const skillsPerOrbit = [1, 12, 24, 24, 72, 72, 72, 24, 72, 144];
  // 12 slots; slot 3 = 90deg clockwise from up = +x axis
  const p = nodePosition({ x: 0, y: 0 }, 1, 3, orbitRadii, skillsPerOrbit);
  assert.equal(Math.round(p.x), 82);
  assert.equal(Math.round(p.y), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/passiveSource.test.js`
Expected: FAIL — `nodePosition is not a function` (import undefined).

- [ ] **Step 3: Write minimal implementation**

```js
// add to scripts/graph/passiveSource.js
// Angle convention: slot 0 points straight up (12 o'clock, -y), increasing
// clockwise. Screen y grows downward, so clockwise = +angle in screen space.
export function nodePosition(group, radiusIdx, posClockwise, orbitRadii, skillsPerOrbit) {
  const r = orbitRadii[radiusIdx];
  const slots = skillsPerOrbit[radiusIdx] || 1;
  const angle = (2 * Math.PI * posClockwise) / slots; // 0 = up, clockwise
  return {
    x: group.x + r * Math.sin(angle),
    y: group.y - r * Math.cos(angle),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/passiveSource.test.js`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/passiveSource.js test/passiveSource.test.js
git commit -m "feat(passives): orbit->absolute position geometry"
```

---

## Task 3: Canonical parse — assemble nodes + edges + meta

**Files:**
- Modify: `scripts/graph/passiveSource.js`
- Test: `test/passiveSource.test.js`

**Interfaces:**
- Consumes: `resolveStatLines`, `nodePosition` (Tasks 1–2).
- Produces: `parseTree() → { nodes, edges, meta }` where
  - `nodes`: array of `{ h:int, x:number, y:number, k:string, name:string, stats:string[], iconDds:string|null, asc:string|null, ws:int }`. `k` ∈ `small|notable|keystone|jewel|ascStart|ascNotable|ascSmall`. Nodes with no `name` (unreleased placeholders) are dropped.
  - `edges`: array of `{ a:int, b:int }` (undirected, deduped, `a<b`). Arc classification is added in Task 4, not here.
  - `meta`: `{ orbitRadii:int[], skillsPerOrbit:int[], roots:int[], classStarts:object, ascStarts:object, liveAscendancies:string[] }`.
  - The result is memoized (parse once).
- Note: `liveAscendancies` filters out disabled / `[DNT` ascendancies from `ascendancies.json` (`v.disabled` truthy or `v.name` containing `[DNT`).

- [ ] **Step 1: Write the failing test**

```js
// add to test/passiveSource.test.js
import { parseTree } from '../scripts/graph/passiveSource.js';

test('parseTree: returns the expected node/edge magnitudes', () => {
  const { nodes, edges, meta } = parseTree();
  // 5150 total passives; placeholders without a name are dropped, so <=5150.
  assert.ok(nodes.length > 4000 && nodes.length <= 5150, `nodes=${nodes.length}`);
  assert.equal(edges.length, 6068);
  // every edge endpoint resolves to a node
  const ids = new Set(nodes.map((n) => n.h));
  for (const e of edges) {
    assert.ok(e.a < e.b, 'edge is ordered a<b');
  }
  assert.equal(meta.roots.length, 6);
});

test('parseTree: a known keystone resolves with kind + stats', () => {
  const { nodes } = parseTree();
  const keystones = nodes.filter((n) => n.k === 'keystone');
  assert.ok(keystones.length >= 30, `keystones=${keystones.length}`);
  for (const k of keystones) {
    assert.equal(typeof k.name, 'string');
    assert.ok(k.name.length > 0);
  }
});

test('parseTree: live ascendancies exclude PoE1 placeholders', () => {
  const { meta } = parseTree();
  assert.ok(!meta.liveAscendancies.includes('Marauder1'));
  assert.ok(meta.liveAscendancies.length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/passiveSource.test.js`
Expected: FAIL — `parseTree is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// add to scripts/graph/passiveSource.js
function kindOf(p) {
  if (p.is_jewel_socket) return 'jewel';
  if (p.is_ascendancy_starting_node) return 'ascStart';
  if (p.ascendancy) return p.is_notable ? 'ascNotable' : 'ascSmall';
  if (p.is_keystone) return 'keystone';
  if (p.is_notable) return 'notable';
  return 'small';
}

let _tree = null;
export function parseTree() {
  if (_tree) return _tree;
  const raw = loadJson(`${REPOE}/passive_skill_trees/Default.json`);
  const asc = loadJson(`${REPOE}/ascendancies.json`);
  const orbitRadii = raw.orbit_radii;
  const skillsPerOrbit = raw.skills_per_orbit;

  // geometry lookup: hash -> { groupIdx, radius, posClockwise, x, y }
  const geo = new Map();
  raw.groups.forEach((g, gi) => {
    for (const gp of g.passives ?? []) {
      const pos = nodePosition(g, gp.radius, gp.position_clockwise, orbitRadii, skillsPerOrbit);
      geo.set(gp.hash, { gi, radius: gp.radius, x: pos.x, y: pos.y, connections: gp.connections ?? [] });
    }
  });

  const nodes = [];
  for (const [hStr, p] of Object.entries(raw.passives)) {
    const h = Number(hStr);
    if (!p.name) continue; // unreleased placeholder, no label
    const g = geo.get(h);
    if (!g) continue;
    nodes.push({
      h,
      x: g.x,
      y: g.y,
      k: kindOf(p),
      name: p.name,
      stats: resolveStatLines(p.stats),
      iconDds: p.icon ?? null,
      asc: p.ascendancy ?? null,
      ws: p.weapon_set_points ?? 0,
    });
  }

  // edges from connections, undirected + deduped
  const seen = new Set();
  const edges = [];
  for (const [h, g] of geo) {
    for (const c of g.connections) {
      const a = Math.min(h, c);
      const b = Math.max(h, c);
      const key = `${a}-${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b });
    }
  }

  const liveAscendancies = Object.entries(asc)
    .filter(([, v]) => !v.disabled && !(v.name && v.name.includes('[DNT')))
    .map(([id]) => id);

  // class start nodes are roots; ascendancy starts are the ascStart nodes.
  const ascStarts = {};
  for (const n of nodes) {
    if (n.k === 'ascStart' && n.asc) ascStarts[n.asc] = n.h;
  }

  _tree = {
    nodes,
    edges,
    meta: {
      orbitRadii,
      skillsPerOrbit,
      roots: raw.roots,
      classStarts: {}, // populated in Task 4 once class->root mapping is confirmed
      ascStarts,
      liveAscendancies,
    },
  };
  return _tree;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/passiveSource.test.js`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/passiveSource.js test/passiveSource.test.js
git commit -m "feat(passives): assemble canonical nodes/edges/meta"
```

---

## Task 4: Edge arc classification + adjacency

**Files:**
- Modify: `scripts/graph/passiveSource.js`
- Test: `test/passiveSource.test.js`

**Interfaces:**
- Produces: `parseTree()` edges now carry an optional `arc` field: `{ a, b, arc?:{ cx, cy, r, a0, a1, ccw } }`. An edge is an arc iff both endpoints are in the same group and same `radius`; otherwise no `arc` (straight line). `a0`/`a1` are start/end angles (radians) on the orbit; `ccw` chooses the minor arc.
- Produces: `buildAdjacency(nodes, edges) → Map<int, int[]>` — undirected adjacency list, used by the allocation engine and exported for the artifact.

- [ ] **Step 1: Write the failing test**

```js
// add to test/passiveSource.test.js
import { buildAdjacency } from '../scripts/graph/passiveSource.js';

test('parseTree: arc vs straight edge counts match the data', () => {
  const { edges } = parseTree();
  const arcs = edges.filter((e) => e.arc);
  assert.equal(arcs.length, 1610);
  assert.equal(edges.length - arcs.length, 4458);
});

test('arc edges carry a center, radius and angle span', () => {
  const { edges } = parseTree();
  const arc = edges.find((e) => e.arc).arc;
  assert.equal(typeof arc.cx, 'number');
  assert.equal(typeof arc.r, 'number');
  assert.equal(typeof arc.a0, 'number');
  assert.equal(typeof arc.a1, 'number');
  assert.equal(typeof arc.ccw, 'boolean');
});

test('buildAdjacency is symmetric', () => {
  const { nodes, edges } = parseTree();
  const adj = buildAdjacency(nodes, edges);
  for (const e of edges.slice(0, 200)) {
    assert.ok(adj.get(e.a).includes(e.b));
    assert.ok(adj.get(e.b).includes(e.a));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/passiveSource.test.js`
Expected: FAIL — arc count assertion fails (edges have no `arc`) and `buildAdjacency` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `parseTree()`, extend the `geo` map to also store `posClockwise` and the group center, then classify edges. Replace the edge-building block:

```js
// in the geo population loop, also keep posClockwise + group center:
geo.set(gp.hash, {
  gi, radius: gp.radius, posClockwise: gp.position_clockwise,
  gx: g.x, gy: g.y, x: pos.x, y: pos.y, connections: gp.connections ?? [],
});

// ... replace edge build:
const seen = new Set();
const edges = [];
for (const [h, g] of geo) {
  for (const c of g.connections) {
    const a = Math.min(h, c), b = Math.max(h, c);
    const key = `${a}-${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ga = geo.get(a), gb = geo.get(b);
    let arc;
    if (ga && gb && ga.gi === gb.gi && ga.radius === gb.radius && ga.radius > 0) {
      const slots = skillsPerOrbit[ga.radius] || 1;
      const a0 = (2 * Math.PI * ga.posClockwise) / slots;
      const a1 = (2 * Math.PI * gb.posClockwise) / slots;
      // minor arc: go counter-clockwise iff the cw delta is the long way around
      let d = (a1 - a0 + 2 * Math.PI) % (2 * Math.PI);
      const ccw = d > Math.PI;
      arc = { cx: ga.gx, cy: ga.gy, r: orbitRadii[ga.radius], a0, a1, ccw };
    }
    edges.push(arc ? { a, b, arc } : { a, b });
  }
}

// export adjacency helper
export function buildAdjacency(nodes, edges) {
  const adj = new Map();
  for (const n of nodes) adj.set(n.h, []);
  for (const e of edges) {
    if (adj.has(e.a) && adj.has(e.b)) {
      adj.get(e.a).push(e.b);
      adj.get(e.b).push(e.a);
    }
  }
  return adj;
}
```

> Note on angle convention for canvas: `a0`/`a1` are measured from 12 o'clock clockwise (matching `nodePosition`). The renderer (Task 12) converts to canvas `arc()` angles (which start at +x, 3 o'clock) by subtracting `Math.PI/2`. Keep the convention consistent: positions and arc angles both use "up = 0, clockwise positive".

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/passiveSource.test.js`
Expected: PASS (11 tests total). If the arc count is off, the arc predicate is wrong (check `ga.radius === gb.radius && same group`).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/passiveSource.js test/passiveSource.test.js
git commit -m "feat(passives): classify arc vs straight edges + adjacency"
```

---

## Task 5: Consolidate `passives.js` onto the canonical parse

**Files:**
- Modify: `scripts/graph/passives.js`
- Test: `test/passiveTree.test.js` (existing — must stay green), `test/graph.test.js` (existing)

**Interfaces:**
- Consumes: `parseTree`, `resolveStatLines` from `passiveSource.js`.
- Produces: unchanged public API of `passives.js` — `passiveNodes()`, `ascendancyNodes()`, `passiveEdges(...)` with identical output to before.

- [ ] **Step 1: Capture the current graph output as a baseline**

Run (before any change):
```bash
npm run build:graph
node -e "const g=require('./build/graph.json'); const f=g.nodes.filter(n=>n.kind==='passive'||n.kind==='ascendancy'); const e=g.edges.filter(x=>x.type==='grants'||x.type==='in_ascendancy'); require('fs').writeFileSync('/tmp/passive-baseline.json', JSON.stringify({n:f.length, e:e.length, sample:f.slice(0,5)}));"
```
Record the printed counts. This is the regression target.

- [ ] **Step 2: Write the failing test (regression guard)**

```js
// add to test/passiveTree.test.js
import { passiveNodes } from '../scripts/graph/passives.js';

test('passiveNodes emits keystones + notables with resolved stat lines', () => {
  const { nodes } = passiveNodes();
  assert.ok(nodes.length > 1000, `passive nodes=${nodes.length}`);
  const withStats = nodes.filter((n) => n.props.statLines.length > 0);
  assert.ok(withStats.length > 0);
  // kind is one of keystone/notable
  for (const n of nodes) assert.ok(['keystone', 'notable'].includes(n.props.kind));
});
```

- [ ] **Step 3: Run test to verify current behavior, then refactor**

Run: `node --test test/passiveTree.test.js` — Expected: PASS (proves the test matches current behavior).

Now refactor `scripts/graph/passives.js`: remove the local `statMap`/`rawString`/`resolveStatLines`, import them from `passiveSource.js`, and source node data from `parseTree()`. `passiveNodes()` filters `parseTree().nodes` to `k ∈ {keystone, notable, ascNotable}` mapping to the existing `props` shape; ascendancy + granted-skill records come from the raw passive data as before. Keep `makeNode`/`makeEdge`/`KINDS`/`EDGE_TYPES` usage identical.

```js
// scripts/graph/passives.js (refactored head)
import { loadJson } from './loader.js';
import { REPOE } from './source.js';
import { makeNode, makeEdge, KINDS, EDGE_TYPES } from './schema.js';
import { parseTree, resolveStatLines } from './passiveSource.js';
// ...passiveNodes() reads parseTree() for identity/stats; granted_skill + ascendancy
// still come from the raw Default.json passives map (loadJson) to preserve records.
```

> The implementer must keep emitted node ids (`Passive/${id}`), slugs, props keys (`kind`, `statLines`, `flavourText`, `reminderText`, `iconDds`, `ascendancy`), and edges byte-identical. Use the baseline from Step 1 to verify.

- [ ] **Step 4: Verify graph output is unchanged**

Run:
```bash
npm run build:graph
node -e "const g=require('./build/graph.json'); const f=g.nodes.filter(n=>n.kind==='passive'||n.kind==='ascendancy'); const e=g.edges.filter(x=>x.type==='grants'||x.type==='in_ascendancy'); console.log('nodes',f.length,'edges',e.length);"
node --test test/passiveTree.test.js test/graph.test.js
```
Expected: counts match Step 1 baseline; all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/passives.js test/passiveTree.test.js
git commit -m "refactor(passives): consume canonical passiveSource (single parse)"
```

---

## Task 6: Emit the render artifact + wire into build

**Files:**
- Create: `scripts/build-passive-tree.js`
- Modify: `package.json`
- Test: `test/passiveTreeArtifact.test.js`

**Interfaces:**
- Consumes: `parseTree`, `buildAdjacency` from `scripts/graph/passiveSource.js`; `ddsUrl` from `src/data/images.js`.
- Produces: `public/generated/passive-tree.json` = `{ nodes:[{h,x,y,k,name,stats,icon,asc,ws}], edges:[{a,b,arc?}], meta:{classStarts,ascStarts,liveAscendancies,pointBudget} }`. `icon` is the webp URL from `ddsUrl(iconDds)` (or null).

- [ ] **Step 1: Write the failing test**

```js
// test/passiveTreeArtifact.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArtifact } from '../scripts/build-passive-tree.js';

test('buildArtifact produces nodes/edges/meta with webp icon urls', () => {
  const art = buildArtifact();
  assert.ok(art.nodes.length > 4000);
  assert.equal(art.edges.length, 6068);
  const withIcon = art.nodes.find((n) => n.icon);
  assert.match(withIcon.icon, /^\/static\/img\/.*\.webp$/);
  assert.ok(Array.isArray(art.meta.liveAscendancies));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/passiveTreeArtifact.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/build-passive-tree.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTree } from './graph/passiveSource.js';
import { ddsUrl } from '../src/data/images.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'generated', 'passive-tree.json');

export function buildArtifact() {
  const { nodes, edges, meta } = parseTree();
  return {
    nodes: nodes.map((n) => ({
      h: n.h, x: Math.round(n.x), y: Math.round(n.y), k: n.k,
      name: n.name, stats: n.stats,
      icon: n.iconDds ? ddsUrl(n.iconDds) : null,
      asc: n.asc, ws: n.ws,
    })),
    edges,
    meta: {
      classStarts: meta.classStarts,
      ascStarts: meta.ascStarts,
      liveAscendancies: meta.liveAscendancies,
      pointBudget: 122, // character passive points cap; refine if source provides it
    },
  };
}

function main() {
  const art = buildArtifact();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(art));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`build-passive-tree: ${art.nodes.length} nodes, ${art.edges.length} edges -> ${OUT} (${kb} KB)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 4: Run test + emit + check size**

Run:
```bash
node --test test/passiveTreeArtifact.test.js
node scripts/build-passive-tree.js
```
Expected: test PASS; emitter prints node/edge counts and a KB size. **If size > 4096 KB, flag it** (per spec risk #2) and note in the commit; otherwise proceed.

- [ ] **Step 5: Wire into the build chain**

Edit `package.json` scripts so the artifact builds alongside the search index. Add a `build:passives` script and append it to `build:index`'s consumers. Match the existing pattern:

```json
"build:index": "node scripts/build-index.js",
"build:passives": "node scripts/build-passive-tree.js",
"predev": "npm run build:graph && npm run build:index && npm run build:passives",
"prestart": "npm run build:graph && npm run build:index && npm run build:passives",
"pretest": "npm run build:graph && npm run build:passives",
"build:static": "npm run build:graph && npm run build:images && npm run build:index && npm run build:passives && npm run build:og && node scripts/prerender.js"
```

> `public/generated/passive-tree.json` is gitignored like the other generated artifacts (confirm `public/generated/` is in `.gitignore`; if only specific files are listed, add this one).

- [ ] **Step 6: Commit**

```bash
git add scripts/build-passive-tree.js test/passiveTreeArtifact.test.js package.json
git commit -m "feat(passives): emit passive-tree.json render artifact"
```

---

## Task 7: Allocation engine — connectivity

**Files:**
- Create: `public/js/passive-alloc.js`
- Test: `test/passiveAlloc.test.js`

**Interfaces:**
- Produces (pure ES module, importable by both browser and node):
  - `canAllocate(adj, allocated, starts, hash) → boolean` — true iff `hash` is adjacent to an already-allocated node or to a start node. `adj` is `Map<int,int[]>`; `allocated` is `Set<int>`; `starts` is `int[]` (class root + chosen ascendancy start).
  - `allocate(adj, allocated, starts, hash) → Set<int>` — returns a new Set with `hash` added (no-op if not allocatable).
  - `deallocate(adj, allocated, starts, hash) → Set<int>` — returns a new Set with `hash` removed AND any node thereby orphaned from `starts` removed (cascade).

- [ ] **Step 1: Write the failing test**

```js
// test/passiveAlloc.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAllocate, allocate, deallocate } from '../public/js/passive-alloc.js';

// graph: 0-1-2-3 chain, start=0
const adj = new Map([[0,[1]],[1,[0,2]],[2,[1,3]],[3,[2]]]);
const starts = [0];

test('canAllocate: only nodes adjacent to start/allocated are allowed', () => {
  assert.equal(canAllocate(adj, new Set(), starts, 1), true);  // adjacent to start 0
  assert.equal(canAllocate(adj, new Set(), starts, 2), false); // not yet reachable
  assert.equal(canAllocate(adj, new Set([1]), starts, 2), true);
});

test('allocate adds an allocatable node and ignores a non-allocatable one', () => {
  const a1 = allocate(adj, new Set(), starts, 1);
  assert.deepEqual([...a1], [1]);
  const a2 = allocate(adj, new Set(), starts, 3); // not reachable -> no-op
  assert.deepEqual([...a2], []);
});

test('deallocate cascades: removing a cut node frees what it orphaned', () => {
  const allocated = new Set([1, 2, 3]); // 0(start)-1-2-3
  const after = deallocate(adj, allocated, starts, 1);
  assert.deepEqual([...after].sort((x,y)=>x-y), []); // 2,3 orphaned -> all gone
});

test('deallocate of a leaf removes only that leaf', () => {
  const allocated = new Set([1, 2, 3]);
  const after = deallocate(adj, allocated, starts, 3);
  assert.deepEqual([...after].sort((x,y)=>x-y), [1, 2]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/passiveAlloc.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// public/js/passive-alloc.js
export function canAllocate(adj, allocated, starts, hash) {
  if (allocated.has(hash)) return false;
  if (starts.includes(hash)) return true;
  for (const nb of adj.get(hash) ?? []) {
    if (allocated.has(nb) || starts.includes(nb)) return true;
  }
  return false;
}

export function allocate(adj, allocated, starts, hash) {
  if (!canAllocate(adj, allocated, starts, hash)) return new Set(allocated);
  const next = new Set(allocated);
  next.add(hash);
  return next;
}

// Reachable set from starts through `allocated` (BFS), starts themselves excluded
// from removal. Anything in `allocated` not reachable is orphaned.
function reachable(adj, allocated, starts) {
  const seen = new Set();
  const q = [...starts];
  while (q.length) {
    const cur = q.shift();
    for (const nb of adj.get(cur) ?? []) {
      if (allocated.has(nb) && !seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
  }
  return seen;
}

export function deallocate(adj, allocated, starts, hash) {
  if (!allocated.has(hash)) return new Set(allocated);
  const trimmed = new Set(allocated);
  trimmed.delete(hash);
  return reachable(adj, trimmed, starts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/passiveAlloc.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add public/js/passive-alloc.js test/passiveAlloc.test.js
git commit -m "feat(passives): allocation connectivity + cascade deallocate"
```

---

## Task 8: Allocation engine — point counting

**Files:**
- Modify: `public/js/passive-alloc.js`
- Test: `test/passiveAlloc.test.js`

**Interfaces:**
- Produces: `pointsSpent(allocated, nodeKindOf) → { main:int, ascendancy:int }` — counts allocated nodes by pool. `nodeKindOf` is `(hash) → kind string`; nodes whose kind starts with `asc` count toward `ascendancy`, all others toward `main`. Start nodes (free) should be excluded by the caller via `isFree`; here we count every member of `allocated`.

- [ ] **Step 1: Write the failing test**

```js
// add to test/passiveAlloc.test.js
import { pointsSpent } from '../public/js/passive-alloc.js';

test('pointsSpent splits main vs ascendancy pools', () => {
  const kindOf = (h) => ({ 1: 'small', 2: 'notable', 10: 'ascSmall', 11: 'ascNotable' }[h]);
  const res = pointsSpent(new Set([1, 2, 10, 11]), kindOf);
  assert.deepEqual(res, { main: 2, ascendancy: 2 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/passiveAlloc.test.js`
Expected: FAIL — `pointsSpent is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// add to public/js/passive-alloc.js
export function pointsSpent(allocated, nodeKindOf) {
  let main = 0, ascendancy = 0;
  for (const h of allocated) {
    if ((nodeKindOf(h) || '').startsWith('asc')) ascendancy += 1;
    else main += 1;
  }
  return { main, ascendancy };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/passiveAlloc.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add public/js/passive-alloc.js test/passiveAlloc.test.js
git commit -m "feat(passives): point counting by pool"
```

---

## Task 9: Allocation engine — weapon-set pools

**Files:**
- Modify: `public/js/passive-alloc.js`
- Test: `test/passiveAlloc.test.js`

**Interfaces:**
- Produces: a weapon-set membership helper. State for a weapon-set-capable node is a small bitmask: `1 = set I`, `2 = set II`, `3 = both`. `setMask(weaponState, hash) → int` reads the mask (default 3 = both when unset); `toggleSet(weaponState, hash, setNo) → Map` returns a new Map flipping the bit for `setNo` (1 or 2), clamping so a node is never 0 (removing the last set deallocates it — handled by the caller).
  - `weaponState` is `Map<int,int>` (only nodes that differ from "both" need entries).

- [ ] **Step 1: Write the failing test**

```js
// add to test/passiveAlloc.test.js
import { setMask, toggleSet } from '../public/js/passive-alloc.js';

test('setMask defaults to both (3) when unset', () => {
  assert.equal(setMask(new Map(), 5), 3);
});

test('toggleSet flips a single set bit', () => {
  let ws = new Map();
  ws = toggleSet(ws, 5, 2); // remove set II -> only set I (1)
  assert.equal(setMask(ws, 5), 1);
  ws = toggleSet(ws, 5, 1); // remove set I too -> 0 (caller deallocates)
  assert.equal(setMask(ws, 5), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/passiveAlloc.test.js`
Expected: FAIL — `setMask is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// add to public/js/passive-alloc.js
export function setMask(weaponState, hash) {
  return weaponState.has(hash) ? weaponState.get(hash) : 3;
}

export function toggleSet(weaponState, hash, setNo) {
  const bit = setNo === 1 ? 1 : 2;
  const next = new Map(weaponState);
  const cur = next.has(hash) ? next.get(hash) : 3;
  next.set(hash, cur ^ bit);
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/passiveAlloc.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add public/js/passive-alloc.js test/passiveAlloc.test.js
git commit -m "feat(passives): weapon-set membership masks"
```

---

## Task 10: Share codec — decode

**Files:**
- Create: `public/js/passive-code.js`
- Test: `test/passiveCode.test.js`

**Interfaces:**
- Consumes: `test/fixtures/passive-tree-codes.json` (committed).
- Produces: `decode(codeStr) → { version:int, charClass:int, ascendancy:int, nodes:int[], weaponSet:int[], ascNodes:int[] }`. `nodes` are main-tree hashes; `weaponSet` are weapon-set-section hashes; `ascNodes` are ascendancy-section hashes. Helper `b64ToBytes(str) → Uint8Array` handles URL-safe base64 + padding.

> **This is the reverse-engineering task.** Use the three fixtures as the spec. Format v7 is partially mapped in `docs/superpowers/specs/2026-06-26-passive-tree-design.md` §F. Iterate: parse header (version uint32 BE, class uint8, ascendancy uint8, count uint16 BE), then the main node list, then the trailing weapon-set / ascendancy sections (distinguished by the `SS` markers 01/02/03). Validate every decoded main hash against the artifact's node set. The decode is correct when the assertions below hold for all three fixtures.

- [ ] **Step 1: Write the failing test**

```js
// test/passiveCode.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decode } from '../public/js/passive-code.js';

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/passive-tree-codes.json', import.meta.url)));
const byName = Object.fromEntries(fx.vectors.map((v) => [v.name, v]));

test('decode reads version 7 and the ascendancy byte', () => {
  for (const v of fx.vectors) {
    const d = decode(v.code);
    assert.equal(d.version, 7, v.name);
    assert.equal(d.ascendancy, v.ascendancy, v.name);
  }
});

test('decode: weapon-set section present iff weapon passives allocated', () => {
  assert.ok(decode(byName.A_noasc_weaponset.code).weaponSet.length > 0);
  assert.ok(decode(byName.B_asc_weaponset.code).weaponSet.length > 0);
  assert.equal(decode(byName.C_asc_noweaponset.code).weaponSet.length, 0);
});

test('decode: ascendancy nodes present iff an ascendancy is chosen', () => {
  assert.equal(decode(byName.A_noasc_weaponset.code).ascNodes.length, 0);
  assert.ok(decode(byName.B_asc_weaponset.code).ascNodes.length > 0);
  assert.ok(decode(byName.C_asc_noweaponset.code).ascNodes.length > 0);
});

test('decode: all main node hashes are valid tree nodes', () => {
  const art = JSON.parse(fs.readFileSync(new URL('../public/generated/passive-tree.json', import.meta.url)));
  const valid = new Set(art.nodes.map((n) => n.h));
  for (const v of fx.vectors) {
    for (const h of decode(v.code).nodes) assert.ok(valid.has(h), `${v.name}:${h}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/passiveCode.test.js`
Expected: FAIL — module not found. (Ensure `npm run build:passives` has run so the artifact exists for the last assertion.)

- [ ] **Step 3: Write the implementation**

Implement `b64ToBytes` and `decode` per the mapped format. Skeleton (the section-walk details are finalized against the fixtures):

```js
// public/js/passive-code.js
export function b64ToBytes(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = typeof atob === 'function'
    ? atob(pad)
    : Buffer.from(pad, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decode(codeStr) {
  const b = b64ToBytes(codeStr);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 0;
  const version = dv.getUint32(o); o += 4;
  const charClass = b[o++]; const ascendancy = b[o++];
  // ... parse count + main node list + trailing weapon-set / ascendancy sections,
  // finalized against the three fixtures. Return the structured result.
  return { version, charClass, ascendancy, nodes: [], weaponSet: [], ascNodes: [] };
}
```

> Iterate the section-walk until all four tests pass. The fixtures are the oracle.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/passiveCode.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add public/js/passive-code.js test/passiveCode.test.js
git commit -m "feat(passives): decode official v7 share code"
```

---

## Task 11: Share codec — encode (byte-exact round-trip)

**Files:**
- Modify: `public/js/passive-code.js`
- Test: `test/passiveCode.test.js`

**Interfaces:**
- Produces: `encode(state) → codeStr` where `state` is the shape returned by `decode`. `encode(decode(code))` must reproduce each fixture **byte-for-byte** (compare decoded bytes, not the base64 string, to avoid padding-equivalence noise — though they should match exactly).

- [ ] **Step 1: Write the failing test**

```js
// add to test/passiveCode.test.js
import { encode, b64ToBytes } from '../public/js/passive-code.js';

test('encode(decode(code)) round-trips byte-for-byte for every fixture', () => {
  for (const v of fx.vectors) {
    const reencoded = encode(decode(v.code));
    assert.deepEqual([...b64ToBytes(reencoded)], [...b64ToBytes(v.code)], v.name);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/passiveCode.test.js`
Expected: FAIL — `encode is not a function`.

- [ ] **Step 3: Write the implementation**

Mirror `decode`: emit header (version uint32 BE, class, ascendancy, count uint16 BE), main node list, then weapon-set + ascendancy sections in the exact byte layout the fixtures use, and base64-encode (URL-safe). Add `bytesToB64`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/passiveCode.test.js`
Expected: PASS (5 tests). Byte-exact round-trip across all three fixtures confirms the codec.

- [ ] **Step 5: Commit**

```bash
git add public/js/passive-code.js test/passiveCode.test.js
git commit -m "feat(passives): encode share code (byte-exact round-trip)"
```

---

## Task 12: Canvas renderer — load, transform, draw

**Files:**
- Create: `public/js/passive-tree.js`
- Test: manual (browser) — no unit test for canvas draw; logic extracted to pure helpers is covered by Tasks 7–9.

**Interfaces:**
- Consumes: `/static/generated/passive-tree.json`; `buildAdjacency`-equivalent built client-side from `edges`.
- Produces: a default-exported `init(canvas, data)` that sets up pan/zoom + draw. Pure helpers `worldToScreen(view, x, y)` and `screenToWorld(view, sx, sy)` are exported for potential testing.

- [ ] **Step 1: Implement the module**

Write `public/js/passive-tree.js`:
- `fetch('/static/generated/passive-tree.json')` → data.
- A `view = { ox, oy, scale }` world transform; wheel adjusts `scale` about the cursor, pointer-drag adjusts `ox/oy`.
- `draw()`: clear; for each edge draw straight line or `ctx.arc(arc.cx, arc.cy, arc.r, arc.a0 - Math.PI/2, arc.a1 - Math.PI/2, arc.ccw)` (convert from "up=0" to canvas "right=0"); then draw node icons (lazy `Image` cache keyed by `icon` url, placeholder until loaded); then frames by `k`; then allocation highlights.
- `requestAnimationFrame` redraw on interaction.

- [ ] **Step 2: Verify in dev**

Run: `npm run build:passives && npm run dev`, open `http://localhost:3000/passives` (after Task 13 adds the route). Expected: the full tree renders; pan/zoom is smooth; arcs curve along orbits and straight edges connect groups. Compare shape against the official tree screenshot from the spec.

- [ ] **Step 3: Commit**

```bash
git add public/js/passive-tree.js
git commit -m "feat(passives): canvas renderer with pan/zoom + arc edges"
```

---

## Task 13: Page shell, route, nav link

**Files:**
- Create: `views/passives.njk`
- Modify: `src/routes/pages.js`
- Modify: the top-nav template (locate via `grep -rl "nav" views/`)
- Test: `test/server.test.js` (add a route smoke test)

**Interfaces:**
- Consumes: `passive-tree.js` (Task 12).
- Produces: `GET /passives` → 200 HTML with a `<canvas>` and a `<script type="module" src="/static/js/passive-tree.js">`, plus a tooltip container and point-counter elements.

- [ ] **Step 1: Write the failing test**

```js
// add to test/server.test.js (follow the existing supertest pattern in this file)
test('GET /passives renders the tree shell', async () => {
  const res = await request(app).get('/passives');
  assert.equal(res.status, 200);
  assert.match(res.text, /<canvas/);
  assert.match(res.text, /passive-tree\.js/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/server.test.js`
Expected: FAIL — 404 for `/passives`.

- [ ] **Step 3: Implement route + view + nav**

- `views/passives.njk`: extend the base layout; include `<canvas id="tree">`, a `<div id="tree-tooltip">`, a points readout, and a weapon-set mode toggle; load `/static/js/passive-tree.js` as a module.
- `src/routes/pages.js`: add `router.get('/passives', (req, res) => res.render('passives.njk', { title: 'Passive Tree' }));` (match the existing handler style in that file).
- Add a `<a href="/passives">` to the top nav so the prerender crawler reaches it.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/server.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add views/passives.njk src/routes/pages.js views/*.njk test/server.test.js
git commit -m "feat(passives): /passives page, route, nav link"
```

---

## Task 14: Wire allocation, tooltips, and hash import into the page

**Files:**
- Modify: `public/js/passive-tree.js`
- Test: manual (browser) + the pure-helper coverage from Tasks 7–11.

**Interfaces:**
- Consumes: `passive-alloc.js` (allocate/deallocate/pointsSpent/setMask/toggleSet) and `passive-code.js` (decode/encode).
- Produces: click-to-allocate behavior, hover tooltip (name + stats), live point counters, weapon-set mode toggle, `#<code>` import on load, and a "copy share code" action that calls `encode()`.

- [ ] **Step 1: Implement interaction wiring**

- Build adjacency from `data.edges`; `starts = [classRoot]` (+ chosen ascendancy start when set).
- On node click: if allocated → `deallocate`; else → `allocate`. Recompute highlights + `pointsSpent`, update the counter DOM.
- On hover (hit-test nearest node within its radius): show `#tree-tooltip` with `name` + `stats` lines; clicking a notable/keystone label opens its wiki page.
- Weapon-set toggle: when active, clicks on weapon-set-capable nodes call `toggleSet`; deallocate when mask hits 0.
- On load: if `location.hash` present, `decode(hash.slice(1))`, set `ascendancy`, and mark `nodes`/`weaponSet`/`ascNodes` as allocated; redraw.
- "Copy share code" button: `encode(currentState)` → `navigator.clipboard.writeText`, also set `location.hash`.

- [ ] **Step 2: Verify in dev**

Run: `npm run dev`, open `/passives`. Verify: clicking from the class start allocates along connected paths; disconnecting cascades; counters update; hovering shows stats; pasting fixture `C`'s code into the hash (`/passives#AAAABwoBAG8...`) highlights its allocation; copy-code produces a string that re-imports to the same shape.

- [ ] **Step 3: Verify static build doesn't regress**

Run: `npm run build:static` and confirm it completes (prerender crawls `/passives`; the artifact is a static file under `public/generated/`, copied wholesale — no crawler-discoverability issue). Then `node --test` (full suite green).

- [ ] **Step 4: Commit**

```bash
git add public/js/passive-tree.js
git commit -m "feat(passives): allocation, tooltips, share-code import/export"
```

---

## Self-Review

**Spec coverage:**
- §A architecture / static model → Tasks 6 (artifact), 12–14 (client app), 13 (route/crawler). ✓
- §B canonical parse + consolidation → Tasks 1–5. ✓
- §C artifact schema → Task 6. ✓
- §D Canvas renderer → Tasks 12, 14. ✓
- §E allocation engine (connectivity, points, ascendancy, weapon-set) → Tasks 7–9, wired in 14. ✓
- §F share codec round-trip → Tasks 10–11. ✓
- §G page/route/hash sharing/crawler → Task 13, 14. ✓
- §H testing → unit tests in Tasks 1–11; manual + static verification in 12–14. ✓
- Consolidation must not change graph output → Task 5 baseline guard. ✓

**Placeholder scan:** Task 10/12/14 intentionally leave finalization to TDD-against-fixtures and browser verification (canvas draw + the reverse-engineered section walk) — these are genuine iterate-against-oracle steps with crisp acceptance criteria (byte-exact round-trip; visual parity), not vague TODOs. All code steps include real code.

**Type consistency:** `parseTree()` shape (`{nodes,edges,meta}`) is consistent across Tasks 3–6; node fields (`h,x,y,k,name,stats,iconDds/icon,asc,ws`) consistent; `decode`/`encode` state shape (`version,charClass,ascendancy,nodes,weaponSet,ascNodes`) consistent across Tasks 10–11 and 14; alloc signatures (`adj,allocated,starts,hash`) consistent across Tasks 7–9 and 14.

**Open follow-ups (next spec, per design boundary):** passive nodes in `/search` + `/theorycraft` with tooltips; retiring standalone keystone/ascendancy representations. Not in this plan.
