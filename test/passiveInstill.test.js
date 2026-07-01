// test/passiveInstill.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmotionIndex, resolveRecipe } from '../scripts/graph/emotions.js';

// Minimal base_items fixture mirroring the real DistilledEmotion shape.
const BASE_ITEMS = {
  'Metadata/Items/Currency/DistilledEmotion8': {
    name: 'Concentrated Liquid Fear',
    drop_level: 69,
    properties: { description: 'Augments a [Rarity|Rare] jewel', directions: 'Use at The Withered Willow.', stack_size: 10 },
    visual_identity: { dds_file: 'Art/2DItems/Currency/DistilledEmotions/ConcentratedDistilledFear.dds' },
  },
  'Metadata/Items/Currency/DistilledEmotion5': {
    name: 'Liquid Envy',
    properties: { stack_size: 10 },
    visual_identity: { dds_file: 'Art/2DItems/Currency/DistilledEmotions/DistilledEnvy.dds' },
  },
  // Time-Lost variant: distinct token, never referenced by a recipe.
  'Metadata/Items/Currency/DistilledEmotionTimeLost8': {
    name: 'Ancient Concentrated Liquid Fear',
    visual_identity: { dds_file: 'Art/2DItems/Currency/DistilledEmotions/AncientFear.dds' },
  },
  // Non-emotion currency must be ignored.
  'Metadata/Items/Currency/CurrencyInstillingOrb': { name: 'Instilling Orb' },
};

const index = buildEmotionIndex(BASE_ITEMS);

test('index keys emotions by space-stripped name and resolves fields', () => {
  const fear = index.byToken.get('ConcentratedLiquidFear');
  assert.equal(fear.name, 'Concentrated Liquid Fear');
  assert.equal(fear.key, 'concentrated-liquid-fear');
  assert.equal(fear.iconUrl, '/static/img/Art/2DItems/Currency/DistilledEmotions/ConcentratedDistilledFear.webp');
  assert.equal(fear.description, 'Augments a [Rarity|Rare] jewel');
  assert.equal(fear.dropLevel, 69);
  assert.equal(fear.stackSize, 10);
});

test('non-emotion currency is excluded; Time-Lost variants keep distinct tokens', () => {
  assert.equal(index.byToken.has('InstillingOrb'), false);
  assert.equal(index.byToken.has('AncientConcentratedLiquidFear'), true);
});

test('resolveRecipe preserves order and duplicates', () => {
  const r = resolveRecipe(index, ['LiquidEnvy', 'ConcentratedLiquidFear', 'LiquidEnvy']);
  assert.deepEqual(r.map((e) => e.name), ['Liquid Envy', 'Concentrated Liquid Fear', 'Liquid Envy']);
});

test('resolveRecipe throws on an unknown token', () => {
  assert.throws(() => resolveRecipe(index, ['LiquidNope']), /Unknown Distilled Emotion recipe token: LiquidNope/);
});
