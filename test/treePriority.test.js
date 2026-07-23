import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePriority, renderPriorityList } from '../public/js/tree-priority.js';

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
  assert.ok(html.includes('Zealot&#39;s &lt;b&gt;Oath&lt;/b&gt;'), 'name escaped in tooltip/label');
});

test('renderPriorityList: readonly hides controls; empty shows a message', () => {
  const meta = new Map([[52, { kind: 'notable', name: 'X', icon: '' }]]);
  const ro = renderPriorityList([52], meta, { readonly: true });
  assert.ok(!ro.includes('data-prio-remove'), 'no remove in readonly');
  assert.ok(!/draggable="true"/.test(ro), 'not draggable in readonly');
  assert.match(renderPriorityList([], new Map(), {}), /editor-none/);
});

test('renderPriorityList: unknown hash falls back gracefully', () => {
  const html = renderPriorityList([999], new Map(), {});
  assert.match(html, /data-prio-row="999"/); // still renders a row (name = hash)
});
