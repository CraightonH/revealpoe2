import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJson, listDataDir } from '../../scripts/graph/loader.js';

test('listDataDir returns filenames in a data subdirectory', () => {
  const files = listDataDir('pob-uniques');
  assert.ok(files.length > 10);
  assert.ok(files.includes('amulet.json'));
  assert.ok(files.includes('_manifest.json'));
});

test('loadJson reads a known repoe file and caches it', () => {
  const a = loadJson('repoe-poe2/gem_tags.json');
  assert.ok(a.fire, 'expected a "fire" gem tag key');
  const b = loadJson('repoe-poe2/gem_tags.json');
  assert.equal(a, b, 'second call should return the cached object reference');
});
