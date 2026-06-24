// test/graph/build.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, toArtifact } from '../../scripts/graph/build.js';

test('buildGraph validates clean and stamps meta', () => {
  const g = buildGraph(); // throws if validation fails
  assert.equal(g.meta.schema, 2);
  assert.match(g.meta.sourceHash, /^[0-9a-f]{64}$/);
  assert.match(g.meta.manualHash, /^[0-9a-f]{64}$/);
  assert.ok(g.nodes.some((n) => n.kind === 'gem'));
  assert.ok(g.nodes.some((n) => n.kind === 'skill'));
  assert.ok(g.edges.some((e) => e.type === 'grants'));
  assert.ok(g.edges.some((e) => e.type === 'recommends_support'));
});

test('buildGraph stamps provenance on every node/edge and summarizes it in meta', () => {
  const g = buildGraph();
  assert.ok(g.nodes.every((n) => n.source), 'every node carries a source');
  assert.ok(g.edges.every((e) => e.source), 'every edge carries a source');
  // Source-derived elements dominate; the meta summary tallies by tier.
  assert.ok(g.meta.provenance.nodes.repoe > 0);
  assert.ok(g.meta.provenance.edges.repoe > 0);
});

test('manual overlay emits derived default_skill edges with a via pointer', () => {
  const g = buildGraph();
  const ds = g.edges.filter((e) => e.type === 'default_skill');
  assert.ok(ds.length > 0, 'default_skill edges present');
  assert.ok(ds.every((e) => e.source === 'derived' && e.via?.startsWith('manual:')), 'derived + via stamped');
  // The driving example: bow bases point at the Bow Shot default-skill gem.
  const bowGem = 'Metadata/Items/Gem/SkillGemPlayerDefaultBow';
  const bows = ds.filter((e) => e.to === bowGem);
  assert.ok(bows.length > 0, 'bow bases grant Bow Shot');
  assert.ok(bows.every((e) => g.nodes.find((n) => n.id === e.from)?.kind === 'base'), 'edges originate at base nodes');
});

test('buildGraph includes base, class, and tag nodes with base edges', () => {
  const g = buildGraph();
  assert.ok(g.nodes.some((n) => n.kind === 'base'));
  assert.ok(g.nodes.some((n) => n.kind === 'class'));
  assert.ok(g.nodes.some((n) => n.kind === 'tag'));
  assert.ok(g.edges.some((e) => e.type === 'in_class'));
  assert.ok(g.edges.some((e) => e.type === 'tagged'));
});

test('buildGraph includes passive + ascendancy nodes with in_ascendancy edges', () => {
  const g = buildGraph();
  assert.ok(g.nodes.some((n) => n.kind === 'passive'), 'passive nodes present');
  assert.ok(g.nodes.some((n) => n.kind === 'ascendancy'), 'ascendancy nodes present');
  assert.ok(g.edges.some((e) => e.type === 'in_ascendancy'), 'in_ascendancy edges present');
  // grants edges now also originate from passives (granted_skill).
  assert.ok(
    g.edges.some((e) => e.type === 'grants' && String(e.from).startsWith('Passive/')),
    'a grants edge originates from a passive node',
  );
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

test('buildGraph includes unique nodes with has_base and grants edges', () => {
  const g = buildGraph();
  assert.ok(g.nodes.some((n) => n.kind === 'unique'), 'unique nodes present');
  assert.ok(g.edges.some((e) => e.type === 'has_base'), 'has_base edges present');
  // grants edges now come from both gems and uniques; assert a unique-sourced one.
  assert.ok(
    g.edges.some((e) => e.type === 'grants' && String(e.from).startsWith('Unique/')),
    'a grants edge originates from a unique node',
  );
});
