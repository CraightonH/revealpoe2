import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagDisplay, displayTags } from '../src/data/gemTags.js';

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
