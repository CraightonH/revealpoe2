import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grantedSkillNames, uniqueNodes, uniqueEdges } from '../../scripts/graph/uniques.js';
import { baseNodes } from '../../scripts/graph/bases.js';
import { skillNodes, selectGemRecords } from '../../scripts/graph/gems.js';

test('grantedSkillNames is a non-empty Set of skill display names', () => {
  const names = grantedSkillNames();
  assert.ok(names instanceof Set);
  assert.ok(names.size > 50, `expected many granted skills, got ${names.size}`);
  // Guiding Palm grants "Purity of Fire" (a Level (1-20) grant — stripped to the bare name).
  assert.ok(names.has('Purity of Fire'), 'contains a known unique-granted skill');
});

test('uniqueNodes: one node per unique with the Unique/ id scheme', () => {
  const { nodes } = uniqueNodes();
  assert.ok(nodes.length > 300, `expected 300+ uniques, got ${nodes.length}`);
  const ids = new Set();
  for (const n of nodes) {
    assert.equal(n.kind, 'unique');
    assert.match(n.id, /^Unique\//, `id namespaced: ${n.id}`);
    assert.ok(!ids.has(n.id), `duplicate id ${n.id}`);
    ids.add(n.id);
    assert.ok(n.name && n.slug && n.props.base, `core fields on ${n.id}`);
    assert.ok(Array.isArray(n.props.variants) && n.props.variants.length > 0);
    assert.ok(n.props.currentIndex >= 0 && n.props.currentIndex < n.props.variants.length);
  }
});

test('uniqueNodes: Astramentis resolves metadata, class, icon, id', () => {
  const a = uniqueNodes().nodes.find((n) => n.slug === 'astramentis');
  assert.ok(a, 'Astramentis node present');
  assert.equal(a.id, 'Unique/Astramentis');        // meta.id form
  assert.equal(a.name, 'Astramentis');
  assert.equal(a.props.base, 'Stellar Amulet');
  assert.equal(a.props.className, 'Amulets');       // base canonical class
  assert.equal(a.props.classSlug, 'amulet');
  assert.match(a.props.iconDds, /Astramentis/);
});

test('uniqueNodes: The Anvil variant resolution picks the Current variant', () => {
  const anvil = uniqueNodes().nodes.find((n) => n.slug === 'the-anvil');
  assert.ok(anvil);
  assert.equal(anvil.props.variants.length, 3);
  assert.equal(anvil.props.currentIndex, 2);
  assert.equal(anvil.props.variants[2].name, 'Current');
  const cur = anvil.props.variants[anvil.props.currentIndex];
  assert.deepEqual(cur.implicits, ['+(30-40) to maximum Life']);
  assert.ok(cur.explicits.includes('25% increased Block chance'));
  assert.ok(cur.explicits.includes('+(5-10)% to maximum Block chance'));
  assert.ok(!cur.explicits.includes('20% increased Block chance'), 'legacy roll excluded');
});

test('uniqueNodes: Guiding Palm gates one Purity grant per variant', () => {
  const gp = uniqueNodes().nodes.find((n) => n.slug === 'guiding-palm');
  assert.ok(gp);
  assert.equal(gp.props.variants.length, 6);
  assert.equal(gp.props.currentIndex, 5);           // no "Current" token -> last
  assert.ok(!gp.props.variants.some((v) => v.name === 'Current'));
  const cur = gp.props.variants[5];
  const grants = [...cur.implicits, ...cur.explicits].filter((l) => l.startsWith('Grants Skill:'));
  assert.equal(grants.length, 1, 'exactly one Purity grant on the current variant');
  assert.match(grants[0], /Purity of Lightning/);
});

test('uniqueNodes: search is current-variant only, lowercased', () => {
  const anvil = uniqueNodes().nodes.find((n) => n.slug === 'the-anvil');
  assert.ok(anvil.search.includes('25% increased block chance'));
  assert.ok(!anvil.search.includes('20% increased block chance'), 'legacy roll not searchable');
  assert.ok(anvil.search.includes('the anvil') && anvil.search.includes('bloodstone amulet'));
});

test('uniqueEdges: has_base only targets browsable base nodes', () => {
  const { records } = uniqueNodes();
  const { nodes: bNodes, records: baseRecs } = baseNodes();
  const baseIds = new Set(bNodes.map((n) => n.id));
  const skl = skillNodes(selectGemRecords());

  const edges = uniqueEdges(records, baseRecs, skl);
  const hasBase = edges.filter((e) => e.type === 'has_base');
  assert.ok(hasBase.length > 200, `most uniques sit on a browsable base, got ${hasBase.length}`);
  for (const e of hasBase) assert.ok(baseIds.has(e.to), `has_base target ${e.to} is a base node`);

  // Astramentis (Stellar Amulet) has a has_base edge; so does a jewel unique now
  // that charm/flask/jewel bases are browsable (The Adorned -> Diamond).
  const astra = records.find((r) => r.slug === 'astramentis');
  assert.ok(hasBase.some((e) => e.from === astra.id), 'Astramentis -> Stellar Amulet');
  const adorned = records.find((r) => r.slug === 'the-adorned'); // Diamond (jewel) base
  assert.ok(adorned, 'fixture present');
  const adornedBase = hasBase.find((e) => e.from === adorned.id);
  assert.ok(adornedBase, 'jewel unique now has a has_base edge');
  assert.ok(baseIds.has(adornedBase.to), 'and it targets a real base node');
});

test('uniqueEdges: grants resolve to skill nodes with zero dangling', () => {
  const { records } = uniqueNodes();
  const { records: baseRecs } = baseNodes();
  const skl = skillNodes(selectGemRecords());
  const skillIds = new Set(skl.map((n) => n.id));
  const skillBySlug = new Map(skl.map((n) => [n.slug, n.id]));

  const edges = uniqueEdges(records, baseRecs, skl);
  const grants = edges.filter((e) => e.type === 'grants');
  assert.ok(grants.length > 50, `many grants edges, got ${grants.length}`);
  for (const e of grants) assert.ok(skillIds.has(e.to), `grants target ${e.to} is a skill node`);

  // Guiding Palm's current (Lightning) variant grants Purity of Lightning.
  const gp = records.find((r) => r.slug === 'guiding-palm');
  const want = skillBySlug.get('purity-of-lightning');
  assert.ok(want, 'Purity of Lightning skill node exists');
  assert.ok(grants.some((e) => e.from === gp.id && e.to === want), 'Guiding Palm -> Purity of Lightning');
});

test('uniqueEdges: grants carry the variant index that grants each skill', () => {
  const { records } = uniqueNodes();
  const { records: baseRecs } = baseNodes();
  const skl = skillNodes(selectGemRecords());
  const skillBySlug = new Map(skl.map((n) => [n.slug, n.id]));

  const edges = uniqueEdges(records, baseRecs, skl);
  const grants = edges.filter((e) => e.type === 'grants');
  for (const e of grants) {
    assert.equal(typeof e.props?.variantIndex, 'number', `grants edge ${e.from}->${e.to} has a variantIndex`);
  }

  // The Unborn Lich: His Vile Intrusion is gated to a single non-default variant;
  // the edge must point at that variant, not the default (which grants only Feast
  // of Flesh). Feast of Flesh is granted by every variant including the default,
  // so its edge keeps the default (currentIndex).
  const lich = records.find((r) => r.slug === 'the-unborn-lich');
  const node = uniqueNodes().nodes.find((n) => n.slug === 'the-unborn-lich');
  const vile = skillBySlug.get('his-vile-intrusion');
  const vileEdge = grants.find((e) => e.from === lich.id && e.to === vile);
  assert.ok(vileEdge, 'The Unborn Lich -> His Vile Intrusion edge exists');
  const vileVariant = node.props.variants[vileEdge.props.variantIndex];
  assert.ok(
    [...vileVariant.implicits, ...vileVariant.explicits].some((l) => l.includes('His Vile Intrusion')),
    'the edge variant actually grants His Vile Intrusion',
  );

  const feast = skillBySlug.get('feast-of-flesh');
  const feastEdge = grants.find((e) => e.from === lich.id && e.to === feast);
  assert.ok(feastEdge, 'The Unborn Lich -> Feast of Flesh edge exists');
  assert.equal(feastEdge.props.variantIndex, node.props.currentIndex,
    'Feast of Flesh (granted by the default variant) keeps the default variant');
});

// --- Name reconciliation against RePoE ---------------------------------------
// Some PoB blocks concatenate the base onto the name line ("Waistgate Heavy Belt"
// over base "Heavy Belt"). Taken verbatim the RePoE metadata join misses, so the
// node loses vid/icon/flavour/inventorySize AND the vid-keyed overlays can never
// attach. The repair is source-anchored: strip the trailing base only when that
// yields a name RePoE actually ships.
test('uniqueNodes: a PoB name line with the base appended resolves to the RePoE name', () => {
  const { nodes } = uniqueNodes();
  const wg = nodes.find((n) => n.name === 'Waistgate');
  assert.ok(wg, 'Waistgate is built under its RePoE name, not "Waistgate Heavy Belt"');
  assert.equal(wg.slug, 'waistgate');
  assert.equal(wg.props.base, 'Heavy Belt');
  // The whole point of the repair: the RePoE join now lands.
  assert.ok(wg.props.vid, 'vid resolved from RePoE uniques.json');
  assert.ok(wg.props.iconDds, 'icon resolved');
  assert.ok(wg.props.inventorySize, 'inventory size resolved');
  assert.ok(!nodes.some((n) => n.name === 'Waistgate Heavy Belt'), 'no name+base artifact node');
});

test('uniqueNodes: every built node joins RePoE metadata (no silent degradation)', () => {
  const { nodes } = uniqueNodes();
  // A node with no vid means the name line didn't match any RePoE unique — the
  // failure mode that hid Waistgate. Guard it globally so the next PoB quirk of
  // this shape fails the test instead of shipping a placeholder-icon page.
  const unjoined = nodes.filter((n) => !n.props.vid).map((n) => n.name);
  assert.deepEqual(unjoined, [], `every unique should join RePoE metadata; unjoined: ${unjoined.join(', ')}`);
});
