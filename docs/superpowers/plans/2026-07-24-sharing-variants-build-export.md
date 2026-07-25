# Phase 8 — Sharing, Variants & In-Game `.build` Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Build Planner roadmap — a build group (parent + ordered labeled variants) travels as ONE share URL that renders view-first, and any build exports to a GGG-official in-game `.build` file.

**Architecture:** Three pure ES cores extend the existing dual-use pattern — `build-store.js` (schema v3 + group API), `build-code.js` (codec v2 group envelope, v1 back-compat decode), and a new `build-file.js` (`buildToBuildFile`). Two new lazily-fetched artifacts supply the `.build` id spaces. All DOM glue lands in the existing `build-editor.js` / `builds-page.js` / `editor-render.js` trio; nothing new is server-rendered, so the static prerender surface is unchanged.

**Tech Stack:** Vanilla ES modules (no bundler), `node:test`, puppeteer-core headless verification, Express + Nunjucks shell, `CompressionStream('deflate')`.

## Global Constraints

- **Never merge or push to `main`.** All work lands on `planner/phase-4a-builds-pages` (currently `ce1d900`). Pushing `main` deploys production.
- **Pure cores use relative imports** (`./build-store.js`), never `/static/js/…` — absolute paths break `node --test`. Browser-only glue files (`build-editor.js`, `builds-page.js`, `build-host.js`) keep `/static/js/…`.
- **`src/data/*` must never read `data/source/`** — graph only. Scripts under `scripts/` may read source.
- **No `data/source/` edits.** Hand-authored facts go in `data/manual/*.json`; the one hand-authored table in this phase (our slotId → GGG `inventory_id`) is *export-format glue*, not game data, so it lives as a constant in `build-file.js` — same class of thing as `tradeUrl`'s mappings.
- **All store mutation goes through `build-store.js`.** Never touch raw localStorage.
- **`npm test` must stay green.** Baseline is **662 passing, 0 failing**.
- `npm run build:static` must complete with the crawler at **9292+/9292+** and zero dead internal links.
- Schema version goes **2 → 3** via the existing `MIGRATIONS` framework.
- Codec version goes **1 → 2**; v1 codes must remain decodable forever.

## Research findings (already verified — do not re-derive)

Confirmed against two **real** `.build` files now committed at `test/fixtures/build-files/` (exported from mobalytics.gg; `author`/`link` retained for provenance) and against GGG's developer docs (`pathofexile.com/developer/docs/game`):

| `.build` field | Id space | Our source | Confidence |
|---|---|---|---|
| `passives[].id` | PassiveSkills string id (`"spells18"`, `"spell_criticals2__"`) — **NOT** the node hash the original spec assumed | `data/source/repoe-poe2/passive_skill_trees/Default.json` → `.passives[<hash>].id` | **Exact.** All 208 fixture ids resolve in our copy; 4782/4784 tree hashes map (the 2 misses are unnamed `Huntress3` filler nodes) |
| `skills[].id`, `support_skills[].id` | BaseItemTypes metadata id | Our **graph gem node key**, verbatim | **Exact.** The fixture's mixed `Metadata/Items/Gem/` + `Metadata/Items/Gems/` prefixes are authentic — our source has 593 of each and the sets are **disjoint**, so no normalization is correct or needed |
| `ascendancy` | e.g. `"Mercenary3"` | Graph `Ascendancy/<id>` node `slug` | **Exact** |
| `passives[].weapon_set` | `1` or `2` | `passive-code.js` `decode()` → `records.trailing[].subType` `0x02`→1, `0x03`→2 | **Exact** (fixture uses both values) |
| `inventory_id` | `Weapon1`, `Weapon2`, `Offhand1`, `Helm1`, `BodyArmour1`, `Gloves1`, `Boots1`, `Belt1`, `Amulet1`, `Ring1`, `Ring2`, `Flask1`, `Charm1` | see `SLOT_TO_INVENTORY` in Task 4 | **Observed** for those 13. `Offhand2` / `Flask2` are **inferred by pattern** — the fixtures only exercised the `*1` variants. Flagged for the owner's in-game check |
| `unique_name` | Words-table UniqueName = plain display name (`"Mageblood"`) | `resolveRef(ref).name` | **Exact** |
| `additional_text` for planned items | `"<Base Name>\n1. <mod>\n2. <mod>…"` | `resolveMod(pools, chosen).text` | **Exact** (fixture convention reproduced verbatim) |

Group-code compression, measured (heavy 13-slot / 8-setup / 700-char-tree builds):

| variants | raw JSON | encoded code |
|---|---|---|
| 0 | 5 843 | **821** chars |
| 4 | 29 233 | **1 167** chars |
| 8 | 52 632 | **1 457** chars |

Deflate absorbs the inter-variant redundancy exactly as Amendment 3 predicted — fragment size is a non-issue.

Artifact sizing (gzipped), which is why the export id maps are **separate, click-time-only** fetches rather than additions to always-loaded artifacts:

| artifact | current gz | note |
|---|---|---|
| `planner-data.json` | 36.9 KB | loaded by every editor view — do NOT add 12.6 KB of gem ids here |
| `passive-tree.json` | 236 KB | loaded by every `/passives` visitor — do NOT add 36 KB of passive ids here |
| **new** `build-export.json` | ~12.6 KB | gem + ascendancy ids; fetched only on export click |
| **new** `passive-build-ids.json` | ~36 KB | hash → PassiveSkills id; fetched only on export click |

## File Structure

**Create:**
- `public/js/build-file.js` — pure `buildToBuildFile(build, ctx)` + `SLOT_TO_INVENTORY` + `buildFileName(name)`.
- `src/data/buildExport.js` — graph projector → `{ gemIds, ascendancyIds }`.
- `test/build-file.test.js` — `buildToBuildFile` unit tests + real-fixture structural conformance.
- `test/buildExport.test.js` — projector tests.
- `scripts/verify-sharing-export.mjs` — headless DOM-glue gate (variant strip, group share round trip, export download).
- `test/fixtures/build-files/README.md` — fixture provenance note.

**Modify:**
- `public/js/build-store.js` — `SCHEMA_VERSION` 3, `variants` field + validation, `MIGRATIONS[2]`, `remove`/`duplicate` guards, new `addVariant`/`renameVariant`/`removeVariant`/`parentOf`/`group`/`importGroup`.
- `public/js/build-code.js` — codec v2: `encodeGroup`/`decodeGroup`; drop `encodeBuild`/`decodeBuild`.
- `public/js/editor-render.js` — variant strip; `renderSwitcher` group nesting; "Export for game" action.
- `public/js/build-editor.js` — variant actions, group share, export download.
- `public/js/builds-page.js` — `decodeGroup` route, group import state + variant switching, `importGroup` save.
- `public/js/build-host.js` — `loadBuildExport()` lazy loader for the two id artifacts.
- `src/data/planner.js` — add `gggId` to each ascendancy entry.
- `scripts/build-index.js` — write `build-export.json`.
- `scripts/build-passive-tree.js` — write `passive-build-ids.json`.
- `public/css/builds.css` — variant strip + export-note styles.
- `test/build-code.test.js`, `test/build-store.test.js` — extend/rewrite.
- `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md`, `docs/TODO.md` — final ticks.

**Already done (setup, no task needed):** the two real fixtures are committed at `test/fixtures/build-files/mobalytics-frostwall-gem-setup.build` and `mobalytics-gemling-spark-coc-comet.build`.

---

### Task 1: Schema v3 — `variants` + store group API

**Files:**
- Modify: `public/js/build-store.js`
- Test: `test/build-store.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `SCHEMA_VERSION === 3`; every build carries `variants: {label: string, buildId: string}[]`.
  - `store.addVariant(parentId, label) → build | null`
  - `store.renameVariant(parentId, buildId, label) → parentBuild | null`
  - `store.removeVariant(parentId, buildId) → parentBuild | null` (unlinks; the build survives)
  - `store.parentOf(buildId) → build | null`
  - `store.group(buildId) → { parent: build, variants: {label, build}[] } | null`
  - `store.importGroup({ parent, variants }) → parentBuild`

- [ ] **Step 1: Write the failing tests**

Append to `test/build-store.test.js`:

```js
// ---- Phase 8: variants + group API ---------------------------------------

test('emptyBuild carries an empty variants list at schema 3', () => {
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid });
  assert.equal(b.schema, 3);
  assert.deepEqual(b.variants, []);
});

test('validateBuild accepts and rejects variant lists', () => {
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid });
  b.variants = [{ label: 'Lv 1-30', buildId: 'abc' }];
  assert.deepEqual(validateBuild(b), { ok: true, errors: [] });
  b.variants = [{ label: 'Lv 1-30' }];
  assert.equal(validateBuild(b).ok, false);
  b.variants = 'nope';
  assert.equal(validateBuild(b).ok, false);
});

test('a v2 build migrates to v3 by gaining an empty variants list', () => {
  const storage = mkStorage();
  const legacy = { ...emptyBuild({ now: fixedNow, uuid: () => 'old' }), schema: 2 };
  delete legacy.variants;
  storage.setItem(STORE_KEY, JSON.stringify({ order: ['old'], builds: { old: legacy } }));
  const store = createStore(storage, { now: fixedNow, uuid: fixedUuid });
  const got = store.get('old');
  assert.equal(got.schema, 3);
  assert.deepEqual(got.variants, []);
});

test('addVariant duplicates the parent and appends an ordered entry', () => {
  const ids = seqUuid();
  const store = createStore(mkStorage(), { now: fixedNow, uuid: ids });
  const parent = store.create({ name: 'Lightning Sorc' });
  parent.gear = {};
  store.update(parent.id, { skills: [{ gem: { slug: 'spark' }, level: null, supports: [] }] });

  const v1 = store.addVariant(parent.id, 'Lv 1-30');
  const v2 = store.addVariant(parent.id, 'Lv 30-60');

  assert.equal(v1.name, 'Lv 1-30');
  assert.deepEqual(v1.variants, [], 'variants are flat — a variant has no list of its own');
  assert.deepEqual(v1.skills, [{ gem: { slug: 'spark' }, level: null, supports: [] }],
    'a variant starts as a copy of its parent');
  assert.deepEqual(store.get(parent.id).variants,
    [{ label: 'Lv 1-30', buildId: v1.id }, { label: 'Lv 30-60', buildId: v2.id }]);
  assert.equal(store.list().length, 3, 'variants are ordinary builds in the store');
});

