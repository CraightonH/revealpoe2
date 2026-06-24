import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordNodes } from '../../scripts/graph/keywords.js';

test('keywordNodes emits a node per defined keyword with definition + phrases', () => {
  const { nodes } = keywordNodes();
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // a known defined keyword has a node, non-empty definition, and term as name
  const acc = byId.get('Accuracy');
  assert.ok(acc, 'expected an Accuracy keyword node');
  assert.equal(acc.kind, 'keyword');
  assert.equal(acc.name, 'Accuracy');
  assert.ok(acc.props.definition.trim().length > 0);
  assert.ok(Array.isArray(acc.props.phrases));

  // empty-definition keyword gets NO node
  assert.equal(byId.has('AbsentAmulet'), false);

  // every node carries a non-empty definition and a slug
  for (const n of nodes) {
    assert.ok(n.props.definition.trim().length > 0, `empty def on ${n.id}`);
    assert.ok(n.slug, `missing slug on ${n.id}`);
  }
});

test('a phrase-bearing keyword carries its derived surface phrases', () => {
  const { nodes } = keywordNodes();
  const res = nodes.find((n) => n.id === 'Resistances');
  assert.ok(res, 'expected a Resistances node');
  const lower = res.props.phrases.map((p) => p.toLowerCase());
  assert.ok(lower.includes('cold resistance'), 'expected "cold resistance" phrase on Resistances');
});
