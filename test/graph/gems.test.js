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

// When two source gems share a display name AND gem_type they collide on one
// slug and only one can survive. Resolving that by source key order silently
// dropped REAL obtainable gems in favour of item-triggered lookalikes (Spark
// lost to SkillGemUniqueEarthboundTriggeredSpark). `crafting_types` is the
// signal: it is non-null exactly for gems you can obtain and level.
test('a slug collision keeps the craftable gem, not an item-triggered lookalike', () => {
  const byId = new Map(selectGemRecords().map((r) => [r.id, r]));
  const winner = (slug) => selectGemRecords().find((r) => r.slug === slug);

  assert.equal(winner('spark')?.id, 'Metadata/Items/Gems/SkillGemSpark',
    'the real Spark skill gem must win its slug');
  assert.ok(!byId.has('Metadata/Items/Gem/SkillGemUniqueEarthboundTriggeredSpark'),
    'the Earthbound triggered lookalike must not take the slug');

  assert.equal(winner('ember-fusillade')?.id, 'Metadata/Items/Gems/SkillGemEmberFusillade',
    'the real Ember Fusillade gem must win its slug');

  // Already-correct collisions must stay correct.
  assert.equal(winner('blink')?.id, 'Metadata/Items/Gem/SkillGemBlink');
  assert.equal(winner('withering-presence')?.id, 'Metadata/Items/Gem/SkillGemWitheringPresence');
  for (const el of ['ash', 'ice', 'thunder']) {
    const cap = el[0].toUpperCase() + el.slice(1);
    assert.equal(winner(`herald-of-${el}`)?.id, `Metadata/Items/Gems/SkillGemHeraldOf${cap}`);
  }
});

test('collision winners keep every id the manual overlays reference', () => {
  // data/manual/weapon-default-skills.json keys on metadata id and the build
  // enforces referential integrity, so deduping one of these away FAILS the
  // build. They are all collision winners (1HAxe vs 2HAxe vs AxeAxe, etc.).
  const ids = new Set(selectGemRecords().map((r) => r.id));
  for (const id of [
    'Metadata/Items/Gem/SkillGemPlayerDefault1HAxe',
    'Metadata/Items/Gem/SkillGemPlayerDefault1HMace',
    'Metadata/Items/Gem/SkillGemPlayerDefault1HSword',
    'Metadata/Items/Gem/SkillGemPlayerDefaultClaw',
    'Metadata/Items/Gem/SkillGemPlayerDefaultDagger',
    'Metadata/Items/Gem/SkillGemPlayerDefaultSpear',
  ]) {
    assert.ok(ids.has(id), `manual overlay reference ${id} was deduped away`);
  }
});

test('every gem slug is unique — one record per slug', () => {
  const slugs = selectGemRecords().map((r) => r.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate slugs would break nodeBySlug');
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
  // Compare the buildSections-derived fields; sections may additionally carry an
  // `altQuality` array (Gemling Legionnaire alt quality), sourced separately.
  const actual = node.props.effectSections.map((s) => ({ label: s.label, lines: s.lines, quality: s.quality }));
  assert.deepEqual(actual, expected);
  // Any altQuality present must be a non-empty array of strings.
  for (const s of node.props.effectSections) {
    if (s.altQuality !== undefined) {
      assert.ok(Array.isArray(s.altQuality) && s.altQuality.length, 'altQuality is a non-empty array when present');
      assert.ok(s.altQuality.every((l) => typeof l === 'string' && l), 'altQuality lines are non-empty strings');
    }
  }
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
