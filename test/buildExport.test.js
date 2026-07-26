// test/buildExport.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildExportIds } from '../src/data/buildExport.js';
import { plannerData } from '../src/data/planner.js';

const GEN = path.join(import.meta.dirname, '..', 'public', 'generated');

test('gemIds map every gem slug to a Metadata item id', () => {
  const { gemIds } = buildExportIds();
  const entries = Object.entries(gemIds);
  assert.ok(entries.length > 900, `expected >900 gems, got ${entries.length}`);
  for (const [slug, id] of entries) {
    assert.match(id, /^Metadata\/[Ii]tems\/Gems?\//, `${slug} -> ${id}`);
  }
});

test('gemIds preserve the authentic Gem/ vs Gems/ prefix per gem', () => {
  // Our source has 593 gems under each prefix and the sets are DISJOINT, so
  // normalizing either way would emit ids the game does not know.
  const { gemIds } = buildExportIds();
  const ids = Object.values(gemIds);
  assert.ok(ids.some((id) => id.startsWith('Metadata/Items/Gem/')), 'some gems are under Gem/');
  assert.ok(ids.some((id) => id.startsWith('Metadata/Items/Gems/')), 'some gems are under Gems/');
});

test('gemIds resolve the gems named in the real .build fixtures', () => {
  const { gemIds } = buildExportIds();
  // slug -> the id the game itself wrote in the fixture files.
  assert.equal(gemIds['power-siphon'], 'Metadata/Items/Gems/SkillGemPowerSiphon');
  assert.equal(gemIds['pinnacle-of-power'], 'Metadata/Items/Gem/SkillGemPinnacleOfPower');
  // A gem's slug and its metadata id routinely DISAGREE: PoE2 renames the
  // display name and keeps the original metadata id. SupportGemTwofold ships as
  // "Heightened Charges" today, so assert the id is reachable as a VALUE — never
  // assume a slug can be back-derived from the metadata id.
  const emitted = new Set(Object.values(gemIds));
  assert.ok(emitted.has('Metadata/Items/Gem/SupportGemTwofold'),
    'the id the fixtures use for Twofold must still be exportable');
  assert.equal(gemIds['heightened-charges'], 'Metadata/Items/Gem/SupportGemTwofold');
  assert.equal(gemIds['twofold'], undefined, 'no slug is invented to match a metadata id');
});

test('ascendancyIds map our slug to the GGG ascendancy id', () => {
  const { ascendancyIds } = buildExportIds();
  assert.equal(ascendancyIds['infernalist'], 'Witch1');
  assert.equal(ascendancyIds['blood-mage'], 'Witch2');
  assert.ok(Object.keys(ascendancyIds).length >= 20);
});

test('plannerData ascendancies carry the GGG id for export', () => {
  const { classes } = plannerData();
  const witch = classes.find((c) => c.slug === 'witch');
  const infernalist = witch.ascendancies.find((a) => a.slug === 'infernalist');
  assert.equal(infernalist.gggId, 'Witch1');
  for (const c of classes) for (const a of c.ascendancies) {
    assert.match(a.gggId, /^[A-Za-z]+\d+[a-z]?$/, `${c.slug}/${a.slug} -> ${a.gggId}`);
  }
});

test('the build-export artifact is written and matches the projector', () => {
  const disk = JSON.parse(fs.readFileSync(path.join(GEN, 'build-export.json'), 'utf8'));
  assert.deepEqual(disk, buildExportIds());
});

test('passive-build-ids maps tree hashes to PassiveSkills string ids', () => {
  const { passiveIds } = JSON.parse(fs.readFileSync(path.join(GEN, 'passive-build-ids.json'), 'utf8'));
  assert.ok(Object.keys(passiveIds).length > 5000, 'expected the full passive table');
  // Ids the real fixtures use must be present as values.
  const values = new Set(Object.values(passiveIds));
  for (const id of ['spells18', 'spell_criticals2__', 'witch_sorceress_notable1', 'cast_speed10']) {
    assert.ok(values.has(id), `fixture id ${id} is missing from passiveIds`);
  }
});

test('passive-build-ids covers essentially every renderable tree node', () => {
  const { passiveIds } = JSON.parse(fs.readFileSync(path.join(GEN, 'passive-build-ids.json'), 'utf8'));
  const tree = JSON.parse(fs.readFileSync(path.join(GEN, 'passive-tree.json'), 'utf8'));
  const missing = tree.nodes.filter((n) => !passiveIds[String(n.h)]);
  // The only known gap is a pair of unnamed Huntress3 filler nodes.
  assert.ok(missing.length <= 2, `unexpected unmapped nodes: ${JSON.stringify(missing.slice(0, 5))}`);
  for (const n of missing) assert.equal(n.name, '', `unmapped node ${n.h} has a name`);
});

test('every id in both real .build fixtures round-trips through our maps', () => {
  const { passiveIds } = JSON.parse(fs.readFileSync(path.join(GEN, 'passive-build-ids.json'), 'utf8'));
  const { gemIds } = buildExportIds();
  const knownPassives = new Set(Object.values(passiveIds));
  const knownGems = new Set(Object.values(gemIds));
  const dir = path.join(import.meta.dirname, 'fixtures', 'build-files');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.build'));
  assert.ok(files.length >= 1, 'no .build fixtures found');
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const p of j.passives) {
      assert.ok(knownPassives.has(p.id), `${f}: passive id ${p.id} unknown to us`);
    }
    // Full coverage since the gem slug-collision fix (scripts/graph/gems.js):
    // every gem id the game itself wrote must be exportable by us. A regression
    // here means a real gem lost its slug to a lookalike again.
    const gems = j.skills.flatMap((s) => [s.id, ...(s.support_skills ?? []).map((x) => x.id)]);
    const missing = [...new Set(gems.filter((id) => !knownGems.has(id)))];
    assert.deepEqual(missing, [], `${f}: gem ids the game uses but we cannot emit`);
  }
});
