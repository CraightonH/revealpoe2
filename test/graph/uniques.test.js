import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grantedSkillNames, uniqueNodes } from '../../scripts/graph/uniques.js';

test('grantedSkillNames is a non-empty Set of skill display names', () => {
  const names = grantedSkillNames();
  assert.ok(names instanceof Set);
  assert.ok(names.size > 50, `expected many granted skills, got ${names.size}`);
  // Guiding Palm grants "Purity of Fire" (a Level (1-20) grant — stripped to the bare name).
  assert.ok(names.has('Purity of Fire'), 'contains a known unique-granted skill');
});

test('uniqueNodes: one node per unique with the Unique/ id scheme', () => {
  const { nodes } = uniqueNodes();
  assert.ok(nodes.length > 300, `expected 300+ uniques, got ${nodes.length}`);
  const ids = new Set();
  for (const n of nodes) {
    assert.equal(n.kind, 'unique');
    assert.match(n.id, /^Unique\//, `id namespaced: ${n.id}`);
    assert.ok(!ids.has(n.id), `duplicate id ${n.id}`);
    ids.add(n.id);
    assert.ok(n.name && n.slug && n.props.base, `core fields on ${n.id}`);
    assert.ok(Array.isArray(n.props.variants) && n.props.variants.length > 0);
    assert.ok(n.props.currentIndex >= 0 && n.props.currentIndex < n.props.variants.length);
  }
});

test('uniqueNodes: Astramentis resolves metadata, class, icon, id', () => {
  const a = uniqueNodes().nodes.find((n) => n.slug === 'astramentis');
  assert.ok(a, 'Astramentis node present');
  assert.equal(a.id, 'Unique/Astramentis');        // meta.id form
  assert.equal(a.name, 'Astramentis');
  assert.equal(a.props.base, 'Stellar Amulet');
  assert.equal(a.props.className, 'Amulets');       // base canonical class
  assert.equal(a.props.classSlug, 'amulet');
  assert.match(a.props.iconDds, /Astramentis/);
});

test('uniqueNodes: The Anvil variant resolution picks the Current variant', () => {
  const anvil = uniqueNodes().nodes.find((n) => n.slug === 'the-anvil');
  assert.ok(anvil);
  assert.equal(anvil.props.variants.length, 3);
  assert.equal(anvil.props.currentIndex, 2);
  assert.equal(anvil.props.variants[2].name, 'Current');
  const cur = anvil.props.variants[anvil.props.currentIndex];
  assert.deepEqual(cur.implicits, ['+(30-40) to maximum Life']);
  assert.ok(cur.explicits.includes('25% increased Block chance'));
  assert.ok(cur.explicits.includes('+(5-10)% to maximum Block chance'));
  assert.ok(!cur.explicits.includes('20% increased Block chance'), 'legacy roll excluded');
});

test('uniqueNodes: Guiding Palm gates one Purity grant per variant', () => {
  const gp = uniqueNodes().nodes.find((n) => n.slug === 'guiding-palm');
  assert.ok(gp);
  assert.equal(gp.props.variants.length, 6);
  assert.equal(gp.props.currentIndex, 5);           // no "Current" token -> last
  assert.ok(!gp.props.variants.some((v) => v.name === 'Current'));
  const cur = gp.props.variants[5];
  const grants = [...cur.implicits, ...cur.explicits].filter((l) => l.startsWith('Grants Skill:'));
  assert.equal(grants.length, 1, 'exactly one Purity grant on the current variant');
  assert.match(grants[0], /Purity of Lightning/);
});

test('uniqueNodes: search is current-variant only, lowercased', () => {
  const anvil = uniqueNodes().nodes.find((n) => n.slug === 'the-anvil');
  assert.ok(anvil.search.includes('25% increased block chance'));
  assert.ok(!anvil.search.includes('20% increased block chance'), 'legacy roll not searchable');
  assert.ok(anvil.search.includes('the anvil') && anvil.search.includes('bloodstone amulet'));
});
