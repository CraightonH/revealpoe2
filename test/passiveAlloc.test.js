// test/passiveAlloc.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAllocate, allocate, deallocate, pointsSpent, pointsNeeded, canAfford, setMask, toggleSet } from '../public/js/passive-alloc.js';

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

test('setMask defaults to both (3) when unset', () => {
  assert.equal(setMask(new Map(), 5), 3);
});

test('toggleSet flips a single set bit', () => {
  let ws = new Map();
  ws = toggleSet(ws, 5, 2); // remove set II -> only set I (1)
  assert.equal(setMask(ws, 5), 1);
  ws = toggleSet(ws, 5, 1); // remove set I too -> 0 (caller deallocates)
  assert.equal(setMask(ws, 5), 0);
});
