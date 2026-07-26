// test/build-store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyBuild, validateBuild, SCHEMA_VERSION, STORE_KEY, CORRUPT_KEY,
  MAX_BUILDS, StoreLimitError, LIMITS, clampBuild,
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

  // A variant's own NAME is the build's identity and is inherited verbatim from
  // the parent; its LABEL is only its role in the group. Two independent strings.
  assert.equal(v1.name, 'Lightning Sorc', 'the variant build keeps the parent title');
  assert.equal(v2.name, 'Lightning Sorc');
  assert.deepEqual(v1.variants, [], 'variants are flat — a variant has no list of its own');
  assert.deepEqual(v1.skills, [{ gem: { slug: 'spark' }, level: null, supports: [] }],
    'a variant starts as a copy of its parent');
  assert.deepEqual(store.get(parent.id).variants,
    [{ label: 'Lv 1-30', buildId: v1.id }, { label: 'Lv 30-60', buildId: v2.id }]);
  assert.equal(store.list().length, 3, 'variants are ordinary builds in the store');
});

test('renameVariant retitles ONLY the entry label, never the build name', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Stormweaver CoC' });
  const v = store.addVariant(parent.id, 'Early');
  store.renameVariant(parent.id, v.id, 'Leveling');
  assert.deepEqual(store.get(parent.id).variants, [{ label: 'Leveling', buildId: v.id }]);
  assert.equal(store.get(v.id).name, 'Stormweaver CoC',
    'relabelling a variant must not touch the build title');
  assert.equal(store.renameVariant(parent.id, 'not-a-variant', 'X'), null);
});

test('renaming a variant build leaves its group label alone', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Stormweaver CoC' });
  const v = store.addVariant(parent.id, 'Leveling');
  store.update(v.id, { name: 'Stormweaver CoC (test rig)' });
  assert.deepEqual(store.get(parent.id).variants, [{ label: 'Leveling', buildId: v.id }],
    'renaming the build must not touch its label');
  assert.equal(store.get(v.id).name, 'Stormweaver CoC (test rig)');
});

test('a whole group can share one title and differ only by label', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Stormweaver CoC' });
  for (const l of ['Leveling', 'Early mapping', 'Endgame']) store.addVariant(parent.id, l);
  const g = store.group(parent.id);
  assert.deepEqual(g.variants.map((v) => v.label), ['Leveling', 'Early mapping', 'Endgame']);
  assert.deepEqual(g.variants.map((v) => v.build.name),
    ['Stormweaver CoC', 'Stormweaver CoC', 'Stormweaver CoC']);
  assert.equal(g.parent.name, 'Stormweaver CoC');
});

test('a group round-trips both strings through the share codec', async () => {
  const { encodeGroup, decodeGroup } = await import('../public/js/build-code.js');
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Stormweaver CoC' });
  store.addVariant(parent.id, 'Leveling');
  // NB: group() yields {label, build}; the STORED entry is {label, buildId}.
  store.update(store.group(parent.id).variants[0].build.id, { name: 'Renamed Child' });
  const out = await decodeGroup(await encodeGroup(store.group(parent.id)));
  assert.equal(out.variants[0].label, 'Leveling', 'label survives');
  assert.equal(out.variants[0].build.name, 'Renamed Child', 'independent build name survives');
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

// ---- storage caps (2026-07-26) -------------------------------------------
// Measured: ~6 KB typical / ~11 KB heavy per build against a ~5 M-char
// localStorage budget. MAX_BUILDS keeps a full store at ~36% (typical) to ~65%
// (heavy) of that, and leaves headroom for the other keys on the origin.

test('MAX_BUILDS is exported and create() refuses past it', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  for (let i = 0; i < MAX_BUILDS; i++) store.create({ name: `b${i}` });
  assert.equal(store.list().length, MAX_BUILDS);
  assert.throws(() => store.create({ name: 'one too many' }),
    (e) => e instanceof StoreLimitError && e.limit === MAX_BUILDS);
  assert.equal(store.list().length, MAX_BUILDS, 'the refused create wrote nothing');
});

test('duplicate and addVariant also respect the cap', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const first = store.create({ name: 'seed' });
  for (let i = 1; i < MAX_BUILDS; i++) store.create({ name: `b${i}` });
  assert.throws(() => store.duplicate(first.id), (e) => e instanceof StoreLimitError);
  assert.throws(() => store.addVariant(first.id, 'Leveling'), (e) => e instanceof StoreLimitError);
  assert.equal(store.list().length, MAX_BUILDS);
  assert.deepEqual(store.get(first.id).variants, [], 'a refused addVariant leaves no dangling entry');
});

