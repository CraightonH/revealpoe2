import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeMerge, resolveQuality, buildSections, buildLevelTable, buildScalingSections, buildQualityTable, buildGemQualityTable, qualitySkeleton, qualityTokenCount } from '../src/data/statText.js';
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

test('buildScalingSections emits a varying "Base Damage" line for a damage_multiplier-only skill', () => {
  // Volcanic Steps scales ONLY via damage_multiplier (60 → 245) with no per-level
  // stat_text, so without a Base Damage line the card body never changes with level.
  const skills = loadJson('repoe-poe2/skills.json');
  const secs = buildScalingSections(skills['AncestralCryShockwavePlayer'], 40);
  const line = secs.flatMap((s) => s.lines).find((l) => l.segs && /Base Damage/.test(l.segs.join('')));
  assert.ok(line, 'expected a varying Base Damage line');
  assert.deepEqual(line.byLevel[1], ['60']);
  assert.deepEqual(line.byLevel[20], ['245']);
});

test('buildScalingSections omits a constant damage_multiplier', () => {
  const secs = buildScalingSections({
    stat_sets: [{ per_level: { 1: { damage_multiplier: 100 }, 2: { damage_multiplier: 100 } } }],
  }, 40);
  const line = secs.flatMap((s) => s.lines).find((l) => /Base Damage/.test((l.segs ?? [l.text]).join('')));
  assert.equal(line, undefined);
});

test('buildQualityTable shows only true breakpoints for a floored count (Arc)', () => {
  const skills = loadJson('repoe-poe2/skills.json');
  const t = buildQualityTable(skills['ArcPlayer']);
  assert.ok(t, 'expected a quality table');

  // single quality column; header keeps markup and blanks the number
  assert.equal(t.columns.length, 1);
  const col = t.columns[0];
  assert.equal(col.kind, 'quality');
  assert.equal(col.header, '[Chain|Chains] _ times');

  // chains = floor(Q/10): a breakpoint every 10% → rows are exactly 100,90,…,10 (no
  // rows between breakpoints), descending.
  assert.deepEqual(t.rows.map((r) => r.quality), [100, 90, 80, 70, 60, 50, 40, 30, 20, 10]);
  const at = (q) => t.rows.find((r) => r.quality === q);
  assert.equal(at(10).cells[col.key], '1');
  assert.equal(at(20).cells[col.key], '2');
  assert.equal(at(100).cells[col.key], '10');
});

test('buildQualityTable emits a complete per-column step series (Arc chains = floor(Q/10))', () => {
  const skills = loadJson('repoe-poe2/skills.json');
  const t = buildQualityTable(skills['ArcPlayer']);
  const col = t.columns[0].key;
  // Change-points only, ascending, first entry = first Q above the 0% baseline.
  assert.deepEqual(t.series[col], [
    [10, '1'], [20, '2'], [30, '3'], [40, '4'], [50, '5'],
    [60, '6'], [70, '7'], [80, '8'], [90, '9'], [100, '10'],
  ]);
  // The series agrees with the display rows at every breakpoint (single source of truth).
  for (const r of t.rows) {
    const pt = t.series[col].filter(([q]) => q <= r.quality).pop();
    assert.equal(pt[1], r.cells[col], `series and row disagree at ${r.quality}%`);
  }
});

test('buildGemQualityTable series aligns with the merged rows at every breakpoint', () => {
  const skills = loadJson('repoe-poe2/skills.json');
  const t = buildGemQualityTable([{ skill: skills['ArcPlayer'], name: 'Arc', altStats: [] }]);
  assert.ok(t.series && Object.keys(t.series).length === t.columns.length);
  for (const col of t.columns.map((c) => c.key)) {
    for (const r of t.rows) {
      const pt = (t.series[col] ?? []).filter(([q]) => q <= r.quality).pop();
      if (r.cells[col] != null) assert.equal(pt?.[1], r.cells[col]);
    }
  }
});

