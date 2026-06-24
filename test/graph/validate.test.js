import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGraph } from '../../scripts/graph/validate.js';

const node = (id, kind, slug) => ({ id, kind, name: id, slug, props: {}, search: '', source: 'repoe' });
const edge = (type, from, to) => ({ type, from, to, source: 'repoe' });

test('clean graph returns no errors', () => {
  const nodes = [node('g1', 'gem', 'fireball'), node('s1', 'skill', 'fireball')];
  const edges = [edge('grants', 'g1', 's1')];
  assert.deepEqual(validateGraph({ nodes, edges }), []);
});

test('missing source on a node or edge is an error', () => {
  const nodes = [{ id: 'g1', kind: 'gem', name: 'g1', slug: 'fireball', props: {}, search: '' }];
  const errors = validateGraph({ nodes, edges: [{ type: 'grants', from: 'g1', to: 'g1' }] });
  assert.ok(errors.some((e) => /invalid\/missing source .* on node g1/.test(e)));
  assert.ok(errors.some((e) => /invalid\/missing source .* on edge grants/.test(e)));
});

test('per-kind slug uniqueness: same slug across kinds is allowed', () => {
  // gem 'fireball' and skill 'fireball' share a slug — not an error.
  const nodes = [node('g1', 'gem', 'fireball'), node('s1', 'skill', 'fireball')];
  assert.deepEqual(validateGraph({ nodes, edges: [] }), []);
});

test('duplicate slug within a kind is an error', () => {
  const nodes = [node('g1', 'gem', 'dup'), node('g2', 'gem', 'dup')];
  const errors = validateGraph({ nodes, edges: [] });
  assert.ok(errors.some((e) => /duplicate slug 'dup'/.test(e)));
});

test('dangling edge endpoint is an error', () => {
  const nodes = [node('g1', 'gem', 'fireball')];
  const edges = [edge('grants', 'g1', 'missing')];
  const errors = validateGraph({ nodes, edges });
  assert.ok(errors.some((e) => /dangling edge grants: to 'missing'/.test(e)));
});

test('unknown kind and edge type are errors', () => {
  const nodes = [node('g1', 'bogus', 's')];
  const edges = [edge('bogus', 'g1', 'g1')];
  const errors = validateGraph({ nodes, edges });
  assert.ok(errors.some((e) => /unknown kind 'bogus'/.test(e)));
  assert.ok(errors.some((e) => /unknown edge type 'bogus'/.test(e)));
});
