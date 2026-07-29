import test from 'node:test';
import assert from 'node:assert/strict';
import { runBackendSuite } from './backend-suite.js';
import { createFsBackend } from '../../src/mcp/backends/fs.js';

async function makeD1() {
  try {
    const { loadSeededDb } = await import('./d1-adapter.js');
    const { createD1Backend } = await import('../../src/mcp/backends/d1.js');
    return createD1Backend(await loadSeededDb());
  } catch (err) {
    if (err.code === 'ERR_UNKNOWN_BUILTIN_MODULE' || /node:sqlite/.test(String(err))) return null;
    throw err;
  }
}

runBackendSuite('fsBackend', async () => createFsBackend());
runBackendSuite('d1Backend', makeD1);

test('fs and d1 agree on non-search methods (equivalence)', async (t) => {
  const d1 = await makeD1();
  if (!d1) { t.skip('node:sqlite unavailable'); return; }
  const fs = createFsBackend();
  const strip = (n) => n && { id: n.id, kind: n.kind, name: n.name, slug: n.slug, buildable: n.buildable };

  const gem = await fs.nodeBySlug('gem', 'fireball');
  assert.deepEqual(strip(await d1.getNode(gem.id)), strip(gem));
  assert.deepEqual(await d1.edgesFrom(gem.id, 'recommends_support'),
    await fs.edgesFrom(gem.id, 'recommends_support'));
  assert.deepEqual(await d1.schemaInfo(), await fs.schemaInfo());
  assert.deepEqual(await d1.treeMeta(), await fs.treeMeta());
  assert.deepEqual((await d1.passiveNodes()).sort((a, b) => a.h - b.h),
    (await fs.passiveNodes()).sort((a, b) => a.h - b.h));
  const [dp, fp] = [await d1.planner(), await fs.planner()];
  assert.deepEqual(Object.keys(dp.items).length, Object.keys(fp.items).length);
  assert.deepEqual(dp.classes, fp.classes);
  // search rankings may differ (FTS vs substring) — assert membership, not order
  const [ds, fsr] = await Promise.all([
    d1.search('flame wall', { kind: 'gem', limit: 25 }),
    fs.search('flame wall', { kind: 'gem', limit: 25 }),
  ]);
  const dset = new Set(ds.map((h) => h.slug));
  assert.ok(fsr.some((h) => dset.has(h.slug)), 'top fs hit present in d1 results');
});
