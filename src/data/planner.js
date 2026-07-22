// src/data/planner.js
//
// Presentation/runtime adapter that projects the gear-slot + skill-gem graph
// facts into the lean `planner-data.json` artifact the Build Planner consumes in
// the browser. Reads ONLY the graph (src/data/graph.js) — no source files.
//
//   slots  ordered gear-slot metadata (paper-doll layout + weapon-set groups)
//   items  slug -> { slots, twoHanded, class, requiresMainhand? }  (bases + uniques)
//   gems   slug -> { gemType, maxSupports, color, reqs }           (setup validation)
//   granted    unique slug -> granted gem slugs
//   recommends gem slug -> recommended support gem slugs
//
// Two-hand occupancy is derived here from the source `twohand` tag; uniques
// inherit their base's slot mapping through the has_base edge.
import { nodesByKind, edgesTo, edgesFrom, getNode } from './graph.js';

const SUPPORTABLE = new Set(['active', 'spirit']); // gem types that take support sockets
const DEFAULT_MAX_SUPPORTS = 5; // source has no per-gem socket count (see Phase 2 spec)

export function plannerData() {
  const slotNodes = nodesByKind('gear-slot');

  const slots = slotNodes
    .map((n) => ({
      id: n.slug,
      name: n.name,
      group: n.props.group ?? null,
      accepts: n.props.accepts ?? null,
      order: n.props.order ?? null,
    }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // Bases: walk fits_slot edges into each slot.
  const items = {};
  for (const slot of slotNodes) {
    for (const e of edgesTo(slot.id, 'fits_slot')) {
      const base = getNode(e.from);
      if (!base) continue;
      let rec = items[base.slug];
      if (!rec) {
        rec = items[base.slug] = {
          slots: [],
          twoHanded: (base.props.tags ?? []).includes('twohand'),
          class: base.props.classSlug ?? null,
        };
      }
      if (!rec.slots.includes(slot.slug)) rec.slots.push(slot.slug);
      if (e.props?.requiresMainhand) rec.requiresMainhand = e.props.requiresMainhand;
    }
  }

  // Uniques inherit their base's slot legality via has_base.
  for (const u of nodesByKind('unique')) {
    const baseEdge = edgesFrom(u.id, 'has_base')[0];
    if (!baseEdge) continue;
    const base = getNode(baseEdge.to);
    const baseRec = base ? items[base.slug] : null;
    if (!baseRec) continue;
    items[u.slug] = {
      slots: [...baseRec.slots],
      twoHanded: baseRec.twoHanded,
      class: baseRec.class,
      ...(baseRec.requiresMainhand ? { requiresMainhand: baseRec.requiresMainhand } : {}),
    };
  }

  // Gems: setup-validation facts. maxSupports defaults to 5 for supportable gems.
  const gems = {};
  for (const g of nodesByKind('gem')) {
    const gemType = g.props.gemType ?? null;
    gems[g.slug] = {
      gemType,
      maxSupports: SUPPORTABLE.has(gemType) ? DEFAULT_MAX_SUPPORTS : 0,
      color: g.props.color ?? null,
      reqs: g.props.requirementWeights ?? null,
    };
  }

  // Item-granted skills: grants edges point unique -> gem-kind node (the
  // granted skill is a gem node; it resolves in the search index too).
  const granted = {};
  for (const u of nodesByKind('unique')) {
    const skills = [...new Set(
      edgesFrom(u.id, 'grants').map((e) => getNode(e.to)).filter((n) => n && gems[n.slug]).map((n) => n.slug),
    )];
    if (skills.length) granted[u.slug] = skills;
  }

  // Recommended supports, source edge order -- the picker ranks these first.
  const recommends = {};
  for (const g of nodesByKind('gem')) {
    const sups = edgesFrom(g.id, 'recommends_support')
      .map((e) => getNode(e.to)).filter((n) => n?.props.gemType === 'support').map((n) => n.slug);
    if (sups.length) recommends[g.slug] = sups;
  }

  return { slots, items, gems, granted, recommends };
}
