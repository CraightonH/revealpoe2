import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/data/slug.js';

test('slugify lowercases and hyphenates', () => {
  assert.equal(slugify('Herald of Ash'), 'herald-of-ash');
});

test('slugify strips punctuation', () => {
  assert.equal(slugify("Alchemist's Boon"), 'alchemists-boon');
});

test('slugify collapses repeated separators', () => {
  assert.equal(slugify('Spark  —  Nova'), 'spark-nova');
});
