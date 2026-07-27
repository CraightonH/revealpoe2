// Identity recovery from a decoded share code (pure helper in passive-tree.js).
//
// The regression these guard: a build that has only PICKED a class in the planner
// (Druid / Oracle, nothing allocated yet) persists an allocation-free share code.
// Recovering identity from that code by BFS-ing the allocation is impossible — the
// old code silently answered "Warrior / no ascendancy" (the first class start in
// the artifact), and the editor adopted that guess over the user's real pick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decode, encode, synthesizeState } from '../public/js/passive-code.js';
import { identityFromDecoded, buildAdjacency } from '../public/js/passive-tree.js';

const art = JSON.parse(fs.readFileSync(new URL('../public/generated/passive-tree.json', import.meta.url)));
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/passive-tree-codes.json', import.meta.url)));
const byName = Object.fromEntries(fx.vectors.map((v) => [v.name, v]));

const meta = art.meta;
const adj = buildAdjacency(art.nodes, art.edges);
const ctx = {
  classStarts: meta.classStarts,
  ascStarts: meta.ascStarts,
  ascByClass: meta.ascByClass,
  ascendancyArt: meta.ascendancyArt,
  selectableClasses: Object.keys(meta.ascByClass),
  adj,
};

/** The code a fresh planner build emits: class + ascendancy picked, nothing allocated. */
const emptyCode = (ascByte) => encode(synthesizeState({
  allocated: [], ascByte, ascOf: () => null, isAttr: () => false, attrOf: () => 'str',
}));

test('an allocation-free code carries NO identity evidence', () => {
  const id = identityFromDecoded(decode(emptyCode(1)), ctx);
  assert.equal(id.fromCode, false, 'must not claim the identity came from the code');
  assert.equal(id.className, null);
  assert.equal(id.ascId, null);
  assert.equal(id.classRoot, null);
});

test('an allocation-free code does not default to the first class start', () => {
  // The bug: Object.values(classStarts)[0] is Warrior's hexagon, so every
  // evidence-free code resolved to Warrior.
  const id = identityFromDecoded(decode(emptyCode(0)), ctx);
  assert.notEqual(id.className, 'Warrior');
  assert.equal(id.fromCode, false);
});

test('identity is recovered from a real allocation', () => {
  for (const v of fx.vectors) {
    const id = identityFromDecoded(decode(v.code), ctx);
    assert.equal(id.fromCode, true, v.name);
    assert.ok(id.classRoot != null, v.name);
    assert.ok(ctx.selectableClasses.includes(id.className), `${v.name}: className=${id.className}`);
    if (v.ascendancy > 0) assert.ok(id.ascId, `${v.name}: ascendancy byte ${v.ascendancy} lost`);
    else assert.equal(id.ascId, null, v.name);
  }
});

test('a chosen-but-unallocated ascendancy survives via the header byte', () => {
  // Druid / Oracle with main passives allocated but zero ascendancy points: the
  // ascendancy start node is not in the allocation, so reachability finds nothing
  // and the 1-based header byte is the only evidence.
  const druidRoot = meta.classStarts.Druid;
  const neighbours = (adj.get(druidRoot) ?? []).slice(0, 3);
  assert.ok(neighbours.length > 0, 'fixture assumption: Druid start has neighbours');
  const code = encode(synthesizeState({
    allocated: neighbours, ascByte: 1, ascOf: () => null, isAttr: () => false, attrOf: () => 'str',
  }));
  const id = identityFromDecoded(decode(code), ctx);
  assert.equal(id.fromCode, true);
  assert.equal(id.className, 'Druid');
  assert.equal(id.ascId, 'Druid1');   // Oracle
});
