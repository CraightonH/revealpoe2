// test/build-file.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildToBuildFile, buildFileName, SLOT_TO_INVENTORY } from '../public/js/build-file.js';
import { emptyBuild } from '../public/js/build-store.js';
import { synthesizeState, encode, ATTR_TAG } from '../public/js/passive-code.js';

const FIX = path.join(import.meta.dirname, 'fixtures', 'build-files');
const GEN = path.join(import.meta.dirname, '..', 'public', 'generated');
const realIds = () => ({
  ...JSON.parse(fs.readFileSync(path.join(GEN, 'build-export.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(GEN, 'passive-build-ids.json'), 'utf8')),
});

const ids = {
  gemIds: { spark: 'Metadata/Items/Gems/SkillGemSpark', arc: 'Metadata/Items/Gem/SkillGemArc',
            'martial-tempo': 'Metadata/Items/Gems/SupportGemMartialTempo' },
  ascendancyIds: { stormweaver: 'Sorceress2' },
  passiveIds: { 100: 'spells18', 200: 'cast_speed10', 300: 'criticals86', 400: 'lightning40' },
};
const pools = {
  families: {
    maximum_life: { name: 'Maximum Life', tiers: [{ id: 'MaximumLife7', text: '+(90-99) to maximum Life', gen: 'prefix' }] },
    lightning_resistance: { name: 'Lightning Resistance', tiers: [{ id: 'LightningResistance5', text: '+(36-41)% to Lightning Resistance', gen: 'suffix' }] },
  },
  bases: {}, uniques: {},
};
const NAMES = { 'tabula-rasa': 'Tabula Rasa', 'ancestral-tiara': 'Ancestral Tiara' };
const ctx = (over = {}) => ({
  ids, pools, planner: { classes: [] },
  resolveRef: (ref) => (NAMES[ref.slug] ? { name: NAMES[ref.slug] } : null),
  grantedRows: () => [],
  ...over,
});

const mk = (over = {}) => emptyBuild({ now: () => 1000, uuid: () => 'id-1', ...over });
const synth = (state) => synthesizeState({
  ...state,
  ascOf: () => null,
  isAttr: () => false,
  attrOf: () => 'str',
});

test('a minimal build produces a valid minimal Build object', () => {
  const out = buildToBuildFile(mk({ name: 'My Build' }), ctx());
  assert.equal(out.name, 'My Build');
  assert.deepEqual(out.passives, []);
  assert.deepEqual(out.skills, []);
  assert.deepEqual(out.inventory_slots, []);
  // Empty optionals are omitted, matching the real fixtures.
  assert.ok(!('description' in out));
  assert.ok(!('ascendancy' in out));
});

test('description and ascendancy are emitted when set', () => {
  const b = mk({ name: 'X', ascendancy: 'stormweaver' });
  b.description = 'Arc into Spark.';
  const out = buildToBuildFile(b, ctx());
  assert.equal(out.description, 'Arc into Spark.');
  assert.equal(out.ascendancy, 'Sorceress2');
});

test('an unmapped ascendancy is omitted rather than guessed', () => {
  const out = buildToBuildFile(mk({ name: 'X', ascendancy: 'not-a-real-asc' }), ctx());
  assert.ok(!('ascendancy' in out));
});

test('skills carry the metadata id and nested support ids', () => {
  const b = mk({ name: 'X' });
  b.skills = [
    { gem: { slug: 'spark' }, level: null, supports: [{ slug: 'martial-tempo' }] },
    { gem: { slug: 'arc' }, level: null, supports: [] },
  ];
  const out = buildToBuildFile(b, ctx());
  assert.deepEqual(out.skills, [
    { id: 'Metadata/Items/Gems/SkillGemSpark',
      support_skills: [{ id: 'Metadata/Items/Gems/SupportGemMartialTempo' }] },
    { id: 'Metadata/Items/Gem/SkillGemArc' },
  ]);
});

test('a gem with no known metadata id is skipped, not emitted broken', () => {
  const b = mk({ name: 'X' });
  b.skills = [{ gem: { slug: 'unknown-gem' }, level: null, supports: [{ slug: 'also-unknown' }] },
              { gem: { slug: 'spark' }, level: null, supports: [{ slug: 'also-unknown' }] }];
  const out = buildToBuildFile(b, ctx());
  assert.equal(out.skills.length, 1);
  assert.equal(out.skills[0].id, 'Metadata/Items/Gems/SkillGemSpark');
  assert.ok(!('support_skills' in out.skills[0]), 'unknown supports drop out entirely');
});

test('item-granted setups are exported alongside authored ones', () => {
  const b = mk({ name: 'X' });
  b.skills = [{ gem: { slug: 'spark' }, level: null, supports: [] }];
  b.grantedSupports = { 'tabula-rasa:arc': [{ slug: 'martial-tempo' }] };
  const out = buildToBuildFile(b, ctx({
    grantedRows: () => [{ key: 'tabula-rasa:arc', item: { kind: 'unique', slug: 'tabula-rasa' },
                          skill: 'arc', supports: [{ slug: 'martial-tempo' }] }],
  }));
  assert.deepEqual(out.skills.map((s) => s.id),
    ['Metadata/Items/Gems/SkillGemSpark', 'Metadata/Items/Gem/SkillGemArc']);
  assert.deepEqual(out.skills[1].support_skills, [{ id: 'Metadata/Items/Gems/SupportGemMartialTempo' }]);
});

test('a unique slot exports unique_name; a planned base exports numbered hints', () => {
  const b = mk({ name: 'X' });
  b.gear.body = { item: { kind: 'unique', slug: 'tabula-rasa' }, mods: [], corrupted: null };
  b.gear.helmet = { item: { kind: 'base', slug: 'ancestral-tiara' }, corrupted: null,
    mods: [{ affix: 'maximum_life', tier: 'MaximumLife7' },
           { affix: 'lightning_resistance', tier: 'LightningResistance5' }] };
  const out = buildToBuildFile(b, ctx());
  const bySlot = Object.fromEntries(out.inventory_slots.map((s) => [s.inventory_id, s]));

  assert.deepEqual(bySlot.BodyArmour1, { inventory_id: 'BodyArmour1', slot_x: 0, slot_y: 0, unique_name: 'Tabula Rasa' });
  assert.equal(bySlot.Helm1.additional_text,
    'Ancestral Tiara\n1. +(90-99) to maximum Life\n2. +(36-41)% to Lightning Resistance');
  assert.ok(!('unique_name' in bySlot.Helm1));
});

test('a base with no chosen mods still names the base', () => {
  const b = mk({ name: 'X' });
  b.gear.helmet = { item: { kind: 'base', slug: 'ancestral-tiara' }, mods: [], corrupted: null };
  const out = buildToBuildFile(b, ctx());
  assert.equal(out.inventory_slots[0].additional_text, 'Ancestral Tiara');
});

test('a corrupted implicit on a unique is spelled out in additional_text', () => {
  const b = mk({ name: 'X' });
  b.gear.body = { item: { kind: 'unique', slug: 'tabula-rasa' }, mods: [],
                  corrupted: { affix: 'maximum_life', tier: 'MaximumLife7' } };
  const out = buildToBuildFile(b, ctx());
  const slot = out.inventory_slots[0];
  assert.equal(slot.unique_name, 'Tabula Rasa');
  assert.match(slot.additional_text, /Corrupted/);
  assert.match(slot.additional_text, /\+\(90-99\) to maximum Life/);
});

test('empty and item-less gear cells produce no inventory slot', () => {
  const b = mk({ name: 'X' });
  b.gear.helmet = { item: null, mods: [], corrupted: null };
  b.gear.nonsense_slot = { item: { kind: 'base', slug: 'ancestral-tiara' }, mods: [], corrupted: null };
  assert.deepEqual(buildToBuildFile(b, ctx()).inventory_slots, [],
    'an unmapped slot id is skipped, never emitted with a bogus inventory_id');
});

test('SLOT_TO_INVENTORY covers every planner slot exactly once', () => {
  const planner = JSON.parse(fs.readFileSync(path.join(GEN, 'planner-data.json'), 'utf8'));
  for (const s of planner.slots) {
    assert.ok(SLOT_TO_INVENTORY[s.id], `slot ${s.id} has no inventory_id mapping`);
  }
  const vals = Object.values(SLOT_TO_INVENTORY);
  assert.equal(new Set(vals).size, vals.length, 'inventory ids must be unique');
});

test('passives follow notablePriority order, then the rest', () => {
  const b = mk({ name: 'X' });
  b.tree = {
    code: encode(synth({ allocated: [100, 200, 300], ascByte: 0 })),
    notablePriority: [300, 100],
  };
  const out = buildToBuildFile(b, ctx());
  assert.deepEqual(out.passives.map((p) => p.id), ['criticals86', 'spells18', 'cast_speed10']);
});

test('weapon-set passives carry weapon_set 1 or 2', () => {
  const b = mk({ name: 'X' });
  b.tree = {
    code: encode(synth({ allocated: [100], ws1: [200], ws2: [300], ascByte: 0 })),
    notablePriority: [],
  };
  const out = buildToBuildFile(b, ctx());
  const byId = Object.fromEntries(out.passives.map((p) => [p.id, p]));
  assert.equal(byId.spells18.weapon_set, undefined, 'main-tree nodes carry no weapon_set');
  assert.equal(byId.cast_speed10.weapon_set, 1);
  assert.equal(byId.criticals86.weapon_set, 2);
});

test('hashes with no known passive id are skipped', () => {
  const b = mk({ name: 'X' });
  b.tree = { code: encode(synth({ allocated: [100, 99999], ascByte: 0 })), notablePriority: [] };
  assert.deepEqual(buildToBuildFile(b, ctx()).passives.map((p) => p.id), ['spells18']);
});

test('no tree code yields no passives and does not throw', () => {
  const out = buildToBuildFile(mk({ name: 'X' }), ctx());
  assert.deepEqual(out.passives, []);
});

test('an undecodable tree code degrades to no passives instead of throwing', () => {
  const b = mk({ name: 'X' });
  b.tree = { code: 'not-a-real-code', notablePriority: [] };
  assert.deepEqual(buildToBuildFile(b, ctx()).passives, []);
});

test('buildFileName sanitizes and extends', () => {
  assert.equal(buildFileName('Stormweaver Arc'), 'Stormweaver Arc.build');
  assert.equal(buildFileName('Lv 1-30 / "early"'), 'Lv 1-30 _early_.build');
  assert.equal(buildFileName('   '), 'build.build');
  assert.ok(buildFileName('x'.repeat(200)).length <= 66);
});

// ---- conformance against the real files -----------------------------------

test('our output shape is a subset of the real fixtures\' shape', () => {
  const real = JSON.parse(fs.readFileSync(path.join(FIX, 'mobalytics-frostwall-gem-setup.build'), 'utf8'));
  const b = mk({ name: 'X', ascendancy: 'stormweaver' });
  b.gear.body = { item: { kind: 'unique', slug: 'tabula-rasa' }, mods: [], corrupted: null };
  b.gear.helmet = { item: { kind: 'base', slug: 'ancestral-tiara' },
    mods: [{ affix: 'maximum_life', tier: 'MaximumLife7' }], corrupted: null };
  b.skills = [{ gem: { slug: 'spark' }, level: null, supports: [{ slug: 'martial-tempo' }] }];
  b.tree = { code: encode(synth({ allocated: [100], ws1: [200], ascByte: 0 })), notablePriority: [] };
  const out = buildToBuildFile(b, ctx());

  const rootKeys = new Set(Object.keys(real).concat(['description']));
  for (const k of Object.keys(out)) assert.ok(rootKeys.has(k), `root key ${k} is not in the real format`);

  const slotKeys = new Set(real.inventory_slots.flatMap(Object.keys));
  for (const s of out.inventory_slots) {
    for (const k of Object.keys(s)) assert.ok(slotKeys.has(k), `inventory_slot key ${k} is not in the real format`);
  }
  const skillKeys = new Set(real.skills.flatMap((s) => Object.keys(s)));
  for (const s of out.skills) {
    for (const k of Object.keys(s)) assert.ok(skillKeys.has(k), `skill key ${k} is not in the real format`);
  }
  const passiveKeys = new Set(real.passives.flatMap(Object.keys));
  for (const p of out.passives) {
    for (const k of Object.keys(p)) assert.ok(passiveKeys.has(k), `passive key ${k} is not in the real format`);
  }
});

test('exporting with the REAL id maps emits ids the game itself uses', () => {
  const b = mk({ name: 'Real Ids', ascendancy: 'infernalist' });
  b.skills = [{ gem: { slug: 'spark' }, level: null, supports: [] }];
  const out = buildToBuildFile(b, ctx({ ids: realIds() }));
  assert.equal(out.ascendancy, 'Witch1');
  assert.match(out.skills[0].id, /^Metadata\/[Ii]tems\/Gems?\/SkillGem/);
});
