import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listUniques, getUnique, buildUniqueViewModel } from '../src/data/uniques.js';

test('listUniques returns a non-empty array with required fields', () => {
  const items = listUniques();
  assert.ok(items.length > 300);
  assert.ok(items.every((u) => u.slug && u.name && u.base));
});

test('getUnique resolves Astramentis by slug', () => {
  const u = getUnique('astramentis');
  assert.equal(u.name, 'Astramentis');
  assert.equal(u.base, 'Stellar Amulet');
  assert.ok(u.iconUrl.includes('Astramentis'));
});

test('getUnique returns null for unknown slug', () => {
  assert.equal(getUnique('not-a-real-unique'), null);
});

test('buildUniqueViewModel includes border and glow colors', () => {
  const vm = buildUniqueViewModel('astramentis');
  assert.equal(vm.borderColor, 'rgba(175,96,37,0.8)');
  assert.equal(vm.glowColor, 'rgba(175,96,37,0.45)');
  assert.ok(vm.iconUrl);
  assert.equal(vm.baseSlug, 'stellar-amulet');
});

test('buildUniqueViewModel returns null for unknown slug', () => {
  assert.equal(buildUniqueViewModel('not-a-real-unique'), null);
});

test('listUniques excludes _manifest metadata entries', () => {
  const items = listUniques();
  const badNames = ['source', 'base_url', 'fetched_at'];
  for (const bad of badNames) {
    assert.ok(!items.some((u) => u.name === bad), `should not include "${bad}"`);
  }
});

test('buildUniqueViewModel stats strip variant and tag prefixes', () => {
  const vm = buildUniqueViewModel('the-anvil');
  assert.ok(vm.stats.length > 0);
  assert.ok(!vm.stats.some((s) => s.text.includes('{variant:')));
  assert.ok(!vm.stats.some((s) => s.text.includes('{tags:')));
});

test('buildUniqueViewModel current variant: only shows applicable stat lines', () => {
  // The Anvil has 3 variants; {variant:2,3} → "25% increased Block chance" applies;
  // {variant:1} → "20% increased Block chance" does not apply to current (index 3).
  const vm = buildUniqueViewModel('the-anvil');
  assert.ok(vm.stats.some((s) => s.text.includes('25% increased Block chance')));
  assert.ok(!vm.stats.some((s) => s.text === '20% increased Block chance'));
});

test('buildUniqueViewModel derives item stats from base + local mods', () => {
  // Pronged Spear base 30–89 phys with "(100–120)% increased Physical Damage"
  // → (60–66) to (178–196); base APS 1000/645 × (1+10–16%) → (1.71–1.8).
  const vm = buildUniqueViewModel('atziris-contempt');
  const byLabel = Object.fromEntries(vm.properties.map((p) => [p.label, p]));

  assert.equal(byLabel['Physical Damage'].value, '(60-66) to (178-196)');
  assert.equal(byLabel['Physical Damage'].colorClass, 'colourAugmented');
  assert.equal(byLabel['Attacks per Second'].value, '(1.71-1.8)');
  assert.equal(byLabel['Attacks per Second'].colorClass, 'colourAugmented');
  assert.equal(byLabel['Critical Hit Chance'].value, '5%');
  assert.equal(byLabel['Weapon Range'].value, '1.5');
  assert.equal(byLabel['Fire Damage'].colorClass, 'colourFireDamage');

  assert.deepEqual(vm.requirements, ['Level 72', '46 Str', '115 Dex']);
});

test('buildUniqueViewModel leaves properties empty for non-browsable bases', () => {
  // Astramentis is a Stellar Amulet — amulets have no derived damage/defence props.
  const vm = buildUniqueViewModel('astramentis');
  assert.ok(Array.isArray(vm.properties));
  assert.equal(vm.properties.length, 0);
});

test('buildUniqueViewModel handles item with no variants', () => {
  // Bijouborne (belt) has no Variant: lines — all stats apply
  const vm = buildUniqueViewModel('bijouborne');
  assert.ok(vm, 'bijouborne should exist');
  assert.ok(vm.stats.length > 0);
});
