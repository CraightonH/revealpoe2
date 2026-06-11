import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeMerge, resolveQuality, buildSections } from '../src/data/statText.js';
import { loadJson } from '../src/data/loader.js';

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

test('resolveQuality drops implausible percentage values', () => {
  // per_minute_to_per_second_2dp divides by 60 -> 15000/60 = 250 (>100) -> null
  const q = {
    stat: 'An additional {x/per_minute_to_per_second_2dp_if_required}% of [Overkill] damage',
    stats: { x: 15000 },
  };
  assert.equal(resolveQuality(q), null);
});

test('resolveQuality renders a plausible range', () => {
  const q = {
    stat: '{q/divide_by_ten_1dp_if_required}% increased [Fire] damage',
    stats: { q: 200 }, // 200/10 = 20 -> plausible
  };
  assert.equal(resolveQuality(q), '(0—20)% increased [Fire] damage');
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
