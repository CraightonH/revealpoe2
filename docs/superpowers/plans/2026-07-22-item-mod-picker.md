# Item Mod Picker + `mod-pools.json` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a build's gear wells carry chosen modifiers — 1–6 real explicit mods with tier selection on bases (prefix/suffix legality), an optional corrupted implicit on uniques — surfaced in a build-aware hover card, backed by a new `mod-pools.json` artifact projected from the graph.

**Architecture:** A new build-time projection (`src/data/modPools.js`) reads the graph's `affix` nodes + `rolls_on` edges and writes a normalized `public/generated/mod-pools.json` (families table + per-base eligibility refs + unique→base map). A pure browser/node core (`public/js/mod-core.js`) resolves a base/unique to its legal pool, resolves a chosen `{affix,tier}` to display text, and computes legality warnings. The build schema bumps to v2 (`gear[slot].mods` / `.corrupted` replacing `.wishlist`, with a v1→v2 migration). A new anchored popover (`public/js/mod-picker.js`, entity-picker idiom) does selection; chosen mods render into a **build-aware hover card** by extending the shared Tippy harness (`tooltips.js`) with a post-fetch `transform` hook, initialized once in `builds-page.js`.

**Tech Stack:** Vanilla ES modules (node:test-tested pure cores + projection), the graph artifact (`build/graph.json`) via `src/data/graph.js`, the existing Tippy tooltip harness, plain CSS on `tokens.css` custom properties.

## Global Constraints

