// test/passiveChoice.test.js
// Multiple-choice nodes (e.g. Gemling Legionnaire's Implanted Gems): the choice
// node itself is never allocated — the picked option takes its place for a
// single ascendancy point. These tests pin the adjacency rewire, the point
// accounting, and the build-time choice linkage behind that rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewireChoiceAdjacency, stripChoiceNodes, swapChoicePick, allocRouteStep, buildAdjacency } from '../public/js/passive-tree.js';
import { canAllocate, allocate, deallocate, pointsSpent, canAfford } from '../public/js/passive-alloc.js';
import * as allocMod from '../public/js/passive-alloc.js';
import { shortestPath } from '../public/js/passive-path.js';
import { parseGggTreeData } from '../scripts/graph/gggTree.js';

// Synthetic cluster mirroring Implanted Gems (60287):
//   S=1 start -- T=52440 tree node -- C=60287 choice -- O1=32952 / O2=37397 options
const S = 1, T = 52440, C = 60287, O1 = 32952, O2 = 37397;
const starts = [S];
const kindOf = (h) => (h === S || h === T ? 'normal' : 'ascNotable');
const budgets = { main: 100, ascendancy: 8, ws: 25 };

function wired() {
  // GGG edge direction between choice and options is inconsistent (Implanted
  // Gems points OUT at its options; Projectile Proximity Specialisation is
  // pointed AT by its) — cover both.
  const nodes = [{ h: S }, { h: T }, { h: C }, { h: O1 }, { h: O2 }];
  const edges = [
    { a: S, b: T },
    { a: T, b: C },
    { a: C, b: O1 }, // out-edge direction
    { a: O2, b: C }, // in-edge direction
  ];
  const adj = buildAdjacency(nodes, edges);
  const choices = new Map([[C, [O1, O2]]]);
  rewireChoiceAdjacency(adj, choices);
  return { adj, choices };
}

test('rewireChoiceAdjacency: options hang off the choice node\'s tree neighbours', () => {
  const { adj } = wired();
  assert.deepEqual([...adj.get(O1)].sort((a, b) => a - b), [T]);
  assert.deepEqual([...adj.get(O2)].sort((a, b) => a - b), [T]);
});

test('rewireChoiceAdjacency: the choice node keeps only its tree neighbours', () => {
  const { adj } = wired();
  assert.deepEqual([...adj.get(C)].sort((a, b) => a - b), [T]);
});

test('rewireChoiceAdjacency: untouched nodes keep their edges', () => {
  const { adj } = wired();
  assert.deepEqual([...adj.get(S)], [T]);
  assert.deepEqual([...adj.get(T)].sort((a, b) => a - b), [S, C, O1, O2].sort((a, b) => a - b));
});

test('choice flow: tree node + one option costs exactly 1 ascendancy point', () => {
  const { adj } = wired();
  let alloc = allocate(adj, new Set(), starts, T);
  assert.ok(canAllocate(adj, alloc, starts, O1), 'option allocatable once its tree neighbour is taken');
  alloc = allocate(adj, alloc, starts, O1);
  assert.deepEqual([...alloc].sort((a, b) => a - b), [O1, T]);
  // The old bug charged the choice node AND the option (2 pts); the choice node
  // is never allocated, so the pick is a single point.
  assert.deepEqual(pointsSpent(alloc, kindOf), { main: 1, ascendancy: 1 });
});

test('choice flow: option is unreachable before the tree neighbour', () => {
  const { adj } = wired();
  assert.equal(canAllocate(adj, new Set(), starts, O1), false);
  const withT = allocate(adj, new Set(), starts, T);
  assert.equal(canAllocate(adj, withT, starts, O1), true);
  assert.equal(canAllocate(adj, withT, starts, C), true); // choice node itself still paths normally
});

test('choice flow: swapping the pick keeps the cost at 1 point', () => {
  const { adj } = wired();
  let alloc = allocate(adj, new Set(), starts, T);
  alloc = allocate(adj, alloc, starts, O1);
  // Re-pick: drop the old option first, then take the new one (mirrors
  // onChoiceOptionClick's swap, which budget-checks post-removal).
  alloc = deallocate(adj, alloc, starts, O1);
  assert.ok(canAfford(alloc, kindOf, [O2], budgets), 'swap fits the budget');
  alloc = allocate(adj, alloc, starts, O2);
  assert.deepEqual(pointsSpent(alloc, kindOf), { main: 1, ascendancy: 1 });
});

