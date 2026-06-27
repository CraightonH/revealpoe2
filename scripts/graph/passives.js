// scripts/graph/passives.js
//
// Build-time resolver for passive tree nodes. Emits one `passive` node per
// keystone/notable (incl. ascendancy notables) and one `ascendancy` node per
// live ascendancy. Stat-id -> English string resolution delegates to
// passiveSource.resolveStatLines (single source of truth); resolved strings are
// stored raw — keyword linkification stays in the app (graph rule #8), exactly
// the uniques split. Two edge kinds connect them:
// `grants` (passive -> granted gem) and `in_ascendancy` (ascNotable -> ascendancy).
//
// src/data/passiveTree.js consumes these nodes/edges and owns all rendering; it
// no longer reads $POE2DATADIR.
import { loadJson } from './loader.js';
import { REPOE } from './source.js';
import { makeNode, makeEdge, KINDS, EDGE_TYPES } from './schema.js';
import { resolveStatLines } from './passiveSource.js';

// ---------------------------------------------------------------------------
// treeArtPaths — every passive-tree art asset (.dds) the renderer needs staged.
//
// Returned as a flat, deduped, .dds-normalized list and stamped into the graph
// meta (build.js) for ONE reason: scripts/fetch-images.js discovers art by
// walking build/graph.json for ".dds" strings — it never reads the render
// artifact, and it runs BEFORE build:passives. Surfacing the paths here lets the
// existing fetcher download them (ggpk for illustrations, its poe2db fallback
// for the UI frames ggpk 500s on) with no pipeline reordering.
//
// Covers node frames (×3 states), orbit group backgrounds, the glow, AND the
// class/ascendancy illustrations — the latter aren't drawn yet (TODO 9 places
// them) but are staged now so they're on disk when that work lands.
// ---------------------------------------------------------------------------
export function treeArtPaths() {
  const tree = loadJson(`${REPOE}/passive_skill_trees/Default.json`);
  const asc = loadJson(`${REPOE}/ascendancies.json`);
  const out = new Set();
  // Collect every "Art/..." string leaf in an arbitrary structure. The art
  // objects also carry non-path strings ("id": "Character"); the Art/ prefix
  // filter drops those.
  const addLeaves = (o) => {
    if (typeof o === 'string') { if (o.startsWith('Art/')) out.add(o); return; }
    if (Array.isArray(o)) { o.forEach(addLeaves); return; }
    if (o && typeof o === 'object') Object.values(o).forEach(addLeaves);
  };

  addLeaves(tree.art); // main-tree frames + group backgrounds + glow

  for (const v of Object.values(asc)) {
    if (v.disabled || (v.name && v.name.includes('[DNT'))) continue;
    addLeaves(v.art);                                  // ascendancy frame variants
    if (v.passive_tree_image) out.add(v.passive_tree_image); // ascendancy illustration
    // The class illustration (e.g. WarriorBaseIllustration) is buried in the
    // character metadata array; find it by content rather than a fixed index.
    if (Array.isArray(v.character)) {
      for (const s of v.character) {
        if (typeof s === 'string' && s.includes('BaseClassIllustrations')) out.add(s);
      }
    }
  }

  // Normalize to .dds so fetch-images.js's /\.dds$/ walker discovers them
  // (frame paths in source carry no extension; illustrations already do).
  return [...out].map((p) => (/\.dds$/i.test(p) ? p : `${p}.dds`)).sort();
}

// ---------------------------------------------------------------------------
// passiveNodes — keystones + notables (incl. ascendancy notables).
// ---------------------------------------------------------------------------
export function passiveNodes() {
  const tree = loadJson(`${REPOE}/passive_skill_trees/Default.json`);
  const nodes = [];
  const records = [];
  for (const p of Object.values(tree.passives)) {
    if (!p.is_keystone && !p.is_notable) continue;
    if (!p.name) continue; // unreleased placeholders (8 Ranger2 notables) — no name to label
    const id = `Passive/${p.id}`;
    const statLines = resolveStatLines(p.stats);
    const flavourText = p.flavour_text || '';
    const props = {
      kind: p.is_keystone ? 'keystone' : 'notable',
      statLines,
      flavourText,
      reminderText: Array.isArray(p.reminder_text) ? p.reminder_text : [],
      iconDds: p.icon ?? null,
      ascendancy: p.ascendancy ?? null,
    };
    const search = [p.name, ...statLines, flavourText].join(' ').toLowerCase();
    nodes.push(makeNode({ id, kind: KINDS.PASSIVE, name: p.name, slug: p.id, props, search }));
    records.push({ id, ascendancy: p.ascendancy ?? null, grantedSkillKey: p.granted_skill ?? null });
  }
  return { nodes, records };
}

// ---------------------------------------------------------------------------
// ascendancyNodes — one node per live ascendancy (groups ascNotables, rule #2).
// ---------------------------------------------------------------------------
export function ascendancyNodes() {
  const raw = loadJson(`${REPOE}/ascendancies.json`);
  const nodes = [];
  for (const [id, v] of Object.entries(raw)) {
    if (v.disabled || (v.name && v.name.includes('[DNT'))) continue;
    nodes.push(makeNode({
      id: `Ascendancy/${id}`,
      kind: KINDS.ASCENDANCY,
      name: v.name,
      slug: id,
      props: { charClass: v.character[1] },
      search: `${v.name} ${v.character[1]}`.toLowerCase(),
    }));
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// passiveEdges — `grants` (passive -> gem, only when the granted_skill key
// resolves to a gem node, mirroring getGemRefByKey) and `in_ascendancy`
// (passive -> ascendancy node).
// ---------------------------------------------------------------------------
export function passiveEdges(records, gemNodeIds, ascNodeIds) {
  const edges = [];
  for (const r of records) {
    if (r.grantedSkillKey && gemNodeIds.has(r.grantedSkillKey)) {
      edges.push(makeEdge({ type: EDGE_TYPES.GRANTS, from: r.id, to: r.grantedSkillKey }));
    }
    if (r.ascendancy) {
      const ascId = `Ascendancy/${r.ascendancy}`;
      if (ascNodeIds.has(ascId)) {
        edges.push(makeEdge({ type: EDGE_TYPES.IN_ASCENDANCY, from: r.id, to: ascId }));
      }
    }
  }
  return edges;
}