- **Pure static site:** no SSR, no backend, no new server route. All build state in localStorage via `build-store.js`; client renders from prebuilt `public/generated/*.json`.
- **Pure-core pattern:** `modPools.js` reads ONLY the graph (never `data/source/`); `mod-core.js` is DOM/fetch/window-free and node-testable (relative import in tests, `/static/js/` in the browser).
- **Data provenance:** mod pools come from graph/source data only. Corrupted implicits are **confirmed present in source** (113 corrupted-origin affix families, 1023/1067 bases carry ≥1, 409/427 based uniques resolve a corrupted pool) — **no `data/manual/` overlay is needed or permitted here.**
- **Size budget:** `mod-pools.json` ≤ ~1 MB gzipped. Measured projection (normalized) = **2.32 MB raw / 0.10 MB gzip** — single file, no sharding.
- **Reference shape (locked):** `affix` = the affix node **slug** (matches the `{kind, slug}` item-reference contract); `tier` = the source tier **id** (stable content key, resolvable via `families[affix].tiers[].id`). Base eligibility refs carry tier **indices** (mirroring the `rolls_on` edge's `props.tiers`), which the core resolves to tier objects.
- **Warnings, never hard blocks** — consistent with `build-rules.js` philosophy (prefix/suffix 3+3 overflow, illegal-on-base, duplicate affix all warn).
- **Crawler discoverability:** no new client-fetched URL is introduced (the hover card reuses the item's existing prerendered `…/card` URL; `mod-pools.json` is a `public/generated/` artifact copied to `dist/`). Nothing to add to `prerender.js`.
- Keep `npm test` green (605 passing now). No `Co-Authored-By` lines in commits.
- Branch: `planner/phase-4a-builds-pages` (current planner feature branch; HELD — do not merge/push to main).

---

## File Structure

- **Create** `src/data/modPools.js` — build-time projection: graph → `{ families, bases, uniques }`.
- **Modify** `scripts/build-index.js` — write `public/generated/mod-pools.json`.
- **Create** `public/js/mod-core.js` — pure pool resolution + mod resolution + legality warnings.
- **Modify** `public/js/build-store.js` — schema v2 (`mods`/`corrupted` cells), v1→v2 migration, validation.
- **Create** `public/js/mod-picker.js` — anchored popover DOM module (entity-picker precedent; DOM glue untested, pure HTML builder lives in `mod-core.js` and IS tested).
- **Modify** `public/js/editor-render.js` — filled-well mods affordance + `data-slot-mods` hook; `modCardLines()` pure helper for the hover-card mod block.
- **Modify** `public/js/tooltips.js` — optional `transform(html, reference)` post-fetch hook.
- **Modify** `public/js/builds-page.js` — init the build-aware slot tooltip once; lazy-load `mod-pools.json`; pass `pools` into the editor mount.
- **Modify** `public/js/build-editor.js` — pass `pools` through; open mod popover; add/remove/set-tier handlers; `equip()` writes the v2 cell shape.
- **Modify** `public/js/builds-render.js` — read-only viewer lists chosen mods as `.explicitMod` lines.
- **Modify** `public/css/builds.css` — mod-picker popover + hover-card mod-block + well indicator styles.
- **Create** tests: `test/mod-pools.test.js`, `test/mod-core.test.js`. **Modify** tests: `test/build-store.test.js`, `test/editorRender.test.js`, `test/buildsRender.test.js`.
- **Modify** `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md` — tick Phase 4c.

---

### Task 1: `mod-pools.json` projection

**Files:**
- Create: `src/data/modPools.js`
- Modify: `scripts/build-index.js:24` (import) and `:75-76` (write)
- Test: `test/mod-pools.test.js`

**Interfaces:**
- Consumes: `nodesByKind`, `edgesTo`, `edgesFrom`, `getNode` from `./graph.js`; `stripGameText` from `./keywords.js`; `toGenericText` from `./affixText.js`.
- Produces: `export function modPools()` returning
  ```
  {
    families: {                       // keyed by affix node slug
      <affixSlug>: {
        name: string,                 // humanized type (node.name)
        origin: 'standard'|'corrupted',
        scope: string,                // node.props.scope
        generic: string,              // display generic label, ranges collapsed to '#'
        tiers: [ { id: string, name: string, level: number,
                   gen: 'prefix'|'suffix'|'corrupted', text: string } ]  // display text, markup stripped
      }
    },
    bases:   { <baseSlug>:   [ { a: affixSlug, t?: number[] } ] },  // standard+corrupted eligibility; t = allowed tier indices (omitted = all)
    uniques: { <uniqueSlug>: baseSlug }                             // for corrupted-implicit lookup
  }
  ```
  `desecrated`-origin affixes are excluded entirely (out of scope for the base mod picker and the unique corrupted implicit).

- [ ] **Step 1: Write the failing test** — `test/mod-pools.test.js`:

```js
// test/mod-pools.test.js — the mod-pools projection over the real graph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modPools } from '../src/data/modPools.js';

test('modPools: families carry origin, tiers with gen + display text', () => {
  const { families } = modPools();
  const slugs = Object.keys(families);
  assert.ok(slugs.length > 400, `expected a large family table, got ${slugs.length}`);
  // Every family is standard or corrupted; never desecrated.
  for (const f of Object.values(families)) {
    assert.ok(f.origin === 'standard' || f.origin === 'corrupted', `bad origin ${f.origin}`);
    assert.ok(f.tiers.length >= 1);
    for (const t of f.tiers) {
      assert.ok(typeof t.id === 'string' && t.id.length);
      assert.ok(['prefix', 'suffix', 'corrupted'].includes(t.gen), `bad gen ${t.gen}`);
      assert.ok(!/\[[^\]]*\|/.test(t.text), `tier text still has [a|b] markup: ${t.text}`);
    }
  }
});

test('modPools: a body-armour base has standard prefixes and suffixes', () => {
  const { families, bases } = modPools();
  const bodySlug = Object.keys(bases).find((slug) =>
    (bases[slug] || []).some((r) => families[r.a]?.origin === 'standard'));
  assert.ok(bodySlug, 'a base with standard families exists');
  const gens = new Set(
    bases[bodySlug].flatMap((r) => (families[r.a]?.tiers ?? []).map((t) => t.gen)));
  assert.ok(gens.has('prefix') && gens.has('suffix'), 'both prefix and suffix reachable');
});

test('modPools: corrupted families exist and reach bases (verification gate)', () => {
  const { families, bases } = modPools();
  const corrupted = Object.values(families).filter((f) => f.origin === 'corrupted');
  assert.ok(corrupted.length >= 50, `expected corrupted families, got ${corrupted.length}`);
  const basesWithCorrupt = Object.keys(bases).filter((slug) =>
    (bases[slug] || []).some((r) => families[r.a]?.origin === 'corrupted'));
  assert.ok(basesWithCorrupt.length > 500, `corrupted reaches many bases: ${basesWithCorrupt.length}`);
});

test('modPools: uniques map to a base slug present in bases', () => {
  const { bases, uniques } = modPools();
  const keys = Object.keys(uniques);
  assert.ok(keys.length > 300, `expected many uniques, got ${keys.length}`);
  const resolvable = keys.filter((u) => bases[uniques[u]]);
  assert.ok(resolvable.length > 300, `most uniques resolve a base pool: ${resolvable.length}`);
});

test('modPools: base eligibility tier indices are in range', () => {
  const { families, bases } = modPools();
  for (const refs of Object.values(bases)) {
    for (const r of refs) {
      const fam = families[r.a];
      assert.ok(fam, `ref points at a known family ${r.a}`);
      if (r.t) for (const i of r.t) assert.ok(i >= 0 && i < fam.tiers.length, `tier idx ${i} in range for ${r.a}`);
    }
  }
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/mod-pools.test.js` → FAIL (`modPools` not found).

- [ ] **Step 3: Implement `src/data/modPools.js`**:

```js
// src/data/modPools.js
//
// Build-time projection of the rollable-affix graph into the lean
// `mod-pools.json` artifact the Build Planner's mod picker consumes in the
// browser. Reads ONLY the graph (src/data/graph.js) — no source files.
//
// Normalized to stay small (measured: 2.32 MB raw / 0.10 MB gzip):
//   families  affixSlug -> { name, origin, scope, generic, tiers[] }
//   bases     baseSlug  -> [{ a: affixSlug, t?: allowedTierIndices }]
//   uniques   uniqueSlug -> baseSlug   (corrupted-implicit lookup)
//
// Only `standard` (craftable prefix/suffix) and `corrupted` (Vaal implicit)
// origins are projected; `desecrated` is out of scope for the planner picker.
import { nodesByKind, edgesTo, edgesFrom, getNode } from './graph.js';
import { stripGameText } from './keywords.js';
import { toGenericText } from './affixText.js';

const KEEP = new Set(['standard', 'corrupted']);

// Tier generation bucket for the client's prefix/suffix/corrupted partition.
// Standard mods split on their source generation type; corrupted mods are a
// flat implicit pool.
function genOf(origin, generationType) {
  if (origin === 'corrupted') return 'corrupted';
  return generationType === 'suffix' ? 'suffix' : 'prefix';
}

export function modPools() {
  const families = {};
  const affixById = new Map(); // node id -> node (for edge resolution)

  for (const node of nodesByKind('affix')) {
    if (!KEEP.has(node.props.origin)) continue;
    affixById.set(node.id, node);
    const tiers = [...node.props.tiers].sort((a, b) => a.level - b.level);
    const top = tiers[tiers.length - 1];
    families[node.slug] = {
      name: node.name,
      origin: node.props.origin,
      scope: node.props.scope,
      generic: stripGameText(toGenericText(top.text)),
      tiers: tiers.map((t) => ({
        id: t.id,
        name: t.name,
        level: t.level,
        gen: genOf(node.props.origin, t.generationType),
        text: stripGameText(t.text),
      })),
    };
  }

  // Per-base eligibility: walk rolls_on edges into each base. The edge's
  // props.tiers (allowed indices, standard/corrupted) is preserved as `t`;
  // absent => all tiers eligible. Tier order here matches families[].tiers
  // (both sorted ascending by level), so the indices line up.
  const bases = {};
  for (const base of nodesByKind('base')) {
    const refs = [];
    for (const e of edgesTo(base.id, 'rolls_on')) {
      const affix = affixById.get(e.from);
      if (!affix) continue; // desecrated / dropped origins
      const ref = { a: affix.slug };
      if (Array.isArray(e.props?.tiers)) ref.t = [...e.props.tiers].sort((x, y) => x - y);
      refs.push(ref);
    }
    if (refs.length) bases[base.slug] = refs;
  }

  // Unique -> base slug, so the picker can find a unique's corrupted pool.
  const uniques = {};
  for (const u of nodesByKind('unique')) {
    const be = edgesFrom(u.id, 'has_base')[0];
    const base = be && getNode(be.to);
    if (base) uniques[u.slug] = base.slug;
  }

  return { families, bases, uniques };
}
```

- [ ] **Step 4: Run to verify pass** — `node --test test/mod-pools.test.js` → PASS.

- [ ] **Step 5: Wire into `scripts/build-index.js`** — add the import after line 24:

```js
import { modPools } from '../src/data/modPools.js';
```

  and after the `planner-data.json` write (line 76) add:

```js
const modpools = modPools();
fs.writeFileSync(path.join(OUT, 'mod-pools.json'), JSON.stringify(modpools));
```

  and extend the closing `console.log` summary to include ` / ${Object.keys(modpools.families).length} affix families`.

- [ ] **Step 6: Regenerate + sanity-check size** — run:

```bash
npm run build:index && node -e "const z=require('zlib'),fs=require('fs');const b=fs.readFileSync('public/generated/mod-pools.json');console.log('raw',(b.length/1e6).toFixed(2),'MB gzip',(z.gzipSync(b).length/1e6).toFixed(2),'MB')"
```

Expected: `raw ~2.3 MB gzip ~0.10 MB` (well under the 1 MB gzip budget).

- [ ] **Step 7: Commit**

```bash
git add src/data/modPools.js scripts/build-index.js test/mod-pools.test.js
git commit -m "feat(planner): project mod-pools.json (affix families + per-base eligibility)"
```

---

### Task 2: pure mod-core (pool resolution, mod resolution, legality)

**Files:**
- Create: `public/js/mod-core.js`
- Test: `test/mod-core.test.js`

**Interfaces:**
- Consumes: a parsed `mod-pools.json` object (`pools`), a build (schema v2), an item ref `{kind, slug}`.
- Produces (all pure, no DOM/window):
  - `poolsForBase(pools, baseSlug) -> { prefix: Fam[], suffix: Fam[], corrupted: Fam[] }` where
    `Fam = { affix, name, generic, gen, tiers: Tier[] }` and `Tier = { id, name, level, gen, text }`,
    tiers narrowed to the base's allowed indices, families sorted by `name`.
  - `corruptedForRef(pools, ref) -> Fam[]` — corrupted implicit pool for a base ref (its own base slug) or a unique ref (via `pools.uniques`).
  - `resolveMod(pools, { affix, tier }) -> Tier & { affix, name } | null` — a chosen mod ref to renderable data.
  - `MAX_PREFIX = 3`, `MAX_SUFFIX = 3`, `MAX_MODS = 6`.
  - `modViolations(cell, pools) -> Violation[]` for one gear cell — `{ code, message }`; codes `prefix-overflow`, `suffix-overflow`, `mods-overflow`, `illegal-mod`, `duplicate-mod`.

- [ ] **Step 1: Write the failing test** — `test/mod-core.test.js`:

```js
// test/mod-core.test.js — pure pool/mod resolution + legality warnings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  poolsForBase, corruptedForRef, resolveMod, modViolations,
  MAX_PREFIX, MAX_SUFFIX,
} from '../public/js/mod-core.js';

// A tiny hand-built pools fixture — decoupled from the real artifact.
const POOLS = {
  families: {
    life: { name: 'to maximum Life', origin: 'standard', scope: 'equipment', generic: '# to maximum Life',
      tiers: [
        { id: 'life1', name: 'Hale', level: 1, gen: 'prefix', text: '+(10-19) to maximum Life' },
        { id: 'life2', name: 'Healthy', level: 20, gen: 'prefix', text: '+(40-49) to maximum Life' },
      ] },
    armour: { name: 'increased Armour', origin: 'standard', scope: 'equipment', generic: '#% increased Armour',
      tiers: [{ id: 'arm1', name: 'Rusted', level: 1, gen: 'prefix', text: '(10-19)% increased Armour' }] },
    fireres: { name: 'to Fire Resistance', origin: 'standard', scope: 'equipment', generic: '#% to Fire Resistance',
      tiers: [{ id: 'fr1', name: 'of the Cinder', level: 6, gen: 'suffix', text: '+(6-11)% to Fire Resistance' }] },
    corrarm: { name: 'increased Armour', origin: 'corrupted', scope: 'equipment', generic: '#% increased Armour',
      tiers: [{ id: 'carm1', name: 'Corrupted', level: 1, gen: 'corrupted', text: '(15-25)% increased Armour' }] },
  },
  bases: {
    'iron-greaves': [
      { a: 'life', t: [0, 1] }, { a: 'armour' }, { a: 'fireres' }, { a: 'corrarm' },
    ],
    'plated-boots': [{ a: 'life', t: [0] }],
  },
  uniques: { 'the-anvil': 'iron-greaves' },
};

test('poolsForBase: partitions prefix/suffix/corrupted, narrows tiers', () => {
  const p = poolsForBase(POOLS, 'iron-greaves');
  assert.deepEqual(p.prefix.map((f) => f.affix).sort(), ['armour', 'life']);
  assert.deepEqual(p.suffix.map((f) => f.affix), ['fireres']);
  assert.deepEqual(p.corrupted.map((f) => f.affix), ['corrarm']);
  const life = p.prefix.find((f) => f.affix === 'life');
  assert.equal(life.tiers.length, 2);
  const boots = poolsForBase(POOLS, 'plated-boots');
  assert.equal(boots.prefix.find((f) => f.affix === 'life').tiers.length, 1, 'narrowed to allowed index');
});

test('corruptedForRef: base uses own slug, unique resolves via uniques map', () => {
  assert.deepEqual(corruptedForRef(POOLS, { kind: 'base', slug: 'iron-greaves' }).map((f) => f.affix), ['corrarm']);
  assert.deepEqual(corruptedForRef(POOLS, { kind: 'unique', slug: 'the-anvil' }).map((f) => f.affix), ['corrarm']);
  assert.deepEqual(corruptedForRef(POOLS, { kind: 'unique', slug: 'nope' }), []);
});

test('resolveMod: returns renderable tier data or null', () => {
  const m = resolveMod(POOLS, { affix: 'life', tier: 'life2' });
  assert.equal(m.name, 'to maximum Life');
  assert.equal(m.text, '+(40-49) to maximum Life');
  assert.equal(m.gen, 'prefix');
  assert.equal(resolveMod(POOLS, { affix: 'life', tier: 'ghost' }), null);
  assert.equal(resolveMod(POOLS, { affix: 'ghost', tier: 'x' }), null);
});

test('modViolations: warns on prefix overflow but never throws', () => {
  const cell = { item: { kind: 'base', slug: 'iron-greaves' }, mods: [
    { affix: 'life', tier: 'life1' }, { affix: 'armour', tier: 'arm1' },
    { affix: 'life', tier: 'life2' }, { affix: 'life', tier: 'life1' },
  ], corrupted: null };
  const v = modViolations(cell, POOLS);
  assert.ok(v.some((x) => x.code === 'prefix-overflow'), 'four prefixes overflow 3');
  assert.ok(v.some((x) => x.code === 'duplicate-mod'), 'repeated affix flagged');
  assert.doesNotThrow(() => modViolations({}, POOLS));
  assert.doesNotThrow(() => modViolations(null, null));
});

test('modViolations: illegal mod for the base', () => {
  const cell = { item: { kind: 'base', slug: 'plated-boots' }, mods: [{ affix: 'fireres', tier: 'fr1' }], corrupted: null };
  assert.ok(modViolations(cell, POOLS).some((x) => x.code === 'illegal-mod'));
});

test('exports: prefix/suffix caps are 3', () => {
  assert.equal(MAX_PREFIX, 3);
  assert.equal(MAX_SUFFIX, 3);
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/mod-core.test.js` → FAIL.

- [ ] **Step 3: Implement `public/js/mod-core.js`**:

```js
// public/js/mod-core.js
//
// Pure resolution + legality core for the Build Planner mod picker. No DOM/
// window imports — importable by node:test (relative path) and by the browser
// at /static/js/mod-core.js. Operates on a parsed mod-pools.json object and a
// schema-v2 build; returns pool views, resolved mods, and warning lists. Never
// throws on malformed input (mirrors build-rules.js philosophy).

export const MAX_PREFIX = 3;
export const MAX_SUFFIX = 3;
export const MAX_MODS = 6;

// One family view for the picker: tiers narrowed to a base's allowed indices.
function familyView(pools, ref) {
  const fam = pools.families?.[ref.a];
  if (!fam) return null;
  const allow = ref.t ? new Set(ref.t) : null;
  const tiers = fam.tiers.filter((_, i) => !allow || allow.has(i));
  if (!tiers.length) return null;
  return { affix: ref.a, name: fam.name, generic: fam.generic, gen: fam.origin === 'corrupted' ? 'corrupted' : null, tiers };
}

/** { prefix, suffix, corrupted } family views legal on a base slug. */
export function poolsForBase(pools, baseSlug) {
  const out = { prefix: [], suffix: [], corrupted: [] };
  const refs = pools?.bases?.[baseSlug] ?? [];
  for (const ref of refs) {
    const fam = pools.families?.[ref.a];
    if (!fam) continue;
    const view = familyView(pools, ref);
    if (!view) continue;
    if (fam.origin === 'corrupted') { out.corrupted.push(view); continue; }
    // A standard family lands in prefix and/or suffix by its tiers' gen.
    for (const bucket of ['prefix', 'suffix']) {
      const tiers = view.tiers.filter((t) => t.gen === bucket);
      if (tiers.length) out[bucket].push({ ...view, gen: bucket, tiers });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  out.prefix.sort(byName); out.suffix.sort(byName); out.corrupted.sort(byName);
  return out;
}

/** Corrupted-implicit family views for a base or unique ref. */
export function corruptedForRef(pools, ref) {
  if (!ref) return [];
  const baseSlug = ref.kind === 'unique' ? pools?.uniques?.[ref.slug] : ref.slug;
  if (!baseSlug) return [];
  return poolsForBase(pools, baseSlug).corrupted;
}

/** A chosen { affix, tier } to renderable data, or null if it no longer resolves. */
export function resolveMod(pools, chosen) {
  if (!chosen) return null;
  const fam = pools?.families?.[chosen.affix];
  const tier = fam?.tiers.find((t) => t.id === chosen.tier);
  if (!fam || !tier) return null;
  return { affix: chosen.affix, name: fam.name, id: tier.id, level: tier.level, gen: tier.gen, text: tier.text };
}

// Which prefix/suffix bucket a chosen standard mod occupies (its resolved tier's gen).
function bucketOf(pools, chosen) {
  return resolveMod(pools, chosen)?.gen ?? null;
}

/** Warnings for one gear cell's chosen mods. Never throws. */
export function modViolations(cell, pools) {
  const out = [];
  const mods = Array.isArray(cell?.mods) ? cell.mods : [];
  const baseSlug = cell?.item?.slug;
  const legal = new Set((pools?.bases?.[baseSlug] ?? []).map((r) => r.a));

  let prefixes = 0, suffixes = 0;
  const seen = new Set();
  for (const m of mods) {
    if (m?.affix && legal.size && !legal.has(m.affix)) {
      out.push({ code: 'illegal-mod', message: `${m.affix} cannot roll on this base` });
    }
    if (m?.affix) {
      if (seen.has(m.affix)) out.push({ code: 'duplicate-mod', message: `${m.affix} is chosen more than once` });
      else seen.add(m.affix);
    }
    const b = bucketOf(pools, m);
    if (b === 'prefix') prefixes++;
    else if (b === 'suffix') suffixes++;
  }
  if (prefixes > MAX_PREFIX) out.push({ code: 'prefix-overflow', message: `${prefixes} prefixes exceed ${MAX_PREFIX}` });
  if (suffixes > MAX_SUFFIX) out.push({ code: 'suffix-overflow', message: `${suffixes} suffixes exceed ${MAX_SUFFIX}` });
  if (mods.length > MAX_MODS) out.push({ code: 'mods-overflow', message: `${mods.length} mods exceed ${MAX_MODS}` });
  return out;
}
```

- [ ] **Step 4: Run to verify pass** — `node --test test/mod-core.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add public/js/mod-core.js test/mod-core.test.js
git commit -m "feat(planner): pure mod-core — pool resolution, mod resolution, legality warnings"
```

---

### Task 3: schema v2 — `mods`/`corrupted` cells + v1→v2 migration

**Files:**
- Modify: `public/js/build-store.js`
- Test: `test/build-store.test.js`

**Interfaces:**
- Produces: `SCHEMA_VERSION = 2`; `emptyBuild()` unchanged top-level (gear cells are created on equip, not up front). A gear cell is now `{ item, mods: [{affix, tier}], corrupted: {affix, tier?}|null }` (the `wishlist` array is gone). `validateBuild` accepts the v2 cell shape AND legacy cells (`wishlist` present, or `mods`/`corrupted` absent) — forward/backward compatible so old share codes still decode. `MIGRATIONS[1]` converts every gear cell: drop `wishlist`, ensure `mods: []` and `corrupted: null`, bump `schema` to 2.

- [ ] **Step 1: Write the failing tests** — in `test/build-store.test.js` add (and update any existing assertion that expects `wishlist` in a fresh/created cell — search the file for `wishlist` and replace those expectations with `mods`/`corrupted`):

```js
test('SCHEMA_VERSION is 2', () => {
  assert.equal(SCHEMA_VERSION, 2);
});

test('validateBuild: v2 gear cell with mods + corrupted', () => {
  const b = emptyBuild({ now: () => 1, uuid: () => 'x' });
  b.gear.helmet = { item: { kind: 'base', slug: 'iron-hat' }, mods: [{ affix: 'life', tier: 'life1' }], corrupted: null };
  b.gear.body = { item: { kind: 'unique', slug: 'the-x' }, mods: [], corrupted: { affix: 'corrarm', tier: 'carm1' } };
  assert.equal(validateBuild(b).ok, true, JSON.stringify(validateBuild(b).errors));
});

test('validateBuild: legacy wishlist cell still validates (old share codes)', () => {
  const b = emptyBuild({ now: () => 1, uuid: () => 'x' });
  b.gear.helmet = { item: { kind: 'base', slug: 'iron-hat' }, wishlist: [] };
  assert.equal(validateBuild(b).ok, true);
});

test('validateBuild: rejects malformed mods / corrupted', () => {
  const b = emptyBuild({ now: () => 1, uuid: () => 'x' });
  b.gear.helmet = { item: null, mods: [{ affix: 5 }], corrupted: null };
  assert.equal(validateBuild(b).ok, false);
  const b2 = emptyBuild({ now: () => 1, uuid: () => 'x' });
  b2.gear.body = { item: null, mods: [], corrupted: { tier: 'x' } }; // no affix
  assert.equal(validateBuild(b2).ok, false);
});

test('migrate v1->v2: wishlist cells become mods/corrupted cells on read', () => {
  const v1 = {
    ...emptyBuild({ now: () => 1, uuid: () => 'x' }),
    schema: 1,
    gear: { helmet: { item: { kind: 'base', slug: 'iron-hat' }, wishlist: ['life'] } },
  };
  const storage = new Map();
  const store = createStore(memStorage(storage), { now: () => 2, uuid: () => 'y' });
  storage.set(STORE_KEY, JSON.stringify({ order: ['b'], builds: { b: { ...v1, id: 'b' } } }));
  const got = store.get('b');
  assert.equal(got.schema, 2);
  assert.deepEqual(got.gear.helmet.mods, []);
  assert.equal(got.gear.helmet.corrupted, null);
  assert.ok(!('wishlist' in got.gear.helmet));
});
```

  If `test/build-store.test.js` has no `memStorage`/`createStore`/`STORE_KEY` import helper, reuse whatever the existing migration/store tests in that file use (they already exercise `createStore`); match their storage-stub style rather than introducing `memStorage` if a different helper name is already present.

- [ ] **Step 2: Run to verify failure** — `node --test test/build-store.test.js` → FAIL (`SCHEMA_VERSION` is 1; validation/migration missing).

- [ ] **Step 3: Implement** in `public/js/build-store.js`:
  - Change `export const SCHEMA_VERSION = 1;` → `export const SCHEMA_VERSION = 2;`
  - Replace the gear-cell validation block (the `for (const [slot, g] of Object.entries(b.gear))` body, currently checking `g.wishlist`) with:

```js
    for (const [slot, g] of Object.entries(b.gear)) {
      if (!isObj(g)) { errors.push(`gear.${slot}: expected object`); continue; }
      if (g.item !== null && g.item !== undefined) checkItemRef(g.item, `gear.${slot}.item`, errors);
      // v2 cells carry `mods` (base explicits) and `corrupted` (unique implicit).
      // Legacy cells (`wishlist`) and cells missing these keys stay valid for
      // forward/backward-compatible decode of old share codes.
      if (g.mods !== undefined) {
        if (!Array.isArray(g.mods)) errors.push(`gear.${slot}.mods: expected array`);
        else g.mods.forEach((m, i) => {
          if (!isObj(m) || !isStr(m.affix)) errors.push(`gear.${slot}.mods[${i}].affix: expected string`);
          else if (m.tier !== undefined && !isStr(m.tier) && !isNum(m.tier)) errors.push(`gear.${slot}.mods[${i}].tier: expected string/number`);
        });
      }
      if (g.corrupted !== undefined && g.corrupted !== null) {
        if (!isObj(g.corrupted) || !isStr(g.corrupted.affix)) errors.push(`gear.${slot}.corrupted.affix: expected string`);
        else if (g.corrupted.tier !== undefined && !isStr(g.corrupted.tier) && !isNum(g.corrupted.tier)) errors.push(`gear.${slot}.corrupted.tier: expected string/number`);
      }
      if (g.wishlist !== undefined && (!Array.isArray(g.wishlist) || g.wishlist.some((w) => !isStr(w)))) {
        errors.push(`gear.${slot}.wishlist: expected string[]`);
      }
    }
```

  - Register the v1→v2 migration (replace the empty `const MIGRATIONS = {};`):

```js
// Schema migrations, keyed by from-version. v1->v2: the per-slot affix
// "wishlist" became real chosen mods; convert cells to the {mods, corrupted}
// shape (wishlists were never written by a shipped UI, so they drop cleanly).
const MIGRATIONS = {
  1: (build) => ({
    ...build,
    schema: 2,
    gear: Object.fromEntries(Object.entries(build.gear ?? {}).map(([slot, g]) => {
      const { wishlist, ...rest } = g ?? {};
      return [slot, { item: rest.item ?? null, mods: rest.mods ?? [], corrupted: rest.corrupted ?? null }];
    })),
  }),
};
```

- [ ] **Step 4: Run to verify pass** — `node --test test/build-store.test.js` → PASS.

- [ ] **Step 5: Run the codec round-trip tests** — `node --test test/build-code.test.js` → PASS (canonical form passes `mods`/`corrupted` through; validation now accepts them). If a codec test hard-codes `schema: 1`, update it to `SCHEMA_VERSION`.

- [ ] **Step 6: Commit**

```bash
git add public/js/build-store.js test/build-store.test.js
git commit -m "feat(planner): schema v2 — chosen mods/corrupted cells + v1->v2 migration"
```

---

### Task 4: mod-picker popover (anchored) + pure HTML builder

**Files:**
- Create: `public/js/mod-picker.js`
- Modify: `public/js/mod-core.js` (add pure `modPickerHtml`)
- Test: `test/mod-core.test.js`

**Interfaces:**
- Consumes: `poolsForBase`/`corruptedForRef`/`resolveMod` (Task 2), a build cell, an item ref.
- Produces:
  - `mod-core.js` gains `export function modPickerHtml(view, cell) -> string` — the popover's inner HTML: a search input, a prefix column (`data-mod-add="<affix>"` rows, count `n/3`), a suffix column, a corrupted section (uniques only when `view.corrupted` is the sole populated bucket), and a "chosen" list with per-mod `<select data-mod-tier="<affix>">` tier dropdowns and `data-mod-remove="<affix>"`. Pure string builder (escapes via `esc`). `view` is `{ prefix, suffix, corrupted, mode: 'base'|'unique' }`.
  - `mod-picker.js` exports `openModPicker({ anchorEl, ref, cell, pools, onChange })` and `closeModPicker()` — anchored popover DOM glue (positions near `anchorEl`, filters rows on input, calls `onChange(nextCell)` on every add/remove/tier change). DOM glue is not node-tested (matches `entity-picker.js` precedent); the HTML/selection logic it uses lives in the tested `mod-core.js`.

- [ ] **Step 1: Write the failing test** — append to `test/mod-core.test.js`:

```js
import { modPickerHtml } from '../public/js/mod-core.js';

test('modPickerHtml: base mode renders prefix/suffix add rows + chosen tier selects', () => {
  const view = { ...poolsForBase(POOLS, 'iron-greaves'), mode: 'base' };
  const cell = { item: { kind: 'base', slug: 'iron-greaves' }, mods: [{ affix: 'life', tier: 'life1' }], corrupted: null };
  const html = modPickerHtml(view, cell);
  assert.match(html, /data-mod-add="armour"/);
  assert.match(html, /data-mod-add="fireres"/);
  assert.match(html, /data-mod-remove="life"/);
  assert.match(html, /data-mod-tier="life"/);
  assert.match(html, /life2/);                 // both tiers offered in the select
  assert.match(html, /Prefixes/); assert.match(html, /Suffixes/);
});

test('modPickerHtml: unique mode renders only the corrupted single-choice section', () => {
  const view = { prefix: [], suffix: [], corrupted: poolsForBase(POOLS, 'iron-greaves').corrupted, mode: 'unique' };
  const cell = { item: { kind: 'unique', slug: 'the-anvil' }, mods: [], corrupted: null };
  const html = modPickerHtml(view, cell);
  assert.match(html, /data-mod-add="corrarm"/);
  assert.ok(!/Prefixes/.test(html), 'no prefix column for a unique corrupted picker');
});
```

- [ ] **Step 2: Run to verify failure** — `node --test test/mod-core.test.js` → FAIL (`modPickerHtml` undefined).

- [ ] **Step 3: Implement `modPickerHtml` in `public/js/mod-core.js`** (add near the top an escape helper import is not available in a pure core, so inline a minimal escaper):

```js
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function tierSelect(affix, fam, chosenTierId) {
  const opts = fam.tiers.map((t) =>
    `<option value="${esc(t.id)}"${t.id === chosenTierId ? ' selected' : ''}>` +
    `T${fam.tiers.length - fam.tiers.indexOf(t)} · ${esc(t.text)}</option>`).join('');
  return `<select class="mod-picker__tier" data-mod-tier="${esc(affix)}">${opts}</select>`;
}

function addRows(fams, chosenAffixes) {
  return fams.map((f) => {
    const on = chosenAffixes.has(f.affix);
    return `<button type="button" class="mod-picker__row${on ? ' is-chosen' : ''}" data-mod-add="${esc(f.affix)}">` +
      `<span class="mod-picker__generic">${esc(f.generic)}</span></button>`;
  }).join('');
}

/** Popover inner HTML. `view` = { prefix, suffix, corrupted, mode }. */
export function modPickerHtml(view, cell) {
  const mods = Array.isArray(cell?.mods) ? cell.mods : [];
  const chosen = new Set(mods.map((m) => m.affix));
  const famByAffix = new Map(
    [...view.prefix, ...view.suffix, ...view.corrupted].map((f) => [f.affix, f]));

  const chosenList = mods.map((m) => {
    const fam = famByAffix.get(m.affix);
    if (!fam) return '';
    return `<li class="mod-picker__chosen-row">` +
      `<span class="mod-picker__generic">${esc(fam.name)}</span>` +
      `${tierSelect(m.affix, fam, m.tier)}` +
      `<button type="button" class="mod-picker__remove" data-mod-remove="${esc(m.affix)}" aria-label="Remove">×</button></li>`;
  }).join('');

  if (view.mode === 'unique') {
    const cur = cell?.corrupted?.affix ?? null;
    return `<div class="mod-picker" data-mod-picker>` +
      `<header class="mod-picker__head"><h3>Corrupted implicit</h3>` +
      `<button type="button" class="mod-picker__close" data-mod-close aria-label="Close">×</button></header>` +
      `<div class="mod-picker__col"><h4>Vaal implicit</h4>` +
      `${view.corrupted.map((f) => `<button type="button" class="mod-picker__row${f.affix === cur ? ' is-chosen' : ''}" data-mod-add="${esc(f.affix)}"><span class="mod-picker__generic">${esc(f.generic)}</span></button>`).join('') || '<p class="mod-picker__none">No corrupted implicits on this base.</p>'}</div>` +
      `${cur ? `<div class="mod-picker__chosen"><h4>Chosen</h4>${tierSelect(cur, famByAffix.get(cur), cell.corrupted.tier)}<button type="button" class="mod-picker__remove" data-mod-remove="${esc(cur)}" aria-label="Remove">×</button></div>` : ''}` +
      `</div>`;
  }

  return `<div class="mod-picker" data-mod-picker>` +
    `<header class="mod-picker__head"><h3>Modifiers</h3>` +
    `<input class="mod-picker__search" type="search" placeholder="Filter modifiers…" autocomplete="off">` +
    `<button type="button" class="mod-picker__close" data-mod-close aria-label="Close">×</button></header>` +
    `<div class="mod-picker__cols">` +
      `<div class="mod-picker__col"><h4>Prefixes <span>${view.prefix.filter((f) => chosen.has(f.affix)).length}/${MAX_PREFIX}</span></h4>${addRows(view.prefix, chosen)}</div>` +
      `<div class="mod-picker__col"><h4>Suffixes <span>${view.suffix.filter((f) => chosen.has(f.affix)).length}/${MAX_SUFFIX}</span></h4>${addRows(view.suffix, chosen)}</div>` +
    `</div>` +
    `<ul class="mod-picker__chosen">${chosenList}</ul>` +
    `</div>`;
}
```

- [ ] **Step 4: Run to verify pass** — `node --test test/mod-core.test.js` → PASS.

- [ ] **Step 5: Implement DOM glue `public/js/mod-picker.js`** (anchored popover; follows `entity-picker.js` structure):

```js
// public/js/mod-picker.js
// Anchored popover for choosing a gear slot's modifiers. Selection/HTML logic
// lives in the pure mod-core (node-tested); this file is DOM glue only.
import { poolsForBase, corruptedForRef, modPickerHtml, resolveMod } from '/static/js/mod-core.js';

let current = null;
export function closeModPicker() {
  current?.el.remove();
  if (current) document.removeEventListener('keydown', current.onKey);
  current = null;
}

function viewFor(ref, pools) {
  if (ref.kind === 'unique') return { prefix: [], suffix: [], corrupted: corruptedForRef(pools, ref), mode: 'unique' };
  const p = poolsForBase(pools, ref.slug);
  return { ...p, mode: 'base' };
}

// First tier id offered for a freshly added affix (top/highest available tier).
function defaultTier(view, affix) {
  const fam = [...view.prefix, ...view.suffix, ...view.corrupted].find((f) => f.affix === affix);
  return fam?.tiers[fam.tiers.length - 1]?.id ?? null;
}

export function openModPicker({ anchorEl, ref, cell, pools, onChange }) {
  closeModPicker();
  const view = viewFor(ref, pools);
  const el = document.createElement('div');
  el.className = 'mod-picker-pop';
  const onKey = (e) => { if (e.key === 'Escape') closeModPicker(); };
  current = { el, onKey, cell };
  document.addEventListener('keydown', onKey);

  const rerender = () => { el.innerHTML = modPickerHtml(view, current.cell); position(); };
  const emit = (next) => { current.cell = next; onChange(next); rerender(); };

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-mod-close]')) { closeModPicker(); return; }
    const add = e.target.closest('[data-mod-add]')?.getAttribute('data-mod-add');
    if (add) {
      const c = current.cell;
      if (ref.kind === 'unique') { emit({ ...c, corrupted: { affix: add, tier: defaultTier(view, add) } }); return; }
      if ((c.mods ?? []).some((m) => m.affix === add)) return;   // one row per family
      emit({ ...c, mods: [...(c.mods ?? []), { affix: add, tier: defaultTier(view, add) }] });
      return;
    }
    const rm = e.target.closest('[data-mod-remove]')?.getAttribute('data-mod-remove');
    if (rm) {
      const c = current.cell;
      if (ref.kind === 'unique') emit({ ...c, corrupted: null });
      else emit({ ...c, mods: (c.mods ?? []).filter((m) => m.affix !== rm) });
    }
  });
  el.addEventListener('change', (e) => {
    const affix = e.target.closest('[data-mod-tier]')?.getAttribute('data-mod-tier');
    if (!affix) return;
    const c = current.cell;
    if (ref.kind === 'unique') emit({ ...c, corrupted: { affix, tier: e.target.value } });
    else emit({ ...c, mods: (c.mods ?? []).map((m) => (m.affix === affix ? { ...m, tier: e.target.value } : m)) });
  });
  el.addEventListener('input', (e) => {
    if (!e.target.matches('.mod-picker__search')) return;
    const q = e.target.value.trim().toLowerCase();
    el.querySelectorAll('.mod-picker__col .mod-picker__row').forEach((row) => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  function position() {
    const r = anchorEl.getBoundingClientRect();
    el.style.top = `${window.scrollY + r.bottom + 6}px`;
    el.style.left = `${Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - 360)}px`;
  }
  document.body.append(el);
  rerender();
  el.querySelector('.mod-picker__search')?.focus();
}
```

- [ ] **Step 6: Commit**

```bash
git add public/js/mod-picker.js public/js/mod-core.js test/mod-core.test.js
git commit -m "feat(planner): anchored mod-picker popover + pure modPickerHtml builder"
```

---

### Task 5: well mods affordance + chosen-mod hover-card block

**Files:**
- Modify: `public/js/editor-render.js`
- Test: `test/editorRender.test.js`

**Interfaces:**
- Consumes: `resolveMod` from `./mod-core.js`, the build cell.
- Produces:
  - `export function modCardLines(cell, pools) -> string` — the `.explicitMod`/implicit HTML block (poe2db class names) for a cell's chosen mods (each standard mod a `.explicitMod` line; a corrupted implicit an `.implicitMod` line with a `.separator`). Empty string when nothing chosen.
  - `renderGear` filled wells gain a `data-slot-mods="<slotId>"` attribute on the well element and a `.editor-slot__mods` indicator (a small "N mods" / "corrupted" pill) when the cell has chosen mods, plus a `data-mods-edit="<slotId>"` affordance button (edit mode only) that opens the picker. The static `data-card-url` moves OFF the filled `.editor-item` art (Task 6 supplies the build-aware hover instead); empty/ghost wells are unchanged.

- [ ] **Step 1: Write the failing tests** — in `test/editorRender.test.js` add (import `modCardLines` and a pools fixture mirroring Task 2's `POOLS`, or import from a shared fixture if the file already has one):

```js
import { modCardLines } from '../public/js/editor-render.js';

const MODPOOLS = {
  families: {
    life: { name: 'to maximum Life', origin: 'standard', scope: 'equipment', generic: '# to maximum Life',
      tiers: [{ id: 'life1', name: 'Hale', level: 1, gen: 'prefix', text: '+(10-19) to maximum Life' }] },
    corrarm: { name: 'increased Armour', origin: 'corrupted', scope: 'equipment', generic: '#% increased Armour',
      tiers: [{ id: 'carm1', name: 'Corrupted', level: 1, gen: 'corrupted', text: '(15-25)% increased Armour' }] },
  }, bases: {}, uniques: {},
};

test('modCardLines: explicit + corrupted lines, empty when nothing chosen', () => {
  assert.equal(modCardLines({ mods: [], corrupted: null }, MODPOOLS), '');
  const html = modCardLines({ mods: [{ affix: 'life', tier: 'life1' }], corrupted: { affix: 'corrarm', tier: 'carm1' } }, MODPOOLS);
  assert.match(html, /explicitMod/);
  assert.ok(html.includes('+(10-19) to maximum Life'));
  assert.match(html, /implicitMod|separator/);
  assert.ok(html.includes('(15-25)% increased Armour'));
});

test('renderGear: a filled well exposes data-slot-mods and a mods-edit affordance', () => {
  const b = fixed();  // reuse the file's fixture builder; ensure a filled gear slot
  b.gear.helmet = { item: { kind: 'base', slug: 'iron-hat' }, mods: [{ affix: 'life', tier: 'life1' }], corrupted: null };
  const html = renderGear(b, ctx);
  assert.match(html, /data-slot-mods="helmet"/);
  assert.match(html, /data-mods-edit="helmet"/);
});
```

  (If the existing `ctx`/`fixed()` helpers don't include a filled `helmet`, set it inline as above. Reuse the file's existing `resolveRef` stub in `ctx`.)

- [ ] **Step 2: Run to verify failure** — `node --test test/editorRender.test.js` → FAIL.

- [ ] **Step 3: Implement in `public/js/editor-render.js`:**
  - Add import: `import { resolveMod } from './mod-core.js';`
  - Add the helper (near `wellArt`):

```js
/** poe2db-styled chosen-mod block for a gear cell's hover card. Empty when none. */
export function modCardLines(cell, pools) {
  const mods = Array.isArray(cell?.mods) ? cell.mods : [];
  const explicit = mods.map((m) => resolveMod(pools, m)).filter(Boolean)
    .map((m) => `<div class="explicitMod">${esc(m.text)}</div>`).join('');
  const corr = cell?.corrupted ? resolveMod(pools, cell.corrupted) : null;
  const corrHtml = corr ? `<div class="separator"></div><div class="implicitMod">${esc(corr.text)}</div>` : '';
  if (!explicit && !corrHtml) return '';
  return `<div class="Stats editor-mod-lines">${explicit}${corrHtml}</div>`;
}
```

  - In `renderGear`, `ctx` now includes `pools` (passed by the controller). For a filled well, compute a chosen-mod count and change the well markup:
    - The `.editor-slot` (outer `<div>`) gains `data-slot-mods="${esc(s.id)}"` when `g?.item` (so the Task-6 tooltip can target it).
    - Replace `wellArt(g.item, resolveRef)` in the filled branch with `wellArt(g.item, resolveRef)` **without** its `data-card-url` (see Task 6 note) **plus** an indicator + edit affordance:

```js
      const cell = g;
      const nMods = (cell.mods?.length ?? 0) + (cell.corrupted ? 1 : 0);
      const indicator = nMods ? `<span class="editor-slot__mods">${nMods} mod${nMods === 1 ? '' : 's'}</span>` : '';
      const modsBtn = ro ? '' : `<button class="editor-slot__mods-edit" type="button" data-mods-edit="${esc(s.id)}" aria-label="Choose modifiers for ${esc(s.name)}">✎ mods</button>`;
      body = wellArt(g.item, resolveRef) + indicator + modsBtn +
        (ro ? '' : `<button class="editor-slot__clear" ... >×</button>`);   // keep existing clear button
```

    Keep the existing clear-button markup exactly; only add `indicator` and `modsBtn`.

- [ ] **Step 4: Run to verify pass** — `node --test test/editorRender.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add public/js/editor-render.js test/editorRender.test.js
git commit -m "feat(planner): well mods indicator + affordance + chosen-mod card block"
```

---

### Task 6: build-aware hover card (Tippy transform + slot tooltip)

**Files:**
- Modify: `public/js/tooltips.js`
- Modify: `public/js/builds-page.js`
- Modify: `public/js/editor-render.js` (finalize: filled `.editor-item` art drops `data-card-url`)

**Interfaces:**
- Consumes: `modCardLines` (Task 5), `resolveRef`/`store`/`pools` (builds-page state).
- Produces:
  - `tooltips.js` `init(config)` accepts an optional `config.transform(html, reference) -> string`, applied to fetched-or-cached content **on every show** (so per-build content is never cached under the shared item URL). Default: identity. The fetched fragment is still cached by URL (unchanged); only the transform output varies.
  - `builds-page.js` initializes exactly one build-aware tooltip delegate targeting `[data-slot-mods]`, resolving the URL from the current build's item card and appending `modCardLines`. Filled wells thus show **one** tooltip (item card + chosen mods); empty wells keep the plain `data-card-url` card handled by the global `card-tooltip.js`.

- [ ] **Step 1: Implement the `transform` hook in `public/js/tooltips.js`** — in `init`, read it:

```js
    var transform = typeof config.transform === 'function' ? config.transform : null;
```

  and in `onShow`, wrap the two `setContent` paths so transform is applied on every show:

```js
        function apply(html) {
          instance.setContent(transform ? transform(html, instance.reference) : html);
        }
        if (cache.has(url)) { apply(cache.get(url)); return; }
        if (instance._poe2Loading) return;
        instance._poe2Loading = true;
        fetchFragment(url, cache, fallback)
          .then(function (result) { apply(result.html); })
          .finally(function () { instance._poe2Loading = false; });
```

  (Replace the existing `instance.setContent(cache.get(url))` / `instance.setContent(result.html)` calls with `apply(...)`. `fetchFragment` still caches the raw fragment; transform runs after.)

- [ ] **Step 2: Finalize `editor-render.js`** — in `wellArt`, only emit `data-card-url` when the well is **not** a build-aware slot. Simplest: drop `data-card-url` from `wellArt` entirely (the tray still uses `wellBody`, which keeps its own `data-card-url`; filled doll wells get the build-aware tooltip via `data-slot-mods` on the outer slot). Change `wellArt` to omit `card`:

```js
function wellArt(ref, resolveRef) {
  const doc = resolveRef(ref) || {};
  const name = doc.name || ref.slug;
  return `<span class="editor-item editor-item--art" aria-label="${esc(name)}" title="${esc(name)}">` +
    `${tile(doc, name, 'well-art')}</span>`;
}
```

- [ ] **Step 3: Initialize the slot tooltip in `public/js/builds-page.js`** — the module already has `store`, `resolveRef`, and (Task 7) `pools`. After the artifact loaders, add a one-time init guarded on `window.poe2Tooltips` and pools availability. Add near the top-level (after `loadPlanner`), a `loadPools()` mirroring `loadPlanner()` but for `/static/generated/mod-pools.json` into a module `pools` var. Then:

```js
  import { modCardLines } from '/static/js/editor-render.js';   // add to imports

  // One build-aware tooltip for filled doll wells: the item's prerendered card
  // + this build's chosen mods. Registered once; reads live build state on show.
  if (window.poe2Tooltips) {
    window.poe2Tooltips.init({
      target: '[data-slot-mods]',
      resolveUrl: function (ref) {
        const slotId = ref.getAttribute('data-slot-mods');
        const route = parseRoute(location.hash);
        const b = route.id ? store.get(route.id) : (importState?.state?.build ?? null);
        const item = b?.gear?.[slotId]?.item;
        return item ? (resolveRef(item)?.cardUrl ?? null) : null;
      },
      transform: function (html, ref) {
        if (!pools) return html;
        const slotId = ref.getAttribute('data-slot-mods');
        const route = parseRoute(location.hash);
        const b = route.id ? store.get(route.id) : (importState?.state?.build ?? null);
        const cell = b?.gear?.[slotId];
        return cell ? html + modCardLines(cell, pools) : html;
      },
    });
  }
```

  Ensure `loadPools()` is added to the `Promise.all([...])` in both the build-route mount and the import-route decode, and the resolved `pools` is stored in the module-scope `pools` var (so `transform` sees it).

- [ ] **Step 4: Run tests** — `npm test` → PASS (no node tests cover these DOM files; the renderer tests confirm the `data-slot-mods` hook and `modCardLines` output exist).

- [ ] **Step 5: Commit**

```bash
git add public/js/tooltips.js public/js/builds-page.js public/js/editor-render.js
git commit -m "feat(planner): build-aware well hover card (Tippy transform + slot tooltip)"
```

---

### Task 7: controller wiring — open picker, mutate cell, viewer display

**Files:**
- Modify: `public/js/build-editor.js`
- Modify: `public/js/builds-page.js` (pass `pools` into `mountEditor`)
- Modify: `public/js/builds-render.js` (read-only viewer lists chosen mods)
- Test: `test/buildsRender.test.js`

**Interfaces:**
- Consumes: `openModPicker`/`closeModPicker` (Task 4), `pools` (from builds-page), `resolveMod` (viewer).
- Produces: clicking `[data-mods-edit]` opens the anchored picker; `onChange(nextCell)` writes `gear[slotId] = nextCell` via `patch`; `equip()` writes the v2 cell shape `{ item, mods: [], corrupted: null }`. The read-only viewer (`renderBuild`) lists each equipped item's chosen mods as `.explicitMod` lines under the item.

- [ ] **Step 1: Update `equip()` and `equipViolations` cell shape** — in `build-editor.js` `equip()`, change:

```js
    gear[slotId] = { item: ref, mods: gear[slotId]?.mods ?? [], corrupted: gear[slotId]?.corrupted ?? null };
```

  and in `build-rules.js` `equipViolations`, change the throwaway cell `{ item: ref, wishlist: [] }` → `{ item: ref, mods: [], corrupted: null }` (functionally identical; keeps the shape consistent).

- [ ] **Step 2: Wire the picker in `build-editor.js`** — add import:

```js
import { openModPicker, closeModPicker } from '/static/js/mod-picker.js';
```

  In `onClick`, before the generic `[data-slot-id]` branch (so the ✎ button doesn't fall through to opening the item picker), add:

```js
    const modsEdit = e.target.closest('[data-mods-edit]');
    if (modsEdit) {
      e.stopPropagation();
      const slotId = modsEdit.getAttribute('data-mods-edit');
      const b = build();
      const cell = b.gear[slotId];
      if (!cell?.item || !pools) return;
      openModPicker({
        anchorEl: modsEdit, ref: cell.item, cell, pools,
        onChange: (next) => patch({ gear: { ...build().gear, [slotId]: next } }),
      });
      return;
    }
```

  Add `closeModPicker()` to the returned `unmount()`. Add `pools` to the `mountEditor` destructured options: `export function mountEditor(container, buildId, { store, planner, docs, resolveRef, pools })`.

- [ ] **Step 3: Pass `pools` from `builds-page.js`** — where the editor mounts (`mountEditor(view, route.id, { store, planner, docs: docsArray, resolveRef })`), add `pools`. Ensure `loadPools()` resolves before mount (add to the `Promise.all`).

- [ ] **Step 4: Write the failing viewer test** — in `test/buildsRender.test.js`:

```js
test('renderBuild: lists chosen mods under an equipped item', () => {
  const pools = { families: { life: { name: 'to maximum Life', origin: 'standard', tiers: [{ id: 'life1', gen: 'prefix', text: '+(40-49) to maximum Life' }] } }, bases: {}, uniques: {} };
  const b = emptyBuild({ now: () => 1, uuid: () => 'x' });
  b.gear.helmet = { item: { kind: 'base', slug: 'iron-hat' }, mods: [{ affix: 'life', tier: 'life1' }], corrupted: null };
  const html = renderBuild(b, () => ({ name: 'Iron Hat' }), pools);
  assert.ok(html.includes('+(40-49) to maximum Life'));
});
```

- [ ] **Step 5: Run to verify failure** — `node --test test/buildsRender.test.js` → FAIL (`renderBuild` ignores mods / arity).

- [ ] **Step 6: Implement in `public/js/builds-render.js`** — `renderBuild(b, resolveRef, pools)` gains a third arg; import `resolveMod` from `./mod-core.js`; in the gear `<li>` builder, append chosen-mod lines:

```js
  const modLines = (g) => {
    if (!pools) return '';
    const lines = (g.mods ?? []).map((m) => resolveMod(pools, m)).filter(Boolean).map((m) => m.text);
    const corr = g.corrupted ? resolveMod(pools, g.corrupted) : null;
    const all = [...lines, ...(corr ? [corr.text] : [])];
    return all.length ? `<ul class="builds-slot__mods">${all.map((t) => `<li class="explicitMod">${esc(t)}</li>`).join('')}</ul>` : '';
  };
```

  and include `${modLines(g)}` in the `builds-slot` `<li>`. Where `builds-page.js` / import view call `renderBuild(b, resolveRef)`, pass `pools` (a third arg; `undefined` degrades gracefully to no mod lines).

- [ ] **Step 7: Run to verify pass** — `node --test test/buildsRender.test.js` → PASS, then `npm test` → PASS.

- [ ] **Step 8: Commit**

```bash
git add public/js/build-editor.js public/js/build-rules.js public/js/builds-page.js public/js/builds-render.js test/buildsRender.test.js
git commit -m "feat(planner): wire mod picker into editor + viewer mod display"
```

---

### Task 8: CSS, visual check, roadmap tick, full verification

**Files:**
- Modify: `public/css/builds.css`
- Modify: `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md`

- [ ] **Step 1: Add styles to `public/css/builds.css`** — append (using `tokens.css` custom properties, matching the dossier idiom):

```css
/* ---- well mods indicator + affordance ---- */
.editor-slot__mods { font-size: 9px; letter-spacing: .08em; text-transform: uppercase;
  color: var(--color-crafted); }
.editor-slot__mods-edit { position: absolute; bottom: 4px; right: 4px; padding: 2px 6px; border: 0;
  border-radius: 4px; background: rgb(0 0 0 / .5); color: var(--color-default); font: 9px/1 var(--font-smallcaps);
  cursor: pointer; opacity: 0; transition: opacity 120ms ease; }
.editor-slot:hover .editor-slot__mods-edit, .editor-slot__mods-edit:focus-visible { opacity: 1; }
.editor-slot__mods-edit:hover { color: var(--color-crafted); }
.editor-mod-lines { margin-top: 6px; }

/* ---- anchored mod picker popover ---- */
.mod-picker-pop { position: absolute; z-index: 60; width: 340px; max-height: 70vh; overflow: auto;
  border: 1px solid color-mix(in srgb, var(--color-crafted) 40%, var(--border)); border-radius: 8px;
  background: var(--bg-surface); box-shadow: 0 18px 44px rgb(0 0 0 / .45); }
.mod-picker__head { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-bottom: 1px solid var(--border); }
.mod-picker__head h3 { margin: 0; font-size: 12px; color: var(--color-normal); }
.mod-picker__search { flex: 1; padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px;
  background: rgb(0 0 0 / .25); color: var(--text); font: 12px/1.4 var(--font-regular); }
.mod-picker__close { border: 0; background: none; color: var(--color-default); font-size: 15px; cursor: pointer; }
.mod-picker__cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 8px 10px; }
.mod-picker__col h4 { margin: 0 0 6px; font-size: 9px; letter-spacing: .12em; text-transform: uppercase;
  color: var(--color-default); display: flex; justify-content: space-between; }
.mod-picker__row { display: block; width: 100%; text-align: left; padding: 4px 6px; margin-bottom: 2px;
  border: 1px solid transparent; border-radius: 5px; background: none; color: var(--color-normal);
  font: 11px/1.3 var(--font-regular); cursor: pointer; }
.mod-picker__row:hover { border-color: color-mix(in srgb, var(--color-crafted) 45%, var(--border)); }
.mod-picker__row.is-chosen { color: var(--color-crafted); }
.mod-picker__chosen { list-style: none; margin: 0; padding: 8px 10px; border-top: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 5px; }
.mod-picker__chosen-row { display: flex; align-items: center; gap: 6px; }
.mod-picker__generic { flex: 1; font-size: 11px; color: var(--color-magic, var(--color-normal)); }
.mod-picker__tier { max-width: 60%; padding: 2px 4px; border: 1px solid var(--border); border-radius: 4px;
  background: rgb(0 0 0 / .25); color: var(--text); font: 10px/1.3 var(--font-regular); }
.mod-picker__remove { border: 0; background: none; color: var(--color-default); cursor: pointer; font-size: 13px; }
.mod-picker__none { margin: 0; font-size: 11px; color: var(--color-default); }
@media (prefers-reduced-motion: reduce) { .editor-slot__mods-edit { transition: none; } }
```

- [ ] **Step 2: Visual check** — `npm run dev`; open `http://localhost:3000/builds`; equip a base and a unique; on the base well click **✎ mods**, add a couple prefixes + a suffix, pick tiers, exceed 3 prefixes to confirm the Checks card warns (Task 5 indicator + Task 7 nothing blocks); on the unique well pick a corrupted implicit; hover both wells to confirm the **one** build-aware card shows the item + chosen mod lines; reload to confirm persistence. (Run `npm run build:images` once first if icons are placeholders.)

- [ ] **Step 3: Full verification** — `npm test` → all green (was 605; +new cases), then `npm run build:static` → crawler passes (no new client-fetched URL; `mod-pools.json` is a static artifact; the hover card reuses existing `…/card` URLs).

- [ ] **Step 4: Tick the roadmap** — in `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md`, change the Phase 4c checklist line to `- [x] Phase 4c — Item mod picker + mod-pools.json (incl. corrupted-implicit data verification) (<commit>)` and note the completing commit hash.

- [ ] **Step 5: Commit**

```bash
git add public/css/builds.css docs/superpowers/specs/2026-07-06-build-planner-roadmap.md
git commit -m "feat(planner): mod-picker + hover-card styles; tick Phase 4c roadmap"
```

---

## Self-Review

**Spec coverage (2026-07-21 amendments §1):**
- ✅ Base items pick 1–6 explicit mods from the legal pool, prefix/suffix legality (3+3), tier selection — Tasks 2 (`poolsForBase`, `modViolations`), 4 (picker), 7 (wiring). Warnings never block (Task 2 returns warnings; Checks card renders them; nothing rejects a write).
- ✅ Unique items pick one corrupted implicit — Tasks 2 (`corruptedForRef`), 4 (unique mode), 7.
- ✅ Schema v2 `mods: [{affix, tier}]` / `corrupted: {affix, tier?}` replacing `wishlist`, with v1→v2 migration — Task 3.
- ✅ New `public/generated/mod-pools.json` projected from `rolls_on` + affix `tiers`, planner-data.json pattern (src/data projection + generated artifact + node tests) — Task 1. Size measured 0.10 MB gzip ≤ 1 MB budget → single file, no shard.
- ✅ **Data verification first task:** corrupted-implicit pools confirmed in source/graph (Task 1's verification-gate test asserts ≥50 corrupted families reaching >500 bases); no `data/manual/` curation — recorded in Global Constraints.
- ✅ Downstream ripple — 4b's wishlist chip list → mod display (Task 5 indicator + Task 6 hover card + Task 7 viewer). Phase 7/8 ripples (tier midpoints, trade-filter keys) are out of this phase's scope and untouched.
- ✅ Reference-shape decision made at plan time: `affix`=slug, `tier`=tier id; base refs carry tier indices (Global Constraints + Task 1/2).
- ✅ Display surface (owner-confirmed): build-aware editor hover card, anchored-popover picker — Tasks 4, 6.

**Placeholder scan:** none — every code step carries full code; test fixtures are self-contained.

**Type consistency:** `Fam`/`Tier` shapes consistent across Tasks 2/4/5; `modPickerHtml(view, cell)` with `view.mode` used identically in Task 4 test, builder, and `mod-picker.js`; `modCardLines(cell, pools)` and `resolveMod(pools, chosen)` signatures match across Tasks 5/6/7; gear cell `{item, mods, corrupted}` consistent across Tasks 3/5/7 and the v1→v2 migration; `renderBuild(b, resolveRef, pools)` third-arg addition is backward-compatible (`undefined` → no mod lines).
