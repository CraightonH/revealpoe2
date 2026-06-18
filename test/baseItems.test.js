import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listItemClasses, getItemClass, getBaseItem, buildBaseItemViewModel,
} from '../src/data/baseItems.js';

test('listItemClasses returns grouped categories with counts', () => {
  const groups = listItemClasses();
  assert.ok(Array.isArray(groups));
  const weaponGroup = groups.find((g) => g.label === 'Weapons');
  assert.ok(weaponGroup, 'Weapons group should exist');
  assert.ok(weaponGroup.classes.length > 5);
  assert.ok(weaponGroup.classes[0].classId);
  assert.ok(weaponGroup.classes[0].name);
  assert.ok(weaponGroup.classes[0].classSlug);
  assert.ok(weaponGroup.classes[0].count > 0);
});

test('getItemClass resolves "amulet" class slug', () => {
  const cls = getItemClass('amulet');
  assert.ok(cls);
  assert.equal(cls.name, 'Amulets');
  assert.ok(cls.bases.length >= 20);
  assert.ok(cls.bases[0].slug);
  assert.ok(cls.bases[0].name);
  assert.ok(cls.bases[0].iconUrl);
});

test('getItemClass returns null for unknown class slug', () => {
  assert.equal(getItemClass('not-a-real-class'), null);
});

test('getBaseItem resolves "stellar-amulet"', () => {
  const b = getBaseItem('stellar-amulet');
  assert.ok(b, 'stellar-amulet should exist');
  assert.equal(b.name, 'Stellar Amulet');
  assert.equal(b.itemClass, 'Amulet');
  assert.ok(b.iconUrl.includes('StellarAmulet') || b.iconUrl.includes('Amulet'));
});

test('getBaseItem returns null for unknown slug', () => {
  assert.equal(getBaseItem('not-a-real-base'), null);
});

test('buildBaseItemViewModel includes class display name and tags', () => {
  const vm = buildBaseItemViewModel('stellar-amulet');
  assert.ok(vm);
  assert.equal(vm.name, 'Stellar Amulet');
  assert.equal(vm.className, 'Amulets');
  assert.ok(Array.isArray(vm.tags));
  assert.ok(vm.iconUrl);
});

test('buildBaseItemViewModel includes drop level from requirements', () => {
  const vm = buildBaseItemViewModel('stellar-amulet');
  // Stellar Amulet drop_level verified from data: 25
  assert.ok(typeof vm.dropLevel === 'number');
  assert.ok(vm.dropLevel > 0);
});

test('buildBaseItemViewModel weapon properties: wooden-club has APS and damage', () => {
  const vm = buildBaseItemViewModel('wooden-club');
  assert.ok(vm, 'wooden-club should exist');
  // attack_time=690ms → APS=1.45
  const aps = vm.properties.find((p) => p.label === 'Attacks per Second');
  assert.ok(aps, 'should have APS property');
  assert.equal(aps.value, '1.45');
  const crit = vm.properties.find((p) => p.label === 'Critical Hit Chance');
  assert.ok(crit);
  assert.equal(crit.value, '5%');
  const dmg = vm.properties.find((p) => p.label === 'Physical Damage');
  assert.ok(dmg);
  assert.match(dmg.value, /\d+ to \d+/);
});

test('buildBaseItemViewModel armour: rusted-cuirass has Armour property', () => {
  const vm = buildBaseItemViewModel('rusted-cuirass');
  assert.ok(vm, 'rusted-cuirass should exist');
  const arm = vm.properties.find((p) => p.label === 'Armour');
  assert.ok(arm, 'should have Armour property');
});

test('buildBaseItemViewModel uniquesOnBase links uniques to Stellar Amulet', () => {
  const vm = buildBaseItemViewModel('stellar-amulet');
  assert.ok(vm.uniquesOnBase.length >= 2); // Astramentis, Fixation of Yix, etc.
  assert.ok(vm.uniquesOnBase.every((u) => u.slug && u.name));
  const astra = vm.uniquesOnBase.find((u) => u.name === 'Astramentis');
  assert.ok(astra);
  assert.equal(astra.slug, 'astramentis');
});

test('buildBaseItemViewModel returns null for unknown slug', () => {
  assert.equal(buildBaseItemViewModel('not-a-real-base'), null);
});

test('buildBaseItemViewModel surfaces innate implicit affixes', () => {
  const vm = buildBaseItemViewModel('bombard-crossbow');
  assert.ok(vm, 'bombard-crossbow should exist');
  assert.ok(Array.isArray(vm.implicits));
  assert.equal(vm.implicits.length, 1);
  // Rendered as game-text HTML with keyword markup.
  assert.match(vm.implicits[0].html, /Grenade/);
  assert.match(vm.implicits[0].html, /additional/);
});

test('buildBaseItemViewModel implicits is empty for bases with no innate affix', () => {
  const vm = buildBaseItemViewModel('crude-bow');
  assert.ok(Array.isArray(vm.implicits));
  assert.equal(vm.implicits.length, 0);
});

test('Energy Blade slug disambiguated by class', () => {
  // Energy Blade exists as both One Hand Sword and Two Hand Sword
  const b1 = getBaseItem('energy-blade--one-hand-sword');
  const b2 = getBaseItem('energy-blade--two-hand-sword');
  assert.ok(b1 || b2, 'at least one Energy Blade disambiguation slug should work');
  if (b1) assert.equal(b1.name, 'Energy Blade');
  if (b2) assert.equal(b2.name, 'Energy Blade');
});

test('getBaseItem includes metadataKey field', () => {
  const b = getBaseItem('stellar-amulet');
  assert.ok(b);
  assert.equal(b.metadataKey, 'Metadata/Items/Amulets/FourAmulet8');
});
