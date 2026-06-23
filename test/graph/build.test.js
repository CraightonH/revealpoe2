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
  const [id, node] = Object.entries(art.nodes)[0];
  assert.ok(id.startsWith('Metadata/'));
  assert.equal(node.id, undefined, 'id is the map key, not a field');
  assert.equal(Object.keys(art.nodes).length, g.nodes.length);
});
