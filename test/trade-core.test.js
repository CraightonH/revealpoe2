// test/trade-core.test.js — turning a crafted planner cell into trade filters,
// and merging them into the trade URL the server baked into the item card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tradeQueryFilters, mergeTradeQuery, tradeActionLabel } from '../public/js/trade-core.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Hand-built fixtures, decoupled from the real artifacts (mirrors mod-core.test).
const POOLS = {
  families: {
    life: { name: 'to maximum Life', origin: 'standard', scope: 'item', generic: '# to maximum Life', tiers: [] },
    fireres: { name: 'to Fire Resistance', origin: 'standard', scope: 'item', generic: '#% to Fire Resistance', tiers: [] },
    hybrid: { name: 'Armour and Stun Threshold', origin: 'standard', scope: 'item', generic: '#% increased Armour\n+# to Stun Threshold', tiers: [] },
    abyss: { name: 'Abyssal Might', origin: 'desecrated', scope: 'item', generic: '#% increased Armour and Life', tiers: [] },
    corrarm: { name: 'increased Armour', origin: 'corrupted', scope: 'item', generic: '#% increased Armour', tiers: [] },
    nofilter: { name: 'Mana Reservation Efficiency', origin: 'standard', scope: 'item', generic: '#% increased Mana Reservation Efficiency of Skills', tiers: [] },
  },
};
const STAT_IDS = {
  map: {
    life: ['explicit.stat_life'],
    fireres: ['explicit.stat_fireres'],
    hybrid: ['explicit.stat_armour', 'explicit.stat_stun'],
    abyss: ['desecrated.stat_abyss'],
    corrarm: ['enchant.stat_armour'],   // corrupted implicits index under Enchant, not Implicit
  },
};

const BASE_URL = 'https://www.pathofexile.com/trade2/search/poe2/Runes%20of%20Aldur?q='
  + encodeURIComponent(JSON.stringify({
    query: { status: { option: 'securable' }, type: 'Furtive Wraps', stats: [{ type: 'and', filters: [] }] },
  }));
const UNIQUE_URL = 'https://www.pathofexile.com/trade2/search/poe2/Runes%20of%20Aldur?q='
  + encodeURIComponent(JSON.stringify({
    query: { status: { option: 'securable' }, name: 'Wanderlust', type: 'Wrapped Sandals', stats: [{ type: 'and', filters: [] }] },
  }));

const decode = (url) => JSON.parse(decodeURIComponent(/[?&]q=(.*)$/.exec(url)[1]));
const statIdsIn = (url) => decode(url).query.stats[0].filters.map((f) => f.id);

test('a rare item filters on every chosen mod, with no value bounds', () => {
  const cell = { mods: [{ affix: 'life', tier: 'life2' }, { affix: 'fireres', tier: 'fr1' }], corrupted: null };
  const r = tradeQueryFilters({ cell, pools: POOLS, statIds: STAT_IDS });
  assert.equal(r.mapped, 2);
  assert.deepEqual(r.unmapped, []);
  assert.deepEqual(r.stats, [{
    type: 'and',
    filters: [{ id: 'explicit.stat_life', disabled: false }, { id: 'explicit.stat_fireres', disabled: false }],
  }]);
  // Tiers are a planning target, not a purchase requirement.
  for (const f of r.stats[0].filters) assert.equal('value' in f, false);
  assert.deepEqual(r.filters.type_filters, { filters: { rarity: { option: 'nonunique' } } });
  assert.equal(r.filters.misc_filters, undefined);
});

test('rarity is nonunique, not the planner magic/rare re-skin', () => {
  const oneMod = tradeQueryFilters({ cell: { mods: [{ affix: 'life' }] }, pools: POOLS, statIds: STAT_IDS });
  const threeMods = tradeQueryFilters({
    cell: { mods: [{ affix: 'life' }, { affix: 'fireres' }, { affix: 'hybrid' }] },
    pools: POOLS, statIds: STAT_IDS,
  });
  assert.equal(oneMod.filters.type_filters.filters.rarity.option, 'nonunique');
  assert.equal(threeMods.filters.type_filters.filters.rarity.option, 'nonunique');
});

test('a hybrid mod contributes one filter per stat line', () => {
  const r = tradeQueryFilters({ cell: { mods: [{ affix: 'hybrid' }] }, pools: POOLS, statIds: STAT_IDS });
  assert.equal(r.mapped, 1);
  assert.deepEqual(r.stats[0].filters.map((f) => f.id), ['explicit.stat_armour', 'explicit.stat_stun']);
});

test('a corrupted implicit sets corrupted:true and pins the implicit stat', () => {
  const cell = { mods: [{ affix: 'life' }], corrupted: { affix: 'corrarm', tier: 'carm1' } };
  const r = tradeQueryFilters({ cell, pools: POOLS, statIds: STAT_IDS });
  assert.deepEqual(r.filters.misc_filters, { filters: { corrupted: { option: 'true' } } });
  assert.deepEqual(r.stats[0].filters.map((f) => f.id), ['explicit.stat_life', 'enchant.stat_armour']);
});

