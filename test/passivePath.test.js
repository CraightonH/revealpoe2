// test/passivePath.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortestPath } from '../public/js/passive-path.js';

// chain 0-1-2-3-4, frontier = {0}
const chain = new Map([[0,[1]],[1,[0,2]],[2,[1,3]],[3,[2,4]],[4,[3]]]);

test('linear chain: path is every node from frontier (exclusive) to target (inclusive)', () => {
  assert.deepEqual(shortestPath(chain, [0], 4), [1, 2, 3, 4]);
  assert.deepEqual(shortestPath(chain, [0], 1), [1]); // directly adjacent → length 1
});

test('target already in the frontier returns null', () => {
  assert.equal(shortestPath(chain, [0], 0), null);
  assert.equal(shortestPath(chain, new Set([0, 1, 2]), 2), null);
});

test('multi-source: BFS starts from every allocated node, picks the nearest frontier', () => {
  // frontier {0,4}; target 2 is equidistant — either [1,2] or [3,2], both length 2.
  const p = shortestPath(chain, [0, 4], 2);
  assert.equal(p.length, 2);
  assert.equal(p[p.length - 1], 2);
  // target 3 is one hop from frontier node 4.
  assert.deepEqual(shortestPath(chain, [0, 4], 3), [3]);
});

test('unreachable target returns null', () => {
  const split = new Map([[0,[1]],[1,[0]],[2,[3]],[3,[2]]]); // {0,1} disjoint from {2,3}
  assert.equal(shortestPath(split, [0], 3), null);
});

test('isPathable filter: a blocked node cannot be traversed', () => {
  // block node 2 → target 4 unreachable through the only chain
  const blocked = new Set([2]);
  assert.equal(shortestPath(chain, [0], 4, { isPathable: (h) => !blocked.has(h) }), null);
  // but a target before the block is still reachable
  assert.deepEqual(shortestPath(chain, [0], 1, { isPathable: (h) => !blocked.has(h) }), [1]);
});

test('tie-break: equal-length routes prefer fewer attribute-filler nodes', () => {
  // diamond: 0 -> {1 (attr), 2 (normal)} -> 3. Both routes are length 2.
  const diamond = new Map([
    [0, [1, 2]],
    [1, [0, 3]],
    [2, [0, 3]],
    [3, [1, 2]],
  ]);
  const attrs = new Set([1]);
  const p = shortestPath(diamond, [0], 3, { isAttr: (h) => attrs.has(h) });
  assert.deepEqual(p, [2, 3]); // routes through the non-attr node 2, not 1
});

test('tie-break never lengthens the path: a shorter attr route still wins', () => {
  // 0 -> 1(attr) -> 4 (length 2) vs 0 -> 2 -> 3 -> 4 (length 3, all normal)
  const g = new Map([
    [0, [1, 2]],
    [1, [0, 4]],
    [2, [0, 3]],
    [3, [2, 4]],
    [4, [1, 3]],
  ]);
  const attrs = new Set([1]);
  assert.deepEqual(shortestPath(g, [0], 4, { isAttr: (h) => attrs.has(h) }), [1, 4]);
});

test('does not mutate inputs', () => {
  const sources = new Set([0]);
  shortestPath(chain, sources, 3);
  assert.deepEqual([...sources], [0]);
});
