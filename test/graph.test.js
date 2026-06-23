// test/graph.test.js — the app's graph read layer (src/data/graph.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNode, nodesByKind, nodeBySlug, edgesFrom, edgesTo } from '../src/data/graph.js';

test('nodesByKind returns gem and skill nodes', () => {
  const gems = nodesByKind('gem');
  const skills = nodesByKind('skill');
  assert.ok(gems.length > 0, 'has gem nodes');
  assert.ok(skills.length > 0, 'has skill nodes');
  assert.ok(gems.every((n) => n.kind === 'gem'));
  assert.ok(gems.every((n) => n.id && n.slug && n.name), 'nodes carry id/slug/name');
});

test('nodeBySlug resolves a gem and getNode round-trips by id', () => {
  const gem = nodesByKind('gem')[0];
  const bySlug = nodeBySlug('gem', gem.slug);
  assert.equal(bySlug.id, gem.id, 'slug lookup returns the same node');
  assert.equal(getNode(gem.id).id, gem.id, 'getNode returns node with id');
  assert.equal(nodeBySlug('gem', 'definitely-not-a-real-slug'), null);
  assert.equal(getNode('Metadata/Nope'), null);
});

test('edgesFrom/edgesTo traverse the same edge both ways, filtered by type', () => {
  // Find a gem that grants a skill.
  const granting = nodesByKind('gem').find((g) => edgesFrom(g.id, 'grants').length > 0);
  assert.ok(granting, 'some gem has a grants edge');

  const grants = edgesFrom(granting.id, 'grants');
  assert.ok(grants.every((e) => e.type === 'grants' && e.from === granting.id));

  // The granted skill resolves to a node, and the reverse edge points back.
  const skillId = grants[0].to;
  assert.ok(getNode(skillId), 'grant target is a node');
  const reverse = edgesTo(skillId, 'grants');
  assert.ok(reverse.some((e) => e.from === granting.id), 'reverse traversal finds the edge');

  // Type filter is honored.
  const all = edgesFrom(granting.id);
  assert.ok(all.length >= grants.length);
  assert.ok(edgesFrom(granting.id, 'no_such_type').length === 0);
});
