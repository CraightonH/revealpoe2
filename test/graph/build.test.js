// test/graph/build.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, toArtifact } from '../../scripts/graph/build.js';

test('buildGraph validates clean and stamps meta', () => {
  const g = buildGraph(); // throws if validation fails
  assert.equal(g.meta.schema, 1);
  assert.match(g.meta.sourceHash, /^[0-9a-f]{64}$/);
  assert.ok(g.nodes.some((n) => n.kind === 'gem'));
  assert.ok(g.nodes.some((n) => n.kind === 'skill'));
  assert.ok(g.edges.some((e) => e.type === 'grants'));
  assert.ok(g.edges.some((e) => e.type === 'recommends_support'));
});

test('toArtifact keys nodes by id and drops the inline id', () => {
  const g = buildGraph();
  const art = toArtifact(g);
  // Gem nodes use Metadata/ source keys; skill nodes use raw skill keys (e.g. 'AlchemistsBoonPlayer').
  // Assert that every gem-kind node is keyed by its Metadata/ path, and that no node retains an
  // inline id field (id is the map key, not duplicated in the value).
  const gemKeys = Object.entries(art.nodes).filter(([, n]) => n.kind === 'gem').map(([k]) => k);
  assert.ok(gemKeys.every((k) => k.startsWith('Metadata/')), 'every gem node key starts with Metadata/');
  assert.ok(Object.values(art.nodes).every((n) => n.id === undefined), 'id is the map key, not a field');
  assert.equal(Object.keys(art.nodes).length, g.nodes.length);
});
