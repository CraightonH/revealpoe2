import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFlavourLines } from '../../scripts/graph/flavour.js';

test('getFlavourLines: resolves by unique display name', () => {
  const lines = getFlavourLines('Bramblejack');
  assert.ok(Array.isArray(lines) && lines.length > 0, 'has lines');
  assert.ok(lines.every((l) => typeof l === 'string' && l.length > 0), 'non-empty strings');
  assert.ok(lines.join(' ').includes('feared'), `got: ${lines.join(' | ')}`);
});

test('getFlavourLines: null for unknown / empty names', () => {
  assert.equal(getFlavourLines('No Such Unique XYZ'), null);
  assert.equal(getFlavourLines(''), null);
  assert.equal(getFlavourLines(null), null);
});

test('getFlavourLines: diacritic-insensitive fallback', () => {
  // PoB's FlavourText keys "Mjolner" (no umlaut); the unique is "Mjölner".
  const lines = getFlavourLines('Mjölner');
  assert.ok(lines && lines.join(' ').includes('storm in the eye'), `got: ${lines}`);
});

test('getFlavourLines: strips in-game markup wrappers', () => {
  // Every returned line must be plain text — no <size:…>{…} wrappers leak through.
  const lines = getFlavourLines('Bramblejack');
  for (const l of lines) assert.ok(!/<[^>]+>\{/.test(l), `markup leaked: ${l}`);
});