test('importGroup refuses atomically when the whole group will not fit', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  for (let i = 0; i < MAX_BUILDS - 2; i++) store.create({ name: `b${i}` });
  const mk = (name) => ({ schema: 3, name, notes: '', description: '', class: null, ascendancy: null,
    gear: {}, unassigned: [], skills: [], tree: { code: null, notablePriority: [] }, variants: [] });
  // parent + 3 variants = 4 builds, but only 2 slots remain.
  assert.throws(() => store.importGroup({
    parent: mk('Shared'),
    variants: ['Leveling', 'Early mapping', 'Endgame'].map((l) => ({ label: l, build: mk(l) })),
  }), (e) => e instanceof StoreLimitError);
  assert.equal(store.list().length, MAX_BUILDS - 2,
    'a refused group import writes NOTHING — no half-imported parent');
});

test('importGroup succeeds when the group exactly fits', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  for (let i = 0; i < MAX_BUILDS - 2; i++) store.create({ name: `b${i}` });
  const mk = (name) => ({ schema: 3, name, notes: '', description: '', class: null, ascendancy: null,
    gear: {}, unassigned: [], skills: [], tree: { code: null, notablePriority: [] }, variants: [] });
  const parent = store.importGroup({ parent: mk('Shared'), variants: [{ label: 'Leveling', build: mk('x') }] });
  assert.ok(parent);
  assert.equal(store.list().length, MAX_BUILDS);
});

test('the corrupt-payload rescue survives a storage that rejects writes', () => {
  // read() parks a corrupt payload before starting empty. That setItem used to
  // be unguarded, so a near-quota + corrupt store threw from inside read() —
  // and read() backs EVERY method, so the whole planner failed instead of
  // recovering. Losing the backup is acceptable; failing to load is not.
  const m = new Map();
  m.set(STORE_KEY, '{ this is not json');
  const hostile = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k) => { throw new DOMException('QuotaExceededError'); },
    removeItem: (k) => { m.delete(k); },
  };
  const store = createStore(hostile, { now: fixedNow, uuid: seqUuid() });
  assert.deepEqual(store.list(), [], 'recovers to an empty store rather than throwing');
  assert.equal(store.get('anything'), null);
});

// ---- clampBuild: untrusted input hardening (2026-07-26) -------------------
// Authoring is bounded by the DOM (maxlength, fixed slot grid, socket counts).
// DECODED SHARE CODES ARE NOT — the codec validates shape, never size. So a
// hostile or accidentally-huge code could previously blow storage, break the
// layout with a megabyte-long title, or hang the page with 10k skill setups.
// clampBuild truncates rather than rejects: a shared build should still open.

const huge = (n) => 'x'.repeat(n);

test('clampBuild leaves an ordinary build completely untouched', () => {
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid, name: 'Stormweaver CoC' });
  b.description = 'Arc into Spark.';
  b.notes = 'Swap to CI at 80.';
  b.gear.helmet = { item: { kind: 'base', slug: 'iron-hat' }, mods: [{ affix: 'life', tier: 'l1' }], corrupted: null };
  b.skills = [{ gem: { slug: 'spark' }, level: null, supports: [{ slug: 'martial-tempo' }] }];
  b.unassigned = [{ kind: 'gem', slug: 'arc' }];
  b.tree = { code: 'AAAA', notablePriority: [1, 2, 3] };
  const { build, trimmed } = clampBuild(b);
  assert.deepEqual(trimmed, [], 'nothing reported for a normal build');
  assert.deepEqual(build, b, 'and nothing altered');
});

