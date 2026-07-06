import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, EDGE_TYPES, SOURCES, makeNode, makeEdge } from '../../scripts/graph/schema.js';

test('makeNode returns a normalized node with defaults', () => {
  const n = makeNode({ id: 'X', kind: KINDS.GEM, name: 'Fireball', slug: 'fireball' });
  assert.deepEqual(n, { id: 'X', kind: 'gem', name: 'Fireball', slug: 'fireball', props: {}, search: '', source: 'repoe' });
});

test('makeNode defaults source to repoe and rejects an invalid source', () => {
  assert.equal(makeNode({ id: 'X', kind: KINDS.GEM, name: 'n', slug: 's' }).source, 'repoe');
  assert.equal(makeNode({ id: 'X', kind: KINDS.GEM, name: 'n', slug: 's', source: 'manual' }).source, 'manual');
  assert.throws(() => makeNode({ id: 'X', kind: KINDS.GEM, name: 'n', slug: 's', source: 'nope' }), /invalid source/);
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
  assert.deepEqual(makeEdge({ type: EDGE_TYPES.GRANTS, from: 'A', to: 'B' }), { type: 'grants', from: 'A', to: 'B', source: 'repoe' });
  assert.deepEqual(
    makeEdge({ type: EDGE_TYPES.ROLLS_ON, from: 'A', to: 'B', props: { tiers: [1] } }),
    { type: 'rolls_on', from: 'A', to: 'B', props: { tiers: [1] }, source: 'repoe' },
  );
});

test('makeEdge stamps source/via for derived overlay edges', () => {
  assert.deepEqual(
    makeEdge({ type: EDGE_TYPES.DEFAULT_SKILL, from: 'A', to: 'B', source: 'derived', via: 'manual:x' }),
    { type: 'default_skill', from: 'A', to: 'B', source: 'derived', via: 'manual:x' },
  );
  assert.throws(() => makeEdge({ type: EDGE_TYPES.GRANTS, from: 'A', to: 'B', source: 'nope' }), /invalid source/);
});

test('makeEdge rejects an invalid type and missing endpoints', () => {
  assert.throws(() => makeEdge({ type: 'nope', from: 'A', to: 'B' }), /invalid type/);
  assert.throws(() => makeEdge({ type: EDGE_TYPES.GRANTS, from: 'A' }), /from and to required/);
});

test('gear-slot kind and fits_slot edge type are registered', () => {
  assert.equal(KINDS.GEAR_SLOT, 'gear-slot');
  assert.equal(EDGE_TYPES.FITS_SLOT, 'fits_slot');
  // Factories accept them (KIND_SET/EDGE_SET auto-derive from the enums).
  const n = makeNode({ id: 'Slot/helmet', kind: KINDS.GEAR_SLOT, name: 'Helmet', slug: 'helmet', source: SOURCES.MANUAL });
  assert.equal(n.kind, 'gear-slot');
  const e = makeEdge({ type: EDGE_TYPES.FITS_SLOT, from: 'Base/X', to: 'Slot/helmet', source: SOURCES.DERIVED, via: 'manual:gear-slots' });
  assert.equal(e.type, 'fits_slot');
  assert.equal(e.via, 'manual:gear-slots');
});
