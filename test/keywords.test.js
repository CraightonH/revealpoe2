import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGameText } from '../src/data/keywords.js';

test('plain text is escaped and numeric values highlighted', () => {
  assert.equal(
    renderGameText('100% more & cooler'),
    '<span class="mod-value">100</span>% more &amp; cooler'
  );
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

test('token without a definition renders as plain escaped text', () => {
  const has = (id) => id === 'Attack';
  assert.equal(
    renderGameText('non-[Attack|Attacks] then [Foo|Bar]', has),
    'non-<span class="kw" data-keyword="Attack">Attacks</span> then Bar'
  );
});

test('default predicate keeps every token interactive', () => {
  assert.equal(
    renderGameText('[Foo|Bar]'),
    '<span class="kw" data-keyword="Foo">Bar</span>'
  );
});
