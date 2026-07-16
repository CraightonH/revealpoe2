// test/graph/gemQuality.test.js — Gemling Legionnaire alternate quality.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { altQualityLines, altQualityStats, loadAltQuality } from '../../scripts/graph/gemQuality.js';
import { gemNodes } from '../../scripts/graph/gems.js';
import { loadJson } from '../../scripts/graph/loader.js';
import { REPOE } from '../../scripts/graph/source.js';

// Resolve the per-set translation_file for a skill (mirrors gems.js).
function tfOf(skillKey, setIndex) {
  const skills = loadJson(`${REPOE}/skills.json`);
  return skills[skillKey]?.stat_sets?.[setIndex]?.translation_file ?? null;
}

test('altQualityLines renders a known alt effect at max (20%) quality', () => {
  // Canary skill: KillingPalm's alt quality recovers Life on Cull (500 permille → /50 = 10%).
  const lines = altQualityLines('KillingPalmPlayer', 0, tfOf('KillingPalmPlayer', 0));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Recover \(0—10\)% of maximum Life/);
  assert.match(lines[0], /on \[CullingStrike\|Culling\] an Enemy/);
});

test('altQualityLines uses active-skill phrasing, not support-gem phrasing', () => {
  // number_of_chains has both "Chains N times" (active) and "Supported Skills Chain N
  // times" (support) descriptions; the active form must win for a skill's own quality.
  const lines = altQualityLines('EssenceDrainPlayer', 0, tfOf('EssenceDrainPlayer', 0));
  assert.ok(lines.some((l) => /\[Chain\|Chains\] \(0—4\) times/.test(l)), `got: ${JSON.stringify(lines)}`);
  assert.ok(!lines.some((l) => /Supported Skills/.test(l)), 'no support-gem phrasing');
});

test('altQualityLines returns [] for a skill without alt quality', () => {
  assert.deepEqual(altQualityLines('NonexistentSkillKey', 0, null), []);
});

test('altQualityLines resolves stats that live only in the per-skill translation file', () => {
  // Regression: specificIdx used to drop the specific_skill_stat_descriptions/ subdir,
  // so skill-only stats (archmage_*) never resolved and Archmage showed no alt quality.
  const lines = altQualityLines('ArchmagePlayer', 0, tfOf('ArchmagePlayer', 0));
  assert.ok(lines.some((l) => /extra \[Lightning\] damage for each 100 maximum Mana/.test(l)), `got: ${JSON.stringify(lines)}`);
  assert.ok(lines.some((l) => /cost an additional \(0—2\)% of your maximum Mana/.test(l)));
});

test('altQualityStats returns parseable { stat, stats } objects for the table', () => {
  const stats = altQualityStats('ArchmagePlayer', 0, tfOf('ArchmagePlayer', 0));
  assert.equal(stats.length, 2);
  for (const s of stats) {
    assert.equal(typeof s.stat, 'string');
    assert.ok(s.stat.includes('{'), 'keeps the scaling token for per-quality resolution');
    assert.ok(Object.keys(s.stats).length >= 1);
  }
});

test('generated overlay covers a broad set of skills and is well-formed', () => {
  const data = loadAltQuality();
  const keys = Object.keys(data);
  assert.ok(keys.length > 100, `expected many skills with alt quality, got ${keys.length}`);
  for (const entries of Object.values(data)) {
    for (const e of entries) {
      assert.equal(typeof e.set, 'number');
      assert.ok(Array.isArray(e.stats) && e.stats.length);
      for (const s of e.stats) {
        assert.equal(typeof s.id, 'string');
        assert.equal(typeof s.permille, 'number');
      }
    }
  }
});

test('gem nodes carry alt quality attached to the correct stat set', () => {
  const { nodes } = gemNodes();
  // Fireball's alt quality targets the primary "Projectile" set only.
  const fireball = nodes.find((n) => n.kind === 'gem' && n.name === 'Fireball');
  assert.ok(fireball, 'Fireball gem node exists');
  const withAlt = fireball.props.effectSections.filter((s) => s.altQuality?.length);
  assert.equal(withAlt.length, 1, 'exactly one section carries alt quality');
  assert.equal(withAlt[0].label, 'Projectile');
  assert.ok(withAlt[0].altQuality.some((l) => /additional \[Projectile\|Projectiles\] in a circle/.test(l)));
});
