import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagDisplay, displayTags } from '../src/data/gemTags.js';
import { tagToken, displayTagTokens } from '../src/data/gemTags.js';

test('tagDisplay extracts plain bracket display', () => {
  assert.equal(tagDisplay('fire'), 'Fire');
});

test('tagDisplay uses text after pipe', () => {
  assert.equal(tagDisplay('area'), 'AoE');
  assert.equal(tagDisplay('duration'), 'Duration');
});

test('tagDisplay returns null for non-display tags', () => {
  assert.equal(tagDisplay('strength'), null);
  assert.equal(tagDisplay('grants_active_skill'), null);
});

test('displayTags maps, drops nulls, and excludes given names', () => {
  const tags = ['strength', 'grants_active_skill', 'buff', 'persistent', 'area', 'fire', 'duration', 'herald'];
  assert.deepEqual(
    displayTags(tags, ['Buff']),
    ['Persistent', 'AoE', 'Fire', 'Duration', 'Herald']
  );
});

test('tagToken returns the raw bracket token preserving the keyword id', () => {
  assert.equal(tagToken('area'), '[AoESkill|AoE]');
  assert.equal(tagToken('fire'), '[Fire]');
  assert.equal(tagToken('strength'), null);
});

test('displayTagTokens keeps ids, drops non-display tags, and excludes by display name', () => {
  const tags = ['strength', 'grants_active_skill', 'buff', 'persistent', 'area', 'fire', 'duration', 'herald'];
  assert.deepEqual(
    displayTagTokens(tags, ['Buff']),
    ['[Persistent]', '[AoESkill|AoE]', '[Fire]', '[DurationSkill|Duration]', '[Herald]']
  );
});
