# Build Store Foundation (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The persistence + serialization layer for the Build Planner: a versioned localStorage build store and a compressed URL-share codec, as pure dual-use (node + browser) ES modules with tests. No UI.

**Architecture:** Two pure modules under `public/js/` following the `query-core.js` / `passive-code.js` pattern: `build-store.js` (schema helpers + `createStore(storage)` over an injected storage interface) and `build-code.js` (canonical JSON → deflate via `CompressionStream` → base64url, reusing `passive-code.js`'s base64 helpers). Tests use `node:test` with in-memory storage — no DOM, no browser.

**Tech Stack:** Vanilla ES modules, `node:test` (`npm test` = `node --test`), Web `CompressionStream`/`DecompressionStream` (global in Node ≥20 and evergreen browsers; use format `'deflate'`, NOT `'deflate-raw'` — raw is missing from some Node 20.x releases).

**Spec:** `docs/superpowers/specs/2026-07-06-build-store-design.md` — read it first.

## Global Constraints

- Modules must be importable unchanged in node and the browser: no `import` of node builtins, no top-level `window`/`document`/`localStorage` access. Environment injection only.
- Nothing outside `build-store.js` ever touches the raw localStorage keys.
- Storage keys: `reveal.builds.v1` (store), `reveal.builds.corrupt` (preserved corrupt payload). Schema version: `1`. Codec version prefix: `'1'`.
- Item refs are `{ kind, slug }` (browse-card key space). Unknown/extra fields on builds must pass through reads, updates, and the codec untouched (forward compatibility).
- Keep `npm test` green at every commit. No `Co-Authored-By` lines in commits.

---

### Task 1: Schema helpers — `emptyBuild` + `validateBuild`

**Files:**
- Create: `public/js/build-store.js`
- Test: `test/build-store.test.js`

**Interfaces:**
- Produces: `emptyBuild({ now, uuid, ...overrides }) -> build` and `validateBuild(obj) -> { ok: boolean, errors: string[] }`, plus constants `STORE_KEY`, `CORRUPT_KEY`, `SCHEMA_VERSION`. `validateBuild` treats `id`/`createdAt`/`updatedAt` as optional (the codec strips them) but type-checks them when present.

- [ ] **Step 1: Write the failing tests**

```js
// test/build-store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyBuild, validateBuild, SCHEMA_VERSION, STORE_KEY, CORRUPT_KEY,
} from '../public/js/build-store.js';

const fixedNow = () => 1000;
const fixedUuid = () => 'id-1';

test('emptyBuild fills v1 defaults', () => {
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid });
  assert.deepEqual(b, {
    id: 'id-1', schema: SCHEMA_VERSION, name: 'Untitled Build', notes: '',
    createdAt: 1000, updatedAt: 1000, class: null, ascendancy: null,
    gear: {}, unassigned: [], skills: [],
    tree: { code: null, notablePriority: [] },
  });
});

test('emptyBuild applies overrides', () => {
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid, name: 'Zap', class: 'Sorceress' });
  assert.equal(b.name, 'Zap');
  assert.equal(b.class, 'Sorceress');
});

test('validateBuild accepts a default build and an id-less canonical build', () => {
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid });
  assert.deepEqual(validateBuild(b), { ok: true, errors: [] });
  const { id, createdAt, updatedAt, ...canonical } = b;
  assert.deepEqual(validateBuild(canonical), { ok: true, errors: [] });
});

test('validateBuild accepts populated collections', () => {
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid });
  b.gear.helmet = { item: { kind: 'unique', slug: 'crown-of-eyes' }, wishlist: ['life'] };
  b.gear.body = { item: null, wishlist: [] };
  b.unassigned = [{ kind: 'base', slug: 'pronged-spear' }];
  b.skills = [{ gem: { slug: 'arc' }, level: 9, supports: [{ slug: 'unleash' }] }];
  b.tree = { code: 'AAAA', notablePriority: [12345, 678] };
  assert.equal(validateBuild(b).ok, true);
});

test('validateBuild rejects bad shapes with error paths', () => {
  for (const [mutate, path] of [
    [(b) => { b.name = 7; }, 'name'],
    [(b) => { b.schema = 'x'; }, 'schema'],
    [(b) => { b.gear = []; }, 'gear'],
    [(b) => { b.gear.helmet = { item: { kind: 'unique' }, wishlist: [] }; }, 'gear.helmet.item.slug'],
    [(b) => { b.gear.helmet = { item: null }; }, 'gear.helmet.wishlist'],
    [(b) => { b.unassigned = [{ kind: 'gem' }]; }, 'unassigned[0].slug'],
    [(b) => { b.skills = [{ gem: {}, level: null, supports: [] }]; }, 'skills[0].gem.slug'],
    [(b) => { b.skills = [{ gem: { slug: 'arc' }, level: 'x', supports: [] }]; }, 'skills[0].level'],
    [(b) => { b.tree.notablePriority = ['a']; }, 'tree.notablePriority[0]'],
    [(b) => { b.tree = null; }, 'tree'],
  ]) {
    const b = emptyBuild({ now: fixedNow, uuid: fixedUuid });
    mutate(b);
    const r = validateBuild(b);
    assert.equal(r.ok, false, `expected fail for ${path}`);
    assert.ok(r.errors.some((e) => e.includes(path)), `errors ${JSON.stringify(r.errors)} should mention ${path}`);
  }
  assert.equal(validateBuild(null).ok, false);
  assert.equal(validateBuild('nope').ok, false);
});

test('validateBuild passes unknown extra fields through untouched', () => {
  const b = { ...emptyBuild({ now: fixedNow, uuid: fixedUuid }), futureField: { x: 1 } };
  assert.equal(validateBuild(b).ok, true);
});

test('exported storage keys are stable', () => {
  assert.equal(STORE_KEY, 'reveal.builds.v1');
  assert.equal(CORRUPT_KEY, 'reveal.builds.corrupt');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/build-store.test.js`
Expected: FAIL — `Cannot find module '../public/js/build-store.js'`

- [ ] **Step 3: Write the implementation**

```js
// public/js/build-store.js
// Pure ES module — Build Planner persistence core. Importable by both node
// tests and the browser (query-core.js pattern): storage, clock and uuid are
// injected, no globals touched. Nothing outside this module reads the raw
// localStorage keys.

export const STORE_KEY = 'reveal.builds.v1';
export const CORRUPT_KEY = 'reveal.builds.corrupt';
export const SCHEMA_VERSION = 1;

const defaultNow = () => Date.now();
const defaultUuid = () => globalThis.crypto.randomUUID();

/**
 * A fresh v1 build. `now`/`uuid` are injectable for tests; remaining keys
 * are field overrides.
 */
export function emptyBuild({ now = defaultNow, uuid = defaultUuid, ...overrides } = {}) {
  const t = now();
  return {
    id: uuid(),
    schema: SCHEMA_VERSION,
    name: 'Untitled Build',
    notes: '',
    createdAt: t,
    updatedAt: t,
    class: null,
    ascendancy: null,
    gear: {},
    unassigned: [],
    skills: [],
    tree: { code: null, notablePriority: [] },
    ...overrides,
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function checkItemRef(v, path, errors) {
  if (!isObj(v)) { errors.push(`${path}: expected {kind, slug}`); return; }
  if (!isStr(v.kind)) errors.push(`${path}.kind: expected string`);
  if (!isStr(v.slug)) errors.push(`${path}.slug: expected string`);
}

/**
 * Shape-check a build (or an id-less canonical build from the codec).
 * Unknown extra fields are allowed — forward compatibility.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateBuild(b) {
  const errors = [];
  if (!isObj(b)) return { ok: false, errors: ['build: expected object'] };

  if (!isNum(b.schema) || b.schema < 1) errors.push('schema: expected number >= 1');
  if (!isStr(b.name)) errors.push('name: expected string');
  if (!isStr(b.notes)) errors.push('notes: expected string');
  for (const k of ['id']) if (b[k] !== undefined && !isStr(b[k])) errors.push(`${k}: expected string`);
  for (const k of ['createdAt', 'updatedAt']) if (b[k] !== undefined && !isNum(b[k])) errors.push(`${k}: expected number`);
  for (const k of ['class', 'ascendancy']) if (b[k] !== null && !isStr(b[k])) errors.push(`${k}: expected string or null`);

  if (!isObj(b.gear)) errors.push('gear: expected object');
  else {
    for (const [slot, g] of Object.entries(b.gear)) {
      if (!isObj(g)) { errors.push(`gear.${slot}: expected object`); continue; }
      if (g.item !== null) checkItemRef(g.item, `gear.${slot}.item`, errors);
      if (!Array.isArray(g.wishlist) || g.wishlist.some((w) => !isStr(w))) {
        errors.push(`gear.${slot}.wishlist: expected string[]`);
      }
    }
  }

  if (!Array.isArray(b.unassigned)) errors.push('unassigned: expected array');
  else b.unassigned.forEach((it, i) => checkItemRef(it, `unassigned[${i}]`, errors));

  if (!Array.isArray(b.skills)) errors.push('skills: expected array');
  else {
    b.skills.forEach((s, i) => {
      if (!isObj(s)) { errors.push(`skills[${i}]: expected object`); return; }
      if (!isObj(s.gem) || !isStr(s.gem.slug)) errors.push(`skills[${i}].gem.slug: expected string`);
      if (s.level !== null && !isNum(s.level)) errors.push(`skills[${i}].level: expected number or null`);
      if (!Array.isArray(s.supports)) errors.push(`skills[${i}].supports: expected array`);
      else s.supports.forEach((sup, j) => {
        if (!isObj(sup) || !isStr(sup.slug)) errors.push(`skills[${i}].supports[${j}].slug: expected string`);
      });
    });
  }

  if (!isObj(b.tree)) errors.push('tree: expected object');
  else {
    if (b.tree.code !== null && !isStr(b.tree.code)) errors.push('tree.code: expected string or null');
    if (!Array.isArray(b.tree.notablePriority)) errors.push('tree.notablePriority: expected number[]');
    else b.tree.notablePriority.forEach((h, i) => {
      if (!isNum(h)) errors.push(`tree.notablePriority[${i}]: expected number`);
    });
  }

  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/build-store.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add public/js/build-store.js test/build-store.test.js
git commit -m "feat(planner): build schema v1 — emptyBuild + validateBuild"
```

---

### Task 2: `createStore` — CRUD, ordering, subscribe, refresh

**Files:**
- Modify: `public/js/build-store.js` (append)
- Test: `test/build-store.test.js` (append)

**Interfaces:**
- Consumes: `emptyBuild`, `validateBuild`, `STORE_KEY` from Task 1.
- Produces: `createStore(storage, { now, uuid }) -> store` where `storage` is `{ getItem(k), setItem(k,v), removeItem(k) }` (the localStorage subset). Store API: `list() -> build[]`, `get(id) -> build|null`, `create(partial) -> build`, `update(id, patch) -> build|null`, `remove(id) -> boolean`, `duplicate(id) -> build|null`, `subscribe(fn) -> unsubscribe`, `refresh() -> void`. Subscribers receive `{ type: 'create'|'update'|'remove'|'refresh', id: string|null }`. Later phases wire cross-tab sync as `window.addEventListener('storage', e => { if (e.key === STORE_KEY) store.refresh(); })`.

- [ ] **Step 1: Write the failing tests**

Append to `test/build-store.test.js`:

```js
import { createStore } from '../public/js/build-store.js';

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    map: m,
  };
}

function seqStore(storage = memStorage()) {
  let t = 0; let n = 0;
  return {
    storage,
    store: createStore(storage, { now: () => ++t, uuid: () => `id-${++n}` }),
  };
}

test('create/list/get round trip, list follows creation order', () => {
  const { store } = seqStore();
  const a = store.create({ name: 'A' });
  const b = store.create({ name: 'B' });
  assert.deepEqual(store.list().map((x) => x.name), ['A', 'B']);
  assert.equal(store.get(a.id).name, 'A');
  assert.equal(store.get('nope'), null);
  assert.notEqual(a.id, b.id);
});

test('state persists through the storage interface (new store, same storage)', () => {
  const storage = memStorage();
  let t = 0; let n = 0;
  const s1 = createStore(storage, { now: () => ++t, uuid: () => `id-${++n}` });
  const made = s1.create({ name: 'Persisted' });
  const s2 = createStore(storage, { now: () => 99, uuid: () => 'other' });
  assert.equal(s2.get(made.id).name, 'Persisted');
});

test('update shallow-merges, bumps updatedAt, protects identity fields', () => {
  const { store } = seqStore();
  const b = store.create({ name: 'A' });
  const before = b.updatedAt;
  const after = store.update(b.id, { name: 'A2', id: 'hack', schema: 99, createdAt: 555 });
  assert.equal(after.name, 'A2');
  assert.equal(after.id, b.id);
  assert.equal(after.schema, b.schema);
  assert.equal(after.createdAt, b.createdAt);
  assert.ok(after.updatedAt > before);
  assert.equal(store.update('nope', { name: 'x' }), null);
});

test('update passes unknown fields through (forward compatibility)', () => {
  const { store } = seqStore();
  const b = store.create({});
  const after = store.update(b.id, { futureField: [1, 2] });
  assert.deepEqual(store.get(b.id).futureField, [1, 2]);
  assert.deepEqual(after.futureField, [1, 2]);
});

test('remove deletes and reports, duplicate deep-copies with new identity', () => {
  const { store } = seqStore();
  const b = store.create({ name: 'Orig' });
  store.update(b.id, { unassigned: [{ kind: 'base', slug: 'x' }] });
  const copy = store.duplicate(b.id);
  assert.equal(copy.name, 'Orig (copy)');
  assert.notEqual(copy.id, b.id);
  assert.deepEqual(copy.unassigned, [{ kind: 'base', slug: 'x' }]);
  copy.unassigned.push({ kind: 'base', slug: 'y' }); // mutation must not leak
  assert.equal(store.get(b.id).unassigned.length, 1);
  assert.equal(store.duplicate('nope'), null);
  assert.equal(store.remove(b.id), true);
  assert.equal(store.remove(b.id), false);
  assert.deepEqual(store.list().map((x) => x.id), [copy.id]);
});

test('subscribe fires per mutation and unsubscribes; refresh re-reads storage', () => {
  const storage = memStorage();
  const { store } = seqStore(storage);
  const events = [];
  const off = store.subscribe((e) => events.push(e));
  const b = store.create({});
  store.update(b.id, { name: 'n' });
  store.remove(b.id);
  assert.deepEqual(events.map((e) => e.type), ['create', 'update', 'remove']);
  assert.equal(events[0].id, b.id);
  // refresh: another store writes to the same storage (cross-tab analogue)
  const other = createStore(storage, { now: () => 50, uuid: () => 'id-x' });
  other.create({ name: 'From other tab' });
  store.refresh();
  assert.deepEqual(events.at(-1), { type: 'refresh', id: null });
  assert.equal(store.list().length, 1);
  off();
  store.create({});
  assert.equal(events.filter((e) => e.type === 'create').length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/build-store.test.js`
Expected: FAIL — `createStore` is not exported

- [ ] **Step 3: Write the implementation**

Append to `public/js/build-store.js`:

```js
const deepCopy = (v) => JSON.parse(JSON.stringify(v));

// Schema migrations, keyed by from-version; v1 has none. A future schema
// bump adds `1: (build) => ({ ...migrated, schema: 2 })` here.
const MIGRATIONS = {};

function migrate(build) {
  let b = build;
  while (b.schema < SCHEMA_VERSION && MIGRATIONS[b.schema]) b = MIGRATIONS[b.schema](b);
  return b;
}

/** Thrown when the backing storage rejects a write (quota). */
export class StoreWriteError extends Error {
  constructor(cause) {
    super('build store write failed (storage quota?)');
    this.name = 'StoreWriteError';
    this.cause = cause;
  }
}

/**
 * Build store over a localStorage-like interface. All mutation goes through
 * here; the raw keys are private to this module.
 */
export function createStore(storage, { now = defaultNow, uuid = defaultUuid } = {}) {
  const subscribers = new Set();
  const emit = (type, id = null) => { for (const fn of subscribers) fn({ type, id }); };

  function read() {
    const raw = storage.getItem(STORE_KEY);
    if (raw === null) return { order: [], builds: {} };
    try {
      const state = JSON.parse(raw);
      if (!state || !Array.isArray(state.order) || typeof state.builds !== 'object' || state.builds === null) {
        throw new Error('bad shape');
      }
      for (const id of state.order) state.builds[id] = migrate(state.builds[id]);
      return state;
    } catch {
      // Never silently destroy user data: park the corrupt payload, start empty.
      storage.setItem(CORRUPT_KEY, raw);
      storage.removeItem(STORE_KEY);
      return { order: [], builds: {} };
    }
  }

  function write(state) {
    try {
      storage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      throw new StoreWriteError(e);
    }
  }

  return {
    list() {
      const s = read();
      return s.order.map((id) => s.builds[id]);
    },
    get(id) {
      return read().builds[id] ?? null;
    },
    create(partial = {}) {
      const s = read();
      const build = emptyBuild({ now, uuid, ...partial });
      s.order.push(build.id);
      s.builds[build.id] = build;
      write(s);
      emit('create', build.id);
      return build;
    },
    update(id, patch) {
      const s = read();
      const cur = s.builds[id];
      if (!cur) return null;
      // Identity fields are store-owned; a patch never moves them.
      const { id: _i, schema: _s, createdAt: _c, ...rest } = patch;
      const next = { ...cur, ...rest, updatedAt: now() };
      s.builds[id] = next;
      write(s);
      emit('update', id);
      return next;
    },
    remove(id) {
      const s = read();
      if (!s.builds[id]) return false;
      delete s.builds[id];
      s.order = s.order.filter((x) => x !== id);
      write(s);
      emit('remove', id);
      return true;
    },
    duplicate(id) {
      const s = read();
      const cur = s.builds[id];
      if (!cur) return null;
      const t = now();
      const copy = { ...deepCopy(cur), id: uuid(), name: `${cur.name} (copy)`, createdAt: t, updatedAt: t };
      s.order.push(copy.id);
      s.builds[copy.id] = copy;
      write(s);
      emit('create', copy.id);
      return copy;
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    // Re-read + notify. The browser host wires this to the cross-tab
    // 'storage' event: e.key === STORE_KEY && store.refresh().
    refresh() {
      emit('refresh', null);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/build-store.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/js/build-store.js test/build-store.test.js
git commit -m "feat(planner): build store CRUD over injected storage"
```

---

### Task 3: Robustness — corruption recovery + quota surfacing

**Files:**
- Modify: `public/js/build-store.js` (already implemented in Task 2's `read`/`write` — this task *proves* it)
- Test: `test/build-store.test.js` (append)

**Interfaces:**
- Consumes: `createStore`, `STORE_KEY`, `CORRUPT_KEY`, `StoreWriteError` from Task 2.
- Produces: verified behavior later phases rely on: corrupt payload preserved under `CORRUPT_KEY`, `StoreWriteError` thrown on quota, schema passthrough for newer builds.

- [ ] **Step 1: Write the failing-or-passing tests (behavior pinned either way)**

Append to `test/build-store.test.js`:

```js
import { StoreWriteError } from '../public/js/build-store.js';

test('corrupt JSON is parked under CORRUPT_KEY, store starts empty', () => {
  const storage = memStorage({ [STORE_KEY]: '{not json' });
  const store = createStore(storage, { now: () => 1, uuid: () => 'id-1' });
  assert.deepEqual(store.list(), []);
  assert.equal(storage.getItem(CORRUPT_KEY), '{not json');
  assert.equal(storage.getItem(STORE_KEY), null);
  const b = store.create({ name: 'fresh' }); // store is usable after recovery
  assert.equal(store.get(b.id).name, 'fresh');
});

test('wrong-shape JSON is treated as corrupt too', () => {
  const storage = memStorage({ [STORE_KEY]: JSON.stringify({ hello: 'world' }) });
  const store = createStore(storage, { now: () => 1, uuid: () => 'id-1' });
  assert.deepEqual(store.list(), []);
  assert.equal(storage.getItem(CORRUPT_KEY), JSON.stringify({ hello: 'world' }));
});

test('storage write failure surfaces as StoreWriteError', () => {
  const storage = memStorage();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const store = createStore(storage, { now: () => 1, uuid: () => 'id-1' });
  assert.throws(() => store.create({}), StoreWriteError);
});

test('a build from a newer schema passes through read untouched', () => {
  const future = { ...emptyBuild({ now: () => 1, uuid: () => 'id-9' }), schema: 2, newField: true };
  const storage = memStorage({
    [STORE_KEY]: JSON.stringify({ order: ['id-9'], builds: { 'id-9': future } }),
  });
  const store = createStore(storage, { now: () => 1, uuid: () => 'id-1' });
  assert.deepEqual(store.get('id-9'), future);
});
```

- [ ] **Step 2: Run tests**

Run: `node --test test/build-store.test.js`
Expected: PASS if Task 2's `read`/`write` are correct; if any FAIL, fix `read`/`write` in `public/js/build-store.js` until green (the Task 2 code above already handles all four cases — a failure means a transcription bug).

- [ ] **Step 3: Commit**

```bash
git add test/build-store.test.js public/js/build-store.js
git commit -m "test(planner): pin store corruption, quota and schema-passthrough behavior"
```

---

### Task 4: Share codec — `build-code.js`

**Files:**
- Create: `public/js/build-code.js`
- Test: `test/build-code.test.js`

**Interfaces:**
- Consumes: `validateBuild`, `emptyBuild` from `build-store.js`; `b64ToBytes`, `bytesToB64` from the existing `public/js/passive-code.js` (do NOT reimplement base64url).
- Produces: `encodeBuild(build) -> Promise<string>` (version-prefixed base64url), `decodeBuild(str) -> Promise<canonicalBuild>` (id/timestamp-less), `CodecError` with `.code` in `'bad-version' | 'corrupt' | 'invalid-build'`. Phase 8's import flow calls `store.create(await decodeBuild(code))`.

- [ ] **Step 1: Write the failing tests**

```js
// test/build-code.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBuild, decodeBuild, CodecError } from '../public/js/build-code.js';
import { emptyBuild } from '../public/js/build-store.js';

const mk = (over = {}) => emptyBuild({ now: () => 1000, uuid: () => 'id-1', ...over });

function realisticBuild() {
  const b = mk({ name: 'Stormweaver Arc', class: 'Sorceress', ascendancy: 'Stormweaver' });
  b.notes = 'League-start friendly. Swap to CI at 80.';
  const slots = ['weapon1a', 'weapon1b', 'helmet', 'body', 'gloves', 'boots',
    'belt', 'amulet', 'ring1', 'ring2', 'flask1', 'flask2'];
  for (const s of slots) {
    b.gear[s] = {
      item: { kind: s === 'body' ? 'unique' : 'base', slug: `some-item-for-${s}` },
      wishlist: ['maximum-life', 'lightning-resistance'],
    };
  }
  b.skills = Array.from({ length: 8 }, (_, i) => ({
    gem: { slug: `skill-gem-${i}` }, level: 20,
    supports: Array.from({ length: 5 }, (_, j) => ({ slug: `support-${i}-${j}` })),
  }));
  // plausible v7 code length + 15 priorities
  b.tree = { code: 'A'.repeat(600), notablePriority: Array.from({ length: 15 }, (_, i) => 10000 + i) };
  return b;
}

test('round trip: decode(encode(b)) equals the canonical form', async () => {
  const b = realisticBuild();
  const out = await decodeBuild(await encodeBuild(b));
  const { id, createdAt, updatedAt, ...canonical } = b;
  assert.deepEqual(out, canonical);
});

test('encode strips local identity, keeps unknown fields', async () => {
  const b = { ...mk(), futureField: 42 };
  const out = await decodeBuild(await encodeBuild(b));
  assert.equal(out.id, undefined);
  assert.equal(out.createdAt, undefined);
  assert.equal(out.futureField, 42);
});

test('code is URL-fragment-safe and version-prefixed', async () => {
  const code = await encodeBuild(mk());
  assert.equal(code[0], '1');
  assert.match(code, /^[A-Za-z0-9_-]+$/);
});

test('realistic build stays under the fragment budget', async () => {
  const code = await encodeBuild(realisticBuild());
  assert.ok(code.length < 2048, `code length ${code.length} exceeds 2048`);
});

test('unknown version prefix rejects with bad-version', async () => {
  const code = await encodeBuild(mk());
  await assert.rejects(decodeBuild('9' + code.slice(1)),
    (e) => e instanceof CodecError && e.code === 'bad-version');
});

test('garbage rejects with corrupt', async () => {
  await assert.rejects(decodeBuild('1zzzz-not-deflate'),
    (e) => e instanceof CodecError && e.code === 'corrupt');
});

test('valid deflate of an invalid build rejects with invalid-build', async () => {
  const b = mk();
  b.name = 123; // break the schema post-hoc
  await assert.rejects(decodeBuild(await encodeBuild(b)),
    (e) => e instanceof CodecError && e.code === 'invalid-build');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/build-code.test.js`
Expected: FAIL — `Cannot find module '../public/js/build-code.js'`

- [ ] **Step 3: Write the implementation**

```js
// public/js/build-code.js
// Pure ES module — Build Planner share codec. Canonical JSON → deflate →
// base64url with a leading codec-version char. Dual-environment via the Web
// CompressionStream API (global in Node >= 20 and evergreen browsers); format
// 'deflate' deliberately — 'deflate-raw' is missing from some Node 20.x.
import { b64ToBytes, bytesToB64 } from './passive-code.js';
import { validateBuild } from './build-store.js';

const CODEC_VERSION = '1';

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

/** Build → version-prefixed base64url deflate of its canonical JSON. */
export async function encodeBuild(build) {
  const json = JSON.stringify(canonical(build));
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate'));
  return CODEC_VERSION + bytesToB64(packed);
}

/** Inverse of encodeBuild. Resolves to an id-less canonical build. */
export async function decodeBuild(str) {
  if (typeof str !== 'string' || str[0] !== CODEC_VERSION) {
    throw new CodecError('bad-version', `unknown build code version ${String(str)[0] ?? '(empty)'}`);
  }
  let build;
  try {
    const bytes = await pipe(b64ToBytes(str.slice(1)), new DecompressionStream('deflate'));
    build = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    throw new CodecError('corrupt', 'build code is not valid compressed JSON');
  }
  const { ok, errors } = validateBuild(build);
  if (!ok) throw new CodecError('invalid-build', `decoded build failed validation: ${errors.join('; ')}`);
  return build;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/build-code.test.js`
Expected: PASS. If the `corrupt` test fails because `b64ToBytes` tolerates the input and `DecompressionStream` still errors asynchronously, confirm the rejection still lands in the `catch` (it does — `pipe` awaits the full stream inside `try`).

- [ ] **Step 5: Commit**

```bash
git add public/js/build-code.js test/build-code.test.js
git commit -m "feat(planner): compressed URL share codec for builds"
```

---

### Task 5: Full-suite verification + roadmap bookkeeping

**Files:**
- Modify: `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md` (status checklist)
- Modify: `docs/superpowers/specs/2026-07-06-build-store-design.md` (tick acceptance criteria)

**Interfaces:**
- Consumes: everything above.
- Produces: Phase 1 recorded complete; later sessions trust the checklist.

- [ ] **Step 1: Run the whole suite (pretest rebuilds the graph)**

Run: `npm test`
Expected: PASS — all pre-existing suites (284+) plus the two new ones. Any pre-existing failure: stop and investigate before proceeding (do not ship on a red baseline).

- [ ] **Step 2: Confirm the dual-use constraint**

Run: `grep -nE "^import .* from '(node:|fs|path)" public/js/build-store.js public/js/build-code.js`
Expected: no output (no node-builtin imports). Also confirm no top-level `localStorage`/`window`/`document` references: `grep -nE 'localStorage|window\.|document\.' public/js/build-store.js public/js/build-code.js` → no output.

- [ ] **Step 3: Update the roadmap checklist**

In `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md`, change `- [ ] Phase 1 — Build store foundation` to `- [x] Phase 1 — Build store foundation (<final commit sha>)`. Tick the acceptance-criteria boxes in `2026-07-06-build-store-design.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-06-build-planner-roadmap.md docs/superpowers/specs/2026-07-06-build-store-design.md
git commit -m "docs(planner): mark roadmap phase 1 complete"
```
