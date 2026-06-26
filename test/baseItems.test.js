import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listItemClasses, getItemClass, getBaseItem, buildBaseItemViewModel, affixBaseTargets,
  listBaseNav,
} from '../src/data/baseItems.js';

test('affixBaseTargets: class-wide mod lists plain class links', () => {
  const targets = affixBaseTargets('increasedlife');
  assert.ok(targets.length > 1, 'IncreasedLife rolls on many classes');
  assert.ok(targets.every((t) => t.href.startsWith('/bases/')));
  // Rolls on all defence subtypes → not split, so a plain (no ?attr=) class link.
  assert.ok(targets.some((t) => t.href === '/bases/body-armour'));
});

test('affixBaseTargets: defence-specific mod splits into deep-linked variants', () => {
  // "increased Armour and Life" rolls only on str/hybrid bases — never Evasion-only.
  const targets = affixBaseTargets('localincreasedarmourandlife');
  assert.ok(targets.length, 'should map to armour bases');
  assert.ok(targets.every((t) => t.href.includes('?attr=str_armour')));
  assert.ok(targets.some((t) => t.label.startsWith('Armour ')));
});

test('affixBaseTargets: unknown family has no targets', () => {
  assert.deepEqual(affixBaseTargets('not-a-real-affix'), []);
});

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

test('listItemClasses exposes the Flasks & Charms and Jewels groups', () => {
  const groups = listItemClasses();
  const labels = groups.map((g) => g.label);
  assert.ok(labels.includes('Flasks & Charms'));
  assert.ok(labels.includes('Jewels'));
  const flasks = groups.find((g) => g.label === 'Flasks & Charms');
  const classNames = flasks.classes.map((c) => c.name);
  assert.deepEqual(classNames, ['Life Flasks', 'Mana Flasks', 'Charms']);
  assert.ok(flasks.classes.every((c) => c.count > 0));
});

test('listBaseNav surfaces consumables/jewels as their own top-level groups', () => {
  const nav = listBaseNav();
  const flasks = nav.find((g) => g.label === 'Flasks & Charms');
  const jewels = nav.find((g) => g.label === 'Jewels');
  assert.ok(flasks && jewels, 'both new nav groups present');
  const flaskCards = flasks.sections.flatMap((s) => s.cards);
  assert.equal(flaskCards.length, 3, 'Life/Mana/Charms class cards');
  assert.ok(flaskCards.every((c) => c.href.startsWith('/bases/') && c.count > 0));
  // They must NOT leak into Accessories.
  const accCards = nav.find((g) => g.label === 'Accessories').sections.flatMap((s) => s.cards);
  assert.ok(!accCards.some((c) => /Flask|Charm|Jewel/.test(c.name)));
});

test('getItemClass renders a jewel class page with its affix pool', () => {
  const cls = getItemClass('jewel');
  assert.ok(cls);
  assert.equal(cls.name, 'Jewels');
  assert.ok(cls.bases.length > 0);
  assert.deepEqual(cls.attrSubtypes, [], 'jewels have no defence subtypes');
  // Jewels roll a large spawn-weight-gated affix pool (domain `misc` mods).
  assert.ok(cls.affixes.standard.prefix.length > 20, 'jewel prefixes resolved');
  assert.ok(cls.affixes.standard.suffix.length > 20, 'jewel suffixes resolved');
});

test('topBases: a class with no drop-level spread treats every base as top-tier', () => {
  // Jewels are all level 20 — Diamond/Emerald/Ruby/Sapphire are distinct siblings,
  // not tiers of one line — so none collapses; all bases appear as highest-tier.
  const jewels = getItemClass('jewel');
  assert.equal(jewels.topBases.length, jewels.bases.length, 'all jewels are top-tier');
  assert.ok(jewels.topBases.length >= 9);

  // A class with a real drop-level progression still collapses to representatives.
  const life = getItemClass('lifeflask');
  assert.ok(life.topBases.length < life.bases.length, 'flask tiers collapse');
  assert.equal(life.topBases[0].name, 'Ultimate Life Flask', 'endgame flask is the representative');
});

test('getItemClass: flask/charm classes expose their craftable mods, scoped by type', () => {
  const life = getItemClass('lifeflask');
  const names = [...life.affixes.standard.prefix, ...life.affixes.standard.suffix].map((f) => f.displayName);
  assert.ok(names.some((n) => /Recovery Amount/.test(n)), 'life flask rolls recovery mods');
  assert.ok(names.some((n) => /Max Charges/.test(n)), 'flasks roll charge mods');
  // Low-Life recovery is life-flask only — must NOT appear on mana flasks.
  const mana = getItemClass('manaflask');
  const manaNames = [...mana.affixes.standard.prefix].map((f) => f.displayName);
  assert.ok(!manaNames.some((n) => /On Low Life$/.test(n)), 'low-life mod excluded from mana flasks');
  // And none of it leaks onto equipment.
  const bow = getItemClass('bow');
  const bowNames = [...bow.affixes.standard.prefix, ...bow.affixes.standard.suffix].map((f) => f.displayName);
  assert.ok(!bowNames.some((n) => /^Flask |^Charm /.test(n)), 'flask/charm mods do not leak onto weapons');
});

test('buildBaseItemViewModel: charm base links its uniques', () => {
  const vm = buildBaseItemViewModel('thawing-charm');
  assert.ok(vm, 'thawing-charm base page exists');
  assert.equal(vm.className, 'Charms');
  assert.ok(vm.uniquesOnBase.some((u) => u.slug === 'nascent-hope'), 'Nascent Hope listed on its base');
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
