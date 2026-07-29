import test from 'node:test';
import assert from 'node:assert/strict';
import { createFsBackend } from '../../src/mcp/backends/fs.js';

const b = createFsBackend();

test('getNode round-trips a slug lookup and stamps buildable', async () => {
  const gem = await b.nodeBySlug('gem', 'fireball');
  assert.ok(gem, 'fireball gem exists');
  assert.equal(gem.kind, 'gem');
  assert.equal(gem.buildable, true);
  const same = await b.getNode(gem.id);
  assert.deepEqual(same, gem);
});

test('nodesByName is case-insensitive and kind-filterable', async () => {
  const all = await b.nodesByName('fireball');
  assert.ok(all.length >= 1);
  const gems = await b.nodesByName('FIREBALL', ['gem']);
  assert.equal(gems.length, 1);
  assert.equal(gems[0].kind, 'gem');
});

test('nodesByIds preserves order and drops misses', async () => {
  const gem = await b.nodeBySlug('gem', 'fireball');
  const out = await b.nodesByIds(['nope', gem.id]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, gem.id);
});

test('edgesFrom/edgesTo use {type, from, to} and agree with the graph', async () => {
  const gem = await b.nodeBySlug('gem', 'fireball');
  const recs = await b.edgesFrom(gem.id, 'recommends_support');
  assert.ok(recs.length > 0, 'fireball recommends supports');
  assert.ok(recs.every((e) => e.type === 'recommends_support' && e.from === gem.id && e.to));
  const back = await b.edgesTo(recs[0].to, 'recommends_support');
  assert.ok(back.some((e) => e.from === gem.id));
});

test('search finds by name and stat text, respects kind + limit', async () => {
  const hits = await b.search('flame wall', { kind: 'gem', limit: 5 });
  assert.ok(hits.length >= 1 && hits.length <= 5);
  assert.ok(hits.every((h) => h.kind === 'gem'));
  assert.ok(hits.some((h) => h.name.toLowerCase().includes('flame')));
});

test('schemaInfo counts match the artifact', async () => {
  const info = await b.schemaInfo();
  assert.equal(Object.keys(info.kinds).length, 12);
  assert.equal(info.kinds.keyword, 720);
  assert.equal(info.relations.length, 11);
  const rolls = info.relations.find((r) => r.type === 'rolls_on');
  assert.deepEqual(rolls.from, ['affix']);
  assert.deepEqual(rolls.to, ['base']);
});

test('planner + treeMeta + passives are wired', async () => {
  const p = await b.planner();
  assert.ok(p.classes.some((c) => c.slug === 'sorceress'));
  const tm = await b.treeMeta();
  assert.equal(tm.classStarts.Sorceress, 54447);
  assert.equal(tm.pointBudget, 122);
  assert.equal(tm.ascendancyBudget, 8);
  assert.ok(['str', 'dex', 'int'].includes(tm.classAttrs.Sorceress));
  const adj = await b.passiveAdj();
  assert.ok(adj.get(54447)?.length > 0, 'class start has neighbours');
  const all = await b.passiveNodes();
  const first = await b.passiveNode(all[0].h);
  assert.deepEqual(first, all[0]);
  assert.equal(all.length, 4784);
  const named = await b.passiveNodesByName(all.find((n) => n.kind === 'notable').name);
  assert.ok(named.length >= 1);
});
