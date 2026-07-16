import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeMerge, resolveQuality, buildSections, buildLevelTable } from '../src/data/statText.js';
import { loadJson } from '../scripts/graph/loader.js';

test('rangeMerge combines differing numbers into a range', () => {
  assert.equal(
    rangeMerge(
      'Base [Ignite] damage is 16.67% of [Overkill] damage',
      'Base [Ignite] damage is 23% of [Overkill] damage'
    ),
    'Base [Ignite] damage is (16.67—23)% of [Overkill] damage'
  );
});

test('rangeMerge returns the string unchanged when numbers match', () => {
  assert.equal(rangeMerge('Explosion radius is 1.2 metres', 'Explosion radius is 1.2 metres'),
    'Explosion radius is 1.2 metres');
});

test('resolveQuality scales a no-handler count to max-quality value (Arc chains → 2)', () => {
  // Quality is per-mille-per-point; 100 / 50 = 2 at 20% quality (verified vs poe2db).
  const q = { stat: '[Chain|Chains] {number_of_chains} times', stats: { number_of_chains: 100 } };
  assert.equal(resolveQuality(q), '[Chain|Chains] (0—2) times');
});

test('resolveQuality composes ÷50 quality scaling with a unit handler (Herald overkill → 5%)', () => {
  // 15000 / 50 = 300, then per_minute_to_per_second (÷60) = 5 (verified vs poe2db).
  const q = {
    stat: 'An additional {x/per_minute_to_per_second_2dp_if_required}% of [Overkill] damage',
    stats: { x: 15000 },
  };
  assert.equal(resolveQuality(q), 'An additional (0—5)% of [Overkill] damage');
});

test('resolveQuality applies the milliseconds_to_seconds handler after ÷50', () => {
  // 75000 / 50 = 1500 ms, then ÷1000 = 1.5 s.
  const q = { stat: 'Adds {x/milliseconds_to_seconds_2dp_if_required} seconds', stats: { x: 75000 } };
  assert.equal(resolveQuality(q), 'Adds (0—1.5) seconds');
});

test('resolveQuality resolves the quality token and blanks base-skill references (Arctic Armour)', () => {
  // Two tokens; only the max-stacks stat carries a value (50/50 = 1). The frequency
  // token has no value in stats → blank, matching poe2db.
  const q = {
    stat: 'Gains a Stage every {base_active_skill_buff_stack_gain_frequency_ms/milliseconds_to_seconds_2dp_if_required} seconds, up to a maximum of {maximum_number_of_arctic_armour_stationary_stacks} Stages',
    stats: { maximum_number_of_arctic_armour_stationary_stacks: 50 },
  };
  assert.equal(resolveQuality(q), 'Gains a Stage every  seconds, up to a maximum of (0—1) Stages');
});

test('buildSections produces Buff and Explosion sections for Herald of Ash', () => {
  const gems = loadJson('repoe-poe2/skill_gems.json');
  const gem = Object.values(gems).find((g) => g.base_item?.display_name === 'Herald of Ash');
  const skills = loadJson('repoe-poe2/skills.json');
  const skill = skills[gem.grants_skills[0]];
  const sections = buildSections(skill, 20);

  const labels = sections.map((s) => s.label);
  assert.deepEqual(labels, ['Buff', 'Explosion']);

  const buff = sections[0];
  assert.ok(buff.lines.some((l) => /Overkill damage is at least 20%/.test(l)));

  const expl = sections[1];
  assert.ok(expl.lines.some((l) => l === 'Explosion radius is 1.2 metres'));
  assert.ok(expl.lines.some((l) => /\[Ignite\] duration is 3 seconds/.test(l)));
  assert.ok(expl.lines.some((l) => /\(16\.67—23\)%/.test(l))); // per-level range
});

