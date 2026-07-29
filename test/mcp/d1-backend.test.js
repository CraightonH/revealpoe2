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

test('edgesFromMany/edgesToMany agree between fs and d1, including the >90-id chunking path', async (t) => {
  const d1 = await makeD1();
  if (!d1) { t.skip('node:sqlite unavailable'); return; }
  const fs = createFsBackend();
  const norm = (list) => list.map((e) => `${e.type}|${e.from}|${e.to}`).sort();

  // Affix/*/LocalAttributeRequirements is the measured worst-case fan-out
  // (940 rolls_on edges) — its rolls_on targets alone exceed the 90-id
  // chunk boundary, so a single query against them exercises chunking.
  const hub = await fs.nodeBySlug('affix', 'localattributerequirements');
  assert.ok(hub, 'worst fan-out affix findable by slug');
  const hubEdges = await fs.edgesFrom(hub.id, 'rolls_on');
  const ids = hubEdges.map((e) => e.to);
  assert.ok(ids.length > 90, 'need >90 ids to exercise the d1 chunking path');

  const [fromD1, fromFs] = await Promise.all([
    d1.edgesFromMany(ids, 'rolls_on'),
    fs.edgesFromMany(ids, 'rolls_on'),
  ]);
  assert.deepEqual(norm(fromD1), norm(fromFs));

  const [toD1, toFs] = await Promise.all([
    d1.edgesToMany(ids, 'rolls_on'),
    fs.edgesToMany(ids, 'rolls_on'),
  ]);
  assert.deepEqual(norm(toD1), norm(toFs));
  assert.ok(toD1.length > 0, 'incoming rolls_on edges exist for these bases');

  // No type filter — flat union across all ids for both directions.
  const [fromD1All, fromFsAll] = await Promise.all([
    d1.edgesFromMany(ids),
    fs.edgesFromMany(ids),
  ]);
  assert.deepEqual(norm(fromD1All), norm(fromFsAll));
});
