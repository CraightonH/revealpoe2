// test/mcp/helpers.js — shared by the build_link test files.
// Picks N real main-tree notables reachable from a class start, by plain BFS,
// so tests never hardcode notable names that a patch could rename.
export async function reachableNotables(backend, className, n = 3) {
  const [tm, adj, all] = await Promise.all([
    backend.treeMeta(), backend.passiveAdj(), backend.passiveNodes(),
  ]);
  const info = new Map(all.map((p) => [p.h, p]));
  const start = tm.classStarts[className];
  const seen = new Set([start]);
  const q = [start];
  const found = [];
  while (q.length && found.length < n) {
    const h = q.shift();
    for (const nb of adj.get(h) ?? []) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      const p = info.get(nb);
      if (!p || p.asc) continue;
      if (p.kind === 'notable') found.push(p);
      q.push(nb);
    }
  }
  return found;
}