test('a unique gets corrupted + the implicit stat but no rarity filter', () => {
  const cell = { mods: [], corrupted: { affix: 'corrarm' } };
  const r = tradeQueryFilters({ cell, pools: POOLS, statIds: STAT_IDS, isUnique: true });
  assert.equal(r.filters.type_filters, undefined);
  assert.deepEqual(r.filters.misc_filters, { filters: { corrupted: { option: 'true' } } });
  assert.deepEqual(r.stats[0].filters.map((f) => f.id), ['enchant.stat_armour']);
});

test('a desecrated mod sets the desecrated flag', () => {
  const r = tradeQueryFilters({ cell: { mods: [{ affix: 'abyss' }] }, pools: POOLS, statIds: STAT_IDS });
  assert.equal(r.filters.misc_filters.filters.desecrated.option, 'true');
  assert.deepEqual(r.stats[0].filters.map((f) => f.id), ['desecrated.stat_abyss']);
});

test('an unfilterable mod is reported, and the rest still filter', () => {
  const cell = { mods: [{ affix: 'life' }, { affix: 'nofilter' }] };
  const r = tradeQueryFilters({ cell, pools: POOLS, statIds: STAT_IDS });
  assert.equal(r.mapped, 1);
  assert.deepEqual(r.unmapped, ['Mana Reservation Efficiency']);
  assert.deepEqual(r.stats[0].filters.map((f) => f.id), ['explicit.stat_life']);
  const label = tradeActionLabel(r);
  assert.equal(label.label, 'Trade (1 of 2)');
  assert.match(label.title, /Mana Reservation Efficiency/);
});

test('a fully-filtered link keeps the plain Trade label', () => {
  const r = tradeQueryFilters({ cell: { mods: [{ affix: 'life' }] }, pools: POOLS, statIds: STAT_IDS });
  assert.equal(tradeActionLabel(r).label, 'Trade');
});

test('an empty cell produces no filters at all', () => {
  const r = tradeQueryFilters({ cell: { mods: [], corrupted: null }, pools: POOLS, statIds: STAT_IDS });
  assert.equal(r.filters, null);
  assert.equal(r.stats, null);
  assert.equal(tradeActionLabel(r), null);
});

test('merging preserves league, type and status from the server URL', () => {
  const r = tradeQueryFilters({ cell: { mods: [{ affix: 'life' }] }, pools: POOLS, statIds: STAT_IDS });
  const url = mergeTradeQuery(BASE_URL, r);
  const q = decode(url).query;
  assert.ok(url.startsWith('https://www.pathofexile.com/trade2/search/poe2/Runes%20of%20Aldur?q='));
  assert.equal(q.type, 'Furtive Wraps');
  assert.deepEqual(q.status, { option: 'securable' });
  assert.deepEqual(statIdsIn(url), ['explicit.stat_life']);
  assert.equal(q.filters.type_filters.filters.rarity.option, 'nonunique');
  // Spaces stay percent-encoded, as everywhere else on the site — never `+`.
  assert.equal(url.includes('+'), false);
});

test('merging onto a unique URL keeps its pinned name', () => {
  const r = tradeQueryFilters({
    cell: { mods: [], corrupted: { affix: 'corrarm' } }, pools: POOLS, statIds: STAT_IDS, isUnique: true,
  });
  const q = decode(mergeTradeQuery(UNIQUE_URL, r)).query;
  assert.equal(q.name, 'Wanderlust');
  assert.equal(q.type, 'Wrapped Sandals');
  assert.equal(q.filters.misc_filters.filters.corrupted.option, 'true');
});

test('merging is a no-op on anything that is not a parseable trade URL', () => {
  const extra = { filters: { misc_filters: { filters: { corrupted: { option: 'true' } } } }, stats: null };
  assert.equal(mergeTradeQuery('', extra), '');
  assert.equal(mergeTradeQuery(null, extra), null);
  assert.equal(mergeTradeQuery('https://example.com/nope', extra), 'https://example.com/nope');
  assert.equal(mergeTradeQuery('https://example.com/?q=notjson', extra), 'https://example.com/?q=notjson');
  assert.equal(mergeTradeQuery(BASE_URL, { filters: null, stats: null }), BASE_URL);
});

test('malformed input never throws', () => {
  for (const args of [undefined, {}, { cell: null, pools: null, statIds: null },
    { cell: { mods: [null, {}] }, pools: {}, statIds: {} }]) {
    assert.doesNotThrow(() => tradeQueryFilters(args));
  }
});

// --- the committed artifact -------------------------------------------------

const ARTIFACT = path.join(ROOT, 'src/data/trade-stat-ids.json');

