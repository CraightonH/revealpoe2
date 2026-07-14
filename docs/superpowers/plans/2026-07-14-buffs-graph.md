# Buffs as Effect Entities — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest buff/debuff effect entities from RePoE `buffs.json` as a new `buff` graph kind, link the skills that grant them via one `grants_buff` edge, and surface them as a file-cheap client-rendered card (a bundle + one index + gem-page "Grants" chips) — no per-buff prerendered pages.

**Architecture:** A build-time producer (`scripts/graph/buffs.js`) emits `buff` nodes (id `Buff/<key>`) and `grants_buff` skill→buff edges, wired into `scripts/graph/build.js`. A read-only runtime adapter (`src/data/buffs.js`) projects buff view models (incl. a build-time-precomputed "granted by" provider list) over the graph. Presentation reuses existing patterns: a Nunjucks buff-card macro rendered into `public/generated/buffs.json` by `build-index.js`, a client-rendered `/buffs` index and `data-buff` Tippy popups that read that bundle, and a "Grants" section on gem pages. Buffs join site search via `allDocs()`.

**Tech Stack:** Node ESM, `node:test`, Nunjucks templates, htmx-free client modules + Tippy, Cloudflare Pages static prerender.

## Global Constraints

- **`src/` never reads `data/source/` at runtime** — build-time producers read source; runtime adapters read only the graph via `src/data/graph.js`. (Copied verbatim intent from CLAUDE.md "Data Architecture: the Graph".)
- **Provenance:** every `buff` node and `grants_buff` edge is `source: repoe` (default in `makeNode`/`makeEdge`) — a direct source-field relationship, like existing `grants` edges. No `manual`/`derived`.
- **Node id convention:** buff node id is `` `Buff/${key}` `` where `key` is the `buffs.json` object key (mirrors the `Class/`, `Tag/` synthetic-id convention in `bases.js`).
- **Edge:** exactly one new type, `grants_buff`, direction `skill → buff`, joined on `skills.json` `entry.active_skill.id === buff key`, emitted only when the `from` skill node exists in `nodeIds` (referential integrity).
- **File-count (roadmap principle 7):** NO per-buff prerendered pages and NO per-buff server card route. Buffs ship as one `public/generated/buffs.json` bundle + one `/buffs` index page. Do not add a crawlable per-buff URL.
- **Card HTML comes from Nunjucks macros rendered at build time and shipped as strings** — never re-implement card markup in JS (mirrors `build-index.js` / `theorycraft-client.js` contract).
- **Greedy node set:** every `buffs.json` entry with `invisible === false` AND a non-null `category` (~1,319 entries).
- Keep `npm test` green after every task; verify static-only behavior with `npm run build:static` at the end.

---

### Task 1: `buff` nodes (schema + producer + build wiring)

**Files:**
- Modify: `scripts/graph/schema.js` (add `BUFF` to `KINDS`)
- Create: `scripts/graph/buffs.js`
- Modify: `scripts/graph/build.js` (import, `SOURCE_FILES`, node merge)
- Test: `test/graph/buffs.test.js`

