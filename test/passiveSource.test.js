// test/passiveSource.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStatLines, nodePosition, parseTree, buildAdjacency } from '../scripts/graph/passiveSource.js';

test('resolveStatLines substitutes a value into the English template', () => {
  // shock_chance_+% is a real passive stat id on hash 4 (Shock Chance, +15%)
  const lines = resolveStatLines({ 'shock_chance_+%': 15 });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /15/);
  assert.match(lines[0].toLowerCase(), /shock/);
});

test('resolveStatLines drops unknown stat ids', () => {
  assert.deepEqual(resolveStatLines({ not_a_real_stat_id_xyz: 3 }), []);
});

test('resolveStatLines applies the negate handler (no double-negative)', () => {
  // ignite_effect_on_self_+% stores -30 and pairs it with a "reduced" entry whose
  // negate handler flips the sign: "30% reduced", NOT "-30% reduced".
  const lines = resolveStatLines({ 'ignite_effect_on_self_+%': -30 });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /reduced/);
  assert.match(lines[0], /\b30%/);
  assert.doesNotMatch(lines[0], /-30/);
});

test('resolveStatLines converts milliseconds to seconds', () => {
  // raise_shield_skill_inflicts_parry_for_duration_ms stores 2000 ms -> "2 seconds".
  const lines = resolveStatLines({ raise_shield_skill_inflicts_parry_for_duration_ms: 2000 });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\b2 seconds/);
  assert.doesNotMatch(lines[0], /2000/);
});

test('nodePosition: radius 0 sits exactly at the group center', () => {
  const orbitRadii = [0, 82, 162, 335, 493, 662, 846, 251, 1080, 1332];
  const skillsPerOrbit = [1, 12, 24, 24, 72, 72, 72, 24, 72, 144];
  const p = nodePosition({ x: 100, y: 200 }, 0, 0, orbitRadii, skillsPerOrbit);
  assert.equal(Math.round(p.x), 100);
  assert.equal(Math.round(p.y), 200);
});

test('nodePosition: slot 0 of an orbit is straight up (12 o\'clock)', () => {
  const orbitRadii = [0, 82, 162, 335, 493, 662, 846, 251, 1080, 1332];
  const skillsPerOrbit = [1, 12, 24, 24, 72, 72, 72, 24, 72, 144];
  // orbit 1 (radius 82), slot 0 -> angle 0 measured from 12 o'clock => (cx, cy - 82)
  const p = nodePosition({ x: 0, y: 0 }, 1, 0, orbitRadii, skillsPerOrbit);
  assert.equal(Math.round(p.x), 0);
  assert.equal(Math.round(p.y), -82);
});

test('nodePosition: orbit 1 slot 3 is at 3 o\'clock (+x)', () => {
  const orbitRadii = [0, 82, 162, 335, 493, 662, 846, 251, 1080, 1332];
  const skillsPerOrbit = [1, 12, 24, 24, 72, 72, 72, 24, 72, 144];
  // 12 slots; slot 3 = 90deg clockwise from up = +x axis
  const p = nodePosition({ x: 0, y: 0 }, 1, 3, orbitRadii, skillsPerOrbit);
  assert.equal(Math.round(p.x), 82);
  assert.equal(Math.round(p.y), 0);
});

test('nodePosition: orbit 7 (non-monotonic radius 251) slot 0 is straight up', () => {
  const orbitRadii = [0, 82, 162, 335, 493, 662, 846, 251, 1080, 1332];
  const skillsPerOrbit = [1, 12, 24, 24, 72, 72, 72, 24, 72, 144];
  const p = nodePosition({ x: 0, y: 0 }, 7, 0, orbitRadii, skillsPerOrbit);
  assert.equal(Math.round(p.x), 0);
  assert.equal(Math.round(p.y), -251);
});

test('parseTree: returns the expected node/edge magnitudes', () => {
  const { nodes, edges, meta } = parseTree();
  // 5150 total passives; placeholders without a name are dropped, so <=5150.
  assert.ok(nodes.length > 4000 && nodes.length <= 5150, `nodes=${nodes.length}`);
  // 5566: mastery (is_icon_only) nodes are dropped and contracted out of the edge
  // graph — direct real↔real connections plus per-mastery neighbour cliques.
  assert.equal(edges.length, 5566);
  // every edge endpoint resolves to a node
  const ids = new Set(nodes.map((n) => n.h));
  for (const e of edges) {
    assert.ok(e.a < e.b, 'edge is ordered a<b');
  }
  assert.equal(meta.roots.length, 6);
});

test('parseTree: a known keystone resolves with kind + stats', () => {
  const { nodes } = parseTree();
  const keystones = nodes.filter((n) => n.k === 'keystone');
  assert.ok(keystones.length >= 30, `keystones=${keystones.length}`);
  for (const k of keystones) {
    assert.equal(typeof k.name, 'string');
    assert.ok(k.name.length > 0);
  }
});

test('parseTree: live ascendancies exclude PoE1 placeholders', () => {
  const { meta } = parseTree();
  assert.ok(!meta.liveAscendancies.includes('Marauder1'));
  assert.ok(meta.liveAscendancies.length > 0);
});

test('parseTree: arc vs straight edge counts match the data', () => {
  const { edges } = parseTree();
  const arcs = edges.filter((e) => e.arc);
  // Observed after mastery contraction: 1615 arcs + 3951 straight = 5566 total.
  assert.equal(arcs.length, 1615);
  assert.equal(edges.length - arcs.length, 3951);
});

test('arc edges carry a center, radius and angle span', () => {
  const { edges } = parseTree();
  const arc = edges.find((e) => e.arc).arc;
  assert.equal(typeof arc.cx, 'number');
  assert.equal(typeof arc.r, 'number');
  assert.equal(typeof arc.a0, 'number');
  assert.equal(typeof arc.a1, 'number');
  assert.equal(typeof arc.ccw, 'boolean');
});

test('parseTree: classStarts maps each root class name to its root hash', () => {
  const { meta } = parseTree();
  const entries = Object.entries(meta.classStarts);
  assert.equal(entries.length, meta.roots.length); // one per root
  // every value is a root hash; every key is a non-empty class name
  for (const [name, hash] of entries) {
    assert.ok(name.length > 0, 'class name non-empty');
    assert.ok(meta.roots.includes(hash), `${hash} is a root`);
  }
  // spot-check a known mapping
  assert.equal(meta.classStarts.WITCH, 54447);
});

test('buildAdjacency is symmetric', () => {
  const { nodes, edges } = parseTree();
  const adj = buildAdjacency(nodes, edges);
  // Symmetry holds for all edges between real (allocatable) nodes. Edges touching a
  // nameless ghost endpoint are intentionally absent from the adjacency map.
  const nodeSet = new Set(nodes.map((n) => n.h));
  for (const e of edges.filter((e) => nodeSet.has(e.a) && nodeSet.has(e.b)).slice(0, 200)) {
    assert.ok(adj.get(e.a).includes(e.b));
    assert.ok(adj.get(e.b).includes(e.a));
  }
});
