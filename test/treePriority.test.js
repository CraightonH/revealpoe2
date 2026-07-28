import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePriority, renderPriorityList, insertionIndex, moveTo } from '../public/js/tree-priority.js';

// Three 40px tiles on one row (y 0–40), then a fourth wrapped onto row two.
const rect = (left, top) => ({ left, top, width: 40, height: 40, right: left + 40, bottom: top + 40 });
const ROW = [rect(0, 0), rect(50, 0), rect(100, 0)];
const WRAPPED = [...ROW, rect(0, 50)];

test('insertionIndex: gaps by tile midpoint, and past the last tile appends', () => {
  assert.equal(insertionIndex(ROW, 5, 20), 0);      // left half of tile 0
  assert.equal(insertionIndex(ROW, 35, 20), 1);     // right half of tile 0
  assert.equal(insertionIndex(ROW, 55, 20), 1);     // left half of tile 1
  assert.equal(insertionIndex(ROW, 135, 20), 3);    // right half of the last tile
  // The reported bug: released in the empty strip to the RIGHT of everything.
  assert.equal(insertionIndex(ROW, 400, 20), 3, 'past the right edge appends');
  assert.equal(insertionIndex([], 400, 20), 0);
});

test('insertionIndex: prefers the row the pointer is on', () => {
  // x=400 on row two must land after the wrapped tile, not after row one's last.
  assert.equal(insertionIndex(WRAPPED, 400, 70), 4);
  assert.equal(insertionIndex(WRAPPED, 400, 20), 3);
  // Below every row still resolves to the nearest row (the last one).
  assert.equal(insertionIndex(WRAPPED, 5, 500), 3, 'left of the wrapped tile');
});

test('moveTo: inserts at the gap, compensating for the removal', () => {
  const order = [1, 2, 3, 4];
  assert.deepEqual(moveTo(order, 1, 4), [2, 3, 4, 1]);   // first -> end
  assert.deepEqual(moveTo(order, 4, 0), [4, 1, 2, 3]);   // last -> front
  assert.deepEqual(moveTo(order, 1, 2), [2, 1, 3, 4]);   // forward one gap
  assert.deepEqual(moveTo(order, 3, 1), [1, 3, 2, 4]);   // backward one gap
  // A no-op returns the SAME reference so the caller can skip the write.
  assert.equal(moveTo(order, 2, 1), order);
  assert.equal(moveTo(order, 2, 2), order);
  assert.equal(moveTo(order, 99, 0), order, 'unknown hash never reorders');
  assert.deepEqual(order, [1, 2, 3, 4], 'input untouched');
});

test('reconcilePriority: keeps prior order, appends new, drops deallocated', () => {
  assert.deepEqual(reconcilePriority([3, 1, 2], [1, 2, 3]), [3, 1, 2]);      // all kept, order held
  assert.deepEqual(reconcilePriority([3, 1], [1, 3, 5, 4]), [3, 1, 5, 4]);   // 5,4 appended in allocated order
  assert.deepEqual(reconcilePriority([3, 1, 2], [1, 3]), [3, 1]);            // 2 dropped
  assert.deepEqual(reconcilePriority([], [7, 9]), [7, 9]);                   // empty prev
  assert.deepEqual(reconcilePriority([9, 9, 7], [7, 9]), [9, 7]);            // dedupe
});

test('renderPriorityList: rows carry hooks, icon canvas, escaped names', () => {
  const meta = new Map([[52, { kind: 'keystone', name: "Zealot's <b>Oath</b>", icon: 'x.png' }]]);
  const html = renderPriorityList([52], meta, {});
  assert.match(html, /data-prio-row="52"/);
  assert.match(html, /draggable="true"/);
  assert.match(html, /data-prio-icon="52"/);
  assert.match(html, /data-prio-remove="52"/);
  assert.match(html, /prio-tile is-keystone/);
  assert.match(html, /prio-handle/);
  assert.ok(html.includes('Zealot&#39;s &lt;b&gt;Oath&lt;/b&gt;'), 'name escaped in tooltip/label');
});

test('renderPriorityList: readonly hides controls; empty shows a message', () => {
  const meta = new Map([[52, { kind: 'notable', name: 'X', icon: '' }]]);
  const ro = renderPriorityList([52], meta, { readonly: true });
  assert.ok(!ro.includes('data-prio-remove'), 'no remove in readonly');
  assert.ok(!ro.includes('prio-handle'), 'no drag handle in readonly');
  assert.ok(!/draggable="true"/.test(ro), 'not draggable in readonly');
  assert.match(renderPriorityList([], new Map(), {}), /editor-none/);
});

test('renderPriorityList: unknown hash falls back gracefully', () => {
  const html = renderPriorityList([999], new Map(), {});
  assert.match(html, /data-prio-row="999"/); // still renders a row (name = hash)
});