test('buildLevelTable renders Fireball damage + mana columns, descending rows, cap on 20', () => {
  const skills = loadJson('repoe-poe2/skills.json');
  const t = buildLevelTable(skills['FireballPlayer']);
  assert.ok(t, 'expected a table');

  // cost column first, friendly header
  const cost = t.columns.find((c) => c.key === 'cost:Mana');
  assert.ok(cost && cost.kind === 'cost' && cost.header === 'Mana');

  // the varying fire-damage stat column, header with numbers blanked, markup intact
  const dmg = t.columns.find((c) => c.kind === 'stat');
  assert.equal(dmg.header, 'Deals _ to _ [Fire] Damage');

  // rows descending: highest level first, level 1 last
  assert.equal(t.rows[0].level, 40);
  assert.equal(t.rows[t.rows.length - 1].level, 1);

  // cap flag only on level 20
  const r20 = t.rows.find((r) => r.level === 20);
  const r19 = t.rows.find((r) => r.level === 19);
  assert.equal(r20.cap, true);
  assert.equal(r19.cap, false);

  // cell values: numbers joined by " / "
  const r1 = t.rows.find((r) => r.level === 1);
  assert.equal(r1.cells[dmg.key], '8 / 12');
  assert.equal(r1.cells['cost:Mana'], '10');
  assert.equal(r20.cells[dmg.key], '224 / 336');
  assert.equal(r20.cells['cost:Mana'], '104');
});

test('buildLevelTable maps per-minute cost kinds to friendly labels', () => {
  const t = buildLevelTable({
    per_level: { 1: { costs: { ManaPerMinute: 60 } }, 2: { costs: { ManaPerMinute: 120 } } },
    stat_sets: [],
  });
  const c = t.columns.find((x) => x.key === 'cost:ManaPerMinute');
  assert.equal(c.header, 'Mana / min');
  assert.equal(t.rows.find((r) => r.level === 2).cells['cost:ManaPerMinute'], '120');
});

test('buildLevelTable omits constant fields and returns null when nothing varies', () => {
  const t = buildLevelTable({
    per_level: { 1: { costs: { Mana: 5 } }, 2: { costs: { Mana: 5 } } },
    stat_sets: [{ per_level: {
      1: { stat_text: { k: 'Deals 5 damage' } },
      2: { stat_text: { k: 'Deals 5 damage' } },
    } }],
  });
  assert.equal(t, null);
});

test('buildLevelTable joins multiple numbers and falls back to raw text when a level has none', () => {
  const t = buildLevelTable({
    per_level: {},
    stat_sets: [{ per_level: {
      1: { stat_text: { w: 'Inflicts [Withered] on [HitDamage|Hit]' } },
      2: { stat_text: { w: 'Inflicts 3 [Withered] on [HitDamage|Hit]' } },
    } }],
  });
  const col = t.columns[0];
  // header from the highest (numbered) level, numbers blanked
  assert.equal(col.header, 'Inflicts _ [Withered] on [HitDamage|Hit]');
  assert.equal(t.rows.find((r) => r.level === 2).cells[col.key], '3');
  // level with no numbers keeps the raw (token-bearing) sentence
  assert.equal(t.rows.find((r) => r.level === 1).cells[col.key], 'Inflicts [Withered] on [HitDamage|Hit]');
});

test('buildLevelTable merges varying stats from a non-first stat_set (Herald of Ash)', () => {
  const skills = loadJson('repoe-poe2/skills.json');
  const t = buildLevelTable(skills['HeraldOfAshPlayer']);
  assert.ok(t, 'expected a table');
  // the varying line lives in the second (Explosion) stat_set
  assert.ok(t.columns.some((c) => c.kind === 'stat' && /Overkill/.test(c.header)));
});

test('buildLevelTable captures per-level damage_multiplier as a "Base Damage" % column', () => {
  // Volcanic Steps (Ancestral Cry's shockwave) scales ONLY via damage_multiplier
  // (60 → 245); it carries no per-level stat_text, so without this the table is null.
  const skills = loadJson('repoe-poe2/skills.json');
  const t = buildLevelTable(skills['AncestralCryShockwavePlayer']);
  assert.ok(t, 'expected a table for a damage_multiplier-only skill');
  const dmg = t.columns.find((c) => c.kind === 'damage');
  assert.ok(dmg, 'expected a damage column');
  assert.equal(dmg.header, 'Base Damage');
  // values rendered as percentages of base damage
  assert.equal(t.rows.find((r) => r.level === 1).cells[dmg.key], '60%');
  assert.equal(t.rows.find((r) => r.level === 20).cells[dmg.key], '245%');
});

test('buildLevelTable omits a constant damage_multiplier', () => {
  const t = buildLevelTable({
    per_level: {},
    stat_sets: [{ per_level: { 1: { damage_multiplier: 100 }, 2: { damage_multiplier: 100 } } }],
  });
  assert.equal(t, null);
});
