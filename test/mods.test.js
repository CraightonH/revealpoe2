import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getMod, getModGroup, listModGroups, getModsForBase, getModsForClass,
} from '../src/data/mods.js';

test('getMod returns a known mod by id', () => {
  const m = getMod('IncreasedLife1');
  assert.ok(m);
  assert.equal(m.name, 'Hale');
  assert.equal(m.text, '+(10-19) to maximum Life');
  assert.equal(m.type, 'IncreasedLife');
  assert.equal(m.generation_type, 'prefix');
  assert.equal(m.required_level, 1);
  assert.deepEqual(m.stats, [{ id: 'base_maximum_life', min: 10, max: 19 }]);
});

test('getMod returns null for unknown id', () => {
  assert.equal(getMod('NotARealMod'), null);
});

test('getModGroup returns all tiers for IncreasedLife', () => {
  const g = getModGroup('IncreasedLife');
  assert.ok(g);
  assert.equal(g.type, 'IncreasedLife');
  assert.equal(g.typeSlug, 'increasedlife');
  assert.equal(g.generation_type, 'prefix');
  assert.ok(Array.isArray(g.tiers));
  assert.ok(g.tiers.length >= 8); // 14 tiers total in the data
  // Sorted by level — lowest first
  const first = g.tiers.find((t) => t.id === 'IncreasedLife1');
  assert.ok(first, 'IncreasedLife1 should be present');
  assert.equal(first.name, 'Hale');
  assert.equal(first.level, 1);
});

test('getModGroup returns null for unknown type', () => {
  assert.equal(getModGroup('NotAType'), null);
});

test('listModGroups returns prefix and suffix groups', () => {
  const groups = listModGroups();
  assert.ok(Array.isArray(groups));
  const life = groups.find((g) => g.type === 'IncreasedLife');
  assert.ok(life);
  assert.equal(life.generation_type, 'prefix');
  const str = groups.find((g) => g.type === 'Strength');
  assert.ok(str);
  assert.equal(str.generation_type, 'suffix');
});

test('listModGroups entries have typeSlug', () => {
  const groups = listModGroups();
  assert.ok(groups.every((g) => g.typeSlug));
  const arrow = groups.find((g) => g.type === 'AdditionalArrowChanceCanExceed100%');
  if (arrow) assert.ok(arrow.typeSlug && !arrow.typeSlug.includes('%'));
});

test('getModsForBase returns prefix/suffix groups for Stellar Amulet', () => {
  const result = getModsForBase('Metadata/Items/Amulets/FourAmulet8');
  assert.ok(result);
  assert.ok(Array.isArray(result.prefix));
  assert.ok(Array.isArray(result.suffix));
  const life = result.prefix.find((g) => g.type === 'IncreasedLife');
  assert.ok(life, 'IncreasedLife should be a prefix group for amulets');
  assert.ok(life.tiers.length >= 1);
  const str = result.suffix.find((g) => g.type === 'Strength');
  assert.ok(str, 'Strength should be a suffix group for amulets');
});

test('getModsForBase decorates families with generic text and clean tags', () => {
  const result = getModsForBase('Metadata/Items/Amulets/FourAmulet8');
  const life = result.prefix.find((g) => g.type === 'IncreasedLife');
  // Generic text collapses rolled ranges to "#" and carries no raw [Id|Display] markup.
  assert.match(life.genericHtml, /# to.*maximum Life/i);
  assert.ok(!life.genericHtml.includes('('), 'ranges should be collapsed to #');
  assert.ok(!/\[[^\]]*\|/.test(life.genericHtml), 'game-text markup should be rendered out');
  // Tags are cleaned of structural/compound entries.
  assert.ok(!life.tags.some((t) => /^has_|_mod$|_damage$/.test(t)));
});

test('getModsForBase sorts families alphabetically by modifier text', () => {
  const { prefix } = getModsForBase('Metadata/Items/Amulets/FourAmulet8');
  for (let i = 1; i < prefix.length; i++) {
    assert.ok(prefix[i - 1].sortKey.localeCompare(prefix[i].sortKey) <= 0, 'families ordered by text');
  }
});

test('getModsForBase returns empty prefix/suffix for unknown base', () => {
  const result = getModsForBase('Metadata/Items/NotReal/Fake');
  assert.deepEqual(result, { prefix: [], suffix: [] });
});

test('getModsForClass unions affixes across bases and dedupes by family', () => {
  const a = getModsForBase('Metadata/Items/Amulets/FourAmulet8');
  // The class union of a single base equals that base's families.
  const single = getModsForClass(['Metadata/Items/Amulets/FourAmulet8']);
  assert.equal(single.prefix.length, a.prefix.length);

  // Unioning two amulet bases must not duplicate a shared family.
  const multi = getModsForClass([
    'Metadata/Items/Amulets/FourAmulet8',
    'Metadata/Items/Amulets/Amulet1',
  ]);
  const types = multi.prefix.map((f) => f.type);
  assert.equal(new Set(types).size, types.length, 'no duplicate prefix families');
  assert.ok(multi.prefix.some((f) => f.type === 'IncreasedLife'));
});

test('getModsForClass returns empty for no known bases', () => {
  assert.deepEqual(getModsForClass(['Metadata/Items/NotReal/Fake']), { prefix: [], suffix: [] });
});
