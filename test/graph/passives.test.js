import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passiveNodes, ascendancyNodes, passiveEdges } from '../../scripts/graph/passives.js';
import { gemNodes } from '../../scripts/graph/gems.js';

test('passiveNodes: one node per keystone/notable, Passive/ id scheme', () => {
  const { nodes } = passiveNodes();
  // 33 keystones + 984 notables + 320 ascendancy notables - 8 empty-name = 1329
  assert.equal(nodes.length, 1329, `expected 1329 passive nodes, got ${nodes.length}`);
  const ids = new Set();
  for (const n of nodes) {
    assert.equal(n.kind, 'passive');
    assert.match(n.id, /^Passive\//, `id namespaced: ${n.id}`);
    assert.ok(!ids.has(n.id), `duplicate id ${n.id}`);
    ids.add(n.id);
    assert.ok(n.name && n.slug, `name+slug on ${n.id}`);
    assert.ok(['keystone', 'notable'].includes(n.props.kind), `kind discriminator on ${n.id}`);
    assert.ok(Array.isArray(n.props.statLines));
    assert.ok(Array.isArray(n.props.reminderText));
  }
});

test('passiveNodes: empty-name passives are skipped', () => {
  const { nodes } = passiveNodes();
  assert.ok(!nodes.some((n) => n.slug === 'AscendancyRanger2Notable1'), 'unreleased Ranger2 placeholder dropped');
});

test('passiveNodes: Zealot\'s Oath keystone resolves stats (raw, no HTML)', () => {
  const z = passiveNodes().nodes.find((n) => n.slug === 'passive_keystone_zealots_oath');
  assert.ok(z, 'keystone present');
  assert.equal(z.id, 'Passive/passive_keystone_zealots_oath');
  assert.equal(z.name, "Zealot's Oath");
  assert.equal(z.props.kind, 'keystone');
  assert.equal(z.props.ascendancy, null);
  const joined = z.props.statLines.join('\n');
  assert.ok(joined.includes('Energy Shield') || joined.includes('[EnergyShield|Energy Shield]'));
  assert.ok(!joined.includes('<'), 'no rendered HTML in stored lines');
  assert.match(z.props.iconDds, /\.dds$/);
});

test('passiveNodes: Fast Acting Toxins notable substitutes the numeric value', () => {
  const n = passiveNodes().nodes.find((x) => x.slug === 'ailments38');
  assert.ok(n);
  assert.equal(n.props.kind, 'notable');
  assert.ok(n.props.statLines.join(' ').includes('12'));
});

test('passiveNodes: ascendancy notable carries its ascendancy id', () => {
  const n = passiveNodes().nodes.find((x) => x.slug === 'AscendancyDruid1Notable4');
  assert.ok(n);
  assert.equal(n.props.ascendancy, 'Druid1');
  assert.equal(n.props.kind, 'notable');
});

test('passiveNodes: records expose grantedSkillKey + ascendancy for edge resolution', () => {
  const { records } = passiveNodes();
  const r = records.find((x) => x.id === 'Passive/AscendancyMonk1Notable4');
  assert.ok(r, 'Hollow Resonance Technique record present');
  assert.match(r.grantedSkillKey, /SkillGem/);
  const asc = records.find((x) => x.ascendancy === 'Druid1');
  assert.ok(asc, 'ascendancy carried on records');
});

test('ascendancyNodes: one node per live ascendancy', () => {
  const nodes = ascendancyNodes();
  assert.equal(nodes.length, 23, `expected 23 live ascendancies, got ${nodes.length}`);
  for (const n of nodes) {
    assert.equal(n.kind, 'ascendancy');
    assert.match(n.id, /^Ascendancy\//);
    assert.ok(n.props.charClass, `charClass on ${n.id}`);
    assert.ok(!n.name.includes('[DNT'), 'no disabled ascendancies');
  }
  const r1 = nodes.find((n) => n.slug === 'Ranger1');
  assert.equal(r1.name, 'Deadeye');
  assert.equal(r1.props.charClass, 'Ranger');
  assert.ok(!nodes.some((n) => n.slug === 'Ranger2'), 'disabled Ranger2 excluded');
});

test('passiveEdges: grants resolves to gem nodes; in_ascendancy to ascendancy nodes', () => {
  const { nodes, records } = passiveNodes();
  const ascNodes = ascendancyNodes();
  const { nodes: gNodes } = gemNodes();
  const gemIds = new Set(gNodes.map((n) => n.id));
  const ascIds = new Set(ascNodes.map((n) => n.id));

  const edges = passiveEdges(records, gemIds, ascIds);
  const grants = edges.filter((e) => e.type === 'grants');
  const inAsc = edges.filter((e) => e.type === 'in_ascendancy');

  assert.ok(grants.length > 30, `many grants edges, got ${grants.length}`);
  for (const e of grants) assert.ok(gemIds.has(e.to), `grants target ${e.to} is a gem`);
  for (const e of grants) assert.ok(String(e.from).startsWith('Passive/'), 'grants from a passive');

  // 208 named ascendancy notables sit in a *live* ascendancy; the other 104 named
  // ones belong to non-live PoE1-legacy ascendancies (no node -> no edge).
  assert.equal(inAsc.length, 208, `one in_ascendancy edge per live-ascendancy notable, got ${inAsc.length}`);
  for (const e of inAsc) assert.ok(ascIds.has(e.to), `in_ascendancy target ${e.to} is an ascendancy`);

  // Hollow Resonance Technique -> the Hollow Resonance gem; and -> Monk1 ascendancy.
  const hr = records.find((r) => r.id === 'Passive/AscendancyMonk1Notable4');
  assert.ok(grants.some((e) => e.from === hr.id), 'Hollow Resonance Technique grants a gem');
  assert.ok(inAsc.some((e) => e.from === hr.id && e.to === 'Ascendancy/Monk1'), 'sits in Monk1');
});
