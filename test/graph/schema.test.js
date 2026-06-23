import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, EDGE_TYPES, makeNode, makeEdge } from '../../scripts/graph/schema.js';

test('makeNode returns a normalized node with defaults', () => {
  const n = makeNode({ id: 'X', kind: KINDS.GEM, name: 'Fireball', slug: 'fireball' });
  assert.deepEqual(n, { id: 'X', kind: 'gem', name: 'Fireball', slug: 'fireball', props: {}, search: '' });
});

test('makeNode rejects an invalid kind', () => {
  assert.throws(() => makeNode({ id: 'X', kind: 'nope', name: 'n', slug: 's' }), /invalid kind/);
});

test('makeNode requires id, name, slug', () => {
  assert.throws(() => makeNode({ kind: KINDS.GEM, name: 'n', slug: 's' }), /id required/);
  assert.throws(() => makeNode({ id: 'X', kind: KINDS.GEM, slug: 's' }), /name required/);
  assert.throws(() => makeNode({ id: 'X', kind: KINDS.GEM, name: 'n' }), /slug required/);
});

test('makeEdge omits props when not given, keeps it when given', () => {
  assert.deepEqual(makeEdge({ type: EDGE_TYPES.GRANTS, from: 'A', to: 'B' }), { type: 'grants', from: 'A', to: 'B' });
  assert.deepEqual(
    makeEdge({ type: EDGE_TYPES.ROLLS_ON, from: 'A', to: 'B', props: { tiers: [1] } }),
    { type: 'rolls_on', from: 'A', to: 'B', props: { tiers: [1] } },
  );
});

test('makeEdge rejects an invalid type and missing endpoints', () => {
  assert.throws(() => makeEdge({ type: 'nope', from: 'A', to: 'B' }), /invalid type/);
  assert.throws(() => makeEdge({ type: EDGE_TYPES.GRANTS, from: 'A' }), /from and to required/);
});
