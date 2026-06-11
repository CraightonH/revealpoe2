import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJson } from '../src/data/loader.js';

test('loadJson reads a known repoe file and caches it', () => {
  const a = loadJson('repoe-poe2/gem_tags.json');
  assert.ok(a.fire, 'expected a "fire" gem tag key');
  const b = loadJson('repoe-poe2/gem_tags.json');
  assert.equal(a, b, 'second call should return the cached object reference');
});
