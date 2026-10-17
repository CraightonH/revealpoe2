import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pobModOverlay, pobTierText } from '../../scripts/graph/pobMods.js';

test('pobModOverlay: known mod returns display fields', () => {
  const o = pobModOverlay('Strength1');
  assert.ok(o, 'overlay exists');
  assert.equal(o.name, 'of the Brute');
  assert.match(o.text, /\+\(5-8\) to Strength/);
  assert.ok(Array.isArray(o.tradeHashes) && o.tradeHashes.length > 0, 'has trade hashes');
});

test('pobModOverlay: null for RePoE-only mods PoB does not list', () => {
  // LocalTrapThrowSpeed1-6 exist in RePoE mods.json but in no PoB pool file.
  assert.equal(pobModOverlay('LocalTrapThrowSpeed1'), null);
  assert.equal(pobModOverlay('NoSuchModXYZ'), null);
});

test('pobTierText: joins numeric text keys in order with newlines', () => {
  const text = pobTierText({ 2: 'second', 10: 'tenth', 1: 'first', affix: 'x' });
  assert.equal(text, 'first\nsecond\ntenth');
});

test('pobTierText: single-line mod', () => {
  assert.equal(pobTierText({ 1: '+(5-8) to Strength' }), '+(5-8) to Strength');
});

test('pobModOverlay: pool covers all six rollable files without id collision loss', () => {
  // Spot-check one id from each pool file (excluding ModItem).
  const ids = {
    FlaskBleedCorruptingBloodImmunity1: 'ModFlask',
    JewelLifeRegeneration: 'ModJewel',
    CharmGainLifeOnUse1: 'ModCharm',
    AbyssModBeltKurgalSuffixManaRegenerationRate: 'ModVeiled',
    CorruptionLifeRegenerationRate1: 'ModCorrupted',
  };
  for (const [id, file] of Object.entries(ids)) {
    const o = pobModOverlay(id);
    assert.ok(o, `${id} (${file}) resolves — remove/rename this case if the id was retired upstream`);
  }
});
