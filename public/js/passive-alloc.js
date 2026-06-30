// public/js/passive-alloc.js
export function canAllocate(adj, allocated, starts, hash) {
  if (allocated.has(hash)) return false;
  if (starts.includes(hash)) return true;
  for (const nb of adj.get(hash) ?? []) {
    if (allocated.has(nb) || starts.includes(nb)) return true;
  }
  return false;
}

export function allocate(adj, allocated, starts, hash) {
  if (!canAllocate(adj, allocated, starts, hash)) return new Set(allocated);
  const next = new Set(allocated);
  next.add(hash);
  return next;
}

// Reachable set from starts through `allocated` (BFS), starts themselves excluded
// from removal. Anything in `allocated` not reachable is orphaned.
function reachable(adj, allocated, starts) {
  const seen = new Set();
  const q = [...starts];
  while (q.length) {
    const cur = q.shift();
    for (const nb of adj.get(cur) ?? []) {
      if (allocated.has(nb) && !seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
  }
  for (const s of starts) if (allocated.has(s)) seen.add(s); // starts are anchors: keep if allocated
  return seen;
}

export function deallocate(adj, allocated, starts, hash) {
  if (!allocated.has(hash)) return new Set(allocated);
  const trimmed = new Set(allocated);
  trimmed.delete(hash);
  return reachable(adj, trimmed, starts);
}

export function pointsSpent(allocated, nodeKindOf) {
  let main = 0, ascendancy = 0;
  for (const h of allocated) {
    if ((nodeKindOf(h) || '').startsWith('asc')) ascendancy += 1;
    else main += 1;
  }
  return { main, ascendancy };
}

// Points a candidate set of node hashes (about to be allocated) would consume,
// split into the same two pools as pointsSpent.
export function pointsNeeded(hashes, nodeKindOf) {
  let main = 0, ascendancy = 0;
  for (const h of hashes) {
    if ((nodeKindOf(h) || '').startsWith('asc')) ascendancy += 1;
    else main += 1;
  }
  return { main, ascendancy };
}

// Whether allocating `hashes` would keep both pools within budget. The pools are
// independent (main passive points vs. ascendancy points). A missing/undefined
// budget pool is treated as unbounded. Allocation is all-or-nothing per call.
export function canAfford(allocated, nodeKindOf, hashes, budgets) {
  const spent = pointsSpent(allocated, nodeKindOf);
  const need = pointsNeeded(hashes, nodeKindOf);
  return spent.main + need.main <= (budgets.main ?? Infinity) &&
         spent.ascendancy + need.ascendancy <= (budgets.ascendancy ?? Infinity);
}

// ---------------------------------------------------------------------------
// Weapon-set passive layers
//
// Each weapon set is its own allocation Set, overlaid on the shared/main tree.
// A weapon node must touch the shared frontier (mainAllocated ∪ starts) or chain
// off another node already in the SAME set — never through the other set. That
// frontier rule is what keeps "Set II can't extend off Set I, and vice versa".
// ---------------------------------------------------------------------------

// Whether a Set-k node can be allocated: adjacent to the shared frontier or a
// same-set node, not already taken in this set, and not already a shared node.
export function wsCanAllocate(adj, mainAllocated, starts, wsSet, hash) {
  if (wsSet.has(hash)) return false;
  if (mainAllocated.has(hash)) return false; // already shared — manage it in the main tree
  for (const nb of adj.get(hash) ?? []) {
    if (mainAllocated.has(nb) || starts.includes(nb) || wsSet.has(nb)) return true;
  }
  return false;
}

export function wsAllocate(adj, mainAllocated, starts, wsSet, hash) {
  if (!wsCanAllocate(adj, mainAllocated, starts, wsSet, hash)) return new Set(wsSet);
  const next = new Set(wsSet);
  next.add(hash);
  return next;
}

// The subset of `wsSet` still reachable from the shared frontier, walking only
// through other wsSet nodes (BFS). Shared anchors aren't part of the set, so
// they seed the search but aren't returned.
function wsReachable(adj, mainAllocated, starts, wsSet) {
  const seen = new Set();
  const q = [];
  const seed = (node) => {
    for (const nb of adj.get(node) ?? []) {
      if (wsSet.has(nb) && !seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
  };
  for (const s of starts) seed(s);
  for (const h of mainAllocated) seed(h);
  while (q.length) {
    const cur = q.shift();
    for (const nb of adj.get(cur) ?? []) {
      if (wsSet.has(nb) && !seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
  }
  return seen;
}

// Remove a node from a weapon set, then drop whatever it orphaned (cascade).
export function wsDeallocate(adj, mainAllocated, starts, wsSet, hash) {
  if (!wsSet.has(hash)) return new Set(wsSet);
  const trimmed = new Set(wsSet);
  trimmed.delete(hash);
  return wsReachable(adj, mainAllocated, starts, trimmed);
}

// Re-anchor a weapon set after the shared tree shrinks: drop nodes that no
// longer reach the (smaller) frontier. Call for BOTH sets on any main dealloc.
export function pruneWeaponSets(adj, mainAllocated, starts, wsSet) {
  return wsReachable(adj, mainAllocated, starts, wsSet);
}

// Whether `count` more nodes fit a weapon set's own budget (25). Missing budget
// = unbounded, mirroring canAfford.
export function wsCanAfford(wsSet, count, budget) {
  return wsSet.size + count <= (budget ?? Infinity);
}

