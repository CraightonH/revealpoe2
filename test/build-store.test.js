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
