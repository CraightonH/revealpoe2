// test/mcp/backend-suite.js — shared contract, imported by both backend tests.
import test from 'node:test';
import assert from 'node:assert/strict';

export function runBackendSuite(name, makeBackend) {
  test(`${name}: contract`, async (t) => {
    const b = await makeBackend();
    if (!b) { t.skip('backend unavailable'); return; }

    await t.test('node lookups', async () => {
      const gem = await b.nodeBySlug('gem', 'fireball');
      assert.equal(gem.kind, 'gem');
      assert.equal(typeof gem.props, 'object');
      assert.equal(gem.buildable, true);
      assert.equal(await b.nodeBySlug('gem', 'no-such-gem'), null);
    });
    await t.test('edges', async () => {
      const gem = await b.nodeBySlug('gem', 'fireball');
      const recs = await b.edgesFrom(gem.id, 'recommends_support');
      assert.ok(recs.length > 0);
      assert.deepEqual(Object.keys(recs[0]).sort(), ['from', 'to', 'type']);
    });
    await t.test('schemaInfo', async () => {
      const info = await b.schemaInfo();
      assert.equal(info.kinds.keyword, 720);
      assert.equal(info.relations.length, 11);
    });
    await t.test('planner + tree', async () => {
      const p = await b.planner();
      assert.ok(p.gems.fireball);
      const tm = await b.treeMeta();
      assert.equal(tm.classStarts.Sorceress, 54447);
      assert.equal(tm.pointBudget, 122);
      const adj = await b.passiveAdj();
      assert.ok(adj.get(54447)?.length > 0);
      assert.ok((await b.passiveNodes()).length === 4784);
    });
    await t.test('search returns hits for a known query', async () => {
      const hits = await b.search('fireball', { kind: 'gem', limit: 10 });
      assert.ok(hits.some((h) => h.slug === 'fireball'));
    });
  });
}