test('clampBuild truncates the display strings', () => {
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid });
  b.name = huge(50000); b.description = huge(50000); b.notes = huge(500000);
  const { build, trimmed } = clampBuild(b);
  assert.equal(build.name.length, LIMITS.name);
  assert.equal(build.description.length, LIMITS.description);
  assert.equal(build.notes.length, LIMITS.notes);
  for (const f of ['name', 'description', 'notes']) {
    assert.ok(trimmed.some((t) => t.includes(f)), `${f} reported: ${JSON.stringify(trimmed)}`);
  }
});

test('clampBuild bounds skill setups and supports per setup', () => {
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid });
  b.skills = Array.from({ length: 10000 }, (_, i) => ({
    gem: { slug: `g${i}` }, level: null,
    supports: Array.from({ length: 500 }, (_, j) => ({ slug: `s${j}` })),
  }));
  const { build, trimmed } = clampBuild(b);
  assert.equal(build.skills.length, LIMITS.setups);
  for (const s of build.skills) assert.equal(s.supports.length, LIMITS.supportsPerSetup);
  assert.ok(trimmed.some((t) => /setup/i.test(t)), JSON.stringify(trimmed));
});

test('clampBuild bounds the unassigned tray', () => {
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid });
  b.unassigned = Array.from({ length: 5000 }, (_, i) => ({ kind: 'gem', slug: `g${i}` }));
  const { build, trimmed } = clampBuild(b);
  assert.equal(build.unassigned.length, LIMITS.unassigned);
  assert.ok(trimmed.some((t) => /unassigned|tray/i.test(t)));
});

test('clampBuild bounds gear keys AND mods per cell', () => {
  // builds-render.js sections() iterates RAW gear keys, so unbounded fake slots
  // render unbounded rows in the fallback share preview.
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid });
  for (let i = 0; i < 10000; i++) {
    b.gear[`fake${i}`] = { item: { kind: 'base', slug: 'x' },
      mods: Array.from({ length: 200 }, (_, j) => ({ affix: `a${j}`, tier: 't' })), corrupted: null };
  }
  const { build, trimmed } = clampBuild(b);
  assert.equal(Object.keys(build.gear).length, LIMITS.gearSlots);
  for (const g of Object.values(build.gear)) assert.ok(g.mods.length <= LIMITS.mods);
  assert.ok(trimmed.some((t) => /gear|slot/i.test(t)));
  assert.ok(trimmed.some((t) => /mod/i.test(t)));
});

test('clampBuild bounds the notable priority list', () => {
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid });
  b.tree = { code: 'AAAA', notablePriority: Array.from({ length: 100000 }, (_, i) => i) };
  const { build, trimmed } = clampBuild(b);
  assert.equal(build.tree.notablePriority.length, LIMITS.notablePriority);
  assert.ok(trimmed.some((t) => /notable|priorit/i.test(t)));
});

test('clampBuild bounds an oversized tree code and grantedSupports', () => {
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid });
  b.tree = { code: huge(200000), notablePriority: [] };
  b.grantedSupports = Object.fromEntries(
    Array.from({ length: 500 }, (_, i) => [`item${i}:skill`, Array.from({ length: 90 }, (_, j) => ({ slug: `s${j}` }))]));
  const { build, trimmed } = clampBuild(b);
  // An over-long code is DROPPED, not truncated: a sliced v7 code is garbage
  // that would fail to decode, so null is the honest outcome.
  assert.equal(build.tree.code, null, 'an impossible tree code is dropped outright');
  assert.ok(trimmed.some((t) => /tree code/i.test(t)), JSON.stringify(trimmed));
  assert.ok(Object.keys(build.grantedSupports).length <= LIMITS.grantedKeys);
  for (const l of Object.values(build.grantedSupports)) assert.ok(l.length <= LIMITS.supportsPerSetup);

  // A legitimate code is left completely alone.
  const good = emptyBuild({ now: fixedNow, uuid: fixedUuid });
  good.tree = { code: 'A'.repeat(900), notablePriority: [1, 2] };
  assert.equal(clampBuild(good).build.tree.code, 'A'.repeat(900), 'real codes untouched');
});

