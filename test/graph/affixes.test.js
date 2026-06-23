import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affixNodes, affixEdges, resolveImplicitTexts } from '../../scripts/graph/affixes.js';
import { baseNodes } from '../../scripts/graph/bases.js';
import { slugify } from '../../src/data/slug.js';
import { originSlug } from '../../src/data/affixOrigins.js';

test('affixNodes: one node per (origin, type) with non-empty tiers', () => {
  const { nodes } = affixNodes();
  assert.ok(nodes.length > 500, 'many affix families');
  for (const n of nodes) {
    assert.equal(n.kind, 'affix');
    assert.ok(['standard', 'corrupted', 'desecrated'].includes(n.props.origin), `valid origin (${n.id})`);
    assert.ok(n.props.type, 'has type');
    assert.ok(Array.isArray(n.props.tiers) && n.props.tiers.length > 0, 'has tiers');
  }
});

test('affixNodes: slug is bare for standard, namespaced for other origins', () => {
  const { nodes } = affixNodes();
  for (const n of nodes) {
    assert.equal(n.slug, originSlug(n.props.origin, slugify(n.props.type)));
  }
  const standard = nodes.filter((n) => n.props.origin === 'standard');
  assert.ok(standard.every((n) => !n.slug.startsWith('corrupted-') && !n.slug.startsWith('desecrated-')));
  assert.ok(nodes.filter((n) => n.props.origin === 'corrupted').every((n) => n.slug.startsWith('corrupted-')));
});

test('affixNodes: slugs are unique within the affix kind', () => {
  const { nodes } = affixNodes();
  const slugs = new Set();
  for (const n of nodes) {
    assert.ok(!slugs.has(n.slug), `duplicate affix slug ${n.slug}`);
    slugs.add(n.slug);
  }
});

test('affixNodes: a dual-gen type is one node holding both prefix and suffix tiers', () => {
  const { nodes } = affixNodes();
  // IncreasedLife appears as both a prefix (base_maximum_life) and a suffix family.
  const life = nodes.find((n) => n.id === 'Affix/standard/IncreasedLife');
  assert.ok(life, 'IncreasedLife standard node present');
  assert.equal(life.slug, slugify('IncreasedLife'));
  const gens = new Set(life.props.tiers.map((t) => t.generationType));
  assert.ok(gens.has('prefix') && gens.has('suffix'), 'holds both gens on one node');
});

test('affixNodes: desecrated gear families carry a Well-of-Souls boss', () => {
  const { nodes } = affixNodes();
  const des = nodes.filter((n) => n.props.origin === 'desecrated');
  assert.ok(des.length > 0);
  // Boss is null for Abyssal *map* mods; gear mods carry one of the three bosses.
  assert.ok(des.every((n) => n.props.boss === null || ['ulaman', 'amanamu', 'kurgal'].includes(n.props.boss)));
  assert.ok(des.some((n) => n.props.boss), 'some desecrated families have a boss');
});

test('affixEdges: rolls_on points only to browsable base nodes, with valid tier indices', () => {
  const { nodes: aNodes, records } = affixNodes();
  const { nodes: bNodes, records: baseRecs } = baseNodes();
  const nodeIds = new Set([...aNodes, ...bNodes].map((n) => n.id));
  const baseIds = new Set(bNodes.map((n) => n.id));
  const tierCount = new Map(aNodes.map((n) => [n.id, n.props.tiers.length]));
  const originOf = new Map(aNodes.map((n) => [n.id, n.props.origin]));

  const edges = affixEdges(records, baseRecs, nodeIds);
  assert.ok(edges.length > 10000, 'substantial rolls_on edge set');
  for (const e of edges) {
    assert.equal(e.type, 'rolls_on');
    assert.ok(baseIds.has(e.to), `edge target ${e.to} is a base node`);
    assert.ok(tierCount.has(e.from), `edge source ${e.from} is an affix node`);
    if (originOf.get(e.from) === 'desecrated') {
      assert.ok(!e.props, 'desecrated edges carry no tier restriction');
    } else {
      assert.ok(Array.isArray(e.props.tiers) && e.props.tiers.length > 0, 'standard/corrupted edge carries tier indices');
      const max = tierCount.get(e.from);
      assert.ok(e.props.tiers.every((i) => i >= 0 && i < max), 'tier indices are in range');
    }
  }
});

test('resolveImplicitTexts: resolves a base implicit, empty for unknown/none', () => {
  const res = resolveImplicitTexts(['AmuletImplicitAllAttributes1']);
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 'AmuletImplicitAllAttributes1');
  assert.match(res[0].text, /Attributes/);
  assert.deepEqual(resolveImplicitTexts([]), []);
  assert.deepEqual(resolveImplicitTexts(['NotARealImplicit']), []);
});