**Interfaces:**
- Produces: `buffNodes(): { nodes, records }` where `records` is `[{ id: string, key: string }]` (consumed by Task 2's `buffEdges`).

- [ ] **Step 1: Write the failing test**

Create `test/graph/buffs.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buffNodes } from '../../scripts/graph/buffs.js';

test('buffNodes yields ~1319 visible+categorized buff nodes', () => {
  const { nodes } = buffNodes();
  assert.ok(nodes.length > 1200 && nodes.length < 1450, `unexpected buff count: ${nodes.length}`);
  assert.ok(nodes.every((n) => n.kind === 'buff'), 'all nodes are kind buff');
  assert.ok(nodes.every((n) => n.id.startsWith('Buff/')), 'ids use the Buff/ prefix');
  assert.ok(nodes.every((n) => n.source === 'repoe'), 'source is repoe');
});

test('buffNodes carries herald_of_ash with structured props', () => {
  const { nodes } = buffNodes();
  const ash = nodes.find((n) => n.id === 'Buff/herald_of_ash');
  assert.ok(ash, 'herald_of_ash buff node exists');
  assert.equal(ash.slug, 'herald-of-ash');
  assert.equal(ash.props.category, 'Herald');
  assert.equal(typeof ash.props.description, 'string');
  assert.ok('removable' in ash.props && 'stackLimit' in ash.props && Array.isArray(ash.props.stats));
});

test('buff records pair node id with source key for the edge builder', () => {
  const { records } = buffNodes();
  assert.ok(records.some((r) => r.id === 'Buff/herald_of_ash' && r.key === 'herald_of_ash'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/graph/buffs.test.js`
Expected: FAIL — `Cannot find module '../../scripts/graph/buffs.js'`.

- [ ] **Step 3: Add the `BUFF` kind**

In `scripts/graph/schema.js`, extend `KINDS` (append `BUFF`):

```js
export const KINDS = {
  GEM: 'gem', SKILL: 'skill', BASE: 'base', UNIQUE: 'unique', AFFIX: 'affix',
  TAG: 'tag', KEYWORD: 'keyword', CLASS: 'class', PASSIVE: 'passive',
  ASCENDANCY: 'ascendancy', GEAR_SLOT: 'gear-slot', AUGMENT: 'augment',
  BUFF: 'buff',
};
```

- [ ] **Step 4: Create the producer**

Create `scripts/graph/buffs.js`:

```js
// scripts/graph/buffs.js
//
// BUFF nodes + grants_buff edges from RePoE buffs.json. A buff is a status-effect
// ENTITY (Herald of Ash, Onslaught, Power Charge) — distinct from the gem/unique
// that PROVIDES it and from any prose keyword of the same name. The grant edge is
// derived from the source fact that a skill's active_skill.id names the buff it
// grants (e.g. HeraldOfAshPlayer.active_skill.id === 'herald_of_ash').
import { loadJson } from './loader.js';
import { REPOE } from './source.js';
import { slugify } from '../../src/data/slug.js';
import { makeNode, makeEdge, KINDS, EDGE_TYPES } from './schema.js';

// User-facing buffs only: visible AND categorized (drops ~1616 invisible engine
// buffs and ~1518 uncategorised internal entries). A rule, not a hand list.
function selectedBuffs() {
  const buffs = loadJson(`${REPOE}/buffs.json`);
  return Object.entries(buffs).filter(([, v]) => v && v.invisible === false && v.category);
}

export function buffNodes() {
  const nodes = [];
  const records = [];
  const usedSlugs = new Set();
  const uniqueSlug = (key) => {
    let slug = slugify(key);
    const base = slug;
    for (let n = 2; usedSlugs.has(slug); n += 1) slug = `${base}-${n}`;
    usedSlugs.add(slug);
    return slug;
  };

  for (const [key, v] of selectedBuffs()) {
    const id = `Buff/${key}`;
    const name = (v.name && v.name.trim()) || key;
    const props = {
      description: typeof v.description === 'string' ? v.description : '',
      category: v.category,
      removable: v.removable === true,
      stackLimit: v.stack_limit ?? null,
      stats: Array.isArray(v.stats) ? v.stats : [],
    };
    nodes.push(makeNode({
      id, kind: KINDS.BUFF, name, slug: uniqueSlug(key),
      props, search: `${name} ${v.category}`.toLowerCase(),
    }));
    records.push({ id, key });
  }
  return { nodes, records };
}

// Defined in Task 2.
export function buffEdges(records, nodeIds) {
  const skills = loadJson(`${REPOE}/skills.json`);
  const buffIdByKey = new Map(records.map((r) => [r.key, r.id]));
  const edges = [];
  for (const [skillKey, skill] of Object.entries(skills)) {
    const aid = skill?.active_skill?.id;
    if (!aid) continue;
    const buffId = buffIdByKey.get(aid);
    if (!buffId) continue;             // active skill isn't a user-facing buff
    if (!nodeIds.has(skillKey)) continue; // skill has no graph node (monster/variant)
    edges.push(makeEdge({ type: EDGE_TYPES.GRANTS_BUFF, from: skillKey, to: buffId }));
  }
  return edges;
}
```

(The `buffEdges` body references `EDGE_TYPES.GRANTS_BUFF`, added in Task 2. Task 1's tests only import `buffNodes`, so this task's tests pass before Task 2; the file is written whole here to avoid a second edit.)

- [ ] **Step 5: Wire nodes into `build.js`**

In `scripts/graph/build.js`:

(a) After `import { keywordNodes } from './keywords.js';` add:
```js
import { buffNodes, buffEdges } from './buffs.js';
```

(b) In the `SOURCE_FILES` array, after `` `${REPOE}/keywords.json`, `` add:
```js
  `${REPOE}/buffs.json`,
```

(c) In `buildGraph()`, after `const { nodes: kNodes } = keywordNodes();` add:
```js
  const { nodes: buffNs, records: buffRecs } = buffNodes();
```

(d) Add `...buffNs` to the `srcNodes` concat array (so buff ids land in `nodeIds`):
```js
  const srcNodes = [...gNodes, ...sNodes, ...bNodes, ...cNodes, ...tNodes, ...aNodes, ...augNodes, ...uNodes, ...pNodes, ...ascNodes, ...kNodes, ...buffNs];
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/graph/buffs.test.js`
Expected: PASS (3 tests).

- [ ] **Step 7: Rebuild graph + full test suite**

Run: `npm run build:graph && npm test`
Expected: build succeeds; all tests pass (buff nodes now in the artifact; `validate.js` accepts the new kind).

- [ ] **Step 8: Commit**

```bash
git add scripts/graph/schema.js scripts/graph/buffs.js scripts/graph/build.js test/graph/buffs.test.js
git commit -m "feat(graph): add buff node kind from buffs.json"
```

---

### Task 2: `grants_buff` edges (schema + build wiring + tests)

**Files:**
- Modify: `scripts/graph/schema.js` (add `GRANTS_BUFF` to `EDGE_TYPES`)
- Modify: `scripts/graph/build.js` (edge merge)
- Test: `test/graph/buffs.test.js` (extend)

**Interfaces:**
- Consumes: `buffNodes(): { nodes, records }` (Task 1).
- Produces: `buffEdges(records, nodeIds): edge[]` — already authored in Task 1's file; this task registers the edge type and wires it in.

- [ ] **Step 1: Write the failing test**

Append to `test/graph/buffs.test.js`:

```js
import { buffEdges } from '../../scripts/graph/buffs.js';
import { skillNodes } from '../../scripts/graph/gems.js';
import { gemNodes } from '../../scripts/graph/gems.js';

test('grants_buff joins a granting skill to its buff (HeraldOfAshPlayer -> Buff/herald_of_ash)', () => {
  const { records } = buffNodes();
  const { records: gemRecs } = gemNodes();
  const sNodes = skillNodes(gemRecs);
  const { nodes: buffNs } = buffNodes();
  const nodeIds = new Set([...sNodes.map((n) => n.id), ...buffNs.map((n) => n.id)]);

  const edges = buffEdges(records, nodeIds);
  assert.ok(edges.length > 0, 'some grants_buff edges exist');
  assert.ok(edges.every((e) => e.type === 'grants_buff'), 'all edges are grants_buff');
  const ash = edges.find((e) => e.to === 'Buff/herald_of_ash');
  assert.ok(ash, 'Herald of Ash buff is granted by some skill');
  assert.equal(ash.from, 'HeraldOfAshPlayer');
});

test('grants_buff edges only target existing buff nodes and existing skill nodes', () => {
  const { records, nodes: buffNs } = buffNodes();
  const { records: gemRecs } = gemNodes();
  const sNodes = skillNodes(gemNodes().records ? gemRecs : gemRecs);
  const nodeIds = new Set([...sNodes.map((n) => n.id), ...buffNs.map((n) => n.id)]);
  const edges = buffEdges(records, nodeIds);
  assert.ok(edges.every((e) => nodeIds.has(e.from) && nodeIds.has(e.to)), 'endpoints resolve');
});
```

(If `skillNodes`/`gemNodes` signatures differ when you get here, adapt the fixture wiring to mirror `build.js` lines that construct `sNodes` — the assertions on the resulting edges are the contract.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/graph/buffs.test.js`
Expected: FAIL — `makeEdge: invalid type 'grants_buff'` (thrown from `buffEdges`).

- [ ] **Step 3: Add the `GRANTS_BUFF` edge type**

In `scripts/graph/schema.js`, extend `EDGE_TYPES` (append `GRANTS_BUFF`):

```js
export const EDGE_TYPES = {
  GRANTS: 'grants', RECOMMENDS_SUPPORT: 'recommends_support', ROLLS_ON: 'rolls_on',
  HAS_BASE: 'has_base', TAGGED: 'tagged', REFERENCES_KEYWORD: 'references_keyword',
  IN_CLASS: 'in_class', IN_ASCENDANCY: 'in_ascendancy',
  DEFAULT_SKILL: 'default_skill', FITS_SLOT: 'fits_slot', SOCKETS_INTO: 'sockets_into',
  GRANTS_BUFF: 'grants_buff',
};
```

- [ ] **Step 4: Wire edges into `build.js`**

In `buildGraph()`, add `buffEdges` to the `srcEdges` array (after `...passiveEdges(...)`):

```js
    ...passiveEdges(passiveRecs, gemIds, ascIds),
    ...buffEdges(buffRecs, nodeIds),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/graph/buffs.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Rebuild + full suite + provenance sanity**

Run: `npm run build:graph && npm test`
Expected: build + tests green. `grants_buff` edges resolve against live nodes (validate.js referential check passes).

- [ ] **Step 7: Commit**

```bash
git add scripts/graph/schema.js scripts/graph/build.js test/graph/buffs.test.js
git commit -m "feat(graph): add grants_buff skill->buff edge"
```

---

### Task 3: Runtime adapter `src/data/buffs.js`

**Files:**
- Create: `src/data/buffs.js`
- Test: `test/buffs.test.js`

**Interfaces:**
- Consumes: graph accessors from `src/data/graph.js`.
- Produces:
  - `toBuff(node): BuffVM` where `BuffVM = { id, slug, name, category, description(html string), removable, stackLimit, grantedBy: [{kind, name, slug, url}] }`
  - `getBuffVM(slug): BuffVM | null`
  - `listBuffs(): BuffVM[]` (sorted by name)

- [ ] **Step 1: Write the failing test**

Create `test/buffs.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listBuffs, getBuffVM } from '../src/data/buffs.js';

test('listBuffs returns projected buff view models', () => {
  const buffs = listBuffs();
  assert.ok(buffs.length > 1200, 'buffs present');
  const ash = buffs.find((b) => b.slug === 'herald-of-ash');
  assert.ok(ash, 'herald of ash present');
  assert.equal(ash.category, 'Herald');
  assert.equal(typeof ash.description, 'string');
});

test('getBuffVM resolves by slug and precomputes providers', () => {
  const ash = getBuffVM('herald-of-ash');
  assert.ok(ash, 'resolved by slug');
  assert.ok(Array.isArray(ash.grantedBy), 'grantedBy is a list');
  assert.ok(ash.grantedBy.some((p) => /herald of ash/i.test(p.name)), 'a Herald of Ash provider is listed');
  assert.ok(ash.grantedBy.every((p) => !p.url || p.url.startsWith('/')), 'provider urls are internal');
});

test('getBuffVM returns null for an unknown slug', () => {
  assert.equal(getBuffVM('no-such-buff'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/buffs.test.js`
Expected: FAIL — `Cannot find module '../src/data/buffs.js'`.

- [ ] **Step 3: Create the adapter**

Create `src/data/buffs.js`:

```js
// src/data/buffs.js
//
// Presentation adapter for BUFF nodes. Read-only over the graph (never reads
// data/source). A buff's "granted by" list is the reverse of grants_buff, then a
// hop back over the existing `grants` edges: buff <- skill <- gem/unique/passive.
import { getNode, nodeBySlug, nodesByKind, edgesTo } from './graph.js';
import { renderGameText } from './keywords.js';
import { hasDefinition } from './keywordDefs.js';

function urlForNode(n) {
  if (n.kind === 'gem') return `/gem/${n.slug}`;
  if (n.kind === 'unique') return `/unique/${n.slug}`;
  if (n.kind === 'base') return `/base/${n.slug}`;
  return null;
}

// buff <- skill (grants_buff) <- provider (grants). Dedup providers by node id.
function providersForBuff(node) {
  const providers = new Map();
  for (const grantsBuff of edgesTo(node.id, 'grants_buff')) {   // .from = skill id
    for (const grants of edgesTo(grantsBuff.from, 'grants')) {   // .from = gem/unique/...
      const p = getNode(grants.from);
      if (p && !providers.has(p.id)) {
        providers.set(p.id, { kind: p.kind, name: p.name, slug: p.slug, url: urlForNode(p) });
      }
    }
  }
  return [...providers.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function toBuff(node) {
  const p = node.props;
  return {
    id: node.id,
    slug: node.slug,
    name: node.name,
    category: p.category,
    description: renderGameText(p.description || '', hasDefinition),
    removable: p.removable === true,
    stackLimit: p.stackLimit ?? null,
    grantedBy: providersForBuff(node),
  };
}

export function getBuffVM(slug) {
  const node = nodeBySlug('buff', slug);
  return node ? toBuff(node) : null;
}

export function listBuffs() {
  return nodesByKind('buff').map(toBuff).sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/buffs.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/buffs.js test/buffs.test.js
git commit -m "feat(buffs): runtime adapter with granted-by provider lookup"
```

---

### Task 4: Gem view model `grantedBuffs`

**Files:**
- Modify: `src/data/gems.js` (add `getGrantedBuffs` helper + `grantedBuffs` field)
- Test: `test/gems.test.js` (extend)

**Interfaces:**
- Consumes: `edgesFrom`, `getNode` (already imported in `gems.js`); the `grants_buff` edge (Task 2).
- Produces: `vm.grantedBuffs: [{ name, slug, category }]` on the gem view model.

- [ ] **Step 1: Write the failing test**

Append to `test/gems.test.js`:

```js
test('grantedBuffs surfaces the buff a herald gem grants (Herald of Ash)', () => {
  const vm = buildGemViewModel('herald-of-ash');
  assert.ok(vm, 'herald of ash gem resolves');
  assert.ok(Array.isArray(vm.grantedBuffs), 'grantedBuffs is a list');
  assert.ok(vm.grantedBuffs.some((b) => b.slug === 'herald-of-ash'), 'grants the Herald of Ash buff');
});

test('grantedBuffs is empty for a gem that grants no buff', () => {
  const vm = buildGemViewModel('fireball');
  assert.ok(vm, 'fireball resolves');
  assert.deepEqual(vm.grantedBuffs, []);
});
```

(If `fireball` isn't a valid slug in this dataset, substitute any non-buff active skill gem slug that `buildGemViewModel` resolves — the assertion is "no grants_buff edges → empty list".)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gems.test.js`
Expected: FAIL — `vm.grantedBuffs` is `undefined` (not an array).

- [ ] **Step 3: Add the helper**

In `src/data/gems.js`, near `getGrantingUniques` (around line 309), add:

```js
// Buffs this gem grants: for each skill the gem grants, the grants_buff targets.
function getGrantedBuffs(gem) {
  const out = new Map();
  for (const skillKey of gem.grants_skills ?? []) {
    for (const e of edgesFrom(skillKey, 'grants_buff')) {
      const b = getNode(e.to);
      if (b && !out.has(b.id)) out.set(b.id, { name: b.name, slug: b.slug, category: b.props.category });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Attach it to the view model**

In `buildGemViewModel`, in the returned object next to `grantedBy: getGrantingUniques(gem),` add:

```js
    grantedBuffs: getGrantedBuffs(gem),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/gems.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/gems.js test/gems.test.js
git commit -m "feat(gems): expose grantedBuffs on the gem view model"
```

---

### Task 5: Buff-card macro + gem "Grants" section

**Files:**
- Create: `views/macros/buff-card.njk`
- Create: `views/macros/grants-buff.njk`
- Modify: `views/gem.njk` (import + render the section)

**Interfaces:**
- Consumes: `BuffVM` (Task 3) for `buffCard`; `vm.grantedBuffs` (Task 4) for `grantsBuff`.
- Produces: macros `buffCard(b)` and `grantsBuff(vm)`. `buffCard` is rendered into the bundle in Task 6; `grantsBuff` emits `data-buff="<slug>"` chips wired to the popup in Task 8.

- [ ] **Step 1: Create the buff-card macro**

Create `views/macros/buff-card.njk`:

```njk
{# Buff/debuff effect card. Rendered into public/generated/buffs.json by
   build-index.js and shown by the data-buff popup and the /buffs index. Shows the
   effect, category, stack/removable facts, and every provider that grants it
   (reverse of grants_buff, precomputed in src/data/buffs.js). #}
{% macro buffCard(b) %}
<div class="newItemPopup NormalPopup item-popup--poe2 buff-card" id="buff-{{ b.slug }}" data-buff-slug="{{ b.slug }}">
  <div class="itemHeader doubleLine">
    <div class="itemName"><span class="lc buff-name">{{ b.name }}</span></div>
  </div>
  <div class="content">
    <div class="Stats">
      <div class="property typeLine buff-category">{{ b.category }}</div>
      {% if b.description %}<div class="explicitMod buff-desc">{{ b.description | safe }}</div>{% endif %}
      {% if b.stackLimit %}<div class="property">Max Stacks: <span class="colourDefault">{{ b.stackLimit }}</span></div>{% endif %}
      <div class="property buff-removable">{{ "Removable" if b.removable else "Cannot be removed" }}</div>
    </div>
    {% if b.grantedBy.length %}
    <div class="separator"></div>
    <div class="buff-granted-by">
      <div class="buff-granted-by-label">Granted by</div>
      <div class="buff-granted-by-list">
        {% for p in b.grantedBy %}
        {% if p.url %}<a class="buff-provider" href="{{ p.url }}" data-card-url="{{ p.url }}/card">{{ p.name }}</a>{% else %}<span class="buff-provider">{{ p.name }}</span>{% endif %}
        {% endfor %}
      </div>
    </div>
    {% endif %}
  </div>
</div>
{% endmacro %}
```

- [ ] **Step 2: Create the gem "Grants" section macro**

Create `views/macros/grants-buff.njk` (mirrors `granted-by-equipping.njk`):

```njk
{% macro grantsBuff(vm) %}
{% if vm.grantedBuffs.length %}
<details class="rec-group" open style="--rec-accent:var(--color-normal)">
  <summary class="rec-group-title">Grants <span class="rec-group-count">{{ vm.grantedBuffs.length }}</span></summary>
  <p class="rec-group-hint">Persistent buffs this skill grants while active — hover a buff for details.</p>
  <div class="buff-chip-row">
    {% for b in vm.grantedBuffs %}
    <span class="buff-chip kw" data-buff="{{ b.slug }}" tabindex="0" role="button">{{ b.name }}</span>
    {% endfor %}
  </div>
</details>
{% endif %}
{% endmacro %}
```

- [ ] **Step 3: Render it on the gem page**

In `views/gem.njk`, add the import after line 6 (`{% from "macros/recommended-by.njk" import recommendedBy %}`):

```njk
{% from "macros/grants-buff.njk" import grantsBuff %}
```

And add the call in the content block after `{{ grantedByEquipping(vm) }}`:

```njk
    {{ grantsBuff(vm) }}
```

- [ ] **Step 4: Verify in dev render**

Run: `npm run build:graph && npm run dev` (or `node src/index.js`), then in another shell:
`node -e "fetch('http://localhost:3000/gem/herald-of-ash').then(r=>r.text()).then(t=>console.log(t.includes('data-buff=\"herald-of-ash\"') ? 'CHIP OK' : 'CHIP MISSING'))"`
Expected: `CHIP OK`. (Use the port your dev server prints.)

- [ ] **Step 5: Commit**

```bash
git add views/macros/buff-card.njk views/macros/grants-buff.njk views/gem.njk
git commit -m "feat(buffs): buff-card macro and gem Grants section"
```

---

### Task 6: Emit `public/generated/buffs.json` from `build-index.js`

**Files:**
- Modify: `scripts/build-index.js`
- Test: `test/build-index-buffs.test.js`

**Interfaces:**
- Consumes: `listBuffs()` (Task 3), `buffCard` macro (Task 5).
- Produces: `public/generated/buffs.json` = `[{ slug, name, category, cardHtml }]`.

- [ ] **Step 1: Add the buff bundle write**

In `scripts/build-index.js`:

(a) Add an import alongside the other `src/data` imports at the top:
```js
import { listBuffs } from '../src/data/buffs.js';
```

(b) In `browseCards()` (or right after the `cards`/`planner` writes near the `fs.writeFileSync` calls), add the buff render + write. Place after the `browse-cards.json` write:
```js
const renderBuff = compileCard('macros/buff-card.njk', 'buffCard');
const buffs = listBuffs().map((b) => ({ slug: b.slug, name: b.name, category: b.category, cardHtml: renderBuff(b) }));
fs.writeFileSync(path.join(OUT, 'buffs.json'), JSON.stringify(buffs));
```

(c) Extend the closing `console.log` to mention buffs (optional but keep parity):
```js
console.log(
  `build-index: ${docs.length} docs, ${count} browse cards, ${buffs.length} buffs, ` +
  `${planner.slots.length} slots / ${Object.keys(planner.items).length} items / ${Object.keys(planner.gems).length} gems ` +
  `-> public/generated/`,
);
```

- [ ] **Step 2: Write the test**

Create `test/build-index-buffs.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'public', 'generated', 'buffs.json');

test('build-index emits a macro-rendered buffs bundle', () => {
  execFileSync('node', ['scripts/build-index.js'], { stdio: 'ignore' });
  const buffs = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  assert.ok(buffs.length > 1200, 'bundle has buffs');
  const ash = buffs.find((b) => b.slug === 'herald-of-ash');
  assert.ok(ash, 'herald of ash in bundle');
  assert.ok(ash.cardHtml.includes('buff-card'), 'cardHtml is the rendered macro');
  assert.ok(/granted by/i.test(ash.cardHtml), 'card shows granted-by section');
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm run build:graph && node --test test/build-index-buffs.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-index.js test/build-index-buffs.test.js
git commit -m "feat(buffs): emit public/generated/buffs.json bundle"
```

---

### Task 7: `/buffs` index page (client-rendered) + nav

**Files:**
- Create: `views/buffs.njk`
- Create: `public/js/buffs-client.js`
- Modify: `src/routes/pages.js` (register `/buffs`)
- Modify: `views/base.njk` (nav link)

**Interfaces:**
- Consumes: `public/generated/buffs.json` (Task 6).
- Produces: a prerender-discoverable `/buffs` route rendering a shell the client fills.

- [ ] **Step 1: Create the index shell**

Create `views/buffs.njk`:

```njk
{% extends "base.njk" %}
{% from "macros/nav.njk" import pageHeader %}
{% block title %}Buffs & Debuffs — Reveal · PoE2 Wiki{% endblock %}
{% block content %}
<div class="page page--column">
  {{ pageHeader('Buffs & Debuffs', 'Status effects and what grants them', '--color-normal') }}
  <div id="buffs-results" class="buff-index-grid">
    <p class="tc-empty">Loading buffs…</p>
  </div>
  <script type="module" src="/static/js/buffs-client.js"></script>
</div>
{% endblock %}
```

- [ ] **Step 2: Create the client renderer**

Create `public/js/buffs-client.js`:

```js
// Client-rendered /buffs index. Injects every buff card from the prebuilt bundle
// (public/generated/buffs.json). No per-buff files ship — one bundle backs the
// whole kind (roadmap principle 7). Deep-links: /buffs#buff-<slug> scrolls to it.
const BUNDLE_URL = '/static/generated/buffs.json';
const target = document.querySelector('#buffs-results');

if (target) {
  fetch(BUNDLE_URL)
    .then((r) => r.json())
    .then((buffs) => {
      buffs.sort((a, b) => a.name.localeCompare(b.name));
      target.innerHTML = buffs.map((b) => b.cardHtml).join('');
      if (location.hash) {
        const el = document.getElementById(location.hash.slice(1));
        if (el) el.scrollIntoView({ block: 'center' });
      }
    })
    .catch(() => { target.innerHTML = '<p class="tc-empty">Could not load buffs.</p>'; });
}
```

- [ ] **Step 3: Register the route**

In `src/routes/pages.js`, near the `/uniques` route, add:

```js
  app.get('/buffs', (_req, res) => {
    res.render('buffs.njk');
  });
```

- [ ] **Step 4: Add the nav link**

In `views/base.njk`, in the `.site-nav__list`, add a nav item before the Theory Crafting item:

```njk
      <li class="site-nav__item">
        <a href="/buffs" class="site-nav__top">Buffs</a>
      </li>
```

- [ ] **Step 5: Verify in dev**

Run: `npm run build:graph && npm run build:index`, start the server, then:
`node -e "fetch('http://localhost:3000/buffs').then(r=>r.text()).then(t=>console.log(t.includes('buffs-results') && t.includes('buffs-client.js') ? 'INDEX OK' : 'INDEX MISSING'))"`
Expected: `INDEX OK`. Load `/buffs` in a browser and confirm cards render.

- [ ] **Step 6: Commit**

```bash
git add views/buffs.njk public/js/buffs-client.js src/routes/pages.js views/base.njk
git commit -m "feat(buffs): client-rendered /buffs index and nav link"
```

---

### Task 8: `data-buff` popup

**Files:**
- Create: `public/js/buff-tooltip.js`
- Modify: `views/base.njk` (load the script)

**Interfaces:**
- Consumes: `public/generated/buffs.json` (Task 6); `data-buff="<slug>"` chips (Task 5).
- Produces: a Tippy popup showing the buff card, sourced in-memory from the bundle (no server route, no prerendered file).

- [ ] **Step 1: Create the popup module**

Create `public/js/buff-tooltip.js`:

```js
// Buff popups. Gem "Grants" chips carry data-buff="<slug>"; hovering shows the
// buff card. Card HTML is pulled ONCE from the prebuilt buffs.json bundle and
// keyed by slug — no per-buff route or prerendered file (roadmap principle 7).
(function () {
  if (typeof window.tippy !== 'function') return;
  if (!document.querySelector('[data-buff]')) return;

  var BUNDLE_URL = '/static/generated/buffs.json';
  var bySlug = null;
  var loading = null;

  function load() {
    if (bySlug) return Promise.resolve(bySlug);
    if (!loading) {
      loading = fetch(BUNDLE_URL)
        .then(function (r) { return r.json(); })
        .then(function (arr) {
          bySlug = {};
          for (var i = 0; i < arr.length; i += 1) bySlug[arr[i].slug] = arr[i].cardHtml;
          return bySlug;
        });
    }
    return loading;
  }

  window.tippy.delegate('body', {
    target: '[data-buff]',
    allowHTML: true,
    interactive: true,
    maxWidth: 420,
    content: 'Loading…',
    onShow: function (instance) {
      var slug = instance.reference.getAttribute('data-buff');
      if (!slug) return false;
      if (instance._buffLoaded) return;
      load().then(function (map) {
        instance.setContent(map[slug] || 'No description available.');
        instance._buffLoaded = true;
      });
    },
  });
})();
```

- [ ] **Step 2: Load it**

In `views/base.njk`, after `<script src="/static/js/card-tooltip.js" defer></script>` add:

```njk
  <script src="/static/js/buff-tooltip.js" defer></script>
```

- [ ] **Step 3: Verify in dev**

Start the server, open `/gem/herald-of-ash`, hover the buff chip → the buff card popup appears with the effect + "Granted by". (Ensure `npm run build:index` has produced `public/generated/buffs.json` first.)

- [ ] **Step 4: Commit**

```bash
git add public/js/buff-tooltip.js views/base.njk
git commit -m "feat(buffs): data-buff card popup from the bundle"
```

---

### Task 9: Buffs in site search + Theory Crafting

**Files:**
- Modify: `src/data/theorycraft.js` (`buffDocs()` + `allDocs()`)
- Modify: `public/js/query-core.js` (`GROUPS`, `CATEGORY_LABEL`, `CAT_ORDER`)
- Test: `test/theorycraft.test.js` (extend, or add `test/buffs-search.test.js`)

**Interfaces:**
- Consumes: `listBuffs()` (Task 3), the `norm`/`stripHtml` helpers already in `theorycraft.js`.
- Produces: buff docs in `allDocs()` with `category: 'buff'`, deep-linking to `/buffs#buff-<slug>`.

- [ ] **Step 1: Write the failing test**

Create `test/buffs-search.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allDocs } from '../src/data/theorycraft.js';

test('allDocs includes buff docs deep-linking to the buffs index', () => {
  const buffs = allDocs().filter((d) => d.category === 'buff');
  assert.ok(buffs.length > 1200, 'buff docs present');
  const ash = buffs.find((d) => d.slug === 'herald-of-ash');
  assert.ok(ash, 'herald of ash searchable');
  assert.equal(ash.url, '/buffs#buff-herald-of-ash');
  assert.ok(ash.text.includes('herald'), 'text indexed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/buffs-search.test.js`
Expected: FAIL — no `buff` category docs.

- [ ] **Step 3: Add `buffDocs()` and register it**

In `src/data/theorycraft.js`:

(a) Import at the top with the other `src/data` imports:
```js
import { listBuffs } from './buffs.js';
```

(b) Add the builder near `augmentDocs()`:
```js
function buffDocs() {
  return listBuffs().map((b) => ({
    name: b.name,
    slug: b.slug,
    url: `/buffs#buff-${b.slug}`,
    cardUrl: null,
    category: 'buff',
    iconUrl: null,
    subtitle: b.category,
    color: '',
    tags: [String(b.category || '').toLowerCase()],
    req: [],
    grants: [],
    text: norm([b.name, b.category, b.description]),
  }));
}
```

(c) Add `...buffDocs()` to the `allDocs()` array:
```js
  _docs = [
    ...gemDocs(),
    ...uniqueDocs(),
    ...affixDocs(),
    ...nodeDocs(listKeystones(), 'keystone', 'keystone'),
    ...nodeDocs(listNotables(), 'notable', 'notable'),
    ...baseDocs(),
    ...augmentDocs(),
    ...buffDocs(),
  ];
```

- [ ] **Step 4: Register the `buff` category in the query core**

In `public/js/query-core.js`:

(a) Add to the `GROUPS` array: `{ category: 'buff', label: 'Buffs' },`
(b) Add to `CATEGORY_LABEL`: `buff: 'Buff',`
(c) Add `'buff'` to the end of the `CAT_ORDER` array.

- [ ] **Step 5: Run test + full suite**

Run: `node --test test/buffs-search.test.js && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/theorycraft.js public/js/query-core.js test/buffs-search.test.js
git commit -m "feat(buffs): index buffs in site search and theorycraft"
```

---

### Task 10: Static build verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 2: Static build**

Run: `npm run build:static`
Expected: completes without a dead-link failure; prerender logs include `/buffs`.

- [ ] **Step 3: Verify the bundle + index shipped, no per-buff explosion**

```bash
test -f dist/static/generated/buffs.json && echo "BUNDLE OK"
test -f dist/buffs.html && echo "INDEX OK"
# No per-buff files should exist:
ls dist/buff 2>/dev/null && echo "UNEXPECTED per-buff dir" || echo "NO per-buff files OK"
# File-count headroom check (must stay well under 20000):
echo "dist files: $(find dist -type f | wc -l | tr -d ' ')"
```
Expected: `BUNDLE OK`, `INDEX OK`, `NO per-buff files OK`, and dist file count risen by only ~1–2 vs before (bundle + index page).

- [ ] **Step 4: Verify /buffs renders client-side from the static output**

Serve `dist/` (or use a preview deploy) and fetch `/buffs`; confirm the shell + `buffs-client.js` are present and the browser fills cards. Use Node `fetch`, not `curl`.

- [ ] **Step 5: Update the roadmap checklist + commit**

In `docs/superpowers/specs/2026-07-14-complete-graph-roadmap.md`, tick Phase 1 in the Status checklist and note the completing commit hash.

```bash
git add docs/superpowers/specs/2026-07-14-complete-graph-roadmap.md
git commit -m "docs(roadmap): mark complete-graph Phase 1 (buffs) done"
```

---

## Self-Review

**Spec coverage** (checked against `2026-07-14-buffs-graph-design.md`):
- New `buff` kind, greedy visible+categorized (~1,319) → Task 1. ✓
- Single `grants_buff` skill→buff edge, join on `active_skill.id`, referential guard → Task 2. ✓
- Providers via traversal (no new item→buff join) → Task 3 `providersForBuff`. ✓
- Card-only, client-rendered bundle (`buffs.json`) → Task 6; popup → Task 8; `/buffs` index → Task 7; no per-buff pages → verified Task 10. ✓
- Gem "Grants →" chip → Tasks 4/5/8. ✓
- Search integration → Task 9. ✓
- Provenance `repoe` + regression tests (Herald of Ash gem→buff, node-count band) → Tasks 1–3. ✓
- Static-only verification → Task 10. ✓
- Non-goals (ailment `inflicts`, mod-stat parsing, buff↔keyword cross-link, per-buff pages, file-count rearchitecture) → not implemented. ✓

**Deliberate simplification vs spec:** the spec's presentation section implied a possible `/buff/:slug/card` server route for dev parity; this plan omits it entirely — the bundle carries the macro-rendered HTML and the popup reads it in-memory, which is strictly more principle-7-pure (zero per-buff server surface) and avoids any risk of the crawler minting 1,319 card files via `data-card-url`. Flagged here for visibility.

**Placeholder scan:** no TBD/TODO; every code step shows real code. Two fixtures carry an explicit fallback note (the `fireball` non-buff gem in Task 4; the `skillNodes`/`gemNodes` fixture wiring in Task 2) in case dataset slugs differ at execution — the assertion contract is stated so the implementer can substitute without guessing.

**Type consistency:** `BuffVM` shape (`{ id, slug, name, category, description, removable, stackLimit, grantedBy:[{kind,name,slug,url}] }`) is defined in Task 3 and consumed unchanged by the `buffCard` macro (Task 5), the bundle (Task 6), and search docs (Task 9, using `b.description`). `vm.grantedBuffs` (`[{name,slug,category}]`) defined in Task 4, consumed by `grantsBuff` (Task 5). Buff node id `Buff/<key>` and `grants_buff` `from`=skill node id / `to`=buff node id are consistent across Tasks 1–4.
