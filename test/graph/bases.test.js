import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectBaseRecords } from '../../scripts/graph/bases.js';

test('selectBaseRecords keys bases by source id and resolves known slugs', () => {
  const { records } = selectBaseRecords();
  const byId = new Map(records.map((r) => [r.id, r]));
  const stellar = byId.get('Metadata/Items/Amulets/FourAmulet8');
  assert.ok(stellar, 'Stellar Amulet present');
  assert.equal(stellar.slug, 'stellar-amulet');
  assert.equal(stellar.itemClass, 'Amulet');
  assert.equal(stellar.raw.name, 'Stellar Amulet');
  assert.ok(records.every((r) => r.id.startsWith('Metadata/')), 'ids are source Metadata keys');
});

test('selectBaseRecords excludes rune variants from records and collects them', () => {
  const { records, runeRaw } = selectBaseRecords();
  assert.ok(!records.some((r) => /^Rune(forged|mastered) /.test(r.raw.name)), 'no rune variants in records');
  assert.ok(runeRaw.length > 0, 'rune variants collected separately');
  assert.ok(runeRaw.every((v) => /^Rune(forged|mastered) /.test(v.name)));
});

test('selectBaseRecords disambiguates a name spanning multiple classes', () => {
  const { records } = selectBaseRecords();
  const slugs = new Set(records.map((r) => r.slug));
  // "Energy Blade" exists as both One Hand Sword and Two Hand Sword → class-suffixed.
  assert.ok(slugs.has('energy-blade--one-hand-sword'));
  assert.ok(slugs.has('energy-blade--two-hand-sword'));
  assert.ok(!slugs.has('energy-blade'), 'undisambiguated slug must not exist');
});

import { baseNodes, classNodes, tagNodes } from '../../scripts/graph/bases.js';

test('baseNodes carry resolved props for a known base', () => {
  const { nodes, records } = baseNodes();
  assert.equal(nodes.length, records.length, 'one node per record');
  assert.ok(nodes.every((n) => n.kind === 'base'));
  const stellar = nodes.find((n) => n.id === 'Metadata/Items/Amulets/FourAmulet8');
  assert.ok(stellar);
  const p = stellar.props;
  assert.equal(p.itemClass, 'Amulet');
  assert.equal(p.className, 'Amulets');
  assert.equal(p.classSlug, 'amulet');
  assert.equal(p.dropLevel, 25);
  assert.deepEqual(p.inventorySize, { w: 1, h: 1 });
  assert.ok(p.tags.includes('amulet'));
  assert.deepEqual(p.implicitIds, ['AmuletImplicitAllAttributes1']);
  assert.equal(p.iconDds, 'Art/2DItems/Amulets/Basetypes/StellarAmulet.dds');
  assert.ok(stellar.search.includes('stellar amulet'));
});

test('baseNodes compute structured properties for a weapon', () => {
  const { nodes } = baseNodes();
  const club = nodes.find((n) => n.name === 'Wooden Club' && n.props.itemClass === 'One Hand Mace');
  assert.ok(club, 'wooden club present');
  const labels = club.props.properties.map((pr) => pr.label);
  assert.ok(labels.includes('Physical Damage'));
  assert.ok(club.props.properties.every((pr) => pr.labelHtml === undefined), 'no presentation labelHtml in the node');
});

test('baseNodes fold rune variants onto the parent base as raw id-sets', () => {
  const { nodes } = baseNodes();
  // "Torment Club" (One Hand Mace) is the parent of "Runemastered Torment Club".
  const parent = nodes.find((n) => n.name === 'Torment Club' && n.props.itemClass === 'One Hand Mace');
  assert.ok(parent, 'parent base present');
  const rv = parent.props.runeVariants;
  assert.ok(Array.isArray(rv) && rv.length > 0, 'has rune variants');
  assert.ok(rv.some((v) => /^Rune(forged|mastered) /.test(v.name)));
  assert.ok(rv.every((v) => Array.isArray(v.optionIdSets) && v.optionIdSets.every(Array.isArray)));
});

test('classNodes cover browsable classes with synthetic ids', () => {
  const cnodes = classNodes();
  const amulet = cnodes.find((n) => n.id === 'Class/Amulet');
  assert.ok(amulet);
  assert.equal(amulet.kind, 'class');
  assert.equal(amulet.name, 'Amulets');
  assert.equal(amulet.slug, 'amulet');
  assert.equal(amulet.props.classId, 'Amulet');
});

test('tagNodes are distinct and synthetic-id keyed', () => {
  const { records } = baseNodes();
  const tnodes = tagNodes(records);
  const ids = tnodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate tag ids');
  assert.ok(tnodes.every((n) => n.kind === 'tag' && n.id.startsWith('Tag/')));
  assert.ok(tnodes.some((n) => n.id === 'Tag/amulet'));
});

import { baseEdges } from '../../scripts/graph/bases.js';

test('baseEdges link a base to its class and tags, with no dangling endpoints', () => {
  const { nodes, records } = baseNodes();
  const allNodes = [...nodes, ...classNodes(), ...tagNodes(records)];
  const nodeIds = new Set(allNodes.map((n) => n.id));
  const edges = baseEdges(records, nodeIds);
  assert.ok(edges.length > 0);
  assert.ok(edges.every((e) => nodeIds.has(e.from) && nodeIds.has(e.to)), 'no dangling');

  const stellarId = 'Metadata/Items/Amulets/FourAmulet8';
  const inClass = edges.filter((e) => e.type === 'in_class' && e.from === stellarId);
  assert.equal(inClass.length, 1);
  assert.equal(inClass[0].to, 'Class/Amulet');
  const tagged = edges.filter((e) => e.type === 'tagged' && e.from === stellarId).map((e) => e.to);
  assert.ok(tagged.includes('Tag/amulet'));
});
