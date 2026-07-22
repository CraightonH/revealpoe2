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
    abyssarm: { name: 'increased Armour and Life', origin: 'desecrated', scope: 'equipment', boss: 'Ulaman',
      generic: '#% increased Armour and Life',
      tiers: [{ id: 'aarm1', name: 'of Ulaman', level: 1, gen: 'prefix', text: '(30-40)% increased Armour, +10 Life' }] },
  },
  bases: {
    'iron-greaves': [
      { a: 'life', t: [0, 1] }, { a: 'armour' }, { a: 'fireres' }, { a: 'corrarm' }, { a: 'abyssarm' },
    ],
    'plated-boots': [{ a: 'life', t: [0] }],
  },
  uniques: { 'the-anvil': 'iron-greaves' },
};

test('poolsForBase: partitions prefix/suffix/corrupted, narrows tiers', () => {
  const p = poolsForBase(POOLS, 'iron-greaves');
  assert.deepEqual(p.prefix.map((f) => f.affix).sort(), ['abyssarm', 'armour', 'life']);
  assert.deepEqual(p.suffix.map((f) => f.affix), ['fireres']);
  assert.deepEqual(p.corrupted.map((f) => f.affix), ['corrarm']);
  const life = p.prefix.find((f) => f.affix === 'life');
  assert.equal(life.tiers.length, 2);
  const boots = poolsForBase(POOLS, 'plated-boots');
  assert.equal(boots.prefix.find((f) => f.affix === 'life').tiers.length, 1, 'narrowed to allowed index');
});

test('poolsForBase: desecrated families join prefix/suffix, ordered after standard, carry origin + boss', () => {
  const p = poolsForBase(POOLS, 'iron-greaves');
  const aby = p.prefix.find((f) => f.affix === 'abyssarm');
  assert.ok(aby, 'desecrated family present in prefix bucket');
  assert.equal(aby.origin, 'desecrated');
  assert.equal(aby.boss, 'Ulaman');
  // Standard families sort before desecrated within a bucket.
  assert.equal(p.prefix.at(-1).affix, 'abyssarm', 'desecrated sorts last');
  assert.ok(p.prefix.slice(0, -1).every((f) => f.origin === 'standard'));
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

import { modPickerHtml } from '../public/js/mod-core.js';

test('modPickerHtml: base mode renders prefix/suffix add rows + chosen tier selects', () => {
  const view = { ...poolsForBase(POOLS, 'iron-greaves'), mode: 'base' };
  const cell = { item: { kind: 'base', slug: 'iron-greaves' }, mods: [{ affix: 'life', tier: 'life1' }], corrupted: null };
  const html = modPickerHtml(view, cell);
  assert.match(html, /data-mod-add="armour"/);
  assert.match(html, /data-mod-add="fireres"/);
  assert.match(html, /data-mod-remove="life"/);
  assert.match(html, /data-mod-tier="life"/);
  assert.match(html, /life2/);                 // both tiers offered in the select
  assert.match(html, /Prefixes/); assert.match(html, /Suffixes/);
});

test('modPickerHtml: desecrated add rows carry an origin badge with the boss name', () => {
  const view = { ...poolsForBase(POOLS, 'iron-greaves'), mode: 'base' };
  const cell = { item: { kind: 'base', slug: 'iron-greaves' }, mods: [], corrupted: null };
  const html = modPickerHtml(view, cell);
  assert.match(html, /data-mod-add="abyssarm"/);
  assert.match(html, /mod-picker__origin/);       // desecrated rows get an origin pill
  assert.match(html, /Ulaman/);                    // boss name shown on the pill
});

test('modPickerHtml: unique mode renders only the corrupted single-choice section', () => {
  const view = { prefix: [], suffix: [], corrupted: poolsForBase(POOLS, 'iron-greaves').corrupted, mode: 'unique' };
  const cell = { item: { kind: 'unique', slug: 'the-anvil' }, mods: [], corrupted: null };
  const html = modPickerHtml(view, cell);
  assert.match(html, /data-mod-add="corrarm"/);
  assert.ok(!/Prefixes/.test(html), 'no prefix column for a unique corrupted picker');
});

test('modPickerHtml: unique mode ignores a stale chosen corrupted affix', () => {
  const view = { prefix: [], suffix: [], corrupted: poolsForBase(POOLS, 'iron-greaves').corrupted, mode: 'unique' };
  const cell = { item: { kind: 'unique', slug: 'the-anvil' }, mods: [],
    corrupted: { affix: 'missing-affix', tier: 'missing-tier' } };

  let html;
  assert.doesNotThrow(() => { html = modPickerHtml(view, cell); });
  assert.equal(typeof html, 'string');
  assert.ok(!html.includes('<div class="mod-picker__chosen"><h4>Chosen</h4>'));
});
