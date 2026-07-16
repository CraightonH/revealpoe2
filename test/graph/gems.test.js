// test/graph/gems.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectGemRecords, gemNodes, skillNodes, gemEdges } from '../../scripts/graph/gems.js';
import { getGem, getRecommendedSupports, listGems } from '../../src/data/gems.js';
import { buildSections } from '../../src/data/statText.js';
import { loadJson } from '../../scripts/graph/loader.js';
import { REPOE } from '../../scripts/graph/source.js';

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

test('multi-skill gem sections are labeled by granted-skill name when the stat_set has none', () => {
  // Ancestral Cry grants three distinct skills whose stat_sets have no label except
  // the primary ("Warcry"). The secondary skills must be labeled by their display
  // name so the three sections render distinctly. Regression for headless sections.
  const { nodes } = gemNodes();
  const ac = nodes.find((n) => n.kind === 'gem' && n.name === 'Ancestral Cry');
  assert.ok(ac, 'Ancestral Cry gem node exists');
  const labels = ac.props.effectSections.map((s) => s.label);
  assert.deepEqual(labels, ['Warcry', 'Volcanic Steps', 'Volcanic Eruption']);
});

test('reservation-pattern gems do not gain a header duplicating the gem name', () => {
  // Blink grants a Reservation variant + the active skill, both named "Blink".
  // Neither section should be labeled with the gem's own name.
  const { nodes } = gemNodes();
  const blink = nodes.find((n) => n.kind === 'gem' && n.name === 'Blink');
  assert.ok(blink, 'Blink gem node exists');
  assert.ok(
    !blink.props.effectSections.some((s) => (s.label || '').toLowerCase() === 'blink'),
    'no section labeled with the gem name',
  );
});

test('skillNodes are deduped and keyed by skill source key', () => {
  const { records } = gemNodes();
  const sNodes = skillNodes(records);
  const ids = sNodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate skill ids');
  assert.ok(sNodes.every((n) => n.kind === 'skill'));
});

test('recommends_support edges match the current app resolution (first gem)', () => {
  const { nodes, records } = gemNodes();
  const sNodes = skillNodes(records);
  const all = [...nodes, ...sNodes];
  const nodeIds = new Set(all.map((n) => n.id));
  const idToSlug = new Map(all.map((n) => [n.id, n.slug]));
  const edges = gemEdges(records, nodeIds);

  // Pick a gem known to have recommended supports.
  const rec = records.find((r) => (r.raw.recommended_supports ?? []).length);
  const graphTargets = edges
    .filter((e) => e.type === 'recommends_support' && e.from === rec.id)
    .map((e) => idToSlug.get(e.to))
    .sort();
  const appTargets = getRecommendedSupports(getGem(rec.slug))
    .flatMap((g) => g.supports)
    .map((s) => s.slug)
    .sort();
  assert.deepEqual(graphTargets, appTargets);
});

test('recommends_support edges match the current app resolution (all gems)', () => {
  const { nodes, records } = gemNodes();
  const sNodes = skillNodes(records);
  const all = [...nodes, ...sNodes];
  const nodeIds = new Set(all.map((n) => n.id));
  const idToSlug = new Map(all.map((n) => [n.id, n.slug]));
  const edges = gemEdges(records, nodeIds);

  for (const rec of records) {
    if (!(rec.raw.recommended_supports ?? []).length) continue;
    const gem = getGem(rec.slug);
    // If the app has no record for this slug (shouldn't happen given selectGemRecords
    // parity test), skip rather than silently mask — the slug parity test above
    // already guards this invariant.
    if (!gem) continue;
    const graphTargets = edges
      .filter((e) => e.type === 'recommends_support' && e.from === rec.id)
      .map((e) => idToSlug.get(e.to))
      .sort();
    const appTargets = getRecommendedSupports(gem)
      .flatMap((g) => g.supports)
      .map((s) => s.slug)
      .sort();
    assert.deepEqual(graphTargets, appTargets, `recommends_support mismatch for ${rec.slug}`);
  }
});

test('every edge endpoint resolves to a node (no dangling)', () => {
  const { nodes, records } = gemNodes();
  const sNodes = skillNodes(records);
  const nodeIds = new Set([...nodes, ...sNodes].map((n) => n.id));
  const edges = gemEdges(records, nodeIds);
  assert.ok(edges.length > 0);
  assert.ok(edges.every((e) => nodeIds.has(e.from) && nodeIds.has(e.to)));
});
