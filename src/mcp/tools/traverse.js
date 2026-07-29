// src/mcp/tools/traverse.js — layer-2 fallback: one composed, typed multi-hop
// chain per call, so the model never shuttles intermediate id lists through
// its context. Constrained hop structure — never raw SQL.
import { err, refOf, MAX_LIMIT } from './util.js';

export const RELATIONS = ['default_skill', 'fits_slot', 'grants', 'has_base', 'in_ascendancy',
  'in_class', 'pool_source', 'recommends_support', 'rolls_on', 'sockets_into', 'tagged'];
const REL_SET = new Set(RELATIONS);
const FRONTIER_CAP = 500;

export async function traverse(backend, { start, hops, limit = 50 }) {
  const cap = Math.min(limit, MAX_LIMIT);
  if (!Array.isArray(hops) || hops.length < 1 || hops.length > 4) {
    return err('invalid', 'hops must be an array of 1-4 steps', { relations: RELATIONS });
  }
  for (const h of hops) {
    if (!REL_SET.has(h.relation)) return err('invalid', `unknown relation '${h.relation}'`, { relations: RELATIONS });
    if (h.direction !== 'out' && h.direction !== 'in') return err('invalid', `direction must be 'out' or 'in'`);
  }
  const origin = await backend.nodeBySlug(start.kind, start.slug);
  if (!origin) return err('not_found', `no ${start.kind} with slug '${start.slug}' — resolve names with find() first`);

  let frontier = [origin.id];
  const hopCounts = [];
  let capped = false;
  for (const hop of hops) {
    // One batched query per hop instead of one per frontier node — a wide
    // frontier (capped at 500) would otherwise spend one D1 subrequest per
    // node, blowing past the Workers free-tier subrequest cap well before
    // FRONTIER_CAP is reached.
    const edges = hop.direction === 'in'
      ? await backend.edgesToMany(frontier, hop.relation)
      : await backend.edgesFromMany(frontier, hop.relation);
    const next = new Set();
    for (const e of edges) {
      next.add(hop.direction === 'in' ? e.from : e.to);
      if (next.size >= FRONTIER_CAP) { capped = true; break; }
    }
    frontier = [...next];
    hopCounts.push(frontier.length);
  }
  const nodes = await backend.nodesByIds(frontier.slice(0, cap));
  return {
    hop_counts: hopCounts,
    total: frontier.length,
    results: nodes.map(refOf),
    truncated: capped || frontier.length > cap,
  };
}
