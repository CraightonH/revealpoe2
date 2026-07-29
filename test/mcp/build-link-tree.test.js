import test from 'node:test';
import assert from 'node:assert/strict';
import { createFsBackend } from '../../src/mcp/backends/fs.js';
import { allocate } from '../../public/js/passive-alloc.js';
import { resolveSpec, allocateSpecTree, greedyAllocate, isConnected } from '../../src/mcp/tools/build-link.js';
import { reachableNotables } from './helpers.js';

const b = createFsBackend();
const planner = await b.planner();
const adj = await b.passiveAdj();
const tm = await b.treeMeta();
const sorcNotables = (n) => reachableNotables(b, 'Sorceress', n);

test('TRAP: allocate() requires starts as an ARRAY — a Set throws', () => {
  const start = tm.classStarts.Sorceress;
  const first = (adj.get(start) ?? [])[0];
  assert.throws(() => allocate(adj, new Set(), new Set([start]), first), TypeError);
  const allocated = new Set();
  const next = allocate(adj, allocated, [start], first); // array form works — allocate() is pure, returns a new Set
  assert.ok(next.has(first));
});

test('greedy allocation connects all targets, nearest-first', async () => {
  const targets = await sorcNotables(3);
  const r = greedyAllocate(adj, [tm.classStarts.Sorceress], targets.map((p) => p.h),
    (h) => true);
  assert.ok(!r.unreachable);
  for (const p of targets) assert.ok(r.allocated.has(p.h));
  assert.equal(r.order.length, 3);
});

test('TRAP: main-tree pathing must exclude ascendancy nodes', async () => {
  const targets = await sorcNotables(2);
  const spec = { class: 'sorceress', ascendancy: 'stormweaver', skills: [], notables: targets.map((p) => p.h) };
  const res = await resolveSpec(b, planner, spec);
  const tree = await allocateSpecTree(b, res);
  assert.ok(!tree.error, JSON.stringify(tree.error ?? {}));
  const info = tree.info;
  for (const h of tree.mainAllocated) {
    assert.equal(info.get(h)?.asc ?? null, null, `main allocation routed through ascendancy node ${h}`);
  }
});

test('TRAP: emitted allocation is verifiably connected to the class start', async () => {
  const targets = await sorcNotables(3);
  const res = await resolveSpec(b, planner, { class: 'sorceress', skills: [], notables: targets.map((p) => p.h) });
  const tree = await allocateSpecTree(b, res);
  assert.ok(isConnected(adj, tm.classStarts.Sorceress, tree.mainAllocated));
  // and the check itself catches a hand-broken set: add a node with no
  // neighbour in (allocated ∪ start) — an island the codec would happily emit
  const broken = new Set(tree.mainAllocated);
  const orphan = [...adj.keys()].find((h) => !broken.has(h) && h !== tm.classStarts.Sorceress
    && !(adj.get(h) ?? []).some((nb) => broken.has(nb) || nb === tm.classStarts.Sorceress));
  broken.add(orphan);
  assert.equal(isConnected(adj, tm.classStarts.Sorceress, broken), false);
});

test('notable from the wrong ascendancy refuses', async () => {
  const wrongAsc = (await b.passiveNodes()).find((p) => p.asc && !/^Sorceress/.test(p.asc) && p.kind === 'ascNotable');
  const res = await resolveSpec(b, planner, {
    class: 'sorceress', ascendancy: 'stormweaver', skills: [], notables: [wrongAsc.h],
  });
  const tree = await allocateSpecTree(b, res);
  assert.equal(tree.error.code, 'invalid');
});
