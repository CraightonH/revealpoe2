// test/passiveAlloc.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAllocate, allocate, deallocate, wouldCascade, pointsSpent, pointsNeeded, canAfford,
  wsCanAllocate, wsAllocate, wsDeallocate, wsWouldCascade, pruneWeaponSets, wsCanAfford,
} from '../public/js/passive-alloc.js';

// graph: 0-1-2-3 chain, start=0
const adj = new Map([[0,[1]],[1,[0,2]],[2,[1,3]],[3,[2]]]);
const starts = [0];

test('canAllocate: only nodes adjacent to start/allocated are allowed', () => {
  assert.equal(canAllocate(adj, new Set(), starts, 1), true);  // adjacent to start 0
  assert.equal(canAllocate(adj, new Set(), starts, 2), false); // not yet reachable
  assert.equal(canAllocate(adj, new Set([1]), starts, 2), true);
});

test('canAllocate: a start node itself is allocatable', () => {
  assert.equal(canAllocate(adj, new Set(), starts, 0), true);
});

test('allocate/deallocate do not mutate the input set', () => {
  const input = new Set([1]);
  const out = allocate(adj, input, starts, 2);
  assert.notEqual(out, input);
  assert.deepEqual([...input], [1]); // unchanged
  const din = new Set([1, 2, 3]);
  const dout = deallocate(adj, din, starts, 3);
  assert.notEqual(dout, din);
  assert.deepEqual([...din].sort((a,b)=>a-b), [1, 2, 3]); // unchanged
});

test('allocate adds an allocatable node and ignores a non-allocatable one', () => {
  const a1 = allocate(adj, new Set(), starts, 1);
  assert.deepEqual([...a1], [1]);
  const a2 = allocate(adj, new Set(), starts, 3); // not reachable -> no-op
  assert.deepEqual([...a2], []);
});

test('deallocate cascades: removing a cut node frees what it orphaned', () => {
  const allocated = new Set([1, 2, 3]); // 0(start)-1-2-3
  const after = deallocate(adj, allocated, starts, 1);
  assert.deepEqual([...after].sort((x,y)=>x-y), []); // 2,3 orphaned -> all gone
});

test('deallocate of a leaf removes only that leaf', () => {
  const allocated = new Set([1, 2, 3]);
  const after = deallocate(adj, allocated, starts, 3);
  assert.deepEqual([...after].sort((x,y)=>x-y), [1, 2]);
});

test('wouldCascade distinguishes a cut node from a leaf', () => {
  const allocated = new Set([1, 2, 3]);
  assert.equal(wouldCascade(adj, allocated, starts, 1), true);
  assert.equal(wouldCascade(adj, allocated, starts, 3), false);
  assert.equal(wouldCascade(adj, allocated, starts, 99), false);
});

test('pointsSpent splits main vs ascendancy pools', () => {
  const kindOf = (h) => ({ 1: 'small', 2: 'notable', 10: 'ascSmall', 11: 'ascNotable' }[h]);
  const res = pointsSpent(new Set([1, 2, 10, 11]), kindOf);
  assert.deepEqual(res, { main: 2, ascendancy: 2 });
});

test('pointsNeeded splits a candidate set of hashes into pools', () => {
  const kindOf = (h) => ({ 1: 'small', 2: 'keystone', 10: 'ascSmall', 11: 'ascNotable' }[h]);
  assert.deepEqual(pointsNeeded([1, 2, 10], kindOf), { main: 2, ascendancy: 1 });
  assert.deepEqual(pointsNeeded([], kindOf), { main: 0, ascendancy: 0 });
});

test('canAfford gates main pool against its budget', () => {
  const kindOf = (h) => 'small';
  const allocated = new Set([1, 2]); // 2 main spent
  const budgets = { main: 3, ascendancy: 8 };
  assert.equal(canAfford(allocated, kindOf, [3], budgets), true);     // 2+1 <= 3
  assert.equal(canAfford(allocated, kindOf, [3, 4], budgets), false); // 2+2  > 3
});

