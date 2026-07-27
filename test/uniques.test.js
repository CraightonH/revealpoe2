import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listUniques, getUnique, buildUniqueViewModel } from '../src/data/uniques.js';

test('listUniques returns a non-empty array with required fields', () => {
  const items = listUniques();
  assert.ok(items.length > 300);
  assert.ok(items.every((u) => u.slug && u.name));
  // `base` is no longer universal: pool-driven uniques (Loreweave & co) have no
  // fixed base, so they carry base:null plus a descriptive baseLabel instead —
  // null deliberately, so nothing downstream treats the label as a base name.
  // Every unique must still have exactly one of the two to render a type line.
  assert.ok(items.every((u) => u.base || u.baseLabel), 'every unique has a base or a baseLabel');
  // Only pool uniques may omit the base — a regular unique losing it is a bug.
  const baseless = items.filter((u) => !u.base);
  assert.ok(baseless.length > 0, 'pool uniques exist');
  assert.ok(baseless.every((u) => u.isPool), `only pool uniques lack a base: ${baseless.filter((u) => !u.isPool).map((u) => u.name).join(', ')}`);
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

  assert.deepEqual(vm.requirements, [
    'Level 72',
    '46 <span class="kw" data-keyword="Strength">Str</span>',
    '115 <span class="kw" data-keyword="Dexterity">Dex</span>',
  ]);
});

test('buildUniqueViewModel splits implicits/explicits and filters colon-less metadata', () => {
  // Adonia's Ego has a "Requires Level 65" header line (no trailing colon).
  // It must NOT leak into stats, or it eats an implicit slot and shoves the
  // second granted skill ("Pinnacle of Power") into the explicit affixes.
  const vm = buildUniqueViewModel('adonias-ego');
  assert.ok(!vm.stats.some((s) => /^Requires\b/.test(s.text)), 'Requires line leaked into stats');
  // Implicits: 2 → both granted skills sit together above the divider.
  assert.equal(vm.implicits.length, 2);
  assert.ok(vm.implicits.every((s) => s.text.startsWith('Grants Skill:')));
  assert.equal(vm.explicits[0].text, '+(100-150) to maximum Mana');
});

test('buildUniqueViewModel includes flavour text from flavour.json', () => {
  const vm = buildUniqueViewModel('atziris-contempt');
  assert.ok(Array.isArray(vm.flavour));
  assert.ok(vm.flavour.some((l) => l.includes('I am their Queen')));
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

test('buildUniqueViewModel surfaces cultivated mods + origin for a Vaal unique', () => {
  const vm = buildUniqueViewModel('atziris-contempt');
  assert.equal(vm.origin, 'Vaal');
  assert.equal(vm.cultivatedMods.length, 4, 'Atziri\'s Contempt has 4 cultivated mods');
  const texts = vm.cultivatedMods.map((m) => m.text);
  assert.ok(texts.some((t) => /Elemental.*Damage with.*Attack/i.test(t)));
  assert.ok(texts.some((t) => /Fork/i.test(t)));
  assert.ok(vm.cultivatedMods.every((m) => typeof m.html === 'string' && m.html.length));
});

test('a non-cultivable unique has no origin/cultivated mods', () => {
  const vm = buildUniqueViewModel('astramentis');
  assert.equal(vm.origin, null);
  assert.deepEqual(vm.cultivatedMods, []);
});
