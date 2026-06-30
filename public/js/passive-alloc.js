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

export function setMask(weaponState, hash) {
  return weaponState.has(hash) ? weaponState.get(hash) : 3;
}

export function toggleSet(weaponState, hash, setNo) {
  const bit = setNo === 1 ? 1 : 2;
  const next = new Map(weaponState);
  const cur = next.has(hash) ? next.get(hash) : 3;
  next.set(hash, cur ^ bit);
  return next;
}