test('canAfford gates the ascendancy pool independently of main', () => {
  const kindOf = (h) => (h >= 10 ? 'ascSmall' : 'small');
  const allocated = new Set([10, 11, 12, 13, 14, 15, 16, 17]); // 8 asc spent (full)
  const budgets = { main: 122, ascendancy: 8 };
  assert.equal(canAfford(allocated, kindOf, [18], budgets), false); // asc full
  assert.equal(canAfford(allocated, kindOf, [1], budgets), true);   // main has room
});

test('canAfford treats a missing budget as unbounded', () => {
  const kindOf = (h) => 'small';
  assert.equal(canAfford(new Set([1, 2, 3]), kindOf, [4], {}), true);
});

// Weapon-set graph: main backbone 0(start)-1-2; extra reachable nodes 3-4 hang
// off 2, and 5 hangs off 1.  Main tree = {1,2}, starts = [0].
//   0:[1]  1:[0,2,5]  2:[1,3]  3:[2,4]  4:[3]  5:[1]
const wsAdj = new Map([
  [0, [1]], [1, [0, 2, 5]], [2, [1, 3]], [3, [2, 4]], [4, [3]], [5, [1]],
]);
const wsMain = new Set([1, 2]);
const wsStarts = [0];

test('wsCanAllocate: a weapon node must touch the shared frontier or same-set nodes', () => {
  const empty = new Set();
  assert.equal(wsCanAllocate(wsAdj, wsMain, wsStarts, empty, 3), true);  // 3 ↔ main 2
  assert.equal(wsCanAllocate(wsAdj, wsMain, wsStarts, empty, 4), false); // 4 only ↔ 3 (not yet in set)
  assert.equal(wsCanAllocate(wsAdj, wsMain, wsStarts, new Set([3]), 4), true); // now 4 ↔ set node 3
});

test('wsCanAllocate: cannot weapon-allocate a node already in the shared/main tree', () => {
  assert.equal(wsCanAllocate(wsAdj, wsMain, wsStarts, new Set(), 1), false); // 1 is shared
});

test('wsAllocate adds a reachable node and is a no-op for an unreachable one', () => {
  assert.deepEqual([...wsAllocate(wsAdj, wsMain, wsStarts, new Set(), 3)], [3]);
  assert.deepEqual([...wsAllocate(wsAdj, wsMain, wsStarts, new Set(), 4)], []); // unreachable
});

test('wsDeallocate cascades: removing a cut node frees what it orphaned', () => {
  const set = new Set([3, 4]);             // 2(main)-3-4
  assert.deepEqual([...wsDeallocate(wsAdj, wsMain, wsStarts, set, 3)], []); // 4 orphaned too
  assert.deepEqual([...wsDeallocate(wsAdj, wsMain, wsStarts, set, 4)].sort((a, b) => a - b), [3]);
});

test('wsWouldCascade distinguishes a cut node from a leaf', () => {
  const set = new Set([3, 4]);
  assert.equal(wsWouldCascade(wsAdj, wsMain, wsStarts, set, 3), true);
  assert.equal(wsWouldCascade(wsAdj, wsMain, wsStarts, set, 4), false);
  assert.equal(wsWouldCascade(wsAdj, wsMain, wsStarts, set, 99), false);
});

test('pruneWeaponSets re-anchors a set after the main tree shrinks', () => {
  const set = new Set([3, 4]);             // both hang off main node 2
  // Main tree loses node 2 → 3 and 4 are no longer reachable from {1} ∪ starts.
  assert.deepEqual([...pruneWeaponSets(wsAdj, new Set([1]), wsStarts, set)], []);
  // Node 5 hangs off main node 1, which survives.
  assert.deepEqual([...pruneWeaponSets(wsAdj, new Set([1]), wsStarts, new Set([5]))], [5]);
});

test('wsCanAfford gates a weapon set against its own 25-point budget', () => {
  assert.equal(wsCanAfford(new Set([1, 2, 3]), 1, 25), true);
  const full = new Set(Array.from({ length: 25 }, (_, i) => i + 1));
  assert.equal(wsCanAfford(full, 1, 25), false);
  assert.equal(wsCanAfford(full, 0, 25), true);
});
