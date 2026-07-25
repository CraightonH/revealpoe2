// test/build-store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyBuild, validateBuild, SCHEMA_VERSION, STORE_KEY, CORRUPT_KEY,
} from '../public/js/build-store.js';

const fixedNow = () => 1000;
const fixedUuid = () => 'id-1';

test('emptyBuild fills v3 defaults', () => {
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid });
  assert.deepEqual(b, {
    id: 'id-1', schema: SCHEMA_VERSION, name: 'Untitled Build', notes: '', description: '',
    createdAt: 1000, updatedAt: 1000, class: null, ascendancy: null,
    gear: {}, unassigned: [], skills: [],
    tree: { code: null, notablePriority: [] },
    variants: [],
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
  b.gear.helmet = { item: { kind: 'unique', slug: 'crown-of-eyes' }, mods: [], corrupted: null };
  b.gear.body = { item: null, mods: [], corrupted: null };
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
    [(b) => { b.gear.helmet = { item: null, mods: 'nope', corrupted: null }; }, 'gear.helmet.mods'],
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

test('SCHEMA_VERSION is 3', () => {
  assert.equal(SCHEMA_VERSION, 3);
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

test('migrate v1 through v3: wishlist cells become mods/corrupted cells on read', () => {
  const v1 = {
    ...emptyBuild({ now: () => 1, uuid: () => 'x' }),
    schema: 1,
    gear: { helmet: { item: { kind: 'base', slug: 'iron-hat' }, wishlist: ['life'] } },
  };
  const storage = memStorage();
  const store = createStore(storage, { now: () => 2, uuid: () => 'y' });
  storage.setItem(STORE_KEY, JSON.stringify({ order: ['b'], builds: { b: { ...v1, id: 'b' } } }));
  const got = store.get('b');
  assert.equal(got.schema, 3);
  assert.deepEqual(got.gear.helmet.mods, []);
  assert.equal(got.gear.helmet.corrupted, null);
  assert.ok(!('wishlist' in got.gear.helmet));
});

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
  const future = { ...emptyBuild({ now: () => 1, uuid: () => 'id-9' }), schema: SCHEMA_VERSION + 1, newField: true };
  const storage = memStorage({
    [STORE_KEY]: JSON.stringify({ order: ['id-9'], builds: { 'id-9': future } }),
  });
  const store = createStore(storage, { now: () => 1, uuid: () => 'id-1' });
  assert.deepEqual(store.get('id-9'), future);
});

test('validateBuild accepts a well-formed grantedSupports map', () => {
  const b = emptyBuild({ now: () => 1, uuid: () => 'x' });
  b.grantedSupports = { 'choir-item:lightning-bolt': [{ slug: 'pierce' }] };
  assert.equal(validateBuild(b).ok, true);
});

test('validateBuild rejects malformed grantedSupports', () => {
  const b = emptyBuild({ now: () => 1, uuid: () => 'x' });
  b.grantedSupports = { bad: [{ nope: 1 }] };
  const r1 = validateBuild(b);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some((e) => e.includes('grantedSupports.bad[0].slug')));
  b.grantedSupports = 'nope';
  assert.equal(validateBuild(b).ok, false);
});

test('emptyBuild: includes empty description', () => {
  assert.equal(emptyBuild({ now: () => 1, uuid: () => 'x' }).description, '');
});

test('validateBuild: description optional but must be a string', () => {
  const base = emptyBuild({ now: () => 1, uuid: () => 'x' });
  assert.equal(validateBuild(base).ok, true);
  const { description, ...legacy } = base;
  assert.equal(validateBuild(legacy).ok, true, 'pre-description builds still validate');
  assert.equal(validateBuild({ ...base, description: 5 }).ok, false);
});

// ---- Phase 8: variants + group API ---------------------------------------

const seqUuid = () => { let n = 0; return () => `id-${++n}`; };

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
  const storage = memStorage();
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
  const store = createStore(memStorage(), { now: fixedNow, uuid: ids });
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
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Parent' });
  const v = store.addVariant(parent.id, 'Early');
  store.renameVariant(parent.id, v.id, 'Lv 1-30');
  assert.deepEqual(store.get(parent.id).variants, [{ label: 'Lv 1-30', buildId: v.id }]);
  assert.equal(store.get(v.id).name, 'Lv 1-30');
  assert.equal(store.renameVariant(parent.id, 'not-a-variant', 'X'), null);
});

test('removeVariant unlinks without deleting the build', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Parent' });
  const v = store.addVariant(parent.id, 'Early');
  store.removeVariant(parent.id, v.id);
  assert.deepEqual(store.get(parent.id).variants, []);
  assert.ok(store.get(v.id), 'the variant build survives an unlink');
});

test('deleting a variant build prunes it from its parent list', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Parent' });
  const v1 = store.addVariant(parent.id, 'A');
  const v2 = store.addVariant(parent.id, 'B');
  store.remove(v1.id);
  assert.deepEqual(store.get(parent.id).variants, [{ label: 'B', buildId: v2.id }]);
});

test('deleting a parent orphans its variants, never deletes them', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Parent' });
  const v = store.addVariant(parent.id, 'A');
  store.remove(parent.id);
  assert.ok(store.get(v.id), 'the variant survives its parent');
  assert.equal(store.parentOf(v.id), null);
});

test('duplicate never inherits the variant list', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Parent' });
  store.addVariant(parent.id, 'A');
  const copy = store.duplicate(parent.id);
  assert.deepEqual(copy.variants, [],
    'two parents must never point at the same variant build');
});

test('parentOf finds the owning parent, or null for a standalone build', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Parent' });
  const v = store.addVariant(parent.id, 'A');
  assert.equal(store.parentOf(v.id)?.id, parent.id);
  assert.equal(store.parentOf(parent.id), null);
});

test('group is parent-rooted from either a parent or a variant id', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
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
  const storage = memStorage();
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
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
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
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
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
