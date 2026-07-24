import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMath, parseStat, stripStatMarkup } from '../public/js/build-math.js';
import { emptyBuild } from '../public/js/build-store.js';

const keys = (line) => { const r = parseStat(line); return r ? r.stats.map((s) => `${s.key}:${s.lo}-${s.hi}`).sort() : null; };

test('parseStat: flat attributes, ranges and scalars', () => {
  assert.deepEqual(keys('+(10-15) to Strength'), ['str:10-15']);
  assert.deepEqual(keys('+8 to Dexterity'), ['dex:8-8']);
  assert.deepEqual(keys('+(5-7) to all Attributes'), ['dex:5-7', 'int:5-7', 'str:5-7']);
});

test('parseStat: life / mana / spirit flats', () => {
  assert.deepEqual(keys('+(30-40) to maximum Life'), ['life:30-40']);
  assert.deepEqual(keys('+(40-60) to maximum Mana'), ['mana:40-60']);
  assert.deepEqual(keys('+30 to Spirit'), ['spirit:30-30']);
  assert.deepEqual(keys('+(10-15) to Spirit'), ['spirit:10-15']);
});

test('parseStat: resistances incl. all-elemental expansion', () => {
  assert.deepEqual(keys('+(50-100)% to Lightning Resistance'), ['lightRes:50-100']);
  assert.deepEqual(keys('+(4-7)% to Chaos Resistance'), ['chaosRes:4-7']);
  assert.deepEqual(keys('+(10-20)% to all Elemental Resistances'),
    ['coldRes:10-20', 'fireRes:10-20', 'lightRes:10-20']);
});

test('parseStat: strips [id|display] markup before matching', () => {
  assert.equal(stripStatMarkup('+5 to [Strength|Strength]'), '+5 to Strength');
  assert.deepEqual(keys('+5 to [Strength|Strength]'), ['str:5-5']);
});

test('parseStat: rejects aura/conditional/non-whitelist lines', () => {
  assert.equal(parseStat('Allies in your Presence have +(3-5)% to all Elemental Resistances'), null);
  assert.equal(parseStat('Critical Hits ignore Enemy Monster Lightning Resistance'), null);
  assert.equal(parseStat('(6-10)% increased maximum Life'), null); // % increased ≠ flat life (v1)
  assert.equal(parseStat('20% reduced maximum Life'), null);
  assert.equal(parseStat('15% increased chance to Shock'), null);
});

const ITEMMATH = {
  classBase: { warrior: { str: 15, dex: 7, int: 7, life: 16, mana: 30 } },
  gemLevel: { 'boneshatter': 12 },
  items: {
    astramentis: { req: { level: 30, str: 0, dex: 0, int: 0 }, lines: ['+(10-20) to all Attributes'] },
    'crude-bow': { req: { level: 1, str: 0, dex: 14, int: 0 }, lines: [] },
    'iron-hat': { req: { level: 8, str: 20, dex: 0, int: 0 }, lines: ['+(30-40) to maximum Life', '+20% to Fire Resistance'] },
  },
};
const PLANNER = { classes: [{ slug: 'warrior', name: 'Warrior' }], gems: {}, items: {}, slots: [] };
const POOLS = { families: {}, bases: {}, uniques: {} };
const build = (over) => emptyBuild({ now: () => 1, uuid: () => 'b1', class: 'warrior', ...over });

test('computeMath: aggregates flat whitelist stats across gear as ranges', () => {
  const b = build({ gear: { helmet: { item: { kind: 'base', slug: 'iron-hat' }, mods: [], corrupted: null } } });
  const r = computeMath(b, { planner: PLANNER, itemMath: ITEMMATH, pools: POOLS, treeLines: [] });
  assert.deepEqual(r.aggregates.life, { lo: 46, hi: 56 });
  assert.deepEqual(r.aggregates.fireRes, { lo: 20, hi: 20 });
});

test('computeMath: all-attributes gear + class base feed availability; tree lines add too', () => {
  const b = build({ gear: { amulet: { item: { kind: 'unique', slug: 'astramentis' }, mods: [], corrupted: null } } });
  const r = computeMath(b, { planner: PLANNER, itemMath: ITEMMATH, pools: POOLS, treeLines: ['+5 to Strength'] });
  // available.str = class 15 + gear all-attr (10..20) + tree 5 = 30..40
  assert.deepEqual(r.attributes.str.available, { lo: 30, hi: 40 });
});

test('computeMath: requirement = max item req; deficit uses worst-case (lo) availability', () => {
  const b = build({ gear: {
    helmet: { item: { kind: 'base', slug: 'iron-hat' }, mods: [], corrupted: null },   // str req 20
    weapon1a: { item: { kind: 'base', slug: 'crude-bow' }, mods: [], corrupted: null }, // dex req 14
  } });
  const r = computeMath(b, { planner: PLANNER, itemMath: ITEMMATH, pools: POOLS, treeLines: [] });
  assert.equal(r.attributes.str.required, 20);
  assert.equal(r.attributes.dex.required, 14);
  // available.str = 15 (class only); required 20 -> deficit 5
  assert.equal(r.attributes.str.deficit, 5);
  assert.equal(r.attributes.dex.deficit, 7); // class dex 7 vs req 14
  assert.ok(r.warnings.some((w) => /Strength/.test(w) && /5/.test(w)));
});

test('computeMath: character-level requirement = max item level + gem crafting level', () => {
  const b = build({
    gear: { amulet: { item: { kind: 'unique', slug: 'astramentis' }, mods: [], corrupted: null } }, // level 30
    skills: [{ gem: { slug: 'boneshatter' }, level: null, supports: [] }],                            // craft 12
  });
  const r = computeMath(b, { planner: PLANNER, itemMath: ITEMMATH, pools: POOLS, treeLines: [] });
  assert.equal(r.level.required, 30);
});

test('computeMath: a non-whitelist stat never enters totals', () => {
  const IM2 = { ...ITEMMATH, items: { ...ITEMMATH.items,
    'iron-hat': { req: { level: 8, str: 20, dex: 0, int: 0 }, lines: ['+(30-40) to maximum Life'] } } };
  const b = build({ gear: { helmet: { item: { kind: 'base', slug: 'iron-hat' }, mods: [], corrupted: null } } });
  const r = computeMath(b, { planner: PLANNER, itemMath: IM2, pools: POOLS, treeLines: [] });
  assert.equal(r.aggregates.fireRes.hi, 0); // fire res line removed -> stays zero
});
