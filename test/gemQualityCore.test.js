import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupQuality } from '../public/js/gem-quality-core.js';

// Arc's two columns: chains = floor(Q/10), and the Gemling alt whose breakpoints include 27%.
const series = {
  q0: [[10, '1'], [20, '2'], [30, '3'], [100, '10']],
  q1: [[7, '1'], [14, '2'], [20, '3'], [27, '4'], [100, '15']],
};

test('lookupQuality holds the value at the largest breakpoint ≤ Q (step semantics)', () => {
  assert.equal(lookupQuality(series, 'q0', 29), '2'); // 29% chains → 20% breakpoint → "2"
  assert.equal(lookupQuality(series, 'q0', 30), '3');
  assert.equal(lookupQuality(series, 'q0', 20), '2');
  assert.equal(lookupQuality(series, 'q1', 29), '4'); // 29% alt → 27% breakpoint → "4"
  assert.equal(lookupQuality(series, 'q1', 26), '3');
});

test('lookupQuality returns null below the first breakpoint (effect is 0 there)', () => {
  assert.equal(lookupQuality(series, 'q0', 9), null);
  assert.equal(lookupQuality(series, 'q1', 6), null);
  assert.equal(lookupQuality(series, 'q0', 0), null);
});

test('lookupQuality caps at the top breakpoint and tolerates missing columns', () => {
  assert.equal(lookupQuality(series, 'q0', 100), '10');
  assert.equal(lookupQuality(series, 'q0', 250), '10'); // caller clamps Q; still resolves
  assert.equal(lookupQuality(series, 'nope', 50), null);
  assert.equal(lookupQuality(null, 'q0', 50), null);
});
