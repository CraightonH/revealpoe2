import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGraph } from '../../scripts/graph/validate.js';

const node = (id, kind, slug) => ({ id, kind, name: id, slug, props: {}, search: '' });

test('clean graph returns no errors', () => {
  const nodes = [node('g1', 'gem', 'fireball'), node('s1', 'skill', 'fireball')];
  const edges = [{ type: 'grants', from: 'g1', to: 's1' }];
  assert.deepEqual(validateGraph({ nodes, edges }), []);
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
  const edges = [{ type: 'grants', from: 'g1', to: 'missing' }];
  const errors = validateGraph({ nodes, edges });
  assert.ok(errors.some((e) => /dangling edge grants: to 'missing'/.test(e)));
});

test('unknown kind and edge type are errors', () => {
  const nodes = [node('g1', 'bogus', 's')];
  const edges = [{ type: 'bogus', from: 'g1', to: 'g1' }];
  const errors = validateGraph({ nodes, edges });
  assert.ok(errors.some((e) => /unknown kind 'bogus'/.test(e)));
  assert.ok(errors.some((e) => /unknown edge type 'bogus'/.test(e)));
});