test('renameVariant retitles both the entry and the variant build', () => {
  const store = createStore(mkStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Parent' });
  const v = store.addVariant(parent.id, 'Early');
  store.renameVariant(parent.id, v.id, 'Lv 1-30');
  assert.deepEqual(store.get(parent.id).variants, [{ label: 'Lv 1-30', buildId: v.id }]);
  assert.equal(store.get(v.id).name, 'Lv 1-30');
  assert.equal(store.renameVariant(parent.id, 'not-a-variant', 'X'), null);
});

test('removeVariant unlinks without deleting the build', () => {
  const store = createStore(mkStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Parent' });
  const v = store.addVariant(parent.id, 'Early');
  store.removeVariant(parent.id, v.id);
  assert.deepEqual(store.get(parent.id).variants, []);
  assert.ok(store.get(v.id), 'the variant build survives an unlink');
});

test('deleting a variant build prunes it from its parent list', () => {
  const store = createStore(mkStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Parent' });
  const v1 = store.addVariant(parent.id, 'A');
  const v2 = store.addVariant(parent.id, 'B');
  store.remove(v1.id);
  assert.deepEqual(store.get(parent.id).variants, [{ label: 'B', buildId: v2.id }]);
});

test('deleting a parent orphans its variants, never deletes them', () => {
  const store = createStore(mkStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Parent' });
  const v = store.addVariant(parent.id, 'A');
  store.remove(parent.id);
  assert.ok(store.get(v.id), 'the variant survives its parent');
  assert.equal(store.parentOf(v.id), null);
});

test('duplicate never inherits the variant list', () => {
  const store = createStore(mkStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Parent' });
  store.addVariant(parent.id, 'A');
  const copy = store.duplicate(parent.id);
  assert.deepEqual(copy.variants, [],
    'two parents must never point at the same variant build');
});

test('parentOf finds the owning parent, or null for a standalone build', () => {
  const store = createStore(mkStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Parent' });
  const v = store.addVariant(parent.id, 'A');
  assert.equal(store.parentOf(v.id)?.id, parent.id);
  assert.equal(store.parentOf(parent.id), null);
});

test('group is parent-rooted from either a parent or a variant id', () => {
  const store = createStore(mkStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Parent' });
  const v1 = store.addVariant(parent.id, 'A');
  const v2 = store.addVariant(parent.id, 'B');

  for (const from of [parent.id, v1.id, v2.id]) {
    const g = store.group(from);
    assert.equal(g.parent.id, parent.id, `group(${from}) roots at the parent`);
    assert.deepEqual(g.variants.map((x) => x.label), ['A', 'B']);
    assert.deepEqual(g.variants.map((x) => x.build.id), [v1.id, v2.id]);
  }
  assert.equal(store.group('nope'), null);
});

test('group skips dangling variant references', () => {
  const storage = mkStorage();
  const store = createStore(storage, { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Parent' });
  const v = store.addVariant(parent.id, 'A');
  // Simulate a half-written store: the entry survives, the build does not.
  const raw = JSON.parse(storage.getItem(STORE_KEY));
  delete raw.builds[v.id];
  raw.order = raw.order.filter((x) => x !== v.id);
  storage.setItem(STORE_KEY, JSON.stringify(raw));
  assert.deepEqual(createStore(storage, { now: fixedNow, uuid: seqUuid() }).group(parent.id).variants, []);
});

test('importGroup creates parent + variants with fresh relinked ids', () => {
  const store = createStore(mkStorage(), { now: fixedNow, uuid: seqUuid() });
  const decoded = {
    parent: { schema: 3, name: 'Shared', notes: '', description: '', class: null, ascendancy: null,
      gear: {}, unassigned: [], skills: [], tree: { code: null, notablePriority: [] }, variants: [] },
    variants: [
      { label: 'Lv 1-30', build: { schema: 3, name: 'x', notes: '', description: '', class: null,
        ascendancy: null, gear: {}, unassigned: [], skills: [], tree: { code: null, notablePriority: [] } } },
    ],
  };
  const parent = store.importGroup(decoded);
  assert.equal(parent.name, 'Shared');
  assert.equal(store.list().length, 2);
  assert.equal(parent.variants.length, 1);
  assert.equal(parent.variants[0].label, 'Lv 1-30');
  const child = store.get(parent.variants[0].buildId);
  assert.ok(child, 'the parent list points at a real local build');
  assert.notEqual(child.id, parent.id);
  assert.deepEqual(child.variants, []);
});

test('importGroup migrates an old-schema decoded build', () => {
  const store = createStore(mkStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.importGroup({
    parent: { schema: 1, name: 'From v1', notes: '', class: null, ascendancy: null,
      gear: { body: { item: { kind: 'unique', slug: 'tabula-rasa' }, wishlist: ['maximum-life'] } },
      unassigned: [], skills: [], tree: { code: null, notablePriority: [] } },
    variants: [],
  });
  assert.equal(parent.schema, 3);
  assert.deepEqual(parent.variants, []);
  assert.deepEqual(parent.gear.body, { item: { kind: 'unique', slug: 'tabula-rasa' }, mods: [], corrupted: null });
});
```

`test/build-store.test.js` already has a storage mock and imports `createStore`. If the file's existing helpers are named differently, reuse them rather than adding duplicates; otherwise add these two helpers next to `fixedNow`/`fixedUuid`:

```js
const mkStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
};
const seqUuid = () => { let n = 0; return () => `id-${++n}`; };
```

Also update the existing `emptyBuild fills v2 defaults` test: rename it to `emptyBuild fills v3 defaults` and add `variants: []` to its expected object — it uses `assert.deepEqual` on the whole build, so it will fail otherwise.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test 2>&1 | grep -E 'variants|group|importGroup|^. (tests|pass|fail)'
```

Expected: the new tests FAIL (`store.addVariant is not a function`, `b.schema` is 2, etc.).

- [ ] **Step 3: Implement the schema + store changes**

In `public/js/build-store.js`, bump the version:

```js
export const SCHEMA_VERSION = 3;
```

Add `variants` to `emptyBuild`, immediately after `tree`:

```js
    tree: { code: null, notablePriority: [] },
    // Ordered variant siblings (Amendment 2). A variant is a full standalone
    // build; this list is the ONLY grouping structure and is one level deep.
    variants: [],
    ...overrides,
```

Add validation in `validateBuild`, just before the `grantedSupports` block:

```js
  if (b.variants !== undefined) {
    if (!Array.isArray(b.variants)) errors.push('variants: expected array');
    else b.variants.forEach((v, i) => {
      if (!isObj(v)) { errors.push(`variants[${i}]: expected {label, buildId}`); return; }
      if (!isStr(v.label)) errors.push(`variants[${i}].label: expected string`);
      if (!isStr(v.buildId)) errors.push(`variants[${i}].buildId: expected string`);
    });
  }
```

Add the migration alongside `MIGRATIONS[1]`:

```js
  // v2->v3: builds gained an ordered `variants` list (Amendment 2).
  2: (build) => ({ ...build, schema: 3, variants: build.variants ?? [] }),
```

Replace `remove` and `duplicate`, and add the six new methods, inside the object `createStore` returns:

```js
    remove(id) {
      const s = read();
      if (!s.builds[id]) return false;
      delete s.builds[id];
      s.order = s.order.filter((x) => x !== id);
      // A deleted build must never linger as a variant reference. Deleting a
      // PARENT is the other direction: its variants are orphaned, not deleted.
      for (const bid of s.order) {
        const b = s.builds[bid];
        if (b?.variants?.some((v) => v.buildId === id)) {
          s.builds[bid] = { ...b, variants: b.variants.filter((v) => v.buildId !== id) };
        }
      }
      write(s);
      emit('remove', id);
      return true;
    },
    duplicate(id) {
      const s = read();
      const cur = s.builds[id];
      if (!cur) return null;
      const t = now();
      // A duplicate is standalone: inheriting the variant list would leave two
      // parents pointing at one variant build.
      const copy = { ...deepCopy(cur), id: uuid(), name: `${cur.name} (copy)`,
                     variants: [], createdAt: t, updatedAt: t };
      s.order.push(copy.id);
      s.builds[copy.id] = copy;
      write(s);
      emit('create', copy.id);
      return copy;
    },
    /** Duplicate `parentId` into a labeled sibling and append it to its list. */
    addVariant(parentId, label) {
      const s = read();
      const parent = s.builds[parentId];
      if (!parent) return null;
      const t = now();
      const child = { ...deepCopy(parent), id: uuid(), name: label,
                      variants: [], createdAt: t, updatedAt: t };
      s.order.push(child.id);
      s.builds[child.id] = child;
      s.builds[parentId] = { ...parent,
        variants: [...(parent.variants ?? []), { label, buildId: child.id }], updatedAt: t };
      write(s);
      emit('create', child.id);
      return child;
    },
    /** Retitle a variant entry; the variant build's name tracks its label. */
    renameVariant(parentId, buildId, label) {
      const s = read();
      const parent = s.builds[parentId];
      if (!parent?.variants?.some((v) => v.buildId === buildId)) return null;
      const t = now();
      s.builds[parentId] = { ...parent, updatedAt: t,
        variants: parent.variants.map((v) => (v.buildId === buildId ? { ...v, label } : v)) };
      const child = s.builds[buildId];
      if (child) s.builds[buildId] = { ...child, name: label, updatedAt: t };
      write(s);
      emit('update', parentId);
      return s.builds[parentId];
    },
    /** Drop a variant entry. The variant build itself survives as standalone. */
    removeVariant(parentId, buildId) {
      const s = read();
      const parent = s.builds[parentId];
      if (!parent?.variants?.length) return null;
      s.builds[parentId] = { ...parent, updatedAt: now(),
        variants: parent.variants.filter((v) => v.buildId !== buildId) };
      write(s);
      emit('update', parentId);
      return s.builds[parentId];
    },
    /** The build whose variant list contains `buildId`, or null. */
    parentOf(buildId) {
      const s = read();
      for (const id of s.order) {
        if (s.builds[id]?.variants?.some((v) => v.buildId === buildId)) return s.builds[id];
      }
      return null;
    },
    /**
     * The share group rooted at `buildId` — its parent if it is a variant, plus
     * every LIVE variant in list order. Dangling references are skipped so a
     * half-written store still shares cleanly.
     */
    group(buildId) {
      const s = read();
      const self = s.builds[buildId];
      if (!self) return null;
      let parent = self;
      for (const id of s.order) {
        if (s.builds[id]?.variants?.some((v) => v.buildId === buildId)) { parent = s.builds[id]; break; }
      }
      const variants = (parent.variants ?? [])
        .map((v) => ({ label: v.label, build: s.builds[v.buildId] }))
        .filter((v) => v.build);
      return { parent, variants };
    },
    /**
     * Materialize a decoded group locally: every build gets a fresh id and the
     * parent's list is relinked to them. Old-schema decoded builds are migrated.
     */
    importGroup(group) {
      const s = read();
      const fresh = (b, over) => {
        const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = migrate(deepCopy(b));
        return emptyBuild({ now, uuid, ...rest, ...over });
      };
      const variants = (group.variants ?? []).map(({ label, build }) => {
        const child = fresh(build, { variants: [] });
        s.order.push(child.id);
        s.builds[child.id] = child;
        return { label, buildId: child.id };
      });
      const parent = fresh(group.parent, { variants });
      s.order.push(parent.id);
      s.builds[parent.id] = parent;
      write(s);
      emit('create', parent.id);
      return parent;
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test 2>&1 | tail -8
```

Expected: `fail 0`, total above the 662 baseline.

- [ ] **Step 5: Commit**

```bash
git add public/js/build-store.js test/build-store.test.js
git commit -m "feat(planner): build schema v3 — ordered variant siblings + store group API"
```

---

### Task 2: Codec v2 — group envelope with v1 back-compat

**Files:**
- Modify: `public/js/build-code.js`
- Modify: `public/js/build-editor.js:8,317` and `public/js/builds-page.js:7,179` (call-site swap — the only two non-test consumers)
- Test: `test/build-code.test.js` (rewrite)

**Interfaces:**
- Consumes: `validateBuild` (Task 1's extended version), `b64ToBytes`/`bytesToB64` from `./passive-code.js`.
- Produces:
  - `encodeGroup({ parent, variants }) → Promise<string>` — a `'2'`-prefixed base64url code.
  - `decodeGroup(code) → Promise<{ parent, variants: {label, build}[] }>` — decodes v2 **and** legacy v1 (a v1 code yields `variants: []`).
  - `CodecError` with codes `'bad-version' | 'corrupt' | 'invalid-build'` (unchanged).
  - `encodeBuild` / `decodeBuild` are **removed**.

- [ ] **Step 1: Write the failing tests**

Replace `test/build-code.test.js` entirely:

```js
// test/build-code.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGroup, decodeGroup, CodecError } from '../public/js/build-code.js';
import { emptyBuild } from '../public/js/build-store.js';

const mk = (over = {}) => emptyBuild({ now: () => 1000, uuid: () => 'id-1', ...over });
const canon = ({ id, createdAt, updatedAt, ...rest }) => rest;

function realisticBuild(name = 'Stormweaver Arc') {
  const b = mk({ name, class: 'sorceress', ascendancy: 'stormweaver' });
  b.notes = 'League-start friendly. Swap to CI at 80.';
  b.description = 'Arc into Spark, lightning conversion.';
  const slots = ['weapon1a', 'weapon1b', 'helmet', 'body', 'gloves', 'boots',
    'belt', 'amulet', 'ring1', 'ring2', 'flask1', 'flask2', 'charm1'];
  for (const s of slots) {
    b.gear[s] = {
      item: { kind: s === 'body' ? 'unique' : 'base', slug: `some-item-for-${s}` },
      mods: [{ affix: 'maximum_life', tier: 'MaximumLife7' },
             { affix: 'lightning_resistance', tier: 'LightningResistance5' }],
      corrupted: null,
    };
  }
  b.skills = Array.from({ length: 8 }, (_, i) => ({
    gem: { slug: `skill-gem-${i}` }, level: 20,
    supports: Array.from({ length: 5 }, (_, j) => ({ slug: `support-${i}-${j}` })),
  }));
  b.tree = { code: 'A'.repeat(700), notablePriority: Array.from({ length: 20 }, (_, i) => 10000 + i) };
  return b;
}

// A code frozen from codec v1 (generated once, before encodeBuild was removed).
// This is the ONLY way to prove v1 back-compat now that no v1 encoder exists.
const V1_CODE = '1eJwtkD1vxCAMhv9K5Dk33PVjyNabO3Q_ZXDASlEMpAZSRRH_vaY5FoPfx6-ND0jmmzzCcOshoCcY4JNmNHu3Xbt7cWxBhZgpqeLRUjftnYmWjAIqWUpG3JpdDApowjCmxqYohoT03gMmQ8FiMHsTchT_S7iRqDQTCgwHTNHuLbpMvsXFBatwCe6nkHKJy6zvjFNhvAgmhNqDj1Z7PUZtG0XKmkmLQmGuKpagk7g5tFxD0uKYG35o1_8mT9O0oizNjmkjPg0UL-saJZ8FT9KjZId80SHXCHWsapuFqJm1pSjyoed-7gwnpi9xUVzWvz2ut5f-9e19rPUPREx9VA';

test('round trip: a lone parent survives encode -> decode', async () => {
  const b = realisticBuild();
  const out = await decodeGroup(await encodeGroup({ parent: b, variants: [] }));
  assert.deepEqual(out, { parent: canon(b), variants: [] });
});

test('round trip: an ordered variant group survives encode -> decode', async () => {
  const parent = realisticBuild('Guide');
  const variants = [
    { label: 'Lv 1-30', build: realisticBuild('Early') },
    { label: 'Lv 30-60', build: realisticBuild('Mid') },
    { label: 'Lv 60+', build: realisticBuild('Late') },
  ];
  const out = await decodeGroup(await encodeGroup({ parent, variants }));
  assert.deepEqual(out.parent, canon(parent));
  assert.deepEqual(out.variants.map((v) => v.label), ['Lv 1-30', 'Lv 30-60', 'Lv 60+']);
  assert.deepEqual(out.variants.map((v) => v.build), variants.map((v) => canon(v.build)));
});

test('encode strips local identity and keeps unknown fields', async () => {
  const parent = { ...mk(), futureField: 42 };
  const { parent: out } = await decodeGroup(await encodeGroup({ parent, variants: [] }));
  assert.equal(out.id, undefined);
  assert.equal(out.createdAt, undefined);
  assert.equal(out.updatedAt, undefined);
  assert.equal(out.futureField, 42);
});

test('variants default to an empty list when omitted', async () => {
  const out = await decodeGroup(await encodeGroup({ parent: mk() }));
  assert.deepEqual(out.variants, []);
});

test('code is URL-fragment-safe and version-prefixed with 2', async () => {
  const code = await encodeGroup({ parent: mk(), variants: [] });
  assert.equal(code[0], '2');
  assert.match(code, /^[A-Za-z0-9_-]+$/);
});

test('an 8-variant heavy group stays well inside the fragment budget', async () => {
  const code = await encodeGroup({
    parent: realisticBuild('Guide'),
    variants: Array.from({ length: 8 }, (_, i) => ({ label: `Lv ${i * 12}-${(i + 1) * 12}`, build: realisticBuild(`V${i}`) })),
  });
  assert.ok(code.length < 4096, `code length ${code.length} exceeds 4096`);
});

test('legacy v1 codes still decode, as a group with no variants', async () => {
  const out = await decodeGroup(V1_CODE);
  assert.deepEqual(out.variants, []);
  assert.equal(out.parent.name, 'Legacy v1 Build');
  assert.equal(out.parent.class, 'sorceress');
  assert.equal(out.parent.tree.code, 'AAAAB');
  assert.deepEqual(out.parent.tree.notablePriority, [123, 456]);
  assert.deepEqual(out.parent.gear.body,
    { item: { kind: 'unique', slug: 'tabula-rasa' }, mods: [], corrupted: null });
  assert.equal(out.parent.id, undefined);
});

test('unknown version prefix rejects with bad-version', async () => {
  const code = await encodeGroup({ parent: mk(), variants: [] });
  await assert.rejects(decodeGroup('9' + code.slice(1)),
    (e) => e instanceof CodecError && e.code === 'bad-version');
  await assert.rejects(decodeGroup(''),
    (e) => e instanceof CodecError && e.code === 'bad-version');
  await assert.rejects(decodeGroup(null),
    (e) => e instanceof CodecError && e.code === 'bad-version');
});

test('garbage rejects with corrupt', async () => {
  await assert.rejects(decodeGroup('2zzzz-not-deflate'),
    (e) => e instanceof CodecError && e.code === 'corrupt');
});

test('a v2 payload with no parent rejects with corrupt', async () => {
  // Hand-pack a deflated payload that is valid JSON but the wrong shape.
  const { bytesToB64 } = await import('../public/js/passive-code.js');
  const bad = JSON.stringify({ v: [] });
  const stream = new Blob([new TextEncoder().encode(bad)]).stream()
    .pipeThrough(new CompressionStream('deflate'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  await assert.rejects(decodeGroup('2' + bytesToB64(packed)),
    (e) => e instanceof CodecError && e.code === 'corrupt');
});

test('an invalid parent rejects with invalid-build', async () => {
  const parent = mk();
  parent.name = 123; // break the schema post-hoc
  await assert.rejects(decodeGroup(await encodeGroup({ parent, variants: [] })),
    (e) => e instanceof CodecError && e.code === 'invalid-build');
});

test('an invalid variant build rejects with invalid-build', async () => {
  const bad = mk();
  bad.skills = 'nope';
  await assert.rejects(
    decodeGroup(await encodeGroup({ parent: mk(), variants: [{ label: 'A', build: bad }] })),
    (e) => e instanceof CodecError && e.code === 'invalid-build');
});

test('a variant with a missing label falls back to a positional one', async () => {
  const code = await encodeGroup({ parent: mk(), variants: [{ label: undefined, build: mk() }] });
  const out = await decodeGroup(code);
  assert.equal(out.variants[0].label, 'Variant 1');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test test/build-code.test.js 2>&1 | tail -12
```

Expected: FAIL — `encodeGroup is not a function` / import error for the removed names.

- [ ] **Step 3: Implement codec v2**

Replace `public/js/build-code.js` entirely:

```js
// public/js/build-code.js
// Pure ES module — Build Planner share codec. A build GROUP (parent + ordered
// labeled variant siblings) → canonical JSON → deflate → base64url with a
// leading codec-version char. Dual-environment via the Web CompressionStream API
// (global in Node >= 20 and evergreen browsers); format 'deflate' deliberately —
// 'deflate-raw' is missing from some Node 20.x.
//
// v2 (2026-07-24) packs a whole group so a leveling guide travels as ONE URL;
// deflate absorbs the heavy inter-variant redundancy (8 heavy variants ≈ 1.5 KB).
// v1 codes were single builds and MUST stay decodable forever.
import { b64ToBytes, bytesToB64 } from './passive-code.js';
import { validateBuild } from './build-store.js';

const CODEC_VERSION = '2';
const LEGACY_VERSIONS = new Set(['1']);

export class CodecError extends Error {
  /** @param {'bad-version'|'corrupt'|'invalid-build'} code */
  constructor(code, message) {
    super(message);
    this.name = 'CodecError';
    this.code = code;
  }
}

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Local-only fields never travel; everything else (incl. unknown future
// fields) passes through so old sites can share to newer ones.
function canonical(build) {
  const { id, createdAt, updatedAt, ...rest } = build;
  return rest;
}

function checked(build, where) {
  const { ok, errors } = validateBuild(build);
  if (!ok) throw new CodecError('invalid-build', `${where} failed validation: ${errors.join('; ')}`);
  return build;
}

/**
 * Group → version-prefixed base64url deflate of its canonical JSON. The payload
 * keys are single letters ('p'arent / 'v'ariants / 'l'abel / 'b'uild) because
 * they repeat once per variant inside the compressed stream.
 * @param {{parent: object, variants?: {label: string, build: object}[]}} group
 * @returns {Promise<string>}
 */
export async function encodeGroup({ parent, variants = [] }) {
  const payload = {
    p: canonical(parent),
    v: variants.map(({ label, build }) => ({ l: label, b: canonical(build) })),
  };
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(payload)),
    new CompressionStream('deflate'));
  return CODEC_VERSION + bytesToB64(packed);
}

async function inflate(str) {
  try {
    const bytes = await pipe(b64ToBytes(str.slice(1)), new DecompressionStream('deflate'));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new CodecError('corrupt', 'build code is not valid compressed JSON');
  }
}

/**
 * Inverse of {@link encodeGroup}, and the reader for legacy v1 single-build
 * codes (which decode to a group with no variants). Resolves to id-less
 * canonical builds — the caller assigns local identity.
 * @param {string} str
 * @returns {Promise<{parent: object, variants: {label: string, build: object}[]}>}
 */
export async function decodeGroup(str) {
  const v = typeof str === 'string' ? str[0] : undefined;
  if (v !== CODEC_VERSION && !LEGACY_VERSIONS.has(v)) {
    throw new CodecError('bad-version', `unknown build code version ${v ?? '(empty)'}`);
  }
  const payload = await inflate(str);
  if (LEGACY_VERSIONS.has(v)) return { parent: checked(payload, 'decoded build'), variants: [] };

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || !payload.p) {
    throw new CodecError('corrupt', 'group code has no parent build');
  }
  const variants = (Array.isArray(payload.v) ? payload.v : []).map((e, i) => {
    if (e === null || typeof e !== 'object') {
      throw new CodecError('corrupt', `group variant ${i} is not an object`);
    }
    return {
      label: typeof e.l === 'string' ? e.l : `Variant ${i + 1}`,
      build: checked(e.b, `decoded variant ${i}`),
    };
  });
  return { parent: checked(payload.p, 'decoded build'), variants };
}
```

- [ ] **Step 4: Swap the two call sites so nothing imports the removed names**

In `public/js/build-editor.js` line 8:

```js
import { encodeGroup } from '/static/js/build-code.js';
```

and in its `[data-share]` handler (line ~317) replace `encodeBuild(build())` with the group form — the group is what travels now:

```js
      encodeGroup(store.group(buildId) ?? { parent: build(), variants: [] })
```

In `public/js/builds-page.js` line 7:

```js
import { decodeGroup } from '/static/js/build-code.js';
```

and line ~179, replace `decodeBuild(route.code)` with `decodeGroup(route.code)`. The `.then(([build]) => …)` callback still receives one value; Task 6 reshapes what it stores. For now make it compile and keep the current single-build preview working:

```js
      Promise.all([decodeGroup(route.code), loadDocs().catch(() => null), loadPlanner().catch(() => null), loadPools().catch(() => null)])
        .then(([group]) => { if (importState === st) st.state = { status: 'ready', build: group.parent, group }; })
```

- [ ] **Step 5: Run the full suite**

```bash
npm test 2>&1 | tail -8
grep -rn "encodeBuild\|decodeBuild" public/ src/ test/ scripts/ views/
```

Expected: `fail 0`; the grep prints **nothing** (no stragglers importing the removed API).

- [ ] **Step 6: Commit**

```bash
git add public/js/build-code.js public/js/build-editor.js public/js/builds-page.js test/build-code.test.js
git commit -m "feat(planner): share codec v2 — one URL per build group, v1 codes still decode"
```

---

### Task 3: Export id artifacts — `build-export.json` + `passive-build-ids.json`

**Files:**
- Create: `src/data/buildExport.js`
- Create: `test/buildExport.test.js`
- Modify: `src/data/planner.js:113` (ascendancy entries gain `gggId`)
- Modify: `scripts/build-index.js` (write `build-export.json`)
- Modify: `scripts/build-passive-tree.js` (write `passive-build-ids.json`)
- Modify: `public/js/build-host.js` (lazy loader)

**Interfaces:**
- Consumes: `nodesByKind`, `getNode` from `src/data/graph.js`.
- Produces:
  - `buildExportIds() → { gemIds: {slug: metadataId}, ascendancyIds: {ascSlug: gggId} }`
  - `public/generated/build-export.json` — that object, verbatim.
  - `public/generated/passive-build-ids.json` — `{ passiveIds: { [hash: string]: string } }`.
  - `loadBuildExport() → Promise<{ gemIds, ascendancyIds, passiveIds }>` from `build-host.js` (both artifacts, merged, fetched in parallel, memoized).
  - `planner.classes[].ascendancies[]` entries gain `gggId` (e.g. `'Sorceress2'`).

**Why two artifacts, two writers:** `gemIds`/`ascendancyIds` are graph facts, so they belong to a `src/data/` projector that `build-index.js` writes. `passiveIds` needs all 5150 RePoE passives — the graph carries only the 1329 notables/keystones — so it must be read from source, which only `scripts/` may do; `build-passive-tree.js` already owns the GGG-tree ↔ RePoE hash join. Keeping them out of `planner-data.json` / `passive-tree.json` avoids putting ~49 KB gz on artifacts every visitor loads for a click-time-only feature.

- [ ] **Step 1: Write the failing tests**

Create `test/buildExport.test.js`:

```js
// test/buildExport.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildExportIds } from '../src/data/buildExport.js';
import { plannerData } from '../src/data/planner.js';

const GEN = path.join(import.meta.dirname, '..', 'public', 'generated');

test('gemIds map every gem slug to a Metadata item id', () => {
  const { gemIds } = buildExportIds();
  const entries = Object.entries(gemIds);
  assert.ok(entries.length > 900, `expected >900 gems, got ${entries.length}`);
  for (const [slug, id] of entries) {
    assert.match(id, /^Metadata\/[Ii]tems\/Gems?\//, `${slug} -> ${id}`);
  }
});

test('gemIds preserve the authentic Gem/ vs Gems/ prefix per gem', () => {
  // Our source has 593 gems under each prefix and the sets are DISJOINT, so
  // normalizing either way would emit ids the game does not know.
  const { gemIds } = buildExportIds();
  const ids = Object.values(gemIds);
  assert.ok(ids.some((id) => id.startsWith('Metadata/Items/Gem/')), 'some gems are under Gem/');
  assert.ok(ids.some((id) => id.startsWith('Metadata/Items/Gems/')), 'some gems are under Gems/');
});

test('gemIds resolve the gems named in the real .build fixtures', () => {
  const { gemIds } = buildExportIds();
  // slug -> the id the game itself wrote in the fixture files.
  assert.equal(gemIds['power-siphon'], 'Metadata/Items/Gems/SkillGemPowerSiphon');
  assert.equal(gemIds['pinnacle-of-power'], 'Metadata/Items/Gem/SkillGemPinnacleOfPower');
  assert.equal(gemIds['twofold'], 'Metadata/Items/Gem/SupportGemTwofold');
});

test('ascendancyIds map our slug to the GGG ascendancy id', () => {
  const { ascendancyIds } = buildExportIds();
  assert.equal(ascendancyIds['infernalist'], 'Witch1');
  assert.equal(ascendancyIds['blood-mage'], 'Witch2');
  assert.ok(Object.keys(ascendancyIds).length >= 20);
});

test('plannerData ascendancies carry the GGG id for export', () => {
  const { classes } = plannerData();
  const witch = classes.find((c) => c.slug === 'witch');
  const infernalist = witch.ascendancies.find((a) => a.slug === 'infernalist');
  assert.equal(infernalist.gggId, 'Witch1');
  for (const c of classes) for (const a of c.ascendancies) {
    assert.match(a.gggId, /^[A-Za-z]+\d$/, `${c.slug}/${a.slug} -> ${a.gggId}`);
  }
});

test('the build-export artifact is written and matches the projector', () => {
  const disk = JSON.parse(fs.readFileSync(path.join(GEN, 'build-export.json'), 'utf8'));
  assert.deepEqual(disk, buildExportIds());
});

test('passive-build-ids maps tree hashes to PassiveSkills string ids', () => {
  const { passiveIds } = JSON.parse(fs.readFileSync(path.join(GEN, 'passive-build-ids.json'), 'utf8'));
  assert.ok(Object.keys(passiveIds).length > 5000, 'expected the full passive table');
  // Ids the real fixtures use must be present as values.
  const values = new Set(Object.values(passiveIds));
  for (const id of ['spells18', 'spell_criticals2__', 'witch_sorceress_notable1', 'cast_speed10']) {
    assert.ok(values.has(id), `fixture id ${id} is missing from passiveIds`);
  }
});

test('passive-build-ids covers essentially every renderable tree node', () => {
  const { passiveIds } = JSON.parse(fs.readFileSync(path.join(GEN, 'passive-build-ids.json'), 'utf8'));
  const tree = JSON.parse(fs.readFileSync(path.join(GEN, 'passive-tree.json'), 'utf8'));
  const missing = tree.nodes.filter((n) => !passiveIds[String(n.h)]);
  // The only known gap is a pair of unnamed Huntress3 filler nodes.
  assert.ok(missing.length <= 2, `unexpected unmapped nodes: ${JSON.stringify(missing.slice(0, 5))}`);
  for (const n of missing) assert.equal(n.name, '', `unmapped node ${n.h} has a name`);
});

test('every id in both real .build fixtures round-trips through our maps', () => {
  const { passiveIds } = JSON.parse(fs.readFileSync(path.join(GEN, 'passive-build-ids.json'), 'utf8'));
  const { gemIds } = buildExportIds();
  const knownPassives = new Set(Object.values(passiveIds));
  const knownGems = new Set(Object.values(gemIds));
  const dir = path.join(import.meta.dirname, 'fixtures', 'build-files');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.build'));
  assert.ok(files.length >= 1, 'no .build fixtures found');
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const p of j.passives) {
      assert.ok(knownPassives.has(p.id), `${f}: passive id ${p.id} unknown to us`);
    }
    // Gem coverage is asserted as a high-water mark, not 100%: the fixtures
    // include ascendancy/meta gems whose ids the game accepts but which our
    // gem node set may legitimately not carry.
    const gems = j.skills.flatMap((s) => [s.id, ...(s.support_skills ?? []).map((x) => x.id)]);
    const hit = gems.filter((id) => knownGems.has(id)).length;
    assert.ok(hit / gems.length > 0.8, `${f}: only ${hit}/${gems.length} gem ids known`);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test test/buildExport.test.js 2>&1 | tail -12
```

Expected: FAIL — cannot find `../src/data/buildExport.js`.

- [ ] **Step 3: Write the projector**

Create `src/data/buildExport.js`:

```js
// src/data/buildExport.js
//
// Presentation adapter projecting the id spaces GGG's in-game `.build` file
// needs out of the graph. Reads ONLY the graph (no source files).
//
//   gemIds        gem slug -> BaseItemTypes metadata id (`skills[].id`)
//   ascendancyIds ascendancy slug -> GGG ascendancy id (`ascendancy`)
//
// The gem metadata id is the graph node KEY, used verbatim: PoE2 stores gems
// under BOTH `Metadata/Items/Gem/` and `Metadata/Items/Gems/`, and the two sets
// are disjoint (593 each), so normalizing either way would emit ids the game
// does not know. Real .build files exported by the game mix both prefixes too.
//
// The third map the exporter needs — tree hash -> PassiveSkills string id —
// covers all ~5150 passives, but the graph only holds notables/keystones, so it
// is projected from source by scripts/build-passive-tree.js instead.
import { nodesByKind } from './graph.js';
import { slugify } from './slug.js';

export function buildExportIds() {
  const gemIds = {};
  for (const g of nodesByKind('gem')) gemIds[g.slug] = g.id;

  const ascendancyIds = {};
  for (const a of nodesByKind('ascendancy')) ascendancyIds[slugify(a.name)] = a.slug;

  return { gemIds, ascendancyIds };
}
```

**Verify the node-id accessor before trusting it:** graph nodes are keyed by metadata id in the artifact's `nodes` map. Confirm `nodesByKind('gem')[0].id` is `'Metadata/Items/Gem/…'` and not `undefined`:

```bash
node --input-type=module -e "
import { nodesByKind } from './src/data/graph.js';
const g = nodesByKind('gem')[0];
console.log('id:', g.id, '| slug:', g.slug);
const a = nodesByKind('ascendancy')[0];
console.log('asc id:', a.id, '| slug:', a.slug, '| name:', a.name);
"
```

Expected: `id: Metadata/Items/Gem/…`, `asc id: Ascendancy/Druid1 | slug: Druid1 | name: Oracle`. If `getNode`-style objects do not expose `.id`, read the key instead — iterate the raw node map via whatever `graph.js` exposes and use the key as the id. **Do not guess: check and adapt.**

- [ ] **Step 4: Add `gggId` to planner ascendancies**

In `src/data/planner.js`, in the class-derivation loop (line ~113), carry the GGG id through:

```js
    byClass.get(cls).push({ slug: slugify(a.name), name: a.name, gggId: a.slug });
```

- [ ] **Step 5: Write both artifacts**

In `scripts/build-index.js`, add the import next to the other `src/data` projectors:

```js
import { buildExportIds } from '../src/data/buildExport.js';
```

and write the artifact next to the `item-math.json` write:

```js
const exportIds = buildExportIds();
fs.writeFileSync(path.join(OUT, 'build-export.json'), JSON.stringify(exportIds));
```

Extend the closing `console.log` template with:

```js
  `/ ${Object.keys(exportIds.gemIds).length} gem export ids ` +
```

In `scripts/build-passive-tree.js`, add the output path next to the other `*_OUT` consts:

```js
const BUILD_IDS_OUT = path.join(GEN_DIR, 'passive-build-ids.json');
```

and, inside `buildArtifact()` where the RePoE passive table is already in reach (it reads `getDataDir()`/`REPOE` for other joins), emit the map. Place it with the other `writeFileSync` calls:

```js
  // Tree hash -> PassiveSkills string id, the id space GGG's in-game `.build`
  // file uses for `passives[].id` (NOT the node hash). Its own artifact,
  // lazily fetched only when a user exports: folding ~36 KB gz into
  // passive-tree.json would tax every /passives visitor for a click-time need.
  const repoePassives = JSON.parse(fs.readFileSync(
    path.join(getDataDir(), REPOE, 'passive_skill_trees', 'Default.json'), 'utf8')).passives;
  const passiveIds = {};
  for (const p of Object.values(repoePassives)) {
    if (p.hash !== undefined && p.id) passiveIds[String(p.hash)] = p.id;
  }
  fs.writeFileSync(BUILD_IDS_OUT, JSON.stringify({ passiveIds }));
```

Add the count to that script's summary `console.log` (match its existing wording), e.g. `+ ${Object.keys(passiveIds).length} build ids`.

- [ ] **Step 6: Add the lazy loader**

In `public/js/build-host.js`, mirror the existing `loadItemMath` pattern:

```js
let buildExport = null;
let buildExportLoading = null;

/**
 * The `.build` export id maps, fetched only when a user actually exports.
 * Two artifacts (graph-sourced gem/ascendancy ids + source-sourced passive
 * ids), merged into one object.
 */
export function loadBuildExport() {
  if (buildExport) return Promise.resolve(buildExport);
  buildExportLoading ??= Promise.all([
    fetch('/static/generated/build-export.json').then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    fetch('/static/generated/passive-build-ids.json').then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
  ])
    .then(([ids, passives]) => { buildExport = { ...ids, ...passives }; return buildExport; })
    .catch((e) => { buildExportLoading = null; throw e; });
  return buildExportLoading;
}
```

- [ ] **Step 7: Rebuild the artifacts and run the tests**

```bash
npm run build:graph && npm run build:index && npm run build:passives
node --test test/buildExport.test.js 2>&1 | tail -8
ls -la public/generated/build-export.json public/generated/passive-build-ids.json
```

Expected: all `buildExport.test.js` tests PASS; both files exist. Then the full suite:

```bash
npm test 2>&1 | tail -8
```

Expected: `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/data/buildExport.js src/data/planner.js scripts/build-index.js \
        scripts/build-passive-tree.js public/js/build-host.js test/buildExport.test.js
git commit -m "feat(planner): project the .build export id spaces into two lazy artifacts"
```

---

### Task 4: Pure `build-file.js` — our build → GGG `.build` JSON

**Files:**
- Create: `public/js/build-file.js`
- Create: `test/build-file.test.js`
- Create: `test/fixtures/build-files/README.md`

**Interfaces:**
- Consumes: `decode` from `./passive-code.js`; `resolveMod` from `./mod-core.js`; the `{ gemIds, ascendancyIds, passiveIds }` object from Task 3.
- Produces:
  - `buildToBuildFile(build, ctx) → object` where `ctx = { ids, planner, pools, resolveRef, grantedRows }`.
  - `buildFileName(name) → string` — a filesystem-safe `<name>.build`.
  - `SLOT_TO_INVENTORY` — our slotId → GGG `inventory_id`.

**Mapping rules (all verified against the committed real fixtures):**
- `passives[]`: `notablePriority` order first (that ordering is what drives the in-game "allocate next" line), then every remaining allocated node in tree-code order. Weapon-set nodes carry `weapon_set: 1|2` from the tree code's trailing-record `subType` (`0x02`→1, `0x03`→2). Unmapped hashes are skipped silently.
- `skills[]`: build setups in order, then item-granted setups (with their persisted `grantedSupports`). A gem with no known metadata id is skipped rather than emitted with a bad id.
- `inventory_slots[]`: uniques get `unique_name` (display name); planned bases get `additional_text` in the fixtures' exact convention — base name, then `1.`-numbered mod lines. A corrupted implicit on a unique adds an `additional_text` line.
- Optional fields are omitted when empty, never emitted as `null`/`""` — the fixtures omit them.

- [ ] **Step 1: Write the fixture provenance note**

Create `test/fixtures/build-files/README.md`:

```markdown
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
```

- [ ] **Step 2: Write the failing tests**

Create `test/build-file.test.js`:

```js
// test/build-file.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildToBuildFile, buildFileName, SLOT_TO_INVENTORY } from '../public/js/build-file.js';
import { emptyBuild } from '../public/js/build-store.js';
import { synthesizeState, encode, ATTR_TAG } from '../public/js/passive-code.js';

const FIX = path.join(import.meta.dirname, 'fixtures', 'build-files');
const GEN = path.join(import.meta.dirname, '..', 'public', 'generated');
const realIds = () => ({
  ...JSON.parse(fs.readFileSync(path.join(GEN, 'build-export.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(GEN, 'passive-build-ids.json'), 'utf8')),
});

const ids = {
  gemIds: { spark: 'Metadata/Items/Gems/SkillGemSpark', arc: 'Metadata/Items/Gem/SkillGemArc',
            'martial-tempo': 'Metadata/Items/Gems/SupportGemMartialTempo' },
  ascendancyIds: { stormweaver: 'Sorceress2' },
  passiveIds: { 100: 'spells18', 200: 'cast_speed10', 300: 'criticals86', 400: 'lightning40' },
};
const pools = {
  families: {
    maximum_life: { name: 'Maximum Life', tiers: [{ id: 'MaximumLife7', text: '+(90-99) to maximum Life', gen: 'prefix' }] },
    lightning_resistance: { name: 'Lightning Resistance', tiers: [{ id: 'LightningResistance5', text: '+(36-41)% to Lightning Resistance', gen: 'suffix' }] },
  },
  bases: {}, uniques: {},
};
const NAMES = { 'tabula-rasa': 'Tabula Rasa', 'ancestral-tiara': 'Ancestral Tiara' };
const ctx = (over = {}) => ({
  ids, pools, planner: { classes: [] },
  resolveRef: (ref) => (NAMES[ref.slug] ? { name: NAMES[ref.slug] } : null),
  grantedRows: () => [],
  ...over,
});

const mk = (over = {}) => emptyBuild({ now: () => 1000, uuid: () => 'id-1', ...over });

test('a minimal build produces a valid minimal Build object', () => {
  const out = buildToBuildFile(mk({ name: 'My Build' }), ctx());
  assert.equal(out.name, 'My Build');
  assert.deepEqual(out.passives, []);
  assert.deepEqual(out.skills, []);
  assert.deepEqual(out.inventory_slots, []);
  // Empty optionals are omitted, matching the real fixtures.
  assert.ok(!('description' in out));
  assert.ok(!('ascendancy' in out));
});

test('description and ascendancy are emitted when set', () => {
  const b = mk({ name: 'X', ascendancy: 'stormweaver' });
  b.description = 'Arc into Spark.';
  const out = buildToBuildFile(b, ctx());
  assert.equal(out.description, 'Arc into Spark.');
  assert.equal(out.ascendancy, 'Sorceress2');
});

test('an unmapped ascendancy is omitted rather than guessed', () => {
  const out = buildToBuildFile(mk({ name: 'X', ascendancy: 'not-a-real-asc' }), ctx());
  assert.ok(!('ascendancy' in out));
});

test('skills carry the metadata id and nested support ids', () => {
  const b = mk({ name: 'X' });
  b.skills = [
    { gem: { slug: 'spark' }, level: null, supports: [{ slug: 'martial-tempo' }] },
    { gem: { slug: 'arc' }, level: null, supports: [] },
  ];
  const out = buildToBuildFile(b, ctx());
  assert.deepEqual(out.skills, [
    { id: 'Metadata/Items/Gems/SkillGemSpark',
      support_skills: [{ id: 'Metadata/Items/Gems/SupportGemMartialTempo' }] },
    { id: 'Metadata/Items/Gem/SkillGemArc' },
  ]);
});

test('a gem with no known metadata id is skipped, not emitted broken', () => {
  const b = mk({ name: 'X' });
  b.skills = [{ gem: { slug: 'unknown-gem' }, level: null, supports: [{ slug: 'also-unknown' }] },
              { gem: { slug: 'spark' }, level: null, supports: [{ slug: 'also-unknown' }] }];
  const out = buildToBuildFile(b, ctx());
  assert.equal(out.skills.length, 1);
  assert.equal(out.skills[0].id, 'Metadata/Items/Gems/SkillGemSpark');
  assert.ok(!('support_skills' in out.skills[0]), 'unknown supports drop out entirely');
});

test('item-granted setups are exported alongside authored ones', () => {
  const b = mk({ name: 'X' });
  b.skills = [{ gem: { slug: 'spark' }, level: null, supports: [] }];
  b.grantedSupports = { 'tabula-rasa:arc': [{ slug: 'martial-tempo' }] };
  const out = buildToBuildFile(b, ctx({
    grantedRows: () => [{ key: 'tabula-rasa:arc', item: { kind: 'unique', slug: 'tabula-rasa' },
                          skill: 'arc', supports: [{ slug: 'martial-tempo' }] }],
  }));
  assert.deepEqual(out.skills.map((s) => s.id),
    ['Metadata/Items/Gems/SkillGemSpark', 'Metadata/Items/Gem/SkillGemArc']);
  assert.deepEqual(out.skills[1].support_skills, [{ id: 'Metadata/Items/Gems/SupportGemMartialTempo' }]);
});

test('a unique slot exports unique_name; a planned base exports numbered hints', () => {
  const b = mk({ name: 'X' });
  b.gear.body = { item: { kind: 'unique', slug: 'tabula-rasa' }, mods: [], corrupted: null };
  b.gear.helmet = { item: { kind: 'base', slug: 'ancestral-tiara' }, corrupted: null,
    mods: [{ affix: 'maximum_life', tier: 'MaximumLife7' },
           { affix: 'lightning_resistance', tier: 'LightningResistance5' }] };
  const out = buildToBuildFile(b, ctx());
  const bySlot = Object.fromEntries(out.inventory_slots.map((s) => [s.inventory_id, s]));

  assert.deepEqual(bySlot.BodyArmour1, { inventory_id: 'BodyArmour1', slot_x: 0, slot_y: 0, unique_name: 'Tabula Rasa' });
  assert.equal(bySlot.Helm1.additional_text,
    'Ancestral Tiara\n1. +(90-99) to maximum Life\n2. +(36-41)% to Lightning Resistance');
  assert.ok(!('unique_name' in bySlot.Helm1));
});

test('a base with no chosen mods still names the base', () => {
  const b = mk({ name: 'X' });
  b.gear.helmet = { item: { kind: 'base', slug: 'ancestral-tiara' }, mods: [], corrupted: null };
  const out = buildToBuildFile(b, ctx());
  assert.equal(out.inventory_slots[0].additional_text, 'Ancestral Tiara');
});

test('a corrupted implicit on a unique is spelled out in additional_text', () => {
  const b = mk({ name: 'X' });
  b.gear.body = { item: { kind: 'unique', slug: 'tabula-rasa' }, mods: [],
                  corrupted: { affix: 'maximum_life', tier: 'MaximumLife7' } };
  const out = buildToBuildFile(b, ctx());
  const slot = out.inventory_slots[0];
  assert.equal(slot.unique_name, 'Tabula Rasa');
  assert.match(slot.additional_text, /Corrupted/);
  assert.match(slot.additional_text, /\+\(90-99\) to maximum Life/);
});

test('empty and item-less gear cells produce no inventory slot', () => {
  const b = mk({ name: 'X' });
  b.gear.helmet = { item: null, mods: [], corrupted: null };
  b.gear.nonsense_slot = { item: { kind: 'base', slug: 'ancestral-tiara' }, mods: [], corrupted: null };
  assert.deepEqual(buildToBuildFile(b, ctx()).inventory_slots, [],
    'an unmapped slot id is skipped, never emitted with a bogus inventory_id');
});

test('SLOT_TO_INVENTORY covers every planner slot exactly once', () => {
  const planner = JSON.parse(fs.readFileSync(path.join(GEN, 'planner-data.json'), 'utf8'));
  for (const s of planner.slots) {
    assert.ok(SLOT_TO_INVENTORY[s.id], `slot ${s.id} has no inventory_id mapping`);
  }
  const vals = Object.values(SLOT_TO_INVENTORY);
  assert.equal(new Set(vals).size, vals.length, 'inventory ids must be unique');
});

test('passives follow notablePriority order, then the rest', () => {
  const b = mk({ name: 'X' });
  b.tree = {
    code: encode(synthesizeState({ allocated: [100, 200, 300], ascByte: 0 })),
    notablePriority: [300, 100],
  };
  const out = buildToBuildFile(b, ctx());
  assert.deepEqual(out.passives.map((p) => p.id), ['criticals86', 'spells18', 'cast_speed10']);
});

test('weapon-set passives carry weapon_set 1 or 2', () => {
  const b = mk({ name: 'X' });
  b.tree = {
    code: encode(synthesizeState({ allocated: [100], ws1: [200], ws2: [300], ascByte: 0 })),
    notablePriority: [],
  };
  const out = buildToBuildFile(b, ctx());
  const byId = Object.fromEntries(out.passives.map((p) => [p.id, p]));
  assert.equal(byId.spells18.weapon_set, undefined, 'main-tree nodes carry no weapon_set');
  assert.equal(byId.cast_speed10.weapon_set, 1);
  assert.equal(byId.criticals86.weapon_set, 2);
});

test('hashes with no known passive id are skipped', () => {
  const b = mk({ name: 'X' });
  b.tree = { code: encode(synthesizeState({ allocated: [100, 99999], ascByte: 0 })), notablePriority: [] };
  assert.deepEqual(buildToBuildFile(b, ctx()).passives.map((p) => p.id), ['spells18']);
});

test('no tree code yields no passives and does not throw', () => {
  const out = buildToBuildFile(mk({ name: 'X' }), ctx());
  assert.deepEqual(out.passives, []);
});

test('an undecodable tree code degrades to no passives instead of throwing', () => {
  const b = mk({ name: 'X' });
  b.tree = { code: 'not-a-real-code', notablePriority: [] };
  assert.deepEqual(buildToBuildFile(b, ctx()).passives, []);
});

test('buildFileName sanitizes and extends', () => {
  assert.equal(buildFileName('Stormweaver Arc'), 'Stormweaver Arc.build');
  assert.equal(buildFileName('Lv 1-30 / "early"'), 'Lv 1-30 _early_.build');
  assert.equal(buildFileName('   '), 'build.build');
  assert.ok(buildFileName('x'.repeat(200)).length <= 66);
});

// ---- conformance against the real files -----------------------------------

test('our output shape is a subset of the real fixtures\' shape', () => {
  const real = JSON.parse(fs.readFileSync(path.join(FIX, 'mobalytics-frostwall-gem-setup.build'), 'utf8'));
  const b = mk({ name: 'X', ascendancy: 'stormweaver' });
  b.gear.body = { item: { kind: 'unique', slug: 'tabula-rasa' }, mods: [], corrupted: null };
  b.gear.helmet = { item: { kind: 'base', slug: 'ancestral-tiara' },
    mods: [{ affix: 'maximum_life', tier: 'MaximumLife7' }], corrupted: null };
  b.skills = [{ gem: { slug: 'spark' }, level: null, supports: [{ slug: 'martial-tempo' }] }];
  b.tree = { code: encode(synthesizeState({ allocated: [100], ws1: [200], ascByte: 0 })), notablePriority: [] };
  const out = buildToBuildFile(b, ctx());

  const rootKeys = new Set(Object.keys(real).concat(['description']));
  for (const k of Object.keys(out)) assert.ok(rootKeys.has(k), `root key ${k} is not in the real format`);

  const slotKeys = new Set(real.inventory_slots.flatMap(Object.keys));
  for (const s of out.inventory_slots) {
    for (const k of Object.keys(s)) assert.ok(slotKeys.has(k), `inventory_slot key ${k} is not in the real format`);
  }
  const skillKeys = new Set(real.skills.flatMap((s) => Object.keys(s)));
  for (const s of out.skills) {
    for (const k of Object.keys(s)) assert.ok(skillKeys.has(k), `skill key ${k} is not in the real format`);
  }
  const passiveKeys = new Set(real.passives.flatMap(Object.keys));
  for (const p of out.passives) {
    for (const k of Object.keys(p)) assert.ok(passiveKeys.has(k), `passive key ${k} is not in the real format`);
  }
});

test('exporting with the REAL id maps emits ids the game itself uses', () => {
  const b = mk({ name: 'Real Ids', ascendancy: 'infernalist' });
  b.skills = [{ gem: { slug: 'spark' }, level: null, supports: [] }];
  const out = buildToBuildFile(b, ctx({ ids: realIds() }));
  assert.equal(out.ascendancy, 'Witch1');
  assert.match(out.skills[0].id, /^Metadata\/[Ii]tems\/Gems?\/SkillGem/);
});
```

**Before writing the implementation, verify `synthesizeState`'s parameter names** (`allocated`, `ws1`, `ws2`, `ascByte`, `ascOf`, `isAttr`, `attrOf`) against `public/js/passive-code.js:181` and confirm `encode(synthesizeState(...))` produces a code `decode()` accepts with the ws nodes landing in `records.trailing` with `subType` `0x02`/`0x03`:

```bash
node --input-type=module -e "
import { synthesizeState, encode, decode } from './public/js/passive-code.js';
const code = encode(synthesizeState({ allocated: [100, 200], ws1: [300], ws2: [400], ascByte: 0 }));
console.log(JSON.stringify(decode(code), null, 1));
"
```

Expected: `nodes` contains 100/200; `records.trailing` has 300 with `subType: 2` and 400 with `subType: 3`. **If `synthesizeState` needs the extra callbacks to run, pass no-ops** (`ascOf: () => null, isAttr: () => false, attrOf: () => 'str'`) and adjust the tests to match what it actually accepts.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
node --test test/build-file.test.js 2>&1 | tail -12
```

Expected: FAIL — cannot find `../public/js/build-file.js`.

- [ ] **Step 4: Implement the exporter**

Create `public/js/build-file.js`:

```js
// public/js/build-file.js
// Pure ES module — our build -> GGG's official in-game Build Planner file
// (`.build`, JSON, v1 Experimental; pathofexile.com/developer/docs/game).
//
// Every id space here was confirmed against REAL .build files exported by the
// game, committed at test/fixtures/build-files/ (see its README):
//   passives[].id  PassiveSkills string id ("spells18") — NOT the node hash
//   skills[].id    BaseItemTypes metadata id, verbatim from the graph node key
//   ascendancy     GGG ascendancy id ("Witch1")
//   weapon_set     1 | 2, from the tree code's trailing-record subType
//
// Unmappable pieces are SKIPPED, never emitted with a guessed id: a file the
// game rejects is worse than one that omits a slot.
import { decode as decodePassiveCode } from './passive-code.js';
import { resolveMod } from './mod-core.js';

/**
 * Our gear slot id -> GGG Inventories table id. Hand-authored export-format
 * glue (not game data, so not a data/manual overlay — same class of thing as
 * tradeUrl's mappings). The 13 slots the real fixtures exercised are observed;
 * `Offhand2`/`Flask2` follow the established `*1`/`*2` pattern and are pending
 * an in-game import check.
 */
export const SLOT_TO_INVENTORY = {
  weapon1a: 'Weapon1',
  weapon1b: 'Offhand1',
  weapon2a: 'Weapon2',
  weapon2b: 'Offhand2',
  helmet: 'Helm1',
  body: 'BodyArmour1',
  gloves: 'Gloves1',
  boots: 'Boots1',
  belt: 'Belt1',
  amulet: 'Amulet1',
  ring1: 'Ring1',
  ring2: 'Ring2',
  flask1: 'Flask1',
  flask2: 'Flask2',
  charm1: 'Charm1',
};

// Weapon-set trailing records: subType 0x02 = set I, 0x03 = set II. The docs
// call weapon_set a 0-2 index; the real fixtures only ever use 1 and 2.
const WS_FOR_SUBTYPE = { 2: 1, 3: 2 };

/** A filesystem-safe `<name>.build`. */
export function buildFileName(name) {
  const safe = String(name ?? '').replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim().slice(0, 60);
  return `${safe || 'build'}.build`;
}

// Allocated hashes in a stable order, plus which weapon set (if any) each
// belongs to. A garbage/legacy code degrades to "nothing allocated" rather than
// exploding the whole export.
function allocations(code) {
  if (!code) return [];
  let state;
  try { state = decodePassiveCode(code); } catch { return []; }
  const out = [];
  for (const h of state.nodes ?? []) out.push({ h, ws: null });
  for (const h of state.ascNodes ?? []) out.push({ h, ws: null });
  for (const r of state.records?.trailing ?? []) {
    const ws = WS_FOR_SUBTYPE[r.subType];
    if (ws) out.push({ h: r.hash, ws });
  }
  return out;
}

function modLines(cell, pools) {
  if (!pools) return [];
  return (cell.mods ?? []).map((m) => resolveMod(pools, m)).filter(Boolean).map((m) => m.text);
}

function inventorySlot(slotId, cell, { pools, resolveRef }) {
  const inventory_id = SLOT_TO_INVENTORY[slotId];
  if (!inventory_id || !cell?.item) return null;
  const slot = { inventory_id, slot_x: 0, slot_y: 0 };
  const name = resolveRef(cell.item)?.name ?? cell.item.slug;
  const corrupted = cell.corrupted && pools ? resolveMod(pools, cell.corrupted) : null;

  if (cell.item.kind === 'unique') {
    slot.unique_name = name;
    if (corrupted) slot.additional_text = `Corrupted\n${corrupted.text}`;
    return slot;
  }
  // Planned (non-unique) items travel as a hint in the fixtures' own
  // convention: base name, then 1.-numbered target modifiers.
  const lines = modLines(cell, pools);
  const parts = [name, ...lines.map((t, i) => `${i + 1}. ${t}`)];
  if (corrupted) parts.push(`Corrupted: ${corrupted.text}`);
  slot.additional_text = parts.join('\n');
  return slot;
}

function skillEntry(gemSlug, supports, gemIds) {
  const id = gemIds[gemSlug];
  if (!id) return null;                       // never emit an id the game can't resolve
  const support_skills = (supports ?? [])
    .map((s) => gemIds[s.slug]).filter(Boolean).map((sid) => ({ id: sid }));
  return support_skills.length ? { id, support_skills } : { id };
}

/**
 * Our build -> a `Build` object ready to `JSON.stringify` into a `.build` file.
 * @param {object} build
 * @param {{ids: {gemIds: object, ascendancyIds: object, passiveIds: object},
 *          pools: object, resolveRef: (ref: object) => ({name?: string}|null),
 *          grantedRows?: (build: object) => {key: string, skill: string, supports: object[]}[]}} ctx
 * @returns {object}
 */
export function buildToBuildFile(build, ctx) {
  const { ids, pools, resolveRef, grantedRows } = ctx;
  const { gemIds = {}, ascendancyIds = {}, passiveIds = {} } = ids ?? {};

  const out = { name: String(build.name ?? 'Untitled Build') };
  if (build.description) out.description = build.description;
  const asc = build.ascendancy ? ascendancyIds[build.ascendancy] : null;
  if (asc) out.ascendancy = asc;

  // ---- passives: notablePriority first (this drives the in-game
  //      "allocate next" line), then everything else still allocated.
  const alloc = allocations(build.tree?.code);
  const wsByHash = new Map(alloc.map((a) => [a.h, a.ws]));
  const allocated = new Set(alloc.map((a) => a.h));
  const prioritized = (build.tree?.notablePriority ?? []).filter((h) => allocated.has(h));
  const seen = new Set(prioritized);
  const ordered = [...prioritized, ...alloc.map((a) => a.h).filter((h) => !seen.has(h) && !seen.add(h))];
  out.passives = ordered.flatMap((h) => {
    const id = passiveIds[String(h)];
    if (!id) return [];                       // e.g. unnamed filler nodes
    const ws = wsByHash.get(h);
    return [ws ? { id, weapon_set: ws } : { id }];
  });

  // ---- skills: authored setups, then item-granted ones.
  const granted = grantedRows ? grantedRows(build) : [];
  out.skills = [
    ...(build.skills ?? []).map((s) => skillEntry(s.gem?.slug, s.supports, gemIds)),
    ...granted.map((r) => skillEntry(r.skill, r.supports, gemIds)),
  ].filter(Boolean);

  // ---- inventory
  out.inventory_slots = Object.entries(build.gear ?? {})
    .map(([slotId, cell]) => inventorySlot(slotId, cell, { pools, resolveRef }))
    .filter(Boolean);

  return out;
}
```

Note the `!seen.has(h) && !seen.add(h)` idiom dedupes while filtering (`Set.add` returns the set, so `!set.add(x)` is always `false`... **it is not** — it returns the Set which is truthy, so `!seen.add(h)` is `false`). **Write it as an explicit loop instead** to avoid that trap:

```js
  const ordered = [...prioritized];
  for (const a of alloc) if (!seen.has(a.h)) { seen.add(a.h); ordered.push(a.h); }
```

Use the explicit loop; delete the one-liner.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node --test test/build-file.test.js 2>&1 | tail -10
npm test 2>&1 | tail -8
```

Expected: `build-file.test.js` all PASS; full suite `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add public/js/build-file.js test/build-file.test.js test/fixtures/build-files/
git commit -m "feat(planner): pure .build exporter mapped against real in-game fixtures"
```

---

### Task 5: Variant strip UI — switch, add, rename, unlink

**Files:**
- Modify: `public/js/editor-render.js` (new `renderVariantStrip`, called from `renderEditor`; `renderSwitcher` nesting)
- Modify: `public/js/build-editor.js` (variant actions)
- Modify: `public/css/builds.css`
- Test: `test/buildsRender.test.js` (pure render assertions)

**Interfaces:**
- Consumes: `store.addVariant` / `renameVariant` / `removeVariant` / `parentOf` / `group` (Task 1).
- Produces:
  - `renderVariantStrip(build, ctx) → string` — exported from `editor-render.js`; renders nothing when there is no group and the mode is read-only.
  - `ctx.group` — `{ parent, variants }` (from `store.group(buildId)`) threaded into `renderEditor`.
  - `ctx.variantRenaming` — `buildId | null`, the entry being relabeled inline.
  - DOM hooks: `data-variant-add`, `data-variant-tab="<buildId>"`, `data-variant-rename="<buildId>"`, `data-variant-unlink="<buildId>"`, `data-variant-label-input`.

- [ ] **Step 1: Write the failing render tests**

Append to `test/buildsRender.test.js` (it already imports from `editor-render.js`; extend that import with `renderVariantStrip`):

```js
// ---- Phase 8: variant strip ----------------------------------------------

const stripCtx = (over = {}) => ({
  planner: { classes: [], slots: [], items: {}, gems: {} },
  resolveRef: () => null, mode: 'edit', ...over,
});
const vb = (id, name) => ({ ...emptyBuild({ now: () => 1, uuid: () => id }), name });

test('renderVariantStrip renders nothing for a standalone build in edit mode', () => {
  const b = vb('p', 'Solo');
  const html = renderVariantStrip(b, stripCtx({ group: { parent: b, variants: [] }, currentId: 'p' }));
  assert.match(html, /data-variant-add/, 'a standalone build still offers "add variant"');
  assert.ok(!html.includes('data-variant-tab'), 'no tabs without variants');
});

test('renderVariantStrip renders nothing at all in read-only mode without variants', () => {
  const b = vb('p', 'Solo');
  const html = renderVariantStrip(b, stripCtx({ mode: 'import', group: { parent: b, variants: [] }, currentId: 'p' }));
  assert.equal(html.trim(), '');
});

test('renderVariantStrip renders parent + ordered variant tabs, current marked', () => {
  const parent = vb('p', 'Guide');
  const group = { parent, variants: [
    { label: 'Lv 1-30', build: vb('v1', 'Lv 1-30') },
    { label: 'Lv 30-60', build: vb('v2', 'Lv 30-60') },
  ] };
  const html = renderVariantStrip(group.variants[0].build, stripCtx({ group, currentId: 'v1' }));
  assert.match(html, /data-variant-tab="p"/);
  assert.match(html, /data-variant-tab="v1"/);
  assert.match(html, /data-variant-tab="v2"/);
  assert.ok(html.indexOf('data-variant-tab="v1"') < html.indexOf('data-variant-tab="v2"'), 'list order is preserved');
  assert.match(html, /data-variant-tab="v1"[^>]*class="[^"]*is-current/,
    'the current variant is marked');
  assert.match(html, /Lv 1-30/);
});

test('renderVariantStrip escapes labels', () => {
  const parent = vb('p', 'Guide');
  const group = { parent, variants: [{ label: '<script>x</script>', build: vb('v1', 'x') }] };
  const html = renderVariantStrip(parent, stripCtx({ group, currentId: 'p' }));
  assert.ok(!html.includes('<script>'), 'label is escaped');
  assert.match(html, /&lt;script&gt;/);
});

test('renderVariantStrip read-only hides add/rename/unlink controls', () => {
  const parent = vb('p', 'Guide');
  const group = { parent, variants: [{ label: 'Lv 1-30', build: vb('v1', 'Lv 1-30') }] };
  const html = renderVariantStrip(parent, stripCtx({ mode: 'import', group, currentId: 'p' }));
  assert.match(html, /data-variant-tab="v1"/, 'tabs still switch in a shared view');
  assert.ok(!html.includes('data-variant-add'));
  assert.ok(!html.includes('data-variant-unlink'));
  assert.ok(!html.includes('data-variant-rename'));
});

test('renderVariantStrip swaps the current tab for an input while renaming', () => {
  const parent = vb('p', 'Guide');
  const group = { parent, variants: [{ label: 'Lv 1-30', build: vb('v1', 'Lv 1-30') }] };
  const html = renderVariantStrip(group.variants[0].build,
    stripCtx({ group, currentId: 'v1', variantRenaming: 'v1' }));
  assert.match(html, /data-variant-label-input/);
  assert.match(html, /value="Lv 1-30"/);
});

test('renderEditor includes the variant strip', () => {
  const parent = vb('p', 'Guide');
  const group = { parent, variants: [{ label: 'Lv 1-30', build: vb('v1', 'Lv 1-30') }] };
  const html = renderEditor(parent, stripCtx({ group, currentId: 'p', builds: [parent] }));
  assert.match(html, /data-variant-tab="v1"/);
});
```

Ensure the test file imports `emptyBuild` and the new `renderVariantStrip`. If `buildsRender.test.js` does not already import from `editor-render.js`, add:

```js
import { renderEditor, renderVariantStrip } from '../public/js/editor-render.js';
import { emptyBuild } from '../public/js/build-store.js';
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test test/buildsRender.test.js 2>&1 | tail -10
```

Expected: FAIL — `renderVariantStrip is not exported`.

- [ ] **Step 3: Implement the strip renderer**

In `public/js/editor-render.js`, add above `renderEditor`:

```js
/**
 * Variant strip: the parent build plus its ordered labeled siblings as tabs
 * (Amendment 2). Rendered on the editor and on a shared group view, where the
 * tabs switch the decoded snapshot instead of navigating.
 */
export function renderVariantStrip(build, ctx) {
  const group = ctx.group;
  const ro = (ctx.mode ?? 'edit') !== 'edit';
  const variants = group?.variants ?? [];
  if (ro && !variants.length) return '';

  const tab = (id, label, current) => {
    if (!ro && ctx.variantRenaming === id) {
      return `<li><input class="variant-tab__input" data-variant-label-input type="text" maxlength="40"
        value="${esc(label)}" aria-label="Variant label" spellcheck="false"></li>`;
    }
    const controls = ro || !current || id === group?.parent?.id ? '' :
      `<button class="variant-tab__edit" type="button" data-variant-rename="${esc(id)}"
         title="Rename variant" aria-label="Rename variant">✎</button>
       <button class="variant-tab__drop" type="button" data-variant-unlink="${esc(id)}"
         title="Detach from this group" aria-label="Detach variant from group">×</button>`;
    return `<li><button class="variant-tab${current ? ' is-current' : ''}" type="button"
      data-variant-tab="${esc(id)}" aria-current="${current ? 'true' : 'false'}">${esc(label)}</button>${controls}</li>`;
  };

  const parentTab = group ? tab(group.parent.id, group.parent.name, group.parent.id === ctx.currentId) : '';
  const rows = variants.map((v) => tab(v.build.id, v.label, v.build.id === ctx.currentId)).join('');
  const add = ro ? '' :
    `<li><button class="variant-tab variant-tab--add" type="button" data-variant-add
       title="Duplicate this build as the next variant">＋ Variant</button></li>`;

  return `<div class="variant-strip" data-variant-strip>
    <span class="variant-strip__label">Variants</span>
    <ul class="variant-strip__tabs">${parentTab}${rows}${add}</ul>
  </div>`;
}
```

In `renderEditor`, insert the strip between the head and the gear chapter:

```js
      ${renderVariantStrip(build, ctx)}
      ${renderGear(build, ctx)}
```

Also nest variants under their parent in `renderSwitcher` so the popover shows structure — replace the `rows` map body's return with:

```js
    const kids = (b.variants ?? []).length;
    return `<li><a class="build-switcher__row${current ? ' is-current' : ''}" href="#/b/${encodeURIComponent(b.id)}">
      <b>${esc(b.name)}</b>
      <span>${esc(classLine(b))} · ${items} items · ${b.skills.length} setups${kids ? ` · ${kids} variant${kids > 1 ? 's' : ''}` : ''}</span></a></li>`;
```

- [ ] **Step 4: Wire the editor actions**

In `public/js/build-editor.js`:

Add state next to `renaming`:

```js
  let variantRenaming = null;   // buildId of the variant label being edited
```

Thread the group + rename state into `renderEditor` inside `render()`:

```js
    container.innerHTML = renderEditor(b, {
      planner, resolveRef, pools, weaponSet, mode, itemMath, treeLines, summaryCollapsed,
      builds: store.list(), currentId: buildId, switcherOpen, classPicker, renaming,
      group: store.group(buildId), variantRenaming,
    });
```

Add handlers in `onClick`, before the `[data-share]` block:

```js
    if (e.target.closest('[data-variant-add]')) {
      const g = store.group(buildId);
      const parentId = g?.parent?.id ?? buildId;
      const label = `Variant ${(g?.variants?.length ?? 0) + 1}`;
      const child = safeWrite(() => store.addVariant(parentId, label));
      if (child) location.hash = `#/b/${encodeURIComponent(child.id)}`;
      return;
    }
    const vtab = attr('data-variant-tab');
    if (vtab) {
      if (vtab !== buildId) location.hash = `#/b/${encodeURIComponent(vtab)}`;
      return;
    }
    const vrename = attr('data-variant-rename');
    if (vrename) {
      variantRenaming = vrename;
      render();
      const inp = container.querySelector('[data-variant-label-input]');
      inp?.focus();
      inp?.select();
      return;
    }
    const vunlink = attr('data-variant-unlink');
    if (vunlink) {
      const g = store.group(buildId);
      if (g?.parent && window.confirm('Detach this variant from the group? The build itself is kept.')) {
        safeWrite(() => store.removeVariant(g.parent.id, vunlink));
      }
      return;
    }
```

Commit the label edit alongside the existing rename commit. Extend `commitRename` with a sibling function and hook both into `onFocusOut`/`onKeyDown`:

```js
  function commitVariantLabel(input) {
    if (!variantRenaming) return;
    const id = variantRenaming;
    variantRenaming = null;
    const v = input.value.trim();
    const g = store.group(buildId);
    const cur = g?.variants.find((x) => x.buildId === id)?.label;
    if (v && v !== cur && g?.parent) safeWrite(() => store.renameVariant(g.parent.id, id, v));
    else render();
  }
```

```js
  function onFocusOut(e) {
    if (e.target.closest?.('[data-build-name-input]')) { commitRename(e.target); return; }
    if (e.target.closest?.('[data-variant-label-input]')) commitVariantLabel(e.target);
  }
  function onKeyDown(e) {
    if (e.target.closest?.('[data-variant-label-input]')) {
      if (e.key === 'Enter') { e.preventDefault(); commitVariantLabel(e.target); }
      if (e.key === 'Escape') { variantRenaming = null; render(); }
      return;
    }
    if (!e.target.closest?.('[data-build-name-input]')) return;
    if (e.key === 'Enter') { e.preventDefault(); commitRename(e.target); }
    if (e.key === 'Escape') { renaming = false; render(); }
  }
```

- [ ] **Step 5: Add the CSS**

Append to `public/css/builds.css`:

```css
/* ---- Phase 8: variant strip ------------------------------------------- */
.variant-strip {
  display: flex; align-items: center; gap: .75rem;
  margin: 0 0 1.25rem; padding-bottom: .5rem;
  border-bottom: 1px solid var(--rule, rgba(255,255,255,.08));
  flex-wrap: wrap;
}
.variant-strip__label {
  font-size: .7rem; letter-spacing: .12em; text-transform: uppercase;
  opacity: .55; flex: 0 0 auto;
}
.variant-strip__tabs {
  display: flex; align-items: center; gap: .35rem;
  list-style: none; margin: 0; padding: 0; flex-wrap: wrap;
}
.variant-strip__tabs > li { display: flex; align-items: center; }
.variant-tab {
  appearance: none; background: transparent; cursor: pointer;
  border: 1px solid var(--rule, rgba(255,255,255,.12)); border-radius: 999px;
  padding: .3rem .7rem; font: inherit; font-size: .82rem;
  color: inherit; opacity: .72;
}
.variant-tab:hover { opacity: 1; }
.variant-tab.is-current {
  opacity: 1; font-weight: 600;
  border-color: var(--accent, #c8aa6e); color: var(--accent, #c8aa6e);
}
.variant-tab--add { opacity: .55; border-style: dashed; }
.variant-tab--add:hover { opacity: .95; }
.variant-tab__edit, .variant-tab__drop {
  appearance: none; background: none; border: 0; cursor: pointer;
  color: inherit; opacity: .4; padding: .15rem .25rem; font-size: .8rem; line-height: 1;
}
.variant-tab__edit:hover { opacity: .9; }
.variant-tab__drop:hover { opacity: .9; color: var(--danger, #d06a6a); }
.variant-tab__input {
  font: inherit; font-size: .82rem; padding: .3rem .7rem;
  border-radius: 999px; border: 1px solid var(--accent, #c8aa6e);
  background: rgba(0,0,0,.25); color: inherit; max-width: 12rem;
}
```

- [ ] **Step 6: Run the tests**

```bash
node --test test/buildsRender.test.js 2>&1 | tail -8
npm test 2>&1 | tail -8
```

Expected: `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add public/js/editor-render.js public/js/build-editor.js public/css/builds.css test/buildsRender.test.js
git commit -m "feat(planner): variant strip — switch, add, relabel and detach sibling builds"
```

---

### Task 6: Group share + view-first group import

**Files:**
- Modify: `public/js/builds-page.js`
- Modify: `public/js/editor-render.js` (import-mode banner copy)
- Test: `test/buildsRender.test.js` (import-state rendering)

**Interfaces:**
- Consumes: `decodeGroup` (Task 2), `store.importGroup`/`store.group` (Task 1), `renderVariantStrip` (Task 5).
- Produces:
  - `importState = { code, state: {status, group?, message?}, weaponSet, activeId }` where `activeId` is `'parent'` or a variant index — the client-side variant selection for a shared group, persisted nowhere.
  - `#/import/<code>` renders the selected snapshot read-only with a working variant strip.
  - "Save a copy" imports the **whole group**.

**Crawler note:** `#/import/<code>` is a URL *fragment* on the already-prerendered `/builds` shell — the prerender crawler never visits fragments, so no new crawlable URL is introduced and `extractLinks()` needs no change. The two new generated artifacts are static files under `public/generated/`, copied into `dist/` like every other artifact. Verify, don't assume, in Task 8.

- [ ] **Step 1: Write the failing tests**

Append to `test/buildsRender.test.js`:

```js
// ---- Phase 8: shared group view -----------------------------------------

test('renderVariantStrip in import mode marks the active decoded snapshot', () => {
  const parent = vb('shared-parent', 'Guide');
  const group = { parent, variants: [
    { label: 'Lv 1-30', build: vb('shared-v0', 'Early') },
    { label: 'Lv 30-60', build: vb('shared-v1', 'Mid') },
  ] };
  const html = renderVariantStrip(group.variants[1].build,
    stripCtx({ mode: 'import', group, currentId: 'shared-v1' }));
  assert.match(html, /data-variant-tab="shared-v1"[^>]*class="[^"]*is-current/);
  assert.ok(!html.includes('data-variant-add'), 'a visitor cannot add variants to your group');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test test/buildsRender.test.js 2>&1 | tail -8
```

Expected: FAIL until Task 5's renderer handles `mode: 'import'` with a group (it does after Task 5 — if this passes immediately, that is fine; it is a regression guard for the group path).

- [ ] **Step 3: Reshape the import route**

In `public/js/builds-page.js`, replace the whole `// import view` block at the end of `render()` with:

```js
    // import view — decoded straight from the fragment. NOTHING is written to
    // this visitor's storage until "Save a copy" (Amendment 3: view first).
    if (importState?.code !== route.code) {
      const st = { code: route.code, state: { status: 'loading' }, weaponSet: 1, activeId: null };
      importState = st;
      // Guard every write with `importState === st` so a stale decode (from a
      // hash that has since moved to a different import code) can't clobber
      // the current importState after this chain settles.
      Promise.all([decodeGroup(route.code), loadDocs().catch(() => null), loadPlanner().catch(() => null), loadPools().catch(() => null)])
        .then(([group]) => { if (importState === st) st.state = { status: 'ready', group }; })
        .catch((e) => {
          if (importState === st) st.state = { status: 'error', message: e?.code === 'bad-version'
            ? 'This code was made by a newer version of the site.'
            : 'The code is damaged or incomplete — recopy the full link.' };
        })
        .finally(() => { if (importState === st) render(); });
    }
    // Same dossier page, read-only: planner data present renders the real
    // thing; without it (fetch failed) fall back to the plain preview.
    if (importState.state.status === 'ready' && planner) {
      const shown = sharedSnapshot(importState);
      view.innerHTML = renderEditor(shown.build, {
        planner, resolveRef, pools, weaponSet: importState.weaponSet, mode: 'import',
        group: shown.group, currentId: shown.id,
      });
    } else if (importState.state.status === 'ready') {
      view.innerHTML = renderImport({ status: 'ready', build: importState.state.group.parent }, resolveRef);
    } else {
      view.innerHTML = renderImport(importState.state, resolveRef);
    }
```

Add the helper above `render()`. Decoded builds are id-less, so the strip needs synthetic ids that are stable for a given code:

```js
  // A decoded group has no local ids (the codec strips them), so give each
  // snapshot a stable synthetic id for the variant strip to key on. These never
  // reach storage — importGroup mints real ids on "Save a copy".
  function sharedSnapshot(st) {
    const { parent, variants } = st.state.group;
    const tagged = {
      parent: { ...parent, id: 'shared:parent' },
      variants: variants.map((v, i) => ({ label: v.label, build: { ...v.build, id: `shared:${i}` } })),
    };
    const id = st.activeId ?? 'shared:parent';
    const found = id === 'shared:parent'
      ? tagged.parent
      : tagged.variants.find((v) => v.build.id === id)?.build ?? tagged.parent;
    return { build: found, group: tagged, id: found.id };
  }
```

- [ ] **Step 4: Handle the shared-view tab clicks and group save**

Still in `public/js/builds-page.js`, inside the `view.addEventListener('click', …)` handler: add a shared-view variant tab branch right after the existing `data-weapon-set` branch (the editor owns tabs on the build route; this owns them on the import route):

```js
    const vtab = attr('data-variant-tab');
    if (vtab && parseRoute(location.hash).view === 'import' && importState?.state.status === 'ready') {
      importState.activeId = vtab;
      render();
      return;
    }
```

and replace the existing `[data-import-save]` branch so the whole group lands:

```js
    if (e.target.closest('[data-import-save]') && importState?.state.status === 'ready') {
      const saved = safeWrite(() => store.importGroup(importState.state.group));
      if (saved) location.hash = `#/b/${encodeURIComponent(saved.id)}`;
    }
```

- [ ] **Step 5: Make the import banner group-aware**

In `public/js/editor-render.js`'s `renderEditor`, replace the `import` banner and rail note so a group share announces itself:

```js
  const sharedCount = (ctx.group?.variants ?? []).length;
  const banner = mode === 'view'
    ? '<p class="dossier-banner">Shared preview — this is exactly what someone opening your link sees.</p>'
    : mode === 'import'
      ? `<p class="dossier-banner">Shared build preview — not saved in this browser yet.${
          sharedCount ? ` This link carries ${sharedCount} variant${sharedCount > 1 ? 's' : ''}; “Save a copy” keeps the whole group.` : ''}</p>`
      : '';
```

and, in the `import` branch of `railNote`:

```js
  const railNote = mode === 'import'
    ? 'Someone shared this build with you. Save a copy to make it yours.'
    : 'Saved in this browser only. The share link makes this build portable.';
```

(unchanged — verify it still reads correctly with the strip present; no edit needed if so).

Also confirm the `[data-share]` handler from Task 2 now shares the group. In `public/js/build-editor.js` the toast copy should say so:

```js
        .then((code) => {
          const url = `${location.origin}/builds#/import/${code}`;
          const n = (store.group(buildId)?.variants ?? []).length;
          return navigator.clipboard.writeText(url).then(
            () => { btn.textContent = n ? `Link copied ✓ (${n + 1} builds)` : 'Link copied ✓'; },
            () => { window.prompt('Copy this share link:', url); });
        })
```

- [ ] **Step 6: Run the tests**

```bash
npm test 2>&1 | tail -8
```

Expected: `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add public/js/builds-page.js public/js/editor-render.js public/js/build-editor.js test/buildsRender.test.js
git commit -m "feat(planner): a build group shares and previews as one view-first URL"
```

---

### Task 7: "Export for game" — download the `.build` file

**Files:**
- Modify: `public/js/editor-render.js` (action button + instruction note)
- Modify: `public/js/build-editor.js` (download handler)
- Modify: `public/css/builds.css`

**Interfaces:**
- Consumes: `buildToBuildFile`/`buildFileName` (Task 4), `loadBuildExport` (Task 3), `grantedRows` (already exported from `editor-render.js`), `pools`, `resolveRef`.
- Produces: `data-export-build` action in edit and view modes; a `Blob` download plus a one-line placement note.

- [ ] **Step 1: Add the action to the renderer**

In `public/js/editor-render.js`, in the `actions` map inside `renderEditor`:

```js
  const actions = {
    edit: `<button class="dossier-share" type="button" data-share>Copy share link</button>
      <button class="dossier-action" type="button" data-export-build>Export for game</button>
      <button class="dossier-action" type="button" data-view-published>View as shared</button>
      <button class="dossier-action" type="button" data-build-duplicate="${esc(build.id)}">Duplicate</button>
      <button class="dossier-action dossier-action--danger" type="button" data-build-delete="${esc(build.id)}">Delete</button>`,
    view: `<button class="dossier-share" type="button" data-edit-build>← Back to editing</button>
      <button class="dossier-action" type="button" data-share>Copy share link</button>
      <button class="dossier-action" type="button" data-export-build>Export for game</button>`,
    import: `<button class="dossier-share" type="button" data-import-save>Save a copy</button>`,
  }[mode];
```

and render a slot for the after-download note, right after the actions div:

```js
        <div class="dossier-actions">${actions}</div>
        <p class="dossier-export-note" data-export-note hidden></p>
```

- [ ] **Step 2: Wire the download**

In `public/js/build-editor.js`, extend the imports:

```js
import { encodeGroup } from '/static/js/build-code.js';
import { buildToBuildFile, buildFileName } from '/static/js/build-file.js';
import { grantedRows, renderEditor } from '/static/js/editor-render.js';
import { safeWrite, loadBuildExport } from '/static/js/build-host.js';
```

(merge with the existing `renderEditor` / `safeWrite` imports rather than duplicating them).

Add the handler in `onClick`, next to `[data-share]`:

```js
    if (e.target.closest('[data-export-build]')) {
      const btn = e.target.closest('[data-export-build]');
      const note = container.querySelector('[data-export-note]');
      btn.disabled = true;
      btn.textContent = 'Preparing…';
      loadBuildExport()
        .then((ids) => {
          const b = build();
          const file = buildToBuildFile(b, {
            ids, pools, resolveRef,
            grantedRows: (bb) => grantedRows(bb, planner),
          });
          const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = buildFileName(b.name);
          document.body.appendChild(a);
          a.click();
          a.remove();
          // Revoke on the next turn so the download has started.
          setTimeout(() => URL.revokeObjectURL(url), 0);
          if (note) {
            note.hidden = false;
            note.textContent = 'Saved. Put the file in Documents\\My Games\\Path of Exile 2\\BuildPlanner\\ '
              + 'to open it in the in-game Build Planner (PC only — consoles cannot import files).';
          }
        })
        .catch(() => {
          if (note) { note.hidden = false; note.textContent = 'Export data could not be loaded — try again.'; }
        })
        .finally(() => {
          btn.disabled = false;
          btn.textContent = 'Export for game';
        });
      return;
    }
```

**Verify `grantedRows`' signature before using it** — `editor-render.js:242` declares `grantedRows(build, planner)` and returns rows shaped `{key, item, skill, supports}`. Confirm with:

```bash
grep -n 'export function grantedRows' -A 12 public/js/editor-render.js
```

If the shape differs, adapt the `ctx.grantedRows` adapter (and Task 4's test double) to match reality.

- [ ] **Step 3: Style the note**

Append to `public/css/builds.css`:

```css
.dossier-export-note {
  flex-basis: 100%; margin: .5rem 0 0;
  font-size: .78rem; opacity: .7; line-height: 1.45;
}
```

- [ ] **Step 4: Verify by hand in the dev server**

```bash
npm run dev   # separate terminal
```

Open `http://localhost:3000/builds`, equip an item, add a skill setup, allocate a few tree nodes, click **Export for game**. Confirm a `.build` file downloads and that:

```bash
node -e "
const fs=require('fs'),os=require('os'),p=require('path');
const dir=p.join(os.homedir(),'Downloads');
const f=fs.readdirSync(dir).filter(x=>x.endsWith('.build')).map(x=>({x,t:fs.statSync(p.join(dir,x)).mtimeMs})).sort((a,b)=>b.t-a.t)[0];
const j=JSON.parse(fs.readFileSync(p.join(dir,f.x),'utf8'));
console.log('newest:',f.x);
console.log('root keys:',Object.keys(j));
console.log('passives:',j.passives.length,'skills:',j.skills.length,'slots:',j.inventory_slots.length);
console.log(JSON.stringify(j,null,1).slice(0,900));
"
```

Expected: root keys are a subset of `name/description/ascendancy/passives/skills/inventory_slots`; ids look like `spells18` and `Metadata/Items/Gem…`.

- [ ] **Step 5: Commit**

```bash
git add public/js/editor-render.js public/js/build-editor.js public/css/builds.css
git commit -m "feat(planner): export a build as GGG's in-game .build file"
```

---

### Task 8: Headless gate, static build, and roadmap close-out

**Files:**
- Create: `scripts/verify-sharing-export.mjs`
- Modify: `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md`
- Modify: `docs/TODO.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a headless DOM-glue gate mirroring `scripts/verify-tree-embed.mjs`; the roadmap's Phase 8 line and TODO #1 marked done.

- [ ] **Step 1: Write the headless verification script**

Create `scripts/verify-sharing-export.mjs`:

```js
#!/usr/bin/env node
// Manual DOM-glue verification for Phase 8 (sharing, variants, .build export).
//   npm run dev   # in another terminal (localhost:3000)
//   node scripts/verify-sharing-export.mjs
//
// node:test covers the pure cores (codec, store, build-file). This covers what
// only a browser can: the variant strip's store round trip, the group share URL
// surviving a reload into a clean profile-like context, and the export click
// producing a downloadable Build object.
import puppeteer from 'puppeteer-core';

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fails = [];
const ok = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'] });
try {
  // ---- 1) variants: add two, confirm the strip and the store agree ----
  const p = await browser.newPage();
  await p.goto(`${BASE}/builds`, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.evaluate(() => window.localStorage.clear());
  await p.goto(`${BASE}/builds`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1800);

  ok('editor mounts with a variant strip', await p.$('[data-variant-strip]') !== null);

  for (const n of [1, 2]) {
    await p.click('[data-variant-add]');
    await sleep(1200);
    ok(`add variant ${n} navigates to the new build`, /#\/b\//.test(p.url()), p.url());
  }
  const strip = await p.evaluate(() => ({
    tabs: [...document.querySelectorAll('[data-variant-tab]')].map((b) => b.textContent.trim()),
    current: document.querySelector('[data-variant-tab].is-current')?.textContent.trim() ?? null,
  }));
  ok('strip shows parent + 2 variants', strip.tabs.length === 3, JSON.stringify(strip.tabs));
  ok('the newest variant is the current tab', strip.current === 'Variant 2', String(strip.current));

  const stored = await p.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem('reveal.builds.v1'));
    const parent = Object.values(raw.builds).find((b) => (b.variants ?? []).length);
    return { builds: raw.order.length, schema: parent?.schema,
             labels: (parent?.variants ?? []).map((v) => v.label),
             linked: (parent?.variants ?? []).every((v) => !!raw.builds[v.buildId]) };
  });
  ok('store holds 3 builds at schema 3', stored.builds === 3 && stored.schema === 3, JSON.stringify(stored));
  ok('parent lists both labels in order', JSON.stringify(stored.labels) === '["Variant 1","Variant 2"]', JSON.stringify(stored.labels));
  ok('every variant entry points at a real build', stored.linked === true);

  // switch back to the parent by clicking its tab
  await p.evaluate(() => document.querySelector('[data-variant-tab]').click());
  await sleep(1200);
  ok('clicking the parent tab navigates', /#\/b\//.test(p.url()));

  // ---- 2) group share: encode here, decode in a fresh context ----
  const code = await p.evaluate(async () => {
    const { encodeGroup } = await import('/static/js/build-code.js');
    const { getStore } = await import('/static/js/build-host.js');
    const store = getStore();
    const parent = store.list().find((b) => (b.variants ?? []).length);
    return encodeGroup(store.group(parent.id));
  });
  ok('group encodes to a v2 code', typeof code === 'string' && code[0] === '2', `len ${code?.length}`);
  ok('code is fragment-safe', /^[A-Za-z0-9_-]+$/.test(code));

  const clean = await browser.createBrowserContext();
  const q = await clean.newPage();
  await q.goto(`${BASE}/builds#/import/${code}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep of 2200;
  const shared = await q.evaluate(() => ({
    banner: document.querySelector('.dossier-banner')?.textContent.trim() ?? null,
    tabs: [...document.querySelectorAll('[data-variant-tab]')].map((b) => b.textContent.trim()),
    canAdd: !!document.querySelector('[data-variant-add]'),
    canSave: !!document.querySelector('[data-import-save]'),
    stored: window.localStorage.getItem('reveal.builds.v1'),
  }));
  ok('shared group renders read-only with tabs', shared.tabs.length === 3, JSON.stringify(shared.tabs));
  ok('banner announces the variants', /variant/i.test(shared.banner ?? ''), shared.banner);
  ok('a visitor cannot add variants', shared.canAdd === false);
  ok('view-first: nothing was written to storage', shared.stored === null, String(shared.stored));

  // switching tabs must not persist anything either
  await q.evaluate(() => document.querySelectorAll('[data-variant-tab]')[2].click());
  await sleep(900);
  const afterSwitch = await q.evaluate(() => ({
    current: document.querySelector('[data-variant-tab].is-current')?.textContent.trim() ?? null,
    stored: window.localStorage.getItem('reveal.builds.v1'),
  }));
  ok('shared tabs switch the previewed snapshot', afterSwitch.current === 'Variant 2', String(afterSwitch.current));
  ok('switching still writes nothing', afterSwitch.stored === null);

  // save a copy imports the WHOLE group
  await q.click('[data-import-save]');
  await sleep(1600);
  const imported = await q.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem('reveal.builds.v1'));
    const parent = Object.values(raw.builds).find((b) => (b.variants ?? []).length);
    return { builds: raw.order.length, variants: (parent?.variants ?? []).length,
             linked: (parent?.variants ?? []).every((v) => !!raw.builds[v.buildId]) };
  });
  ok('save-a-copy imports parent + variants', imported.builds === 3 && imported.variants === 2, JSON.stringify(imported));
  ok('imported group is relinked to local ids', imported.linked === true);

  // ---- 3) a damaged code fails friendly, not blank ----
  const bad = await clean.newPage();
  await bad.goto(`${BASE}/builds#/import/2notarealcode`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  const errText = await bad.evaluate(() => document.body.textContent ?? '');
  ok('a damaged code shows a friendly error', /didn|damaged|incomplete/i.test(errText));

  // ---- 4) export: the click produces a real Build object ----
  const file = await p.evaluate(async () => {
    const [{ buildToBuildFile, buildFileName }, { loadBuildExport, getStore }, { grantedRows }] = await Promise.all([
      import('/static/js/build-file.js'),
      import('/static/js/build-host.js'),
      import('/static/js/editor-render.js'),
    ]);
    const planner = await fetch('/static/generated/planner-data.json').then((r) => r.json());
    const pools = await fetch('/static/generated/mod-pools.json').then((r) => r.json());
    const ids = await loadBuildExport();
    const b = getStore().list()[0];
    return {
      name: buildFileName(b.name),
      out: buildToBuildFile(b, { ids, pools, resolveRef: () => null, grantedRows: (x) => grantedRows(x, planner) }),
      idCounts: { gems: Object.keys(ids.gemIds).length, passives: Object.keys(ids.passiveIds).length },
    };
  });
  ok('export id artifacts both load', file.idCounts.gems > 900 && file.idCounts.passives > 5000, JSON.stringify(file.idCounts));
  ok('exported object has the required root keys',
    ['name', 'passives', 'skills', 'inventory_slots'].every((k) => k in file.out), JSON.stringify(Object.keys(file.out)));
  ok('exported filename ends in .build', /\.build$/.test(file.name), file.name);

  const btn = await p.$('[data-export-build]');
  ok('the editor exposes an Export for game action', btn !== null);
  if (btn) {
    await btn.click();
    await sleep(1500);
    const note = await p.evaluate(() => {
      const n = document.querySelector('[data-export-note]');
      return { hidden: n?.hidden, text: n?.textContent.trim() ?? '' };
    });
    ok('export click surfaces the placement note', note.hidden === false && /BuildPlanner/.test(note.text), note.text);
  }
} finally {
  await browser.close();
}

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
```

**Note the deliberate syntax error** `await sleep of 2200;` in the draft above — replace it with `await sleep(2200);`. (Left visible so the implementer reads the script rather than pasting it blind; fix it and confirm the file parses with `node --check scripts/verify-sharing-export.mjs`.)

- [ ] **Step 2: Run the headless gate**

```bash
node --check scripts/verify-sharing-export.mjs
npm run dev   # separate terminal, wait for "listening"
node scripts/verify-sharing-export.mjs
```

Expected: `all checks passed`, exit 0. Fix real failures; do not weaken assertions to pass.

- [ ] **Step 3: Run every gate**

```bash
npm test 2>&1 | tail -8
node scripts/verify-tree-embed.mjs      # Phase 5 regression (dev server up)
node scripts/verify-light-math.mjs      # Phase 7 regression
node scripts/verify-sitewide-pin.mjs    # Phase 6 regression
```

Expected: `fail 0` and `all checks passed` from each.

- [ ] **Step 4: Verify the static build**

```bash
npm run build:static 2>&1 | tail -25
ls -la dist/static/generated/build-export.json dist/static/generated/passive-build-ids.json
```

Expected: the crawler reports **9292+/9292+** with zero dead links, and both new artifacts are present in `dist/`. If either artifact is missing, the copy step in `scripts/prerender.js` needs the same treatment the other `public/generated/*` files get — check how they are copied and match it.

Then smoke-test the frozen output the way the deployed site would be hit:

```bash
node -e "
const http=require('http'),fs=require('fs'),p=require('path');
const root='dist';
const srv=http.createServer((req,res)=>{
  const u=req.url.split('?')[0].split('#')[0];
  let f=p.join(root,u==='/'?'index.html':u);
  if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=p.join(f,'index.html');
  if(!fs.existsSync(f))return void res.writeHead(404).end('nope');
  res.writeHead(200,{'content-type':f.endsWith('.js')?'text/javascript':f.endsWith('.json')?'application/json':'text/html'});
  fs.createReadStream(f).pipe(res);
});
srv.listen(4321,()=>console.log('dist server on http://localhost:4321'));
" &
sleep 2
node scripts/verify-sharing-export.mjs http://localhost:4321
kill %1
```

Expected: the same `all checks passed` against the **static** output — this is the static-only failure-mode check the roadmap requires.

- [ ] **Step 5: Tick the roadmap and TODO**

In `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md`, replace the two unchecked lines with (fill in the real completing commit hash and the honest gate numbers):

```markdown
- [x] Phase 8 — Sharing (incl. variants/group codec v2) & in-game `.build` export (2026-07-24, <first>..<last>) — **Variants:** schema v3 `variants: [{label, buildId}]` + store group API (`addVariant`/`renameVariant`/`removeVariant`/`parentOf`/`group`/`importGroup`); `remove` prunes stale references, deleting a parent orphans (never deletes) its variants, and `duplicate` no longer inherits a variant list. **Codec v2:** `encodeGroup`/`decodeGroup` pack a parent + ordered variant snapshots into one code; v1 codes still decode (guarded by a frozen v1 code literal in the test, since no v1 encoder remains). 8 heavy variants ≈ 1.5 KB encoded — deflate absorbs the redundancy as predicted. **Share UX:** view-first — a group URL renders read-only with a working variant strip and writes nothing to the visitor's storage until "Save a copy", which imports the whole relinked group. **`.build` export:** pure `build-file.js` mapped against two REAL in-game files committed at `test/fixtures/build-files/` (see its README). Fixture findings: `passives[].id` is the PassiveSkills **string** id (`"spells18"`), NOT the node hash the original spec assumed — all 411 fixture ids resolve in our RePoE copy, and 4782/4784 tree hashes map (the 2 misses are unnamed `Huntress3` filler nodes); `skills[].id` is our graph gem node key **verbatim**, because PoE2's `Metadata/Items/Gem/` and `Metadata/Items/Gems/` prefixes are two disjoint 593-gem sets that must not be normalized; `ascendancy` is the GGG id (`Witch1`); `weapon_set` is 1|2 from the tree code's trailing-record subType. Two new lazily-fetched artifacts (`build-export.json` ~12.6 KB gz, `passive-build-ids.json` ~36 KB gz) keep those id maps off the always-loaded `planner-data.json`/`passive-tree.json`. **Accept-the-hole:** `Offhand2`/`Flask2` inventory ids are emitted by pattern (neither fixture exercised them); item **mod ranges**, not rolled values, go into `additional_text` hints (we plan builds, we don't roll them); gem/passive `level_interval` is never emitted (we hold no bracket data per setup). **Deferred (owner decision 2026-07-24):** wishlist→trade **stat-filter** links (spec §3, always a stretch) — the trade-API stat-id mapping stays unbuilt; base-type trade links are unchanged. **Pending the only true oracle:** the owner's manual in-game import of a generated `.build` on PC. Gates: <N> tests, `build:static` <crawl>, headless `scripts/verify-sharing-export.mjs` (<M>/<M>) plus green Phase 5/6/7 gates.
- [x] TODO.md items 1, 3, 4 marked complete
```

In `docs/TODO.md`, mark item 1 done in the file's established style:

```markdown
1. ~~Make a Build Planner (save groups of items, skills, supports, etc.)~~ ✅ done (Build Planner roadmap, Phases 1–8)
```

- [ ] **Step 6: Final commit on the held branch**

```bash
git add docs/superpowers/specs/2026-07-06-build-planner-roadmap.md docs/TODO.md \
        docs/superpowers/plans/2026-07-24-sharing-variants-build-export.md scripts/verify-sharing-export.mjs
git commit -m "docs(planner): tick Phase 8 + TODO #1 — Build Planner roadmap complete"
git log --oneline -1
git branch --show-current
```

Expected: the branch is still `planner/phase-4a-builds-pages`. **Do not merge. Do not push to `main`.**

---

## Self-Review

**1. Spec coverage**

| Requirement | Task |
|---|---|
| Spec §1 export: editor Share → `encodeBuild` → copy `/builds#/import/<code>` | Task 2 (call site) + Task 6 (group-aware toast) |
| Spec §1 import: client router decodes → read-only preview → "Save a copy" → fresh ids | Task 6 |
| Spec §1 decode failures show a friendly error, never a blank page | Task 6 + Task 8 gate check 3 |
| Spec §1 version-prefixed codes | Task 2 |
| Spec §2 research spike: confirm id spaces against fixture files | **Done at plan time** — findings table above; fixtures committed in Task 4 |
| Spec §2 `passives[]` ids | Task 3 (`passiveIds`) + Task 4 |
| Spec §2 `skills[]` id space + mapping rule recorded | Task 3 (`gemIds` + its prefix test) + Task 4 README |
| Spec §2 enumerate `inventory_id`, map from Phase 2 slotIds | Task 4 `SLOT_TO_INVENTORY` + its coverage test |
| Spec §2 weapon-set passives + ascendancy expression | Task 4 |
| Spec §2 meta gems unsupported → skip gracefully | Task 4 (`skillEntry` returns null for unknown ids) |
| Spec §2 fixtures in `test/fixtures/build-files/` + findings note | Task 4 |
| Spec §2 `passives[]` follows `notablePriority` then the rest | Task 4 |
| Spec §2 chosen mods → `inventory_slots[].additional_text` | Task 4 |
| Spec §2 "Export for game" action + placement popover | Task 7 |
| Spec §3 wishlist → trade stat filters | **Deferred** by owner decision; recorded in the completion entry |
| Amendment 2 variants: full standalone siblings, `variants: [{label, buildId}]`, delete guards | Task 1 |
| Amendment 2 variant switcher strip + "Add variant" = duplicate + label | Task 5 |
| Amendment 3 view-first, nothing touches storage until Save a copy | Task 6 + gate assertion |
| Amendment 3 group shares carry every variant in one code | Tasks 2, 6 |
| Amendment 3 "Save a copy" imports the whole group, relinked | Task 1 `importGroup` + Task 6 |
| Amendment 3 codec v2 envelope, v1 still decodable | Task 2 |
| Acceptance: share round trip on the **static** site | Task 8 Step 4 |
| Acceptance: `.build` imports in-game | Owner-manual; flagged pending in the completion entry |
| Acceptance: codec tests green, malformed/oversized rejected | Task 2 |
| Acceptance: TODO #1 marked complete | Task 8 |

**2. Placeholder scan** — no TBDs. Two spots deliberately instruct *verify then adapt* rather than asserting an accessor blind (`nodesByKind(...).id` in Task 3 Step 3, `synthesizeState`/`grantedRows` signatures in Tasks 4 and 7); each ships the exact command to run and what to do with the answer. One deliberate syntax error is planted and called out in Task 8 Step 1.

**3. Type consistency** — `store.group()` returns `{parent, variants: [{label, build}]}`, the same shape `encodeGroup` takes, `decodeGroup` returns, `importGroup` consumes, and `ctx.group` carries into `renderVariantStrip`. One shape end to end. `buildToBuildFile(build, ctx)`'s `ctx.ids` is exactly `loadBuildExport()`'s merged `{gemIds, ascendancyIds, passiveIds}`. `SLOT_TO_INVENTORY` keys are asserted against live `planner-data.json` slot ids rather than trusted.

**Known risk, stated plainly:** the in-game import is unverifiable from here. `Offhand2`/`Flask2` and the exact tolerance for range-text `additional_text` are the two places a real import could still disappoint, and both are isolated to `build-file.js` constants/strings — a one-line fix each once the owner tests a file.
