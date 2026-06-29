// test/passiveStatsAgg.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripMarkup, parseLine, categorize, aggregate, templateToQuery, CATEGORY_ORDER,
} from '../public/js/passive-stats-agg.js';

test('stripMarkup unwraps [tag|text] to text and [tag] to tag', () => {
  assert.equal(stripMarkup('15% increased chance to [Shock]'), '15% increased chance to Shock');
  assert.equal(stripMarkup('[Minion|Minions] deal 10% increased Damage'), 'Minions deal 10% increased Damage');
  assert.equal(stripMarkup('  spaced   out  '), 'spaced out');
});

test('parseLine templatizes numbers into {i} slots, capturing sign/decimals', () => {
  const a = parseLine('+5 to Strength');
  assert.equal(a.template, '{0} to Strength');
  assert.deepEqual(a.slots, [{ value: 5, hadSign: true, decimals: 0 }]);

  const b = parseLine('8% increased [Physical] Damage');
  assert.equal(b.template, '{0}% increased Physical Damage');
  assert.equal(b.slots[0].hadSign, false);

  const c = parseLine('0.4% of Damage Leeched');
  assert.equal(c.slots[0].decimals, 1);
});

test('parseLine: a number-less line has no slots (a unique/flag effect)', () => {
  const p = parseLine('[EnergyShield|Energy Shield] does not Recharge');
  assert.equal(p.slots.length, 0);
  assert.equal(p.text, 'Energy Shield does not Recharge');
});

test('aggregate sums lines that share a template', () => {
  const { categories } = aggregate([
    '15% increased chance to [Shock]',
    '15% increased chance to [Shock]',
    '10% increased chance to [Shock]',
  ]);
  const all = categories.flatMap((c) => c.lines.map((l) => l.text));
  assert.ok(all.includes('40% increased chance to Shock'));
});

test('aggregate keeps "increased" and "reduced" separate (no netting)', () => {
  const { categories } = aggregate([
    '8% increased Skill Effect Duration',
    '4% reduced Skill Effect Duration',
  ]);
  const all = categories.flatMap((c) => c.lines.map((l) => l.text));
  assert.ok(all.includes('8% increased Skill Effect Duration'));
  assert.ok(all.includes('4% reduced Skill Effect Duration'));
});

test('aggregate re-renders the sign for +N attribute lines', () => {
  const { categories } = aggregate(['+5 to Strength', '+8 to Strength', '+5 to Strength']);
  const attrs = categories.find((c) => c.name === 'Attributes');
  assert.ok(attrs, 'Attributes category present');
  assert.equal(attrs.lines[0].text, '+18 to Strength');
});

test('aggregate handles multi-number lines by summing each slot', () => {
  const { categories } = aggregate([
    'Recover 2% of maximum Mana on Kill',
    'Recover 3% of maximum Mana on Kill',
  ]);
  const all = categories.flatMap((c) => c.lines.map((l) => l.text));
  assert.ok(all.includes('Recover 5% of maximum Mana on Kill'));
});

test('aggregate preserves decimals when summing', () => {
  const { categories } = aggregate(['0.4% of Damage Leeched as Life', '0.4% of Damage Leeched as Life']);
  const all = categories.flatMap((c) => c.lines.map((l) => l.text));
  assert.ok(all.includes('0.8% of Damage Leeched as Life'));
});

test('aggregate collects number-less lines as unique effects with counts', () => {
  const { uniqueEffects } = aggregate([
    '[EnergyShield|Energy Shield] does not Recharge',
    'You can apply an additional [Curse]',
    'You can apply an additional [Curse]',
  ]);
  const byText = Object.fromEntries(uniqueEffects.map((u) => [u.text, u.count]));
  assert.equal(byText['Energy Shield does not Recharge'], 1);
  assert.equal(byText['You can apply an additional Curse'], 2);
});

test('categorize buckets by keyword heuristics', () => {
  assert.equal(categorize('45% increased Physical Damage'), 'Offense');
  assert.equal(categorize('30% increased Critical Hit Chance'), 'Offense');
  assert.equal(categorize('+200 to maximum Life'), 'Defense');
  assert.equal(categorize('12% increased Mana Regeneration Rate'), 'Defense');
  assert.equal(categorize('+18 to Strength'), 'Attributes');
  assert.equal(categorize('20% increased Light Radius'), 'Other');
});

test('aggregate returns only non-empty categories in fixed order', () => {
  const { categories } = aggregate([
    '+200 to maximum Life',     // Defense
    '45% increased Physical Damage', // Offense
  ]);
  const names = categories.map((c) => c.name);
  assert.deepEqual(names, ['Offense', 'Defense']); // Offense before Defense per CATEGORY_ORDER
  // sanity: order matches the canonical list filtered to present buckets
  const filtered = CATEGORY_ORDER.filter((c) => names.includes(c));
  assert.deepEqual(names, filtered);
});

test('aggregate sorts lines within a category by descending magnitude', () => {
  const { categories } = aggregate([
    '5% increased [Attack] Speed',
    '45% increased [Physical] Damage',
    '20% increased [Critical|Critical Hit] Chance',
  ]);
  const off = categories.find((c) => c.name === 'Offense');
  assert.deepEqual(off.lines.map((l) => l.sortKey), [45, 20, 5]);
});

test('aggregate exposes the number-less template on every line (node-highlight key)', () => {
  const { categories, uniqueEffects } = aggregate([
    '15% increased chance to [Shock]',
    '[EnergyShield|Energy Shield] does not Recharge',
  ]);
  const summed = categories.flatMap((c) => c.lines)[0];
  assert.equal(summed.template, '{0}% increased chance to Shock');
  // a unique effect's template is its own stripped text
  assert.equal(uniqueEffects[0].template, 'Energy Shield does not Recharge');
});

test('templateToQuery derives a substring the search index will match', () => {
  // leading-number stat → the phrase after the number
  assert.equal(templateToQuery('{0}% increased chance to Shock'), 'increased chance to shock');
  // mid-string number → the longest number-free segment
  assert.equal(templateToQuery('Recover {0}% of maximum Mana on Kill'), 'of maximum mana on kill');
  // attribute lines map to the phrase the generic nodes actually carry
  assert.equal(templateToQuery(parseLine('+5 to Strength').template), 'any attribute');
  assert.equal(templateToQuery(parseLine('+12 to Dexterity').template), 'any attribute');
  // a number-less unique effect is its own (lowercased) query
  assert.equal(templateToQuery('Energy Shield does not Recharge'), 'energy shield does not recharge');
});

test('aggregate tolerates empty / nullish input', () => {
  assert.deepEqual(aggregate([]), { categories: [], uniqueEffects: [] });
  assert.deepEqual(aggregate(null), { categories: [], uniqueEffects: [] });
});
