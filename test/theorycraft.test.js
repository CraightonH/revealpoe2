import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/data/theorycraft.js';

test('parseQuery: bare words become free-text terms', () => {
  assert.deepEqual(parseQuery('cold chaos').terms, [
    { kind: 'text', value: 'cold', negate: false },
    { kind: 'text', value: 'chaos', negate: false },
  ]);
});

test('parseQuery: known field:value becomes a field term', () => {
  assert.deepEqual(parseQuery('type:support').terms, [
    { kind: 'field', field: 'type', value: 'support', negate: false },
  ]);
});

test('parseQuery: leading dash negates', () => {
  assert.deepEqual(parseQuery('-type:unique -chaos').terms, [
    { kind: 'field', field: 'type', value: 'unique', negate: true },
    { kind: 'text', value: 'chaos', negate: true },
  ]);
});

test('parseQuery: quoted phrase is one free-text term', () => {
  assert.deepEqual(parseQuery('"cast speed"').terms, [
    { kind: 'text', value: 'cast speed', negate: false },
  ]);
});

test('parseQuery: unknown field degrades to free text (field name dropped)', () => {
  assert.deepEqual(parseQuery('dmg:fire').terms, [
    { kind: 'text', value: 'fire', negate: false },
  ]);
});

test('parseQuery: empty/whitespace yields no terms', () => {
  assert.deepEqual(parseQuery('').terms, []);
  assert.deepEqual(parseQuery('   ').terms, []);
  assert.deepEqual(parseQuery(null).terms, []);
});