test('choice flow: shortest path reaches the option directly, never through the choice node', () => {
  const { adj } = wired();
  const path = shortestPath(adj, new Set([S, T]), O1, {});
  assert.deepEqual(path, [O1]);
  // …and the choice node is never an intermediate on a route past it
  const past = shortestPath(adj, new Set([S]), O2, {
    isPathable: (h) => h !== C, // mirrors computePath's choice-node guard
  });
  assert.ok(past && !past.includes(C), `route ${past} must not pass through the choice node`);
});

test('choice flow: two ordinary ascendancy nodes still cost 2', () => {
  const { adj } = wired();
  let alloc = allocate(adj, new Set(), starts, T);
  alloc = allocate(adj, alloc, starts, O1);
  alloc = allocate(adj, alloc, starts, O2);
  assert.deepEqual(pointsSpent(alloc, kindOf), { main: 1, ascendancy: 2 });
});

test('stripChoiceNodes: legacy codes carrying the choice hash normalize to the option alone', () => {
  const { choices } = wired();
  // Pre-fix codes allocated BOTH the choice node and the option (2 pts).
  const legacy = new Set([T, C, O1]);
  const fixed = stripChoiceNodes(legacy, choices);
  assert.deepEqual([...fixed].sort((a, b) => a - b), [O1, T]);
  assert.deepEqual(pointsSpent(fixed, kindOf), { main: 1, ascendancy: 1 });
  assert.deepEqual([...legacy].sort((a, b) => a - b), [O1, T, C], 'input not mutated');
});

test('stripChoiceNodes: no choices → set returned as-is', () => {
  const s = new Set([T, O1]);
  assert.equal(stripChoiceNodes(s, new Map()), s);
});

// Minimal GGG-shaped tree: choice linkage must come from the
// multipleChoiceParent back-reference (authoritative), NOT from edges —
// Path Seeker-style non-option neighbours (36676 here) touch the choice node
// but carry no parent link and must be excluded.
function syntheticGgg() {
  const n = (x, y, extra = {}) => ({
    x, y, ascendancyId: 'AscTest', isNotable: true, name: 'n', stats: [], ...extra,
  });
  return {
    min_x: 0, min_y: 0, max_x: 100, max_y: 100,
    classes: [],
    nodes: {
      52440: n(0, 0),
      60287: n(10, 0, { name: 'Implanted Gems', isMultipleChoice: true }),
      32952: n(20, 0, { name: 'Bolstering Implants', isMultipleChoiceOption: true, multipleChoiceParent: '60287' }),
      37397: n(20, 10, { name: 'Neurological Implants', isMultipleChoiceOption: true, multipleChoiceParent: '60287' }),
      36676: n(10, 10, { name: 'Passive Points' }),
    },
    edges: [
      { from: 52440, to: 60287 },
      { from: 60287, to: 32952 },
      { from: 37397, to: 60287 },
      { from: 60287, to: 36676 },
    ],
  };
}

test('parseGggTreeData: choice node carries sorted option hashes from multipleChoiceParent', () => {
  const { nodes } = parseGggTreeData(syntheticGgg());
  const byH = new Map(nodes.map((x) => [x.h, x]));
  assert.deepEqual(byH.get(60287).choice, [32952, 37397]);
  // Non-option neighbours and options themselves carry no choice array.
  assert.equal(byH.get(36676).choice, undefined);
  assert.equal(byH.get(32952).choice, undefined);
  assert.equal(byH.get(52440).choice, undefined);
});

test('swapChoicePick: picking a second option overwrites the first — never two picks', () => {
  const { adj, choices } = wired();
  let alloc = allocate(adj, new Set(), starts, T);
  alloc = swapChoicePick(adj, starts, alloc, choices, O1, kindOf, budgets, allocMod);
  assert.deepEqual([...alloc].sort((a, b) => a - b), [O1, T]);
  alloc = swapChoicePick(adj, starts, alloc, choices, O2, kindOf, budgets, allocMod);
  assert.deepEqual([...alloc].sort((a, b) => a - b), [O2, T], 'O1 swapped out, not kept alongside O2');
  const { ascendancy } = pointsSpent(alloc, kindOf);
  assert.equal(ascendancy, 1, 'still a single ascendancy point after the swap');
});

