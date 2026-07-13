import { test } from 'node:test';
import assert from 'node:assert/strict';
import { augmentsForClass, augmentsForUnique, getAugmentVM } from '../src/data/augments.js';

// Body Armour accepts augments from four families (Rune / Soul Core / Idol /
// Abyssal Eye — no Congealed Mist), which is a good exercise of grouping + order.
const CLASS = 'Body Armour';

// Match by base name (sortName) — the display name carries the tier prefix
// ("Greater Vision Rune") since Greater is the default-shown variant.
function findAug(groups, name) {
  for (const g of groups) {
    const hit = g.augments.find((a) => a.sortName === name || a.name === name);
    if (hit) return hit;
  }
  return null;
}

test('augmentsForClass returns augments grouped by family for Body Armour', () => {
  const groups = augmentsForClass(CLASS);
  assert.ok(groups.length, 'has at least one family group');
  const rune = groups.find((g) => g.family === 'Rune');
  assert.ok(rune, 'Rune family present');
  assert.ok(rune.augments.length > 1, 'Rune family has multiple augments');
  // A known rune socketable into body armour.
  assert.ok(findAug(groups, 'Vision Rune'), 'Vision Rune present');
});

test('augmentsForClass groups families in the canonical display order', () => {
  const groups = augmentsForClass(CLASS);
  const order = groups.map((g) => g.family);
  const expected = ['Rune', 'SoulCore', 'Idol', 'AbyssalEye', 'CongealedMist'];
  // The families present must appear as a subsequence of the canonical order.
  const idx = order.map((f) => expected.indexOf(f));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), 'families in canonical order');
  assert.equal(order[0], 'Rune', 'Runes lead');
  assert.ok(groups.every((g) => g.familyLabel), 'each group has a display label');
});

test('augments within a family are ordered by base name', () => {
  const groups = augmentsForClass(CLASS);
  const rune = groups.find((g) => g.family === 'Rune');
  const names = rune.augments.map((a) => a.sortName);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'sorted by base name');
});

test('collapsed Vision Rune defaults to the Perfect tier, others condensed high-first', () => {
  const groups = augmentsForClass(CLASS);
  const vision = findAug(groups, 'Vision Rune');
  assert.ok(vision, 'Vision Rune found');
  assert.equal(vision.family, 'Rune');
  assert.ok(vision.hasTiers, 'rune has multiple tiers');

  // Default-displayed variant is Perfect (required level 50), name carries the tier.
  assert.equal(vision.tierLabel, 'Perfect', 'default tier is Perfect');
  assert.equal(vision.requiredLevel, 50, 'perfect-tier required level');
  assert.equal(vision.name, 'Perfect Vision Rune', 'display name matches shown tier');
  const primaryAcc = vision.categories.find((c) => /Martial Weapon/.test(c.category)).lines.join(' ');
  assert.ok(primaryAcc.includes('150'), 'perfect grants +150 Accuracy');

  // Other tiers, high-first, exclude the shown perfect tier: greater, normal, lesser.
  assert.deepEqual(vision.otherTiers.map((t) => t.tier), ['greater', 'normal', 'lesser']);
  assert.equal(vision.otherTiers[0].tierLabel, 'Greater');
  // Condensed tiers expose flattened value lines (Accuracy: +120 greater … +60 lesser).
  assert.ok(vision.otherTiers[0].flatLines.join(' ').includes('120'), 'greater grants +120');
  const lesser = vision.otherTiers[vision.otherTiers.length - 1];
  assert.ok(lesser.flatLines.join(' ').includes('60'), 'lesser grants +60');
});

test('category lines render keyword links with no raw markup leaking', () => {
  const groups = augmentsForClass(CLASS);
  const vision = findAug(groups, 'Vision Rune');
  const allHtml = vision.categories
    .flatMap((c) => [c.categoryHtml, ...c.lines, ...c.bondedLines])
    .join(' ');
  assert.ok(!/\[[^\]]*\|[^\]]*\]/.test(allHtml), 'no raw [Id|Display] markup');
  // The Accuracy keyword token becomes a glossary hover span.
  assert.ok(/data-keyword="Accuracy"/.test(allHtml), 'Accuracy linkified to a keyword span');
  assert.ok(/class="mod-value"/.test(allHtml), 'numeric values highlighted');
});

test('augmentsForUnique resolves a unique to its base class augments', () => {
  // Atziri's Splendour is a Body Armour unique — same augment set as the class.
  const byVm = augmentsForUnique({ itemClass: CLASS });
  const bySlug = augmentsForUnique('atziris-splendour');
  assert.ok(bySlug.length, 'augments resolved from a unique slug');
  assert.ok(findAug(bySlug, 'Vision Rune'), 'Vision Rune available on the unique');
  assert.deepEqual(
    bySlug.map((g) => g.family),
    byVm.map((g) => g.family),
    'slug and vm resolve the same families',
  );
});

test('Rune family splits into Common / Ancient / Kalguuran subgroups in order', () => {
  const groups = augmentsForClass(CLASS);
  const rune = groups.find((g) => g.family === 'Rune');
  assert.ok(rune.subgroups.length >= 1, 'rune has subgroups');
  const labels = rune.subgroups.map((s) => s.label);
  assert.ok(labels.includes('Common'), 'Common subgroup present');
  const order = ['Common', 'Ancient', 'Kalguuran'];
  const idx = labels.map((l) => order.indexOf(l));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), 'subgroups in canonical order');
  assert.ok(labels.every((l) => order.includes(l)), 'no unexpected subgroup labels');
  const common = rune.subgroups.find((s) => s.label === 'Common');
  assert.ok(common.augments.some((a) => a.sortName === 'Vision Rune'), 'Vision Rune in Common');
  assert.ok(rune.subgroups.every((s) => s.augments.length), 'no empty subgroups');
});

test('non-rune families are a single unlabelled subgroup', () => {
  const groups = augmentsForClass(CLASS);
  const idol = groups.find((g) => g.family === 'Idol');
  if (idol) {
    assert.equal(idol.subgroups.length, 1);
    assert.equal(idol.subgroups[0].label, null);
  }
});

test('getAugmentVM returns the full multi-tier VM by slug', () => {
  const vision = findAug(augmentsForClass(CLASS), 'Vision Rune');
  const vm = getAugmentVM(vision.slug);
  assert.ok(vm, 'resolved by slug');
  assert.equal(vm.family, 'Rune');
  assert.equal(vm.allTiers.length, 4, 'all four tiers present');
  assert.equal(vm.allTiers[0].tier, 'perfect', 'highest tier first');
  assert.equal(getAugmentVM('definitely-not-an-augment'), null);
});

test('augmentsForClass returns empty for a class with no augments', () => {
  assert.deepEqual(augmentsForClass('NotARealClass'), []);
  assert.deepEqual(augmentsForUnique({ itemClass: undefined }), []);
});
