// public/js/passive-path.js
// Pure shortest-path finder for the passive tree. Multi-source BFS from the
// allocated frontier (allocated ∪ starts) to a hovered target, minimising nodes
// (= fewest passive points), tie-broken to route through the fewest generic
// "+5 to any Attribute" filler nodes when two routes are the same length. No
// DOM; node-testable (test/passivePath.test.js).
//
// Used by the renderer's hover-path preview and one-click path allocation:
// clicking a node allocates every hash this returns, in order.

// Lexicographic cost: composite = dist * COST_W + attrCount, so the heap orders
// by (hops, then attr-filler count). COST_W just needs to exceed any realistic
// attrCount (≤ total nodes, a few thousand) so it never overflows into the dist
// digit — 2^22 ≈ 4.19M is comfortably above the ~1500-node tree.
const COST_W = 1 << 22;

// Minimal binary min-heap keyed by a numeric `key`. Avoids an O(V²) scan so a
// per-hover path computation over the full tree stays sub-millisecond.
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(key, h) {
    const a = this.a;
    a.push({ key, h });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].key <= a[i].key) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      const n = a.length;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < n && a[l].key < a[m].key) m = l;
        if (r < n && a[r].key < a[m].key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Shortest allocation path from the frontier to `target`.
 *
 * @param {Map<number, number[]>} adj  adjacency map (hash -> neighbour hashes)
 * @param {Iterable<number>} sources   the frontier: allocated nodes ∪ starts
 * @param {number} target              the hovered node to reach
 * @param {object} [opts]
 * @param {(h:number)=>boolean} [opts.isPathable]  node may be traversed/allocated
 *        (visible, unlocked, not a non-active ascendancy). Defaults to allow all.
 *        Sources are always valid origins regardless of this predicate.
 * @param {(h:number)=>boolean} [opts.isAttr]      node is generic-attribute filler;
 *        equal-length routes prefer fewer of these. Defaults to none.
 * @returns {number[]|null}  ordered hashes from the frontier (exclusive) to
 *        `target` (inclusive) — exactly the nodes that would be newly allocated —
 *        or null if `target` is already a source or is unreachable.
 */
export function shortestPath(adj, sources, target, opts = {}) {
  const isPathable = opts.isPathable || (() => true);
  const isAttr = opts.isAttr || (() => false);
  const srcSet = sources instanceof Set ? sources : new Set(sources);
  if (srcSet.has(target)) return null; // already allocated — nothing to add

  const best = new Map(); // hash -> best composite cost seen
  const prev = new Map(); // hash -> predecessor on the best path
  const heap = new MinHeap();
  for (const s of srcSet) { best.set(s, 0); heap.push(0, s); }

  while (heap.size) {
    const { key, h } = heap.pop();
    if (key > (best.get(h) ?? Infinity)) continue; // stale heap entry
    if (h === target) break;
    for (const nb of adj.get(h) ?? []) {
      if (srcSet.has(nb)) continue;     // never route back through the frontier
      if (!isPathable(nb)) continue;    // can't traverse or allocate this node
      const nk = key + COST_W + (isAttr(nb) ? 1 : 0);
      if (nk < (best.get(nb) ?? Infinity)) {
        best.set(nb, nk);
        prev.set(nb, h);
        heap.push(nk, nb);
      }
    }
  }

  if (!best.has(target)) return null; // unreachable
  const path = [];
  let cur = target;
  while (cur != null && !srcSet.has(cur)) { path.push(cur); cur = prev.get(cur); }
  path.reverse();
  return path.length ? path : null;
}
