// src/data/modPools.js
//
// Build-time projection of the rollable-affix graph into the lean
// `mod-pools.json` artifact the Build Planner's mod picker consumes in the
// browser. Reads ONLY the graph (src/data/graph.js) — no source files.
//
// Normalized to stay small (measured: 2.32 MB raw / 0.10 MB gzip):
//   families  affixSlug -> { name, origin, scope, generic, tiers[] }
//   bases     baseSlug  -> [{ a: affixSlug, t?: allowedTierIndices }]
//   uniques   uniqueSlug -> baseSlug   (corrupted-implicit lookup)
//
// Only `standard` (craftable prefix/suffix) and `corrupted` (Vaal implicit)
// origins are projected; `desecrated` is out of scope for the planner picker.
import { nodesByKind, edgesTo, edgesFrom, getNode } from './graph.js';
import { stripGameText } from './keywords.js';
import { toGenericText } from './affixText.js';

const KEEP = new Set(['standard', 'corrupted']);

// Tier generation bucket for the client's prefix/suffix/corrupted partition.
// Standard mods split on their source generation type; corrupted mods are a
// flat implicit pool.
function genOf(origin, generationType) {
  if (origin === 'corrupted') return 'corrupted';
  return generationType === 'suffix' ? 'suffix' : 'prefix';
}

export function modPools() {
  const families = {};
  const affixById = new Map(); // node id -> node (for edge resolution)

  for (const node of nodesByKind('affix')) {
    if (!KEEP.has(node.props.origin)) continue;
    affixById.set(node.id, node);
    const tiers = [...node.props.tiers].sort((a, b) => a.level - b.level);
    const top = tiers[tiers.length - 1];
    families[node.slug] = {
      name: node.name,
      origin: node.props.origin,
      scope: node.props.scope,
      generic: stripGameText(toGenericText(top.text)),
      tiers: tiers.map((t) => ({
        id: t.id,
        name: t.name,
        level: t.level,
        gen: genOf(node.props.origin, t.generationType),
        text: stripGameText(t.text),
      })),
    };
  }

  // Per-base eligibility: walk rolls_on edges into each base. The edge's
  // props.tiers (allowed indices, standard/corrupted) is preserved as `t`;
  // absent => all tiers eligible. Tier order here matches families[].tiers
  // (both sorted ascending by level), so the indices line up.
  const bases = {};
  for (const base of nodesByKind('base')) {
    const refs = [];
    for (const e of edgesTo(base.id, 'rolls_on')) {
      const affix = affixById.get(e.from);
      if (!affix) continue; // desecrated / dropped origins
      const ref = { a: affix.slug };
      if (Array.isArray(e.props?.tiers)) ref.t = [...e.props.tiers].sort((x, y) => x - y);
      refs.push(ref);
    }
    if (refs.length) bases[base.slug] = refs;
  }

  // Unique -> base slug, so the picker can find a unique's corrupted pool.
  const uniques = {};
  for (const u of nodesByKind('unique')) {
    const be = edgesFrom(u.id, 'has_base')[0];
    const base = be && getNode(be.to);
    if (base) uniques[u.slug] = base.slug;
  }

  return { families, bases, uniques };
}