test('swapChoicePick: first pick with no current option just allocates', () => {
  const { adj, choices } = wired();
  const alloc = allocate(adj, new Set(), starts, T);
  const next = swapChoicePick(adj, starts, alloc, choices, O1, kindOf, budgets, allocMod);
  assert.deepEqual([...next].sort((a, b) => a - b), [O1, T]);
});

test('swapChoicePick: a legacy state with two picks collapses to one', () => {
  const { adj, choices } = wired();
  // Simulate the pre-fix state Craighton hit: both options allocated directly.
  let alloc = allocate(adj, new Set(), starts, T);
  alloc = allocate(adj, alloc, starts, O1);
  alloc = allocate(adj, alloc, starts, O2);
  assert.ok(alloc.has(O1) && alloc.has(O2));
  const next = swapChoicePick(adj, starts, alloc, choices, O1, kindOf, budgets, allocMod);
  assert.deepEqual([...next].sort((a, b) => a - b), [O1, T], 'O2 dropped, O1 kept');
});

test('swapChoicePick: null when the pick is unreachable after the drop', () => {
  const { adj, choices } = wired();
  // T not allocated: neither option hangs off the tree.
  assert.equal(swapChoicePick(adj, starts, new Set(), choices, O1, kindOf, budgets, allocMod), null);
});

test('swapChoicePick: null for a hash in no choice group', () => {
  const { adj, choices } = wired();
  const alloc = allocate(adj, new Set(), starts, T);
  assert.equal(swapChoicePick(adj, starts, alloc, choices, 99999, kindOf, budgets, allocMod), null);
});

test('swapChoicePick: null when the swap breaks the ascendancy budget', () => {
  const { adj, choices } = wired();
  let alloc = allocate(adj, new Set(), starts, T);
  alloc = swapChoicePick(adj, starts, alloc, choices, O1, kindOf, budgets, allocMod);
  const broke = { ...budgets, ascendancy: 0 };
  assert.equal(swapChoicePick(adj, starts, alloc, choices, O2, kindOf, broke, allocMod), null);
  // ...but the same swap fits once the budget allows a single point.
  const ok = swapChoicePick(adj, starts, alloc, choices, O2, kindOf, { ...budgets, ascendancy: 1 }, allocMod);
  assert.deepEqual([...ok].sort((a, b) => a - b), [O2, T]);
});

test('allocRouteStep: regular route nodes allocate normally', () => {
  const { adj, choices } = wired();
  const choiceOf = new Map([[O1, C], [O2, C]]);
  const next = allocRouteStep(adj, starts, new Set(), choiceOf, choices, T, kindOf, budgets, allocMod);
  assert.deepEqual([...next], [T]);
});

test('allocRouteStep: unpicked option on a route is swap-picked (single selection)', () => {
  const { adj, choices } = wired();
  const choiceOf = new Map([[O1, C], [O2, C]]);
  // Route to O2 collapses: stepping O2 picks it for 1 point.
  let alloc = allocRouteStep(adj, starts, new Set([T]), choiceOf, choices, O2, kindOf, budgets, allocMod);
  assert.ok(alloc.has(O2));
  assert.equal(pointsSpent(alloc, kindOf).ascendancy, 1);
  // Stepping the other option swaps, never adds alongside.
  alloc = allocRouteStep(adj, starts, alloc, choiceOf, choices, O1, kindOf, budgets, allocMod);
  assert.ok(alloc.has(O1));
  assert.ok(!alloc.has(O2));
  assert.equal(pointsSpent(alloc, kindOf).ascendancy, 1);
});

test('allocRouteStep: already-picked option steps through as a no-op', () => {
  const { adj, choices } = wired();
  const choiceOf = new Map([[O1, C], [O2, C]]);
  const alloc = new Set([T, O1]);
  const next = allocRouteStep(adj, starts, alloc, choiceOf, choices, O1, kindOf, budgets, allocMod);
  assert.deepEqual([...next].sort((a, b) => a - b), [O1, T]);
});

test('allocRouteStep: failed swap leaves the allocation unchanged', () => {
  const { adj, choices } = wired();
  const choiceOf = new Map([[O1, C], [O2, C]]);
  // O1 unreachable with an empty tree around it (T not allocated).
  const alloc = new Set();
  const next = allocRouteStep(adj, starts, alloc, choiceOf, choices, O1, kindOf, budgets, allocMod);
  assert.deepEqual([...next], []);
});