test('clampBuild survives structurally broken input without throwing', () => {
  for (const bad of [{}, { gear: null, skills: null, unassigned: null, tree: null },
                     { name: 42, notes: [], gear: 'nope', skills: 'nope' }]) {
    const { build } = clampBuild(bad);
    assert.equal(typeof build, 'object', 'always returns an object');
  }
  assert.equal(typeof clampBuild(null).build, 'object');
});

test('importGroup clamps every build in the group', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const nasty = (name) => ({
    schema: 3, name: huge(9000), notes: huge(90000), description: huge(9000),
    class: null, ascendancy: null, gear: {}, unassigned: [],
    skills: Array.from({ length: 900 }, (_, i) => ({ gem: { slug: `g${i}` }, level: null, supports: [] })),
    tree: { code: null, notablePriority: [] }, variants: [],
  });
  const parent = store.importGroup({ parent: nasty('p'), variants: [{ label: huge(500), build: nasty('v') }] });
  assert.equal(parent.name.length, LIMITS.name, 'parent name clamped on import');
  assert.equal(parent.notes.length, LIMITS.notes);
  assert.equal(parent.skills.length, LIMITS.setups);
  assert.equal(parent.variants[0].label.length, LIMITS.label, 'variant LABEL clamped too');
  const child = store.get(parent.variants[0].buildId);
  assert.equal(child.skills.length, LIMITS.setups, 'variant build clamped as well');
});

test('group() variants carry BOTH buildId and the resolved build', () => {
  // Guards a footgun: the stored entry is {label, buildId} while group() used to
  // return {label, build}. Callers reaching for the other spelling got undefined
  // — silently, three separate times.
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Stormweaver CoC' });
  const v = store.addVariant(parent.id, 'Leveling');
  const [entry] = store.group(parent.id).variants;
  assert.equal(entry.label, 'Leveling');
  assert.equal(entry.buildId, v.id, 'buildId is present');
  assert.equal(entry.build.id, v.id, 'and matches the resolved build');
});

// ---- the parent is Variant 1 (2026-07-26) --------------------------------
// A group reads as an ordered list of phases, so the parent must present as
// "Variant 1" from the start. Otherwise it silently becomes a tab the moment you
// add a variant, and that addition claims the name "Variant 1" while the parent
// is really the first.
//
// A variant's label is a property of the RELATIONSHIP, so it lives on the
// parent's entry. The parent has no incoming entry, so its own label lives on the
// build. setLabel() hides that split from callers.

test('nextVariantLabel counts the parent as Variant 1', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Stormweaver CoC' });
  assert.equal(store.nextVariantLabel(parent.id), 'Variant 2', 'the first ADDED variant is #2');
  const v2 = store.addVariant(parent.id, store.nextVariantLabel(parent.id));
  assert.equal(v2.label ?? null, null, 'the label lives on the parent entry, not the build');
  assert.equal(store.nextVariantLabel(parent.id), 'Variant 3');
  store.addVariant(parent.id, store.nextVariantLabel(parent.id));
  assert.equal(store.nextVariantLabel(parent.id), 'Variant 4');
  // Asking from a variant resolves the same group.
  assert.equal(store.nextVariantLabel(v2.id), 'Variant 4');
});

test('nextVariantLabel is POSITIONAL, not gap-filling', () => {
  // The number is the build's place in the group, so renaming tabs must not
  // reset it. An earlier gap-filling version returned the lowest unused number,
  // which collapsed to 'Variant 2' forever once any tab was renamed — and this
  // test previously asserted that bug.
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Stormweaver CoC' });

  const a = store.addVariant(parent.id, store.nextVariantLabel(parent.id));
  store.setLabel(parent.id, 'Leveling');
  store.setLabel(a.id, 'Early mapping');
  assert.equal(store.nextVariantLabel(parent.id), 'Variant 3', '3rd in the group');

  const b = store.addVariant(parent.id, store.nextVariantLabel(parent.id));
  store.setLabel(b.id, 'Endgame');
  assert.equal(store.nextVariantLabel(parent.id), 'Variant 4', '4th, not back to 2');

  store.addVariant(parent.id, store.nextVariantLabel(parent.id));
  assert.equal(store.nextVariantLabel(parent.id), 'Variant 5', '5th');
});

