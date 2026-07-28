// test/mod-core.test.js — pure pool/mod resolution + legality warnings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  poolsForBase, corruptedForRef, resolveMod, modViolations, orderMods, baseSlugOf,
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
  // Tier rank: T1 = top (highest level). life has 2 tiers; life2 (lvl 20) is T1, life1 (lvl 1) is T2.
  assert.equal(m.tierNum, 1);
  assert.equal(m.tierCount, 2);
  assert.equal(resolveMod(POOLS, { affix: 'life', tier: 'life1' }).tierNum, 2);
  assert.equal(resolveMod(POOLS, { affix: 'life', tier: 'ghost' }), null);
  assert.equal(resolveMod(POOLS, { affix: 'ghost', tier: 'x' }), null);
});

test('resolveMod: tier rank is relative to the tiers the BASE can roll', () => {
  // plated-boots only rolls life tier index 0 (life1), so on that base life1 is
  // the top tier available — T1, not T2. The picker's tier select narrows the
  // same way, and the card used to contradict it (bug: T1 values labelled T2).
  assert.equal(resolveMod(POOLS, { affix: 'life', tier: 'life1' }, 'plated-boots').tierNum, 1);
  assert.equal(resolveMod(POOLS, { affix: 'life', tier: 'life1' }, 'plated-boots').tierCount, 1);
  // iron-greaves rolls both tiers, so the full ladder applies there.
  assert.equal(resolveMod(POOLS, { affix: 'life', tier: 'life1' }, 'iron-greaves').tierNum, 2);
  // A tier the base cannot roll still renders, ranked on the family's ladder.
  assert.equal(resolveMod(POOLS, { affix: 'life', tier: 'life2' }, 'plated-boots').tierNum, 1);
  // Unknown base / no base -> family ladder, unchanged from before.
  assert.equal(resolveMod(POOLS, { affix: 'life', tier: 'life1' }, 'nope').tierNum, 2);
});

test('baseSlugOf: a base is its own base, a unique resolves through the uniques map', () => {
  assert.equal(baseSlugOf(POOLS, { kind: 'base', slug: 'iron-greaves' }), 'iron-greaves');
  assert.equal(baseSlugOf(POOLS, { kind: 'unique', slug: 'the-anvil' }), 'iron-greaves');
  assert.equal(baseSlugOf(POOLS, { kind: 'unique', slug: 'nope' }), null);
  assert.equal(baseSlugOf(POOLS, null), null);
});

test('orderMods: every prefix before every suffix, desecrated last within each', () => {
  const mods = [
    { affix: 'abyssarm', tier: 'aarm1' }, // desecrated prefix
    { affix: 'fireres', tier: 'fr1' },    // suffix
    { affix: 'life', tier: 'life1' },     // prefix
    { affix: 'armour', tier: 'arm1' },    // prefix
  ];
  assert.deepEqual(orderMods(POOLS, mods, 'iron-greaves').map((m) => m.affix),
    ['life', 'armour', 'abyssarm', 'fireres']);
  // Unresolvable picks sort last rather than disappearing or throwing.
  const withGhost = [{ affix: 'ghost', tier: 'x' }, { affix: 'fireres', tier: 'fr1' }];
  assert.deepEqual(orderMods(POOLS, withGhost).map((m) => m.affix), ['fireres', 'ghost']);
  assert.deepEqual(orderMods(POOLS, null), []);
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
  // Bases now also offer a corrupted implicit chooser (distinct hook).
  assert.match(html, /Corrupted implicit/);
  assert.match(html, /data-mod-corrupt="corrarm"/);
});

test('modPickerHtml: the chosen list is sticky at the top, above the pools', () => {
  const view = { ...poolsForBase(POOLS, 'iron-greaves'), mode: 'base' };
  const cell = { item: { kind: 'base', slug: 'iron-greaves' },
    mods: [{ affix: 'fireres', tier: 'fr1' }, { affix: 'abyssarm', tier: 'aarm1' },
      { affix: 'life', tier: 'life1' }],
    corrupted: { affix: 'corrarm', tier: 'carm1' } };
  const html = modPickerHtml(view, cell);
  assert.ok(html.indexOf('mod-picker__sticky') < html.indexOf('mod-picker__cols'),
    'sticky selection block precedes the prefix/suffix pools');
  assert.ok(html.indexOf('mod-picker__chosen"') < html.indexOf('mod-picker__cols'),
    'chosen list precedes the prefix/suffix pools');
  // Implicit, then standard prefixes, then desecrated prefixes, then suffixes.
  const order = ['data-mod-corrupt-remove', 'data-mod-remove="life"',
    'data-mod-remove="abyssarm"', 'data-mod-remove="fireres"'].map((s) => html.indexOf(s));
  assert.ok(order.every((i) => i >= 0), 'every chosen row present');
  assert.deepEqual([...order].sort((a, b) => a - b), order,
    'implicit, then standard prefixes, then desecrated prefixes, then suffixes');
  assert.match(html, /mod-picker__kind">P</);
  assert.match(html, /mod-picker__kind">S</);
});

test('modPickerHtml: unique mode lifts the chosen corrupted row into the sticky block', () => {
  const view = { prefix: [], suffix: [], corrupted: poolsForBase(POOLS, 'iron-greaves').corrupted, mode: 'unique' };
  const cell = { item: { kind: 'unique', slug: 'the-anvil' }, mods: [],
    corrupted: { affix: 'corrarm', tier: 'carm1' } };
  const html = modPickerHtml(view, cell);
  assert.ok(html.indexOf('data-mod-tier-corrupt') < html.indexOf('mod-picker__col--corrupt'),
    'the tier select sits above the chooser list, not below it');
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
  assert.match(html, /data-mod-corrupt="corrarm"/);
  assert.ok(!/Prefixes/.test(html), 'no prefix column for a unique corrupted picker');
});

test('modPickerHtml: unique mode ignores a stale chosen corrupted affix', () => {
  const view = { prefix: [], suffix: [], corrupted: poolsForBase(POOLS, 'iron-greaves').corrupted, mode: 'unique' };
  const cell = { item: { kind: 'unique', slug: 'the-anvil' }, mods: [],
    corrupted: { affix: 'missing-affix', tier: 'missing-tier' } };

  let html;
  assert.doesNotThrow(() => { html = modPickerHtml(view, cell); });
  assert.equal(typeof html, 'string');
  assert.ok(!/data-mod-tier-corrupt/.test(html), 'no tier select for an unresolvable chosen affix');
});
