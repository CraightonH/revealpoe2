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

test('element in a resistance context links to Resistances, not the damage keyword', () => {
  const out = renderGameText('[Attack|Attacks] with this Weapon Penetrate (15-25)% Cold Resistance');
  assert.match(out, /data-keyword="Resistances">Cold Resistance</);
  assert.doesNotMatch(out, /data-keyword="Cold"/);
});

test('two-element resistance phrase links the whole phrase to Resistances', () => {
  const out = renderGameText('+(13-17)% to Fire and Chaos Resistances');
  assert.match(out, /data-keyword="Resistances">Fire and Chaos Resistances</);
  assert.doesNotMatch(out, /data-keyword="Fire"/);
  assert.doesNotMatch(out, /data-keyword="Chaos"/);
});

test('Elemental Resistances links to Resistances', () => {
  const out = renderGameText('Trap Damage Penetrates (20-30)% Elemental Resistances');
  assert.match(out, /data-keyword="Resistances">Elemental Resistances</);
});

test('Maximum resistance phrases link to MaximumResistances, not Resistances', () => {
  const out = renderGameText('+(1-2)% to Maximum Fire Resistance');
  assert.match(out, /data-keyword="MaximumResistances">Maximum Fire Resistance</);
  assert.doesNotMatch(out, /data-keyword="Resistances">/);
});

test('bare element outside a resistance context still links to the damage keyword', () => {
  const out = renderGameText('Adds (5-10) to (15-20) Cold Damage');
  assert.match(out, /data-keyword="Cold">Cold</);
});

test('unrelated "Resistance" terms are not mislinked to elemental Resistances', () => {
  const out = renderGameText('Monsters have Leech Resistance');
  assert.doesNotMatch(out, /data-keyword="Resistances"/);
});
