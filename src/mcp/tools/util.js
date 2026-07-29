// src/mcp/tools/util.js — shared helpers for the pure tool layer.
// HARD RULE: nothing in src/mcp/tools/ may import node:fs (directly or
// transitively); backends are injected. slugify is pure and allowed.
import { slugify } from '../../data/slug.js';

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export const err = (code, message, extra = {}) => ({ error: { code, message, ...extra } });
export const refOf = (n) => ({ kind: n.kind, slug: n.slug, name: n.name });

export function capList(list, cap = DEFAULT_LIMIT) {
  return list.length > cap
    ? { items: list.slice(0, cap), truncated: true, total: list.length }
    : { items: list, truncated: false, total: list.length };
}

export function summarizeByClass(nodes) {
  const counts = new Map();
  for (const n of nodes) {
    const cls = n.props?.className ?? n.kind;
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([cls, n]) => `${n} ${cls}`);
}

// Resolve a user-supplied name to exactly one node among `kinds`.
// Slug matches collect across ALL kinds first (slugs are only unique within a
// kind — cross-kind collisions), then exact name. >1 hit => ambiguous.
export async function resolveRef(backend, kinds, name) {
  const slug = slugify(String(name));
  const slugHits = (await Promise.all(kinds.map((k) => backend.nodeBySlug(k, slug)))).filter(Boolean);
  if (slugHits.length === 1) return { node: slugHits[0] };
  if (slugHits.length > 1) return { ambiguous: slugHits.map(refOf) };
  const nameHits = await backend.nodesByName(String(name), kinds);
  if (nameHits.length === 1) return { node: nameHits[0] };
  if (nameHits.length > 1) return { ambiguous: nameHits.map(refOf) };
  return { notFound: true };
}