test('the committed stat-id map is well-formed and covers the common mods', { skip: !fs.existsSync(ARTIFACT) }, () => {
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const map = artifact.map;
  assert.ok(Object.keys(map).length > 800, 'expected the map to cover most rollable families');
  for (const [slug, ids] of Object.entries(map)) {
    assert.ok(Array.isArray(ids) && ids.length, `${slug} has no ids`);
    for (const id of ids) {
      assert.match(id, /^(explicit|enchant|desecrated)\./, `${slug} -> unexpected group in ${id}`);
    }
  }
});

// A re-scrape that reworded affix text would silently drop mappings and leave
// planner trade links under-filtering. Fail loudly instead: coverage of the
// families the planner can actually put on gear must not regress.
const POOLS_ARTIFACT = path.join(ROOT, 'public/generated/mod-pools.json');
const COVERAGE_FLOOR = 0.80;

test('trade-stat coverage of item-scope families has not regressed', {
  skip: !fs.existsSync(ARTIFACT) || !fs.existsSync(POOLS_ARTIFACT) ? 'artifacts not built' : false,
}, () => {
  const map = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8')).map;
  const families = JSON.parse(fs.readFileSync(POOLS_ARTIFACT, 'utf8')).families;
  const rollable = Object.entries(families)
    .filter(([, f]) => f.scope === 'item' && ['standard', 'corrupted', 'desecrated'].includes(f.origin))
    .filter(([, f]) => String(f.generic ?? '').trim());
  const covered = rollable.filter(([slug]) => map[slug]?.length).length;
  const ratio = covered / rollable.length;
  assert.ok(
    ratio >= COVERAGE_FLOOR,
    `only ${(ratio * 100).toFixed(1)}% of ${rollable.length} item-scope families map to a trade stat `
    + `(floor ${COVERAGE_FLOOR * 100}%). Re-run \`npm run fetch:trade-stats\` — affix text may have changed.`,
  );
});

// The invariant most likely to be "corrected" back into a bug: corrupted
// implicits index under Enchant. Trade's Implicit group is base-item implicits
// and returns ZERO listings for a corruption outcome (verified live).
test('every affix maps to the stat group its origin actually lives in', {
  skip: !fs.existsSync(ARTIFACT) || !fs.existsSync(POOLS_ARTIFACT) ? 'artifacts not built' : false,
}, () => {
  const map = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8')).map;
  const families = JSON.parse(fs.readFileSync(POOLS_ARTIFACT, 'utf8')).families;
  const expected = { standard: 'explicit', corrupted: 'enchant', desecrated: 'desecrated' };
  for (const [slug, ids] of Object.entries(map)) {
    const want = expected[families[slug]?.origin];
    assert.ok(want, `${slug} is mapped but has no rollable origin`);
    for (const id of ids) {
      assert.equal(id.split('.')[0], want, `${slug} (${families[slug].origin}) mapped to ${id}`);
    }
  }
});

// Trade distinguishes 8 stats that share display text but are different stats
// by position: "# to Accuracy Rating" (global, jewellery/armour) vs
// "# to Accuracy Rating (Local)" (the weapon's own). They match disjoint item
// sets, so binding a weapon-local affix to the global id searches for an item
// that cannot exist. Locality comes from the RePoE stat id's `local_` prefix,
// resolved PER STAT LINE — hybrid families genuinely mix the two.
test('local affixes bind to the (Local) trade stat, not its global twin', {
  skip: !fs.existsSync(ARTIFACT) ? 'artifact not built' : false,
}, () => {
  const map = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8')).map;
  const LOCAL_ACCURACY = 'explicit.stat_691932474';
  const GLOBAL_ACCURACY = 'explicit.stat_803737631';
  const LOCAL_ATTACK_SPEED = 'explicit.stat_210067635';

  // "#% increased Physical Damage / +# to Accuracy Rating" on a weapon —
  // both lines local.
  const weaponHybrid = map['localincreasedphysicaldamagepercentandaccuracyrating'];
  assert.ok(weaponHybrid, 'the phys/accuracy weapon hybrid should be mapped');
  assert.ok(weaponHybrid.includes(LOCAL_ACCURACY), `expected local accuracy, got ${weaponHybrid}`);
  assert.ok(!weaponHybrid.includes(GLOBAL_ACCURACY), 'must not use the global accuracy stat');

  // "+# to Accuracy Rating / #% increased Attack Speed" — GLOBAL accuracy but
  // LOCAL attack speed. Proves locality is resolved per line, not per family.
  const mixed = map.accuracyattackspeedhybrid;
  assert.ok(mixed, 'the accuracy/attack-speed hybrid should be mapped');
  assert.ok(mixed.includes(GLOBAL_ACCURACY), `expected global accuracy, got ${mixed}`);
  assert.ok(mixed.includes(LOCAL_ATTACK_SPEED), `expected local attack speed, got ${mixed}`);
  assert.ok(!mixed.includes(LOCAL_ACCURACY), 'must not use the local accuracy stat');
});
