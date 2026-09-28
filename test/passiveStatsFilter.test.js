// test/passiveStatsFilter.test.js
// Aggregated-stats panel filter: the query is a case-insensitive regex;
// an uncompilable query falls back to a literal substring match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statsFilterPredicate } from '../public/js/passive-tree.js';

test('empty query matches everything', () => {
  for (const q of ['', '   ', null, undefined]) {
    const match = statsFilterPredicate(q);
    assert.equal(match('+12% to Fire Resistance'), true, JSON.stringify(q));
    assert.equal(match('anything at all'), true, JSON.stringify(q));
  }
});

test('plain text matches case-insensitively', () => {
  const match = statsFilterPredicate('fire');
  assert.equal(match('+12% to Fire Resistance'), true);
  assert.equal(match('+12% to FIRE resistance'), true);
  assert.equal(match('+12% to Cold Resistance'), false);
});

test('query is treated as a regular expression', () => {
  const match = statsFilterPredicate('fire|cold');
  assert.equal(match('+12% to Fire Resistance'), true);
  assert.equal(match('+12% to Cold Resistance'), true);
  assert.equal(match('+12% to Lightning Resistance'), false);
  assert.equal(statsFilterPredicate('^\\+12%')('+12% to Fire Resistance'), true);
  assert.equal(statsFilterPredicate('^\\+12%')('Adds +12% to Fire Resistance'), false);
});

test('invalid regex falls back to a literal substring match', () => {
  const match = statsFilterPredicate('(fire');
  assert.equal(match('grants (fire) damage'), true);
  assert.equal(match('+12% to Fire Resistance'), false);
});