test('nextVariantLabel bumps past an exact duplicate only', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'P' });
  store.addVariant(parent.id, 'Variant 3');   // hand-picked, out of sequence
  // Positionally the newcomer is 3rd, but that label is taken, so step to 4.
  assert.equal(store.nextVariantLabel(parent.id), 'Variant 4');
  store.addVariant(parent.id, 'Variant 4');
  assert.equal(store.nextVariantLabel(parent.id), 'Variant 5', 'never reuses 2');
});

test('deleting a variant does not make the next one reuse its number', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'P' });
  const a = store.addVariant(parent.id, store.nextVariantLabel(parent.id));   // Variant 2
  const b = store.addVariant(parent.id, store.nextVariantLabel(parent.id));   // Variant 3
  store.remove(a.id);                                                          // drop Variant 2
  // One variant left (Variant 3), so the newcomer is positionally 3rd -> taken -> 4.
  assert.equal(store.nextVariantLabel(parent.id), 'Variant 4');
});

test('setLabel writes a parent label onto the build itself', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Stormweaver CoC' });
  assert.equal(store.get(parent.id).label ?? null, null, 'unset by default');
  store.setLabel(parent.id, 'Leveling');
  assert.equal(store.get(parent.id).label, 'Leveling');
  assert.equal(store.get(parent.id).name, 'Stormweaver CoC', 'the TITLE is untouched');
});

test('setLabel on a variant writes the parent entry, not the variant build', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Stormweaver CoC' });
  const v = store.addVariant(parent.id, 'Variant 2');
  store.setLabel(v.id, 'Endgame');
  assert.deepEqual(store.get(parent.id).variants, [{ label: 'Endgame', buildId: v.id }]);
  assert.equal(store.get(v.id).label ?? null, null, 'no duplicate label on the variant build');
  assert.equal(store.get(v.id).name, 'Stormweaver CoC', 'title still untouched');
});

test('setLabel is a no-op for an unknown id', () => {
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  assert.equal(store.setLabel('nope', 'X'), null);
});

test('a renamed parent label survives the share codec', async () => {
  const { encodeGroup, decodeGroup } = await import('../public/js/build-code.js');
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Stormweaver CoC' });
  store.setLabel(parent.id, 'Leveling');
  store.addVariant(parent.id, 'Endgame');
  const out = await decodeGroup(await encodeGroup(store.group(parent.id)));
  assert.equal(out.parent.label, 'Leveling', 'the parent label travels inside the build');
  assert.equal(out.variants[0].label, 'Endgame');
});

test('clampBuild bounds a parent label too', () => {
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid });
  b.label = 'x'.repeat(5000);
  const { build, trimmed } = clampBuild(b);
  assert.equal(build.label.length, LIMITS.label);
  assert.ok(trimmed.some((t) => /label/i.test(t)), JSON.stringify(trimmed));
});

test('validateBuild accepts an absent or string label, rejects other types', () => {
  const b = emptyBuild({ now: fixedNow, uuid: fixedUuid });
  assert.equal(validateBuild(b).ok, true, 'absent is fine');
  b.label = 'Leveling';
  assert.equal(validateBuild(b).ok, true);
  b.label = 42;
  assert.equal(validateBuild(b).ok, false);
});

test('addVariant does not copy the parent label onto the child', () => {
  // A variant's label lives on the parent's ENTRY, so a copied `label` on the
  // build is stale data — it would resurface as the child's own label if the
  // child were ever promoted to a root.
  const store = createStore(memStorage(), { now: fixedNow, uuid: seqUuid() });
  const parent = store.create({ name: 'Stormweaver CoC' });
  store.setLabel(parent.id, 'Leveling');
  const v = store.addVariant(parent.id, 'Endgame');
  assert.equal(store.get(v.id).label ?? null, null, 'the child carries no inherited label');
  assert.equal(store.get(parent.id).label, 'Leveling', 'the root keeps its own');
});
