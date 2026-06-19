import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveKeywordPhrases, installKeywordPhrases } from '../src/data/keywordPhrases.js';
import { registerDerivedPhrases, renderGameText } from '../src/data/keywords.js';

test('derives a clean phrase->id map from the game data', () => {
  const pairs = deriveKeywordPhrases();
  const byPhrase = new Map(pairs.map(([p, id]) => [p.toLowerCase(), id]));

  // terms the game tokenizes somewhere but writes plain in mods — the holes
  assert.equal(byPhrase.get('cold resistance'), 'Resistances');
  assert.equal(byPhrase.get('fork'), 'Fork');
  assert.equal(byPhrase.get('culling strike'), 'CullingStrike');

  // ambiguity tie-break: id whose name equals the phrase wins
  assert.equal(byPhrase.get('frozen'), 'Frozen'); // not Freeze
  assert.equal(byPhrase.get('rarity'), 'Rarity'); // not ItemRarity

  // hygiene: no numeric or sentence-length phrases, no dead (def-less) ids
  for (const [phrase] of pairs) {
    assert.ok(!/\d/.test(phrase), `phrase has a digit: ${phrase}`);
    assert.ok(phrase.split(/\s+/).length <= 4, `phrase too long: ${phrase}`);
  }

  // rare-elision rule: the game truncates "[SkillSpeed|Skill] and Movement Speed",
  // but bare "Skill" must NOT link to the Skill Speed glossary. The dominant
  // "Skill Speed" display survives; a legit short form like "Elemental Damage"
  // (more frequent than "Elemental Damage Types") is not collateral damage.
  assert.equal(byPhrase.has('skill'), false);
  assert.equal(byPhrase.get('skill speed'), 'SkillSpeed');
  assert.equal(byPhrase.get('elemental damage'), 'ElementalDamage');
});

test('installed derived phrases make a plain-text keyword interactive', () => {
  installKeywordPhrases();
  // "Culling Strike" is never tokenized in this mod string, but is now linked.
  const out = renderGameText('Skills have (10-20)% chance to Culling Strike');
  assert.match(out, /data-keyword="CullingStrike">Culling Strike</);
});

test('registerDerivedPhrases never overrides a seed phrase', () => {
  // "Hit" is seeded to HitDamage; a derived pair must not steal it.
  registerDerivedPhrases([['Hit', 'SomethingElse']]);
  assert.match(renderGameText('on Hit'), /data-keyword="HitDamage">Hit</);
});
