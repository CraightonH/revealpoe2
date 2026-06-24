// test/graph/manual.test.js — guardrails for the hand-crafted data overlay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOverlays } from '../../scripts/graph/manual.js';

// Minimal source graph: one default-skill gem + two bow bases in class 'bow'.
const sourceNodes = [
  { id: 'Gem/Bow', kind: 'gem', name: 'Bow Shot', slug: 'bow-shot', props: {}, source: 'repoe' },
  { id: 'Base/Bow1', kind: 'base', name: 'Crude Bow', slug: 'crude-bow', props: { classSlug: 'bow' }, source: 'repoe' },
  { id: 'Base/Bow2', kind: 'base', name: 'Shortbow', slug: 'shortbow', props: { classSlug: 'bow' }, source: 'repoe' },
];
const wds = (map) => [{ name: 'weapon-default-skills', data: { kind: 'weapon-default-skills', map } }];

test('expands a weapon-default-skills rule into derived default_skill edges', () => {
  const r = applyOverlays({ nodes: sourceNodes, edges: [], overlays: wds({ 'Gem/Bow': 'bow' }) });
  assert.equal(r.errors.length, 0);
  assert.equal(r.edges.length, 2, 'one edge per base in the class');
  assert.ok(r.edges.every((e) => e.type === 'default_skill' && e.to === 'Gem/Bow'));
  assert.ok(r.edges.every((e) => e.source === 'derived' && e.via === 'manual:weapon-default-skills'));
  assert.deepEqual(r.edges.map((e) => e.from).sort(), ['Base/Bow1', 'Base/Bow2']);
});

test('a gem may serve multiple classes via an array value', () => {
  const nodes = [
    ...sourceNodes,
    { id: 'Base/Axe1', kind: 'base', name: 'Axe', slug: 'axe', props: { classSlug: 'one-hand-axe' }, source: 'repoe' },
    { id: 'Base/Axe2', kind: 'base', name: 'Greataxe', slug: 'greataxe', props: { classSlug: 'two-hand-axe' }, source: 'repoe' },
    { id: 'Gem/Axe', kind: 'gem', name: 'Axe Slash', slug: 'axe-slash', props: {}, source: 'repoe' },
  ];
  const r = applyOverlays({
    nodes,
    edges: [],
    overlays: [{ name: 'weapon-default-skills', data: { kind: 'weapon-default-skills', map: { 'Gem/Axe': ['one-hand-axe', 'two-hand-axe'] } } }],
  });
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.edges.map((e) => e.from).sort(), ['Base/Axe1', 'Base/Axe2']);
  assert.ok(r.edges.every((e) => e.to === 'Gem/Axe'));
});

test('referential integrity: an unresolved gem key is a build error', () => {
  const r = applyOverlays({ nodes: sourceNodes, edges: [], overlays: wds({ 'Gem/Renamed': 'bow' }) });
  assert.equal(r.edges.length, 0);
  assert.ok(r.errors.some((e) => /not a live gem node/.test(e)));
});

test('referential integrity: a class slug with no bases is a build error', () => {
  const r = applyOverlays({ nodes: sourceNodes, edges: [], overlays: wds({ 'Gem/Bow': 'nonexistent-class' }) });
  assert.equal(r.edges.length, 0);
  assert.ok(r.errors.some((e) => /has no bases/.test(e)));
});

test('retirement detection: drops + warns when source already has the relationship', () => {
  // Source now expresses the same default_skill edge for Base/Bow1.
  const sourceEdges = [{ type: 'default_skill', from: 'Base/Bow1', to: 'Gem/Bow', source: 'repoe' }];
  const r = applyOverlays({ nodes: sourceNodes, edges: sourceEdges, overlays: wds({ 'Gem/Bow': 'bow' }) });
  assert.equal(r.errors.length, 0);
  assert.equal(r.edges.length, 1, 'the source-duplicated edge is dropped');
  assert.equal(r.edges[0].from, 'Base/Bow2');
  assert.ok(r.warnings.some((w) => /retire .*source now provides/.test(w)));
});

test('unknown overlay kind is a build error', () => {
  const r = applyOverlays({ nodes: sourceNodes, edges: [], overlays: [{ name: 'x', data: { kind: 'bogus' } }] });
  assert.ok(r.errors.some((e) => /unknown overlay kind 'bogus'/.test(e)));
});
