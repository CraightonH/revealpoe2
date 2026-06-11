import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGem, buildGemViewModel, listGems } from '../src/data/gems.js';

test('listGems returns active + support gems with slugs', () => {
  const gems = listGems();
  assert.ok(gems.length > 500);
  assert.ok(gems.every((g) => g.slug && g.name));
});

test('getGem resolves Herald of Ash by slug', () => {
  const gem = getGem('herald-of-ash');
  assert.equal(gem.base_item.display_name, 'Herald of Ash');
  assert.equal(gem.color, 'r');
});

test('buildGemViewModel produces card fields', () => {
  const vm = buildGemViewModel('herald-of-ash');
  assert.equal(vm.name, 'Herald of Ash');
  assert.equal(vm.attribute, 'r');
  assert.equal(vm.borderColor, 'rgba(139,48,48,0.7)');
  assert.ok(vm.skillIconUrl.includes('HeraldOfAshSkill'));
  assert.ok(vm.hoverImageUrl.includes('GemHoverImage'));
  assert.ok(vm.tags.includes('fire'));
  assert.match(vm.description, /<span class="kw"/); // tokens rendered
  assert.ok(vm.recommendedSupports.length > 0);
  assert.ok(vm.recommendedSupports[0].slug);
});

test('getGem returns null for unknown slug', () => {
  assert.equal(getGem('not-a-real-gem'), null);
});
