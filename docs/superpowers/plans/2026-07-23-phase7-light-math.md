# Phase 7 — Light Math Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved "light math" to the build editor — attribute/level **requirement** checks, a whitelisted **stat aggregates** card, and one **consolidated warnings** strip — with no DPS/damage/defence computation.

**Architecture:** A single pure parser + aggregator (`public/js/build-math.js`) parses whitelisted stat lines and sums them; it is imported by **both** a Node build-step projector (`src/data/itemMath.js`, which pre-filters each item's fixed stat lines against real source at build time and emits `public/generated/item-math.json`) and the browser editor (which parses the same way for dynamic chosen-mods + the live passive tree). The editor renders a Summary card from `computeMath(build, ctx)`. Requirements come from real source data (`base_items.json` requirements, `characters.json` base_stats); gem *attribute* requirements and Spirit *reservation* are cut (not cleanly derivable — accept-the-hole).

**Tech Stack:** Node build step (`src/data/*` graph projectors), vanilla ES-module browser JS, `node:test` + `node:assert/strict`, puppeteer-core headless gate for the new tree API.

## Global Constraints

- **Hard boundary: NO DPS / damage / defence-effectiveness math.** Only requirement totals, whitelisted stat sums, and legality warnings.
- **Whitelist v1 (exact):** +Strength, +Dexterity, +Intelligence, +all Attributes, maximum Life, maximum Mana, Spirit, Fire/Cold/Lightning/Chaos Resistance, all Elemental Resistances. Everything else is silently ignored *in math* (still shown as item text). Extending the whitelist is a data/regex change, not an engine change.
- **Parse once, in one pure module.** `build-math.js` is the only stat-text parser added; it is node-tested against **real source stat lines**. The projector imports it (dual-use, the `query-core.js` ↔ `src/data/search.js` precedent) so build-time parsing and runtime parsing can never diverge.
- **Ranges stay ranges.** `+(30-40) to maximum Life` aggregates as a `[lo,hi]` range and displays as a range; scalars are `[n,n]`.
- **Anchored regexes only.** Match `^…$` on the stripped line so aura/conditional lines (`Allies in your Presence have +X% to all Elemental Resistances`, `Critical Hits ignore Enemy Monster Lightning Resistance`) never count toward the character's own totals.
- **Pure `(build, ctx) → results`.** No DOM in `build-math.js`; the editor only renders results. Keep `npm test` green (646 at start). No `data/source/` edits.
- **Scope cuts (accept-the-hole, per spec):** gem *attribute* requirements are cut (source only has proportional `requirement_weights`, not magnitudes); Spirit *reservation* vs available is cut (no structured reservation numbers in source — only 6 free-text mentions). Both noted in the roadmap completion entry. Gem `crafting_level` **is** used for the character-level requirement.

---

### Task 1: Pure stat parser `parseStat()` in `build-math.js`

The fragile heart, tested against real source lines. One function turns a display stat line into a whitelist contribution or `null`.

**Files:**
- Create: `public/js/build-math.js`
- Test: `test/build-math.test.js`

**Interfaces:**
- Produces: `stripStatMarkup(line) -> string`; `parseStat(line) -> { stats: [{ key, lo, hi }] } | null` where `key ∈ {str,dex,int,life,mana,spirit,fireRes,coldRes,lightRes,chaosRes}`. `+ to all Attributes` expands to three entries (str/dex/int); `% to all Elemental Resistances` expands to three (fireRes/coldRes/lightRes). `lo`/`hi` are numbers (equal for scalars). Non-whitelist or conditional/aura lines return `null`.

- [ ] **Step 1: Write the failing tests** (real source lines, incl. the aura/conditional exclusions)

Create `test/build-math.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStat, stripStatMarkup } from '../public/js/build-math.js';

const keys = (line) => { const r = parseStat(line); return r ? r.stats.map((s) => `${s.key}:${s.lo}-${s.hi}`).sort() : null; };

test('parseStat: flat attributes, ranges and scalars', () => {
  assert.deepEqual(keys('+(10-15) to Strength'), ['str:10-15']);
  assert.deepEqual(keys('+8 to Dexterity'), ['dex:8-8']);
  assert.deepEqual(keys('+(5-7) to all Attributes'), ['dex:5-7', 'int:5-7', 'str:5-7']);
});

test('parseStat: life / mana / spirit flats', () => {
  assert.deepEqual(keys('+(30-40) to maximum Life'), ['life:30-40']);
  assert.deepEqual(keys('+(40-60) to maximum Mana'), ['mana:40-60']);
  assert.deepEqual(keys('+30 to Spirit'), ['spirit:30-30']);
  assert.deepEqual(keys('+(10-15) to Spirit'), ['spirit:10-15']);
});

test('parseStat: resistances incl. all-elemental expansion', () => {
  assert.deepEqual(keys('+(50-100)% to Lightning Resistance'), ['lightRes:50-100']);
  assert.deepEqual(keys('+(4-7)% to Chaos Resistance'), ['chaosRes:4-7']);
  assert.deepEqual(keys('+(10-20)% to all Elemental Resistances'),
    ['coldRes:10-20', 'fireRes:10-20', 'lightRes:10-20']);
});

test('parseStat: strips [id|display] markup before matching', () => {
  assert.equal(stripStatMarkup('+5 to [Strength|Strength]'), '+5 to Strength');
  assert.deepEqual(keys('+5 to [Strength|Strength]'), ['str:5-5']);
});

test('parseStat: rejects aura/conditional/non-whitelist lines', () => {
  assert.equal(parseStat('Allies in your Presence have +(3-5)% to all Elemental Resistances'), null);
  assert.equal(parseStat('Critical Hits ignore Enemy Monster Lightning Resistance'), null);
  assert.equal(parseStat('(6-10)% increased maximum Life'), null); // % increased ≠ flat life (v1)
  assert.equal(parseStat('20% reduced maximum Life'), null);
  assert.equal(parseStat('15% increased chance to Shock'), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/build-math.test.js`
Expected: FAIL — `build-math.js` does not exist / `parseStat` undefined.

- [ ] **Step 3: Implement the parser**

Create `public/js/build-math.js` (this task adds only the parser; Task 4 appends `computeMath`):

```js
// Pure light-math core for the build planner (Phase 7). Parses a whitelisted
// set of stat lines and sums them; NO DPS/damage/defence math. Imported by BOTH
// the Node build step (src/data/itemMath.js, over real source) and the browser
// editor (dynamic chosen-mods + live passive tree), so parsing can't diverge.

// [id|display] -> display (repoe markup), then collapse whitespace.
export function stripStatMarkup(line) {
  return String(line ?? '')
    .replace(/\[([^\]|]*)\|([^\]]*)\]/g, (_, id, disp) => disp || id)
    .replace(/\[([^\]]*)\]/g, (_, t) => t)
    .replace(/\s+/g, ' ')
    .trim();
}

const ATTR_NAME = { Strength: 'str', Dexterity: 'dex', Intelligence: 'int' };
const RES_NAME = { Fire: 'fireRes', Cold: 'coldRes', Lightning: 'lightRes', Chaos: 'chaosRes' };
// A number token: optional +, optional (a-b) range, e.g. "+(10-15)", "8", "-5".
const N = String.raw`\+?\(?(-?\d+)(?:-(-?\d+))?\)?`;
const FLAT = new RegExp(`^${N} to (Strength|Dexterity|Intelligence|all Attributes|maximum Life|maximum Mana|Spirit)$`);
const RES = new RegExp(`^${N}% to (Fire|Cold|Lightning|Chaos) Resistance$`);
const ALL_ELE = new RegExp(`^${N}% to all Elemental Resistances$`);

function range(lo, hi) { const a = Number(lo); const b = hi == null ? a : Number(hi); return { lo: Math.min(a, b), hi: Math.max(a, b) }; }

export function parseStat(line) {
  const t = stripStatMarkup(line);
  let m = FLAT.exec(t);
  if (m) {
    const { lo, hi } = range(m[1], m[2]);
    const what = m[3];
    if (what === 'all Attributes') return { stats: ['str', 'dex', 'int'].map((key) => ({ key, lo, hi })) };
    if (what === 'maximum Life') return { stats: [{ key: 'life', lo, hi }] };
    if (what === 'maximum Mana') return { stats: [{ key: 'mana', lo, hi }] };
    if (what === 'Spirit') return { stats: [{ key: 'spirit', lo, hi }] };
    return { stats: [{ key: ATTR_NAME[what], lo, hi }] };
  }
  m = RES.exec(t);
  if (m) { const { lo, hi } = range(m[1], m[2]); return { stats: [{ key: RES_NAME[m[3]], lo, hi }] }; }
  m = ALL_ELE.exec(t);
  if (m) { const { lo, hi } = range(m[1], m[2]); return { stats: ['fireRes', 'coldRes', 'lightRes'].map((key) => ({ key, lo, hi })) }; }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/build-math.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add public/js/build-math.js test/build-math.test.js
git commit -m "feat(planner): pure whitelist stat parser for light math (Phase 7)"
```

---

### Task 2: Build-step projector `item-math.json`

Emit, per class, the base attributes/life/mana; and per unique/base slug, its equip requirements + the fixed stat lines that parse to a whitelist stat (pre-filtered with Task 1's parser over real source — proving it runs clean against every source line).

**Files:**
- Create: `src/data/itemMath.js`
- Modify: `scripts/build-index.js` (write the new artifact next to planner-data / mod-pools)
- Test: `test/itemMath.test.js`

**Interfaces:**
- Consumes: `parseStat` (Task 1); graph via `src/data/graph.js` (`nodesByKind`, `getNode`, `edgesFrom`/`edgesTo`) and the same source access `planner.js`/`modPools.js` use; `listUniques()` (`src/data/uniques.js`) for unique stat lines; base item requirements + implicit text.
- Produces: `itemMath() -> { classBase: {[slug]:{str,dex,int,life,mana}}, gemLevel: {[gemSlug]: number}, items: {[slug]: { req:{level,str,dex,int}, lines:string[] }} }`. `lines` are stripped, whitelist-matching only. Written to `public/generated/item-math.json`.

- [ ] **Step 1: Write the failing test**

Create `test/itemMath.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemMath } from '../src/data/itemMath.js';
import { plannerData } from '../src/data/planner.js';
import { parseStat } from '../public/js/build-math.js';

const IM = itemMath();

test('itemMath: every planner class resolves to base attributes', () => {
  const pd = plannerData();
  for (const c of pd.classes) {
    const base = IM.classBase[c.slug];
    assert.ok(base, `no classBase for ${c.slug}`);
    for (const k of ['str', 'dex', 'int', 'life', 'mana']) assert.equal(typeof base[k], 'number');
  }
});

test('itemMath: a known unique carries requirements + only whitelist-parseable lines', () => {
  const astra = IM.items.astramentis;
  assert.ok(astra, 'astramentis missing');
  assert.equal(typeof astra.req.level, 'number');
  // Astramentis grants "+(X-Y) to all Attributes" — every kept line must parse.
  assert.ok(astra.lines.length >= 1);
  for (const line of astra.lines) assert.ok(parseStat(line), `kept a non-whitelist line: ${line}`);
});

test('itemMath: kept lines are the whitelist subset (no aura/conditional lines survive)', () => {
  for (const [slug, it] of Object.entries(IM.items)) {
    for (const line of it.lines) assert.ok(parseStat(line), `${slug}: ${line}`);
  }
});

test('itemMath: gem crafting levels are exposed for the character-level requirement', () => {
  const anySlug = Object.keys(IM.gemLevel)[0];
  assert.equal(typeof IM.gemLevel[anySlug], 'number');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/itemMath.test.js`
Expected: FAIL — `src/data/itemMath.js` does not exist.

- [ ] **Step 3: Implement the projector**

Create `src/data/itemMath.js`. Read the existing header/import conventions in `src/data/planner.js` and `src/data/modPools.js` and match them. Implementation:

```js
// Build-step projector for Phase 7 light math. Graph-only, mirrors planner.js /
// modPools.js. Emits per-class base attributes, gem crafting levels, and per-item
// equip requirements + the fixed stat lines that parse to a whitelist stat.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStat, stripStatMarkup } from '../../public/js/build-math.js';
import { plannerData } from './planner.js';
import { listUniques } from './uniques.js';
import { nodesByKind, getNode } from './graph.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'source', 'repoe-poe2');

function classBaseByName() {
  const chars = JSON.parse(fs.readFileSync(path.join(SRC, 'characters.json'), 'utf8'));
  const byName = new Map();
  for (const c of chars) {
    const b = c.base_stats || {};
    byName.set(String(c.name).toLowerCase(), {
      str: b.strength ?? 0, dex: b.dexterity ?? 0, int: b.intelligence ?? 0,
      life: b.life ?? 0, mana: b.mana ?? 0,
    });
  }
  return byName;
}

// Keep only the lines that parse to a whitelist stat. Feeding EVERY source stat
// line through parseStat here is the build-time proof that the parser stays clean
// against real data; the browser re-parses the same kept lines at runtime.
function keepWhitelist(lines) {
  const kept = [];
  for (const raw of lines || []) {
    const t = stripStatMarkup(raw);
    if (t && parseStat(t)) kept.push(t);
  }
  return kept;
}

export function itemMath() {
  const pd = plannerData();
  const byName = classBaseByName();
  const classBase = {};
  for (const c of pd.classes) classBase[c.slug] = byName.get(c.slug.toLowerCase()) || { str: 0, dex: 0, int: 0, life: 0, mana: 0 };

  // Gem crafting level (character-level gate) from the gem nodes.
  const gemLevel = {};
  for (const n of nodesByKind('gem')) {
    const lvl = n.props?.craftingLevel ?? n.props?.crafting_level;
    if (typeof lvl === 'number') gemLevel[n.slug] = lvl;
  }

  // Per-item requirements + whitelist lines.
  const items = {};
  // Uniques: full stat lines (implicits + explicits) via listUniques(); requirement
  // is inherited from the unique's base item (see planner.js has_base linkage).
  for (const u of listUniques()) {
    const req = requirementFor(u.baseSlug || u.base) || { level: u.req?.level ?? 0, str: 0, dex: 0, int: 0 };
    items[u.slug] = { req, lines: keepWhitelist(u.stats) };
  }
  // Bases: requirement from base_items requirements; whitelist lines from implicits.
  for (const b of nodesByKind('base')) {
    const req = requirementFromNode(b);
    const lines = keepWhitelist((b.props?.implicits || []).map((x) => (typeof x === 'string' ? x : x?.text)));
    items[b.slug] = { req, lines };
  }
  return { classBase, gemLevel, items };
}

// --- requirement helpers: read the base_items requirement block off the graph node.
function requirementFromNode(node) {
  const r = node?.props?.requirements || node?.props?.req || {};
  return { level: r.level ?? 0, str: r.strength ?? r.str ?? 0, dex: r.dexterity ?? r.dex ?? 0, int: r.intelligence ?? r.int ?? 0 };
}
function requirementFor(baseSlug) {
  if (!baseSlug) return null;
  const node = nodesByKind('base').find((n) => n.slug === baseSlug);
  return node ? requirementFromNode(node) : null;
}
```

> **Implementer note:** the exact field names (`node.props.requirements`, `node.props.implicits`, unique `baseSlug`/`base`, `props.craftingLevel`) must be confirmed against the real graph — run `node -e "import('./src/data/graph.js')…"` to print one `base`/`gem` node's `props` keys and one `listUniques()[0]`, and adjust the accessors so all four `test/itemMath.test.js` cases pass. This is normal wiring, not a design change; keep the shape `{ classBase, gemLevel, items }` fixed.

- [ ] **Step 4: Wire it into the build**

In `scripts/build-index.js`, near where `planner-data.json` / `mod-pools.json` are written (around lines 76–80), add:

```js
import { itemMath } from '../src/data/itemMath.js';
// … alongside the other writeFileSync calls:
fs.writeFileSync(path.join(OUT, 'item-math.json'), JSON.stringify(itemMath()));
```

(Match the existing `OUT`/`path.join` idiom already used in the file.)

- [ ] **Step 5: Run to verify it passes**

Run: `npm run build:index && node --test test/itemMath.test.js`
Expected: PASS (4 tests); `public/generated/item-math.json` exists.

- [ ] **Step 6: Commit**

```bash
git add src/data/itemMath.js scripts/build-index.js test/itemMath.test.js
git commit -m "feat(planner): item-math.json projector — class base, gem levels, item reqs + whitelist lines"
```

---

### Task 3: Embeddable tree API `getAllocatedStatLines()`

The editor needs the flat stat lines of allocated tree nodes so `computeMath` can add tree attribute/life/etc. contributions. The embed already computes this internally for its stats panel (`passive-tree.js` ~line 793) but exposes no getter.

**Files:**
- Modify: `public/js/passive-tree.js` (add getter to the returned API object, ~line 2289)
- Modify: `scripts/verify-tree-embed.mjs` (add one assertion after allocation)

**Interfaces:**
- Produces: `api.getAllocatedStatLines() -> string[]` — the stripped stat lines for every allocated node (same `lines` array the stats panel aggregates), `[]` before load/allocation.

- [ ] **Step 1: Find the internal lines source**

Read `public/js/passive-tree.js` around lines 780–800 (where `_aggMod.aggregate(lines)` is called) and identify the function/variable that builds `lines` for allocated nodes (the passive-stats lookup per allocated node id). Confirm whether it is already a callable (e.g. `allocatedStatLines()`) or an inline computation.

- [ ] **Step 2: Expose the getter**

If the computation is inline, extract it into a local `function allocatedStatLines() { … return lines; }` (no behavior change — the stats panel calls the same function). Then add to the returned API object (the object containing `getState`, `getAllocatedNotables`, `getPoints`, ~line 2289):

```js
    getAllocatedStatLines: () => { try { return allocatedStatLines(); } catch { return []; } },
```

- [ ] **Step 3: Add the headless assertion**

In `scripts/verify-tree-embed.mjs`, after the aimed-click allocation step, add (adapt to the file's existing `ok()` helper + page handle names):

```js
const treeLines = await p.evaluate(() => window.__treeApi?.getAllocatedStatLines?.() ?? null);
ok('getAllocatedStatLines returns lines after allocation', Array.isArray(treeLines) && treeLines.length > 0,
   `got ${Array.isArray(treeLines) ? treeLines.length : treeLines}`);
```

> If the verify script does not already stash the embed API on `window.__treeApi`, expose it in the same place it mounts the embed (a one-line `window.__treeApi = api;` in the script's page-eval mount), or read the count via the stats panel DOM instead. Keep the assertion; adapt the access path.

- [ ] **Step 4: Run the unit suite + headless gate**

Run: `npm test` then (dev server on :3000 in another shell) `node scripts/verify-tree-embed.mjs`
Expected: `npm test` still green (no unit regressions); the tree verify prints the new `ok` line plus its prior checks.

- [ ] **Step 5: Commit**

```bash
git add public/js/passive-tree.js scripts/verify-tree-embed.mjs
git commit -m "feat(planner): expose getAllocatedStatLines() on the embeddable tree API"
```

---

### Task 4: `computeMath()` — aggregates, requirements, consolidated warnings

**Files:**
- Modify: `public/js/build-math.js` (append `computeMath`)
- Test: `test/build-math.test.js` (append fixture-build cases)

**Interfaces:**
- Consumes: `parseStat` (Task 1); `gearViolations`, `setupViolations` (`build-rules.js`); `modViolations`, `resolveMod` (`mod-core.js`).
- Produces:
  `computeMath(build, ctx) -> { attributes: {str,dex,int: {required, available:{lo,hi}, deficit}}, level: {required}, aggregates: {life,mana,spirit,fireRes,coldRes,lightRes,chaosRes: {lo,hi}}, warnings: string[] }`
  where `ctx = { planner, itemMath, pools, treeLines }` (`planner` = planner-data, `itemMath` = the artifact, `pools` = mod-pools, `treeLines` = string[] from Task 3).

- [ ] **Step 1: Write the failing fixture-build tests**

Append to `test/build-math.test.js` (follow the `editorRender.test.js` fixture idiom — hand-built PLANNER / ITEMMATH / POOLS + a build object):

```js
import { computeMath } from '../public/js/build-math.js';
import { emptyBuild } from '../public/js/build-store.js';

const ITEMMATH = {
  classBase: { warrior: { str: 15, dex: 7, int: 7, life: 16, mana: 30 } },
  gemLevel: { 'boneshatter': 12 },
  items: {
    astramentis: { req: { level: 30, str: 0, dex: 0, int: 0 }, lines: ['+(10-20) to all Attributes'] },
    'crude-bow': { req: { level: 1, str: 0, dex: 14, int: 0 }, lines: [] },
    'iron-hat': { req: { level: 8, str: 20, dex: 0, int: 0 }, lines: ['+(30-40) to maximum Life', '+20% to Fire Resistance'] },
  },
};
const PLANNER = { classes: [{ slug: 'warrior', name: 'Warrior' }], gems: {}, items: {}, slots: [] };
const POOLS = { families: {}, bases: {}, uniques: {} };
const build = (over) => emptyBuild({ now: () => 1, uuid: () => 'b1', class: 'warrior', ...over });

test('computeMath: aggregates flat whitelist stats across gear as ranges', () => {
  const b = build({ gear: { helmet: { item: { kind: 'base', slug: 'iron-hat' }, mods: [], corrupted: null } } });
  const r = computeMath(b, { planner: PLANNER, itemMath: ITEMMATH, pools: POOLS, treeLines: [] });
  assert.deepEqual(r.aggregates.life, { lo: 30, hi: 40 });
  assert.deepEqual(r.aggregates.fireRes, { lo: 20, hi: 20 });
});

test('computeMath: all-attributes gear + class base feed availability; tree lines add too', () => {
  const b = build({ gear: { amulet: { item: { kind: 'unique', slug: 'astramentis' }, mods: [], corrupted: null } } });
  const r = computeMath(b, { planner: PLANNER, itemMath: ITEMMATH, pools: POOLS, treeLines: ['+5 to Strength'] });
  // available.str = class 15 + gear all-attr (10..20) + tree 5 = 30..35
  assert.deepEqual(r.attributes.str.available, { lo: 30, hi: 35 });
});

test('computeMath: requirement = max item req; deficit uses worst-case (lo) availability', () => {
  const b = build({ gear: {
    helmet: { item: { kind: 'base', slug: 'iron-hat' }, mods: [], corrupted: null },   // str req 20
    weapon1a: { item: { kind: 'base', slug: 'crude-bow' }, mods: [], corrupted: null }, // dex req 14
  } });
  const r = computeMath(b, { planner: PLANNER, itemMath: ITEMMATH, pools: POOLS, treeLines: [] });
  assert.equal(r.attributes.str.required, 20);
  assert.equal(r.attributes.dex.required, 14);
  // available.str = 15 (class only); required 20 -> deficit 5
  assert.equal(r.attributes.str.deficit, 5);
  assert.equal(r.attributes.dex.deficit, 7); // class dex 7 vs req 14
  assert.ok(r.warnings.some((w) => /Strength/.test(w) && /5/.test(w)));
});

test('computeMath: character-level requirement = max item level + gem crafting level', () => {
  const b = build({
    gear: { amulet: { item: { kind: 'unique', slug: 'astramentis' }, mods: [], corrupted: null } }, // level 30
    skills: [{ gem: { slug: 'boneshatter' }, level: null, supports: [] }],                            // craft 12
  });
  const r = computeMath(b, { planner: PLANNER, itemMath: ITEMMATH, pools: POOLS, treeLines: [] });
  assert.equal(r.level.required, 30);
});

test('computeMath: a non-whitelist stat never enters totals', () => {
  const IM2 = { ...ITEMMATH, items: { ...ITEMMATH.items,
    'iron-hat': { req: { level: 8, str: 20, dex: 0, int: 0 }, lines: ['+(30-40) to maximum Life'] } } };
  const b = build({ gear: { helmet: { item: { kind: 'base', slug: 'iron-hat' }, mods: [], corrupted: null } } });
  const r = computeMath(b, { planner: PLANNER, itemMath: IM2, pools: POOLS, treeLines: [] });
  assert.equal(r.aggregates.fireRes.hi, 0); // fire res line removed -> stays zero
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/build-math.test.js`
Expected: FAIL — `computeMath` undefined.

- [ ] **Step 3: Implement `computeMath`**

Append to `public/js/build-math.js`:

```js
// Relative imports (NOT /static/js/…) so node --test resolves them; in the
// browser these resolve relative to /static/js/build-math.js all the same. This
// matches editor-render.js / mod-core.js convention. Both modules are import-free
// and pure, so pulling them in from the Node projector (Task 2) is safe too.
import { gearViolations, setupViolations } from './build-rules.js';
import { modViolations, resolveMod } from './mod-core.js';

const ATTR_KEYS = ['str', 'dex', 'int'];
const AGG_KEYS = ['life', 'mana', 'spirit', 'fireRes', 'coldRes', 'lightRes', 'chaosRes'];
const zero = () => ({ lo: 0, hi: 0 });
const add = (acc, { lo, hi }) => { acc.lo += lo; acc.hi += hi; };

function addLines(acc, lines) {
  for (const line of lines || []) {
    const parsed = parseStat(line);
    if (!parsed) continue;
    for (const s of parsed.stats) (acc[s.key] ??= zero()) && add(acc[s.key], s);
  }
}

// Chosen base mods (dynamic) → their display text via mod-pools, parsed the same way.
function modLines(cell, pools) {
  if (!pools) return [];
  const out = [];
  for (const m of cell.mods || []) { const r = resolveMod(pools, m); if (r?.text) out.push(...String(r.text).split('\n')); }
  if (cell.corrupted) { const r = resolveMod(pools, cell.corrupted); if (r?.text) out.push(...String(r.text).split('\n')); }
  return out;
}

export function computeMath(build, ctx) {
  const { planner, itemMath, pools, treeLines } = ctx;
  const cells = Object.values(build.gear || {}).filter((c) => c && c.item);

  // --- sums (class base + gear fixed lines + chosen mods + tree lines)
  const sums = {};
  for (const k of [...ATTR_KEYS, ...AGG_KEYS]) sums[k] = zero();
  const base = itemMath.classBase?.[build.class] || null;
  if (base) { for (const k of ATTR_KEYS) add(sums[k], { lo: base[k], hi: base[k] }); add(sums.life, { lo: base.life, hi: base.life }); add(sums.mana, { lo: base.mana, hi: base.mana }); }
  for (const cell of cells) {
    const im = itemMath.items?.[cell.item.slug];
    if (im) addLines(sums, im.lines);
    addLines(sums, modLines(cell, pools));
  }
  addLines(sums, treeLines || []);

  // --- requirements (items only; gems add a character-level gate)
  const required = { str: 0, dex: 0, int: 0 };
  let levelReq = 0;
  for (const cell of cells) {
    const req = itemMath.items?.[cell.item.slug]?.req;
    if (!req) continue;
    required.str = Math.max(required.str, req.str || 0);
    required.dex = Math.max(required.dex, req.dex || 0);
    required.int = Math.max(required.int, req.int || 0);
    levelReq = Math.max(levelReq, req.level || 0);
  }
  for (const setup of build.skills || []) {
    const lvl = itemMath.gemLevel?.[setup.gem?.slug];
    if (typeof lvl === 'number') levelReq = Math.max(levelReq, lvl);
  }

  const attributes = {};
  const warnings = [];
  for (const k of ATTR_KEYS) {
    const available = { lo: sums[k].lo, hi: sums[k].hi };
    const deficit = Math.max(0, required[k] - available.lo); // worst-case availability
    attributes[k] = { required: required[k], available, deficit };
    if (deficit > 0) warnings.push(`Need ${deficit} more ${{ str: 'Strength', dex: 'Dexterity', int: 'Intelligence' }[k]}`);
  }
  const aggregates = {}; for (const k of AGG_KEYS) aggregates[k] = { lo: sums[k].lo, hi: sums[k].hi };

  // --- consolidated legality warnings (reuse the existing pure checks)
  for (const v of gearViolations(build, planner)) warnings.push(v.message);
  for (const v of setupViolations(build, planner.gems || {})) warnings.push(v.message);
  if (pools) for (const cell of cells) for (const v of modViolations(cell, pools)) warnings.push(v.message);

  return { attributes, level: { required: levelReq }, aggregates, warnings };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/build-math.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add public/js/build-math.js test/build-math.test.js
git commit -m "feat(planner): computeMath — aggregates, attribute/level requirements, consolidated warnings"
```

---

### Task 5: Editor Summary card + wiring

Render the results and keep them live. A `renderSummary(build, ctx)` card shows attributes (available/required with deficit highlight), character-level requirement, whitelist aggregates (resists as `N/75`), and the consolidated warnings strip. It mounts at the top of `.dossier-main` and recomputes on every edit and on tree change.

**Files:**
- Modify: `public/js/editor-render.js` (add `renderSummary`; call it in `renderEditor`)
- Modify: `public/js/build-editor.js` (thread `itemMath` + live `treeLines` into ctx; recompute on tree `onChange`)
- Modify: `public/js/build-host.js` (load `item-math.json`; pass to `mountEditor`)
- Modify: `public/css/app.css` (Summary card styles)
- Test: `test/editorRender.test.js` (append a render assertion)

**Interfaces:**
- Consumes: `computeMath` (Task 4); `mountEditor({ …, itemMath })`; `ctx.itemMath`, `ctx.treeLines`.
- Produces: `renderSummary(build, ctx) -> string` (exported like `renderGear`/`renderSkills`); a `.editor-summary` section in the editor.

- [ ] **Step 1: Write the failing render test**

Append to `test/editorRender.test.js` (reuse its `PLANNER`/`MODPOOLS`/`fixed` fixtures; add a small `ITEMMATH`):

```js
import { renderSummary } from '../public/js/editor-render.js';

test('renderSummary shows attributes, level requirement, aggregates and warnings', () => {
  const ITEMMATH = {
    classBase: { warrior: { str: 15, dex: 7, int: 7, life: 16, mana: 30 } },
    gemLevel: {},
    items: { 'iron-hat': { req: { level: 8, str: 40, dex: 0, int: 0 }, lines: ['+(30-40) to maximum Life'] } },
  };
  const b = fixed({ class: 'warrior', gear: { helmet: { item: { kind: 'base', slug: 'iron-hat' }, mods: [], corrupted: null } } });
  const html = renderSummary(b, { planner: PLANNER, itemMath: ITEMMATH, pools: MODPOOLS, treeLines: [], resolveRef: () => ({}) });
  assert.match(html, /editor-summary/);
  assert.match(html, /Strength/);       // attribute row
  assert.match(html, /Life/);           // aggregate row
  assert.match(html, /Need 25 more Strength/); // req 40 vs available 15 -> deficit 25 warning
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/editorRender.test.js`
Expected: FAIL — `renderSummary` not exported.

- [ ] **Step 3: Implement `renderSummary` and call it**

In `public/js/editor-render.js`, import `computeMath` at the top (relative, matching its other imports like `./build-rules.js`):

```js
import { computeMath } from './build-math.js';
```

Add the exported render function (place near `renderGear`; reuse the file's `esc` helper and `.editor-side-card` styling):

```js
const ATTR_LABEL = { str: 'Strength', dex: 'Dexterity', int: 'Intelligence' };
const AGG_ROWS = [
  { key: 'life', label: 'Life' }, { key: 'mana', label: 'Mana' }, { key: 'spirit', label: 'Spirit' },
  { key: 'fireRes', label: 'Fire Res', cap: 75 }, { key: 'coldRes', label: 'Cold Res', cap: 75 },
  { key: 'lightRes', label: 'Lightning Res', cap: 75 }, { key: 'chaosRes', label: 'Chaos Res' },
];
const rangeText = (r) => (r.lo === r.hi ? `${r.lo}` : `${r.lo}–${r.hi}`);

export function renderSummary(build, ctx) {
  if (!ctx.itemMath) return '';
  const m = computeMath(build, ctx);
  const attrRows = ['str', 'dex', 'int'].map((k) => {
    const a = m.attributes[k];
    const cls = a.deficit > 0 ? ' editor-summary__row--deficit' : '';
    return `<li class="editor-summary__row${cls}"><span>${ATTR_LABEL[k]}</span>` +
      `<span>${rangeText(a.available)} / ${a.required}</span></li>`;
  }).join('');
  const aggRows = AGG_ROWS.map(({ key, label, cap }) => {
    const v = m.aggregates[key];
    const val = cap ? `${rangeText(v)}/${cap}` : rangeText(v) + (key.endsWith('Res') ? '%' : '');
    return `<li class="editor-summary__row"><span>${label}</span><span>${val}</span></li>`;
  }).join('');
  const warns = m.warnings.length
    ? `<ul class="editor-summary__warnings">${m.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
    : '<p class="editor-summary__ok">No warnings.</p>';
  return `<section class="editor-summary editor-side-card" data-chapter="summary" aria-label="Character summary">
    <h3>Summary <span class="editor-summary__level">Level ${m.level.required}+</span></h3>
    <div class="editor-summary__cols">
      <ul class="editor-summary__list editor-summary__attrs" aria-label="Attributes (available / required)">${attrRows}</ul>
      <ul class="editor-summary__list editor-summary__aggs" aria-label="Stat totals">${aggRows}</ul>
    </div>
    ${warns}
  </section>`;
}
```

In `renderEditor` (the `.dossier-main` assembly, ~lines 425–444), insert the summary at the top of the main column (before the Gear section call):

```js
      ${isReadonly(ctx) ? '' : renderSummary(build, ctx)}
```

- [ ] **Step 4: Load the artifact and thread ctx (build-host + build-editor)**

In `public/js/build-host.js`, wherever `planner-data.json` / `mod-pools.json` are fetched for the editor, add `item-math.json` and pass it into `mountEditor`:

```js
const itemMath = await fetch('/static/generated/item-math.json').then((r) => r.json()).catch(() => null);
// … mountEditor(container, buildId, { store, planner, docs, resolveRef, pools, itemMath });
```

In `public/js/build-editor.js`:
- Accept `itemMath` in the `mountEditor` destructure (line 14): `{ store, planner, docs, resolveRef, pools, itemMath }`.
- Maintain a `let treeLines = [];` updated from the embed. Where the tree embed is created (the `onReady`/`onChange` wiring around lines 58–66), set `treeLines = treeEmbed.getAllocatedStatLines?.() ?? []` on ready and inside the existing `onChange` handler, then trigger a re-render.
- Add `itemMath, treeLines` to the `renderEditor` ctx object (line 37):
  ```js
  container.innerHTML = renderEditor(b, { planner, resolveRef, pools, weaponSet, mode, itemMath, treeLines, ...rest });
  ```
  (The existing debounced tree save already calls the render path; ensure the render reads the current `treeLines`.)

- [ ] **Step 5: Style the Summary card**

In `public/css/app.css`, near the other `.editor-side-card` / `.editor-checks` rules, add:

```css
.editor-summary { margin-bottom: 1rem; }
.editor-summary__level { float: right; font-size: .8em; opacity: .8; }
.editor-summary__cols { display: flex; gap: 1.5rem; flex-wrap: wrap; }
.editor-summary__list { list-style: none; margin: 0; padding: 0; min-width: 9rem; flex: 1; }
.editor-summary__row { display: flex; justify-content: space-between; gap: 1rem; padding: .15rem 0; }
.editor-summary__row--deficit { color: var(--color-danger, #e06c6c); font-weight: 600; }
.editor-summary__warnings { margin: .5rem 0 0; padding-left: 1.1rem; color: var(--color-danger, #e06c6c); }
.editor-summary__ok { margin: .5rem 0 0; opacity: .7; }
```

- [ ] **Step 6: Run the render test + full suite**

Run: `node --test test/editorRender.test.js` then `npm test`
Expected: PASS (the new render test + all prior). 

- [ ] **Step 7: Commit**

```bash
git add public/js/editor-render.js public/js/build-editor.js public/js/build-host.js public/css/app.css test/editorRender.test.js
git commit -m "feat(planner): editor Summary card — live aggregates, requirements, consolidated warnings"
```

---

### Task 6: End-to-end verify, static build, roadmap tick

**Files:**
- Create: `scripts/verify-light-math.mjs`
- Modify: `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md`, `docs/superpowers/specs/2026-07-06-light-math-design.md`

- [ ] **Step 1: Headless end-to-end check**

Create `scripts/verify-light-math.mjs` (copy the puppeteer-core launch preamble from `scripts/verify-sitewide-pin.mjs`, then): open the editor for a fresh build, choose a class, add an item with a known requirement via the URL/store hooks the editor exposes, and assert `.editor-summary` renders with an attribute row and (if under-statted) a deficit warning. Minimum viable assertion:

```js
const page = await browser.newPage();
await page.goto(`${BASE}/builds`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.editor-summary', { timeout: 8000 });
const txt = await page.$eval('.editor-summary', (el) => el.textContent);
if (!/Strength/.test(txt) || !/Life/.test(txt)) { console.error('FAIL: summary card missing rows'); process.exit(1); }
console.log('PASS: Summary card renders attributes + aggregates');
await browser.close();
```

Run against the dev server (`npm run dev` on :3000): `node scripts/verify-light-math.mjs`. If a fresh empty build shows the card with zeros, that satisfies the render path; deeper deficit-warning verification is covered by the unit tests.

- [ ] **Step 2: Static build gate**

Run: `npm run build:static`
Expected: build completes; `dist/static/generated/item-math.json` and `dist/static/js/build-math.js` present; crawler passes (no new fetched URL — `item-math.json` is same-origin static, loaded by JS, not crawled/linked; it does not need `extractLinks()` because it is a static asset copied to `dist`, not a prerendered page).

- [ ] **Step 3: Verify the static build's editor still renders the card**

Serve `dist/` and re-run: `BASE=http://localhost:8788 node scripts/verify-light-math.mjs`
Expected: `PASS: Summary card renders attributes + aggregates`.

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Tick roadmap + design spec**

In `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md`, change the Phase 7 line to `- [x] Phase 7 — Light math (…commit…)` with a one-line note recording the two accept-the-hole cuts: **gem attribute requirements** (source has only proportional `requirement_weights`) and **Spirit reservation** (no structured reservation numbers). Note the character-level requirement uses gem `crafting_level`.

In `docs/superpowers/specs/2026-07-06-light-math-design.md`, tick the five acceptance boxes; under Computation #3 record that Spirit reservation was cut per the plan-time check.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-light-math.mjs docs/superpowers/specs/2026-07-06-build-planner-roadmap.md docs/superpowers/specs/2026-07-06-light-math-design.md
git commit -m "docs(planner): tick Phase 7 (light math); record Spirit + gem-attr accept-the-hole cuts"
```

---

## Self-Review

**Spec coverage** (`2026-07-06-light-math-design.md`):
- "Parse at build time, sum in the browser" → Task 2's projector runs `parseStat` over all real source lines at build time and emits pre-filtered `lines`; the browser sums (and parses the *dynamic* pieces — chosen mods, live tree — with the same pure parser). One parser, dual-use. ✓
- Whitelist v1 (all 10 stats + all-attr + all-ele) → Task 1 regexes + expansion. ✓
- Ranges kept as ranges → `{lo,hi}` throughout, `rangeText` display. ✓
- Computation #1 Requirements (required/available/deficit per attribute) → Task 4 `attributes`; item reqs real, gem attr reqs cut, character-level from item level + gem `crafting_level`. ✓
- Computation #2 Aggregates panel (resists vs 75 cap, beginner-friendly `N/75`) → Task 5 `AGG_ROWS` with `cap: 75`. ✓
- Computation #3 Legality warnings consolidated → Task 4 folds `gearViolations`+`setupViolations`+`modViolations`+deficits into `warnings`; Task 5 renders one strip. Spirit reservation cut (plan-time check, Task 6 note). ✓
- "All functions pure `(build, plannerData) → results`, node-tested with fixture builds; editor just renders" → `build-math.js` pure, `computeMath(build, ctx)`, fixture tests in Task 4; editor render-only. ✓
- Acceptance: parser tests vs real lines (Task 1 + Task 2's whole-corpus filter) ✓; fixture-build totals/deficits (Task 4) ✓; editor shows card + live updates (Task 5, tree `onChange` re-render) ✓; out-of-whitelist stat excluded (Task 4 last test) ✓; `npm test` green + static verified (Task 6) ✓.

**Placeholder scan:** the two `> Implementer note` blocks (itemMath graph-accessor confirmation; tree API extraction access path) point at concrete inspection commands and keep the *interface shape* fixed — they are wiring confirmations against the live graph/embed, not deferred design. All code steps carry full code.

**Type consistency:** `{lo,hi}` range object used uniformly (`parseStat` stats, `computeMath` aggregates/available, `rangeText`). `computeMath(build, ctx)` ctx = `{planner, itemMath, pools, treeLines}` in Task 4 tests, Task 5 render, and Task 5 build-editor wiring. `itemMath()` return `{classBase, gemLevel, items:{slug:{req,lines}}}` matches Task 4's `ITEMMATH` fixture and `computeMath` accessors (`itemMath.classBase[build.class]`, `itemMath.items[slug].{req,lines}`, `itemMath.gemLevel[slug]`). `getAllocatedStatLines()` (Task 3) → `treeLines` (Task 4/5).

**Risk notes:**
- Import specifiers: `build-math.js` uses **relative** imports (`./build-rules.js`, `./mod-core.js`) — verified: both are import-free and node-importable, and editor-render.js already uses this relative convention (the `/static/js/…` form only works in the browser and breaks `node --test`). Do not use `/static/js/…` in any node-tested module.
- Projector graph accessors (`props.requirements`, `props.implicits`, unique base linkage, `props.craftingLevel`) are the one place needing live-graph confirmation (Task 2 Step 3 note) — the tests fail loudly until the accessors are right.
