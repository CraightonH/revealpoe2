import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey, planOg } from '../scripts/build-og.js';

const SALT = 'salt-v1';
const spec = (over = {}) => ({
  name: 'Spark', typeLine: 'Skill', lines: ['a', 'b'],
  accent: '#fff', glow: 'rgba(0,0,0,0.1)', artPath: '/img/spark.webp', ...over,
});
const entry = (id, over = {}) => ({ id, file: `out/${id}.png`, spec: spec(over) });

// No art change: stat string is constant. Everything else fixed.
const noArt = () => '';
const fixedArt = () => 'mtime:size';
const allExist = () => true;

test('cacheKey is stable for identical inputs and varies with each input', () => {
  const s = spec();
  assert.equal(cacheKey(s, SALT, 'A'), cacheKey(s, SALT, 'A'));
  assert.notEqual(cacheKey(s, SALT, 'A'), cacheKey(s, SALT, 'B'));        // art changed
  assert.notEqual(cacheKey(s, SALT, 'A'), cacheKey(s, 'salt-v2', 'A'));   // salt changed
  assert.notEqual(cacheKey(s, SALT, 'A'), cacheKey(spec({ name: 'X' }), SALT, 'A')); // spec changed
});

test('unchanged spec + art + salt → nothing to render', () => {
  const entries = [entry('gem/spark'), entry('gem/fireball', { name: 'Fireball' })];
  const warm = planOg({ entries, prevManifest: {}, salt: SALT, artStatOf: fixedArt, exists: allExist });
  // Second pass with the manifest the first pass produced → all skipped.
  const again = planOg({ entries, prevManifest: warm.manifest, salt: SALT, artStatOf: fixedArt, exists: allExist });
  assert.equal(again.todo.length, 0);
});

test('a changed spec line re-renders only that card', () => {
  const entries = [entry('gem/spark'), entry('gem/fireball', { name: 'Fireball' })];
  const prev = planOg({ entries, prevManifest: {}, salt: SALT, artStatOf: fixedArt, exists: allExist }).manifest;
  const changed = [entry('gem/spark', { lines: ['a', 'CHANGED'] }), entry('gem/fireball', { name: 'Fireball' })];
  const plan = planOg({ entries: changed, prevManifest: prev, salt: SALT, artStatOf: fixedArt, exists: allExist });
  assert.deepEqual(plan.todo.map((e) => e.id), ['gem/spark']);
});

test('a changed art stat re-renders the card whose art moved', () => {
  const entries = [entry('gem/spark')];
  const prev = planOg({ entries, prevManifest: {}, salt: SALT, artStatOf: () => 'old', exists: allExist }).manifest;
  const plan = planOg({ entries, prevManifest: prev, salt: SALT, artStatOf: () => 'new', exists: allExist });
  assert.deepEqual(plan.todo.map((e) => e.id), ['gem/spark']);
});

test('a salt (render code/font) change re-renders everything', () => {
  const entries = [entry('gem/spark'), entry('gem/fireball', { name: 'Fireball' })];
  const prev = planOg({ entries, prevManifest: {}, salt: SALT, artStatOf: fixedArt, exists: allExist }).manifest;
  const plan = planOg({ entries, prevManifest: prev, salt: 'salt-v2', artStatOf: fixedArt, exists: allExist });
  assert.equal(plan.todo.length, entries.length);
});

test('a missing PNG re-renders even when the key matches', () => {
  const entries = [entry('gem/spark')];
  const prev = planOg({ entries, prevManifest: {}, salt: SALT, artStatOf: noArt, exists: allExist }).manifest;
  const plan = planOg({ entries, prevManifest: prev, salt: SALT, artStatOf: noArt, exists: () => false });
  assert.deepEqual(plan.todo.map((e) => e.id), ['gem/spark']);
});

test('a removed slug drops from the manifest and desired set (gets pruned)', () => {
  const before = [entry('gem/spark'), entry('gem/gone')];
  const warm = planOg({ entries: before, prevManifest: {}, salt: SALT, artStatOf: noArt, exists: allExist });
  const after = planOg({ entries: [entry('gem/spark')], prevManifest: warm.manifest, salt: SALT, artStatOf: noArt, exists: allExist });
  assert.ok(!('gem/gone' in after.manifest));
  assert.ok(!after.desiredFiles.has('out/gem/gone.png'));
});
