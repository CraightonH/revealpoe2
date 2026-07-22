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
