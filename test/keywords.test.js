import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGameText } from '../src/data/keywords.js';

test('plain text passes through escaped', () => {
  assert.equal(renderGameText('100% more & cooler'), '100% more &amp; cooler');
});

test('token without pipe uses id as display', () => {
  assert.equal(
    renderGameText('enemies you [Overkill]'),
    'enemies you <span class="kw" data-keyword="Overkill">Overkill</span>'
  );
});

test('token with pipe uses display text after pipe', () => {
  assert.equal(
    renderGameText('non-[Attack|Attacks]'),
    'non-<span class="kw" data-keyword="Attack">Attacks</span>'
  );
});