test('qualitySkeleton / qualityTokenCount map a resolved line to its table column', () => {
  const line = '[Chain|Chains] (0—2) times';
  assert.equal(qualitySkeleton(line), '[Chain|Chains] _ times');
  assert.equal(qualityTokenCount(line), 1);
  // negative (negate handler) and multi-token lines
  assert.equal(qualitySkeleton('Bells appear within (0—-0.4) metre radius of you'),
    'Bells appear within _ metre radius of you');
  assert.equal(qualityTokenCount('Deals (0—3) to (0—5) Fire'), 2);
  assert.equal(qualityTokenCount('Gain an additional random Charge'), 0);
});

test('buildQualityTable uses the coarse 5% grid with expandable bands for a smooth gem (Archmage)', () => {
  const skills = loadJson('repoe-poe2/skills.json');
  const t = buildQualityTable(skills['ArchmagePlayer']);
  assert.ok(t, 'expected a quality table');

  const col = t.columns[0];
  assert.equal(col.header, '_% increased [Reservation] [Efficiency]');
  const at = (q) => t.rows.find((r) => r.quality === q);

  // no steppy count → coarse rows every 5%, descending; 0.5%/1% floored to integer %
  assert.deepEqual(t.rows.map((r) => r.quality),
    [100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5]);
  assert.equal(at(20).cells[col.key], '10');
  assert.equal(at(100).cells[col.key], '50');
  // the 20% row's band holds the off-grid breakpoints between 15% and 20% — 18→9 and
  // 16→8 — skipping 17/19 which add only ½% and don't tick the floored value. Descending,
  // matching the surrounding table.
  assert.deepEqual((at(20).band ?? []).map((b) => `${b.quality}:${b.cells[col.key]}`), ['18:9', '16:8']);
});

test('buildQualityTable floors a distance stat to tenths, a row every 5% (Fragments)', () => {
  const skills = loadJson('repoe-poe2/skills.json');
  const t = buildQualityTable(skills['FragmentsOfThePastPlayer']);
  assert.ok(t, 'expected a quality table');
  const col = t.columns[0];
  assert.equal(col.header, 'Eruption radius is _ metres');
  const at = (q) => t.rows.find((r) => r.quality === q);
  // 0.1 metre per 5% (divide_by_ten_1dp) → a breakpoint exactly every 5%
  assert.deepEqual(t.rows.map((r) => r.quality), [100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5]);
  assert.equal(at(5).cells[col.key], '0.1');
  assert.equal(at(20).cells[col.key], '0.4');
  assert.equal(at(100).cells[col.key], '2');
});

test('buildQualityTable blanks base-skill reference tokens (Arctic Armour)', () => {
  const skills = loadJson('repoe-poe2/skills.json');
  const t = buildQualityTable(skills['ArcticArmourPlayer']);
  assert.ok(t, 'expected a quality table');
  // the frequency token carries no quality value → blanked; only max-Stages scales
  const col = t.columns[0];
  assert.equal(col.header, 'Gains a Stage every  seconds, up to a maximum of _ Stages');
  const at = (q) => t.rows.find((r) => r.quality === q);
  // 50 permille → floor(Q/20): a breakpoint every 20%, rows 100,80,60,40,20
  assert.deepEqual(t.rows.map((r) => r.quality), [100, 80, 60, 40, 20]);
  assert.equal(at(20).cells[col.key], '1');
  assert.equal(at(40).cells[col.key], '2');
});

test('a steppy gem shows a sparse alt effect’s own breakpoints as rows', () => {
  // count (chains, every 10%) + a slow % alt (0.2%/1% → a step every 5%): the alt is
  // sparse enough to be discrete, so its off-count breakpoints (5,15,25…) become rows.
  const t = buildGemQualityTable([{
    skill: { stat_sets: [{ static: { quality_stats: [{ stat: '[Chain|Chains] {number_of_chains} times', stats: { number_of_chains: 100 } }] } }] },
    name: 'X',
    altStats: [{ stat: '{x}% more Damage', stats: { x: 200 } }],
  }]);
  assert.ok(t);
  const qs = t.rows.map((r) => r.quality);
  assert.ok(qs.includes(5) && qs.includes(15) && qs.includes(25), `alt breakpoints missing: ${qs}`);
  assert.ok(t.rows.every((r) => !r.band), 'steppy gem → no bands');
});

