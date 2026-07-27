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
import { supportTier } from './gems.js';
import { slugify } from './slug.js';

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
      // Support tier = the uncut-support level needed to craft it, so the
      // planner's picker can group recommendations the way the gem detail page
      // does. 0 for actives and for untiered supports.
      tier: gemType === 'support' ? supportTier(g.props.craftingLevel) : 0,
    };
  }

  // Item-granted skills: grants edges point unique -> skill-kind node, not
  // directly at the gem. Find the granting gem by reverse-traversing the same
  // skill node's grants edges for its gem-kind source (gem -> skill also uses
  // 'grants'). Slug-matching the skill node itself only works by coincidence
  // for most skills and silently drops cases where names diverge (e.g. The
  // Last Lament's "Compose Requiem" skill is granted by the `requiem` gem).
  const granted = {};
  for (const u of nodesByKind('unique')) {
    const skillNodes = edgesFrom(u.id, 'grants').map((e) => getNode(e.to)).filter(Boolean);
    const skills = [...new Set(
      skillNodes.flatMap((skillNode) => edgesTo(skillNode.id, 'grants')
        .map((e) => getNode(e.from))
        .filter((n) => n?.kind === 'gem')
        .map((n) => n.slug)),
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

  // Character classes, derived from ascendancy nodes' charClass — the graph
  // has no standalone character-class kind ('class' nodes are item classes).
  const byClass = new Map();
  for (const a of nodesByKind('ascendancy')) {
    const cls = a.props.charClass;
    if (!cls) continue;
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push({ slug: slugify(a.name), name: a.name, gggId: a.slug });
  }
  const classes = [...byClass.entries()]
    .map(([name, ascendancies]) => ({
      slug: slugify(name), name,
      ascendancies: ascendancies.sort((x, y) => x.name.localeCompare(y.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { slots, items, gems, granted, recommends, classes };
}
