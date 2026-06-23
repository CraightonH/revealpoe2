// test/graph/gems.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectGemRecords, gemNodes, skillNodes } from '../../scripts/graph/gems.js';
import { listGems } from '../../src/data/gems.js';
import { buildSections } from '../../src/data/statText.js';
import { loadJson } from '../../src/data/loader.js';
import { REPOE } from '../../src/config.js';

test('selectGemRecords reproduces the current gem slug set', () => {
  const graphSlugs = new Set(selectGemRecords().map((r) => r.slug));
  const appSlugs = new Set(listGems().map((g) => g.slug));
  assert.equal(graphSlugs.size, appSlugs.size, 'same number of gems');
  for (const s of appSlugs) assert.ok(graphSlugs.has(s), `graph missing slug ${s}`);
});

test('selectGemRecords keys nodes by source id and excludes DNT/garbage', () => {
  const recs = selectGemRecords();
  assert.ok(recs.every((r) => r.id.startsWith('Metadata/')), 'ids are source Metadata keys');
  assert.ok(!recs.some((r) => r.raw.base_item.display_name.includes('[DNT')), 'no DNT entries');
});

test('gemNodes carry resolved effect sections matching buildSections', () => {
  const { nodes, records } = gemNodes();
  assert.equal(nodes.length, records.length, 'one node per record');
  assert.ok(nodes.every((n) => n.kind === 'gem'));
  // Pick a gem that grants a skill, compare its effectSections to the source resolution.
  const skills = loadJson(`${REPOE}/skills.json`);
  const withSkill = records.find((r) => skills[r.raw.grants_skills?.[0]]);
  assert.ok(withSkill, 'expected at least one gem granting a skill');
  const node = nodes.find((n) => n.id === withSkill.id);
  const expected = buildSections(skills[withSkill.raw.grants_skills[0]], 20)
    .map((s) => ({ label: s.label, lines: s.lines, quality: s.quality }));
  assert.deepEqual(node.props.effectSections, expected);
  assert.ok(node.search.includes(node.name.toLowerCase()), 'search includes the name');
});

test('skillNodes are deduped and keyed by skill source key', () => {
  const { records } = gemNodes();
  const sNodes = skillNodes(records);
  const ids = sNodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate skill ids');
  assert.ok(sNodes.every((n) => n.kind === 'skill'));
});