test('a steppy gem samples a dense alt effect instead of letting it flood the rows', () => {
  // count (chains, every 10%) + a dense % alt (1%/1% → a step every 1%): the alt is too
  // dense to drive rows, so rows stay at the chain breakpoints and the alt is sampled.
  const t = buildGemQualityTable([{
    skill: { stat_sets: [{ static: { quality_stats: [{ stat: '[Chain|Chains] {number_of_chains} times', stats: { number_of_chains: 100 } }] } }] },
    name: 'X',
    altStats: [{ stat: '{y}% more Damage', stats: { y: 1000 } }],
  }]);
  assert.ok(t);
  assert.deepEqual(t.rows.map((r) => r.quality), [100, 90, 80, 70, 60, 50, 40, 30, 20, 10]);
  const altCol = t.columns.find((c) => c.kind === 'alt-quality');
  assert.equal(t.rows.find((r) => r.quality === 20).cells[altCol.key], '20'); // sampled: 1×20
});

test('buildQualityTable returns null when no quality stat varies', () => {
  assert.equal(buildQualityTable({ stat_sets: [] }), null);
  // permille 0 → constant across all quality → skipped
  assert.equal(buildQualityTable({
    stat_sets: [{ static: { quality_stats: [{ stat: 'Nothing {x} here', stats: { x: 0 } }] } }],
  }), null);
});

test('buildGemQualityTable captions columns when two skills each scale (Fragments of the Past)', () => {
  const skills = loadJson('repoe-poe2/skills.json');
  const t = buildGemQualityTable([
    { skill: skills['FragmentsOfThePastPlayer'], name: 'Fragments of the Past' },
    { skill: skills['FragmentsOfThePastFragmentPlayer'], name: 'Ice Fragments' },
  ]);
  assert.ok(t);
  // two radius columns (one per skill) + the Fragments-of-the-Past alt-quality duration
  const std = t.columns.filter((c) => c.kind === 'quality');
  assert.deepEqual(std.map((c) => c.header).sort(),
    ['Eruption radius is _ metres', 'Explosion radius is _ metres']);
  // every standard column carries its granting skill's caption
  assert.deepEqual(std.map((c) => c.skill).sort(), ['Fragments of the Past', 'Ice Fragments']);
});

test('buildGemQualityTable folds in Gemling alt-quality effects as tagged columns (Archmage)', () => {
  const skills = loadJson('repoe-poe2/skills.json');
  const t = buildGemQualityTable([{
    skill: skills['ArchmagePlayer'],
    name: 'Archmage',
    altStats: [
      { stat: 'Non-Channelling Spells Gain {a}% of Damage as extra Lightning', stats: { a: 50 } },
      { stat: 'Non-Channelling Spells cost an additional {b/divide_by_one_hundred_2dp_if_required}% of your maximum Mana', stats: { b: 10000 } },
    ],
  }]);
  assert.ok(t);
  const alt = t.columns.filter((c) => c.kind === 'alt-quality');
  assert.equal(alt.length, 2, 'two alt-quality columns');
  const at = (q) => t.rows.find((r) => r.quality === q);
  const gain = alt.find((c) => /extra Lightning/.test(c.header));
  const cost = alt.find((c) => /maximum Mana/.test(c.header));
  assert.equal(at(20).cells[gain.key], '1'); // 50/1000 × 20 = 1, floored
  assert.equal(at(20).cells[cost.key], '2'); // 10000/1000 × 20 / 100 = 2
});

test('buildGemQualityTable drops dummy/empty skills and omits captions for a single scaler (Explosive Shot)', () => {
  const skills = loadJson('repoe-poe2/skills.json');
  const t = buildGemQualityTable([
    { skill: skills['ExplosiveShotAmmoPlayer'], name: 'Load Explosive Shot' }, // dummy-only → dropped
    { skill: skills['ExplosiveShotPlayer'], name: 'Explosive Shot' },
  ]);
  assert.ok(t);
  const std = t.columns.filter((c) => c.kind === 'quality');
  assert.equal(std.length, 1); // only the ignite-magnitude effect (deduped)
  assert.equal(std[0].skill, undefined); // single contributor → no caption
});
