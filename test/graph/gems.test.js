// test/graph/gems.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectGemRecords } from '../../scripts/graph/gems.js';
import { listGems } from '../../src/data/gems.js';

test('selectGemRecords reproduces the current gem slug set', () => {
  const graphSlugs = new Set(selectGemRecords().map((r) => r.slug));
  const appSlugs = new Set(listGems().map((g) => g.slug));
  assert.equal(graphSlugs.size, appSlugs.size, 'same number of gems');
  for (const s of appSlugs) assert.ok(graphSlugs.has(s), `graph missing slug ${s}`);
});

test('selectGemRecords keys nodes by source id and excludes DNT/garbage', () => {
  const recs = selectGemRecords();
  assert.ok(recs.every((r) => r.id.startsWith('Metadata/')), 'ids are source Metadata keys');
  assert.ok(!recs.some((r) => r.raw.base_item.display_name.includes('[DNT')), 'no DNT entries');
});
