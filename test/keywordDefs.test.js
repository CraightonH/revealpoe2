import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasDefinition, getDefinition } from '../src/data/keywordDefs.js';

test('hasDefinition is true for a keyword with non-empty definition', () => {
  assert.equal(hasDefinition('Accuracy'), true);
});

test('hasDefinition is false for an empty-definition keyword', () => {
  assert.equal(hasDefinition('AbsentAmulet'), false);
});

test('hasDefinition is false for an unknown keyword', () => {
  assert.equal(hasDefinition('NotARealKeyword'), false);
});

test('getDefinition returns term and definition for a hit', () => {
  const d = getDefinition('Accuracy');
  assert.equal(d.term, 'Accuracy');
  assert.match(d.definition, /Accuracy/);
});

test('getDefinition returns null for empty-definition and unknown keys', () => {
  assert.equal(getDefinition('AbsentAmulet'), null);
  assert.equal(getDefinition('NotARealKeyword'), null);
});
