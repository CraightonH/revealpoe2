// test/mod-core.test.js — pure pool/mod resolution + legality warnings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  poolsForBase, corruptedForRef, resolveMod, modViolations,
  MAX_PREFIX, MAX_SUFFIX,
} from '../public/js/mod-core.js';

// A tiny hand-built pools fixture — decoupled from the real artifact.
const POOLS = {
  families: {
    life: { name: 'to maximum Life', origin: 'standard', scope: 'equipment', generic: '# to maximum Life',
      tiers: [
        { id: 'life1', name: 'Hale', level: 1, gen: 'prefix', text: '+(10-19) to maximum Life' },
        { id: 'life2', name: 'Healthy', level: 20, gen: 'prefix', text: '+(40-49) to maximum Life' },
      ] },
    armour: { name: 'increased Armour', origin: 'standard', scope: 'equipment', generic: '#% increased Armour',
      tiers: [{ id: 'arm1', name: 'Rusted', level: 1, gen: 'prefix', text: '(10-19)% increased Armour' }] },
    fireres: { name: 'to Fire Resistance', origin: 'standard', scope: 'equipment', generic: '#% to Fire Resistance',
      tiers: [{ id: 'fr1', name: 'of the Cinder', level: 6, gen: 'suffix', text: '+(6-11)% to Fire Resistance' }] },
    corrarm: { name: 'increased Armour', origin: 'corrupted', scope: 'equipment', generic: '#% increased Armour',
      tiers: [{ id: 'carm1', name: 'Corrupted', level: 1, gen: 'corrupted', text: '(15-25)% increased Armour' }] },
  },
  bases: {
    'iron-greaves': [
      { a: 'life', t: [0, 1] }, { a: 'armour' }, { a: 'fireres' }, { a: 'corrarm' },
    ],
    'plated-boots': [{ a: 'life', t: [0] }],
  },
  uniques: { 'the-anvil': 'iron-greaves' },
};

test('poolsForBase: partitions prefix/suffix/corrupted, narrows tiers', () => {
  const p = poolsForBase(POOLS, 'iron-greaves');
  assert.deepEqual(p.prefix.map((f) => f.affix).sort(), ['armour', 'life']);
  assert.deepEqual(p.suffix.map((f) => f.affix), ['fireres']);
  assert.deepEqual(p.corrupted.map((f) => f.affix), ['corrarm']);
  const life = p.prefix.find((f) => f.affix === 'life');
  assert.equal(life.tiers.length, 2);
  const boots = poolsForBase(POOLS, 'plated-boots');
  assert.equal(boots.prefix.find((f) => f.affix === 'life').tiers.length, 1, 'narrowed to allowed index');
});

test('corruptedForRef: base uses own slug, unique resolves via uniques map', () => {
  assert.deepEqual(corruptedForRef(POOLS, { kind: 'base', slug: 'iron-greaves' }).map((f) => f.affix), ['corrarm']);
  assert.deepEqual(corruptedForRef(POOLS, { kind: 'unique', slug: 'the-anvil' }).map((f) => f.affix), ['corrarm']);
  assert.deepEqual(corruptedForRef(POOLS, { kind: 'unique', slug: 'nope' }), []);
});

test('resolveMod: returns renderable tier data or null', () => {
  const m = resolveMod(POOLS, { affix: 'life', tier: 'life2' });
  assert.equal(m.name, 'to maximum Life');
  assert.equal(m.text, '+(40-49) to maximum Life');
  assert.equal(m.gen, 'prefix');
  assert.equal(resolveMod(POOLS, { affix: 'life', tier: 'ghost' }), null);
  assert.equal(resolveMod(POOLS, { affix: 'ghost', tier: 'x' }), null);
});

test('modViolations: warns on prefix overflow but never throws', () => {
  const cell = { item: { kind: 'base', slug: 'iron-greaves' }, mods: [
    { affix: 'life', tier: 'life1' }, { affix: 'armour', tier: 'arm1' },
    { affix: 'life', tier: 'life2' }, { affix: 'life', tier: 'life1' },
  ], corrupted: null };
  const v = modViolations(cell, POOLS);
  assert.ok(v.some((x) => x.code === 'prefix-overflow'), 'four prefixes overflow 3');
  assert.ok(v.some((x) => x.code === 'duplicate-mod'), 'repeated affix flagged');
  assert.doesNotThrow(() => modViolations({}, POOLS));
  assert.doesNotThrow(() => modViolations(null, null));
});

test('modViolations: illegal mod for the base', () => {
  const cell = { item: { kind: 'base', slug: 'plated-boots' }, mods: [{ affix: 'fireres', tier: 'fr1' }], corrupted: null };
  assert.ok(modViolations(cell, POOLS).some((x) => x.code === 'illegal-mod'));
});

test('exports: prefix/suffix caps are 3', () => {
  assert.equal(MAX_PREFIX, 3);
  assert.equal(MAX_SUFFIX, 3);
});
