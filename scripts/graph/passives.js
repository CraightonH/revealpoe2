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
import { parseGggTree } from './gggTree.js';
import { buildEmotionIndex, resolveRecipe } from './emotions.js';

// Instill recipes (the 3 Distilled Emotions that craft the Instilling Orb
// granting a Notable) are GGG-tree data — RePoE carries none. Bridge them onto
// graph passives by hash (RePoE key === GGG node hash) so the notable tooltip
// shows its recipe everywhere the graph is read (detail pages, search hover,
// Theory Crafting), matching the interactive tree. Build-time resolution, same
// helpers the tree render uses (single source, can't diverge).
//
// Degrades gracefully: `build:graph` runs RePoE-only on a fresh checkout (before
// `fetch:tree`), so if the GGG source is absent we simply omit instill rather
// than fail the build.
function instillByHash() {
  let gg;
  try {
    gg = parseGggTree();
  } catch {
    return new Map(); // GGG tree source not present — skip instill
  }
  const emo = buildEmotionIndex(loadJson(`${REPOE}/base_items.json`));
  const map = new Map();
  for (const n of gg.nodes) {
    if (!n.recipe) continue;
    map.set(
      n.h,
      resolveRecipe(emo, n.recipe).map((e) => ({ key: e.key, name: e.name, iconUrl: e.iconUrl })),
    );
  }
  return map;
}

// ---------------------------------------------------------------------------
// passiveNodes — keystones + notables (incl. ascendancy notables).
// ---------------------------------------------------------------------------
export function passiveNodes() {
  const tree = loadJson(`${REPOE}/passive_skill_trees/Default.json`);
  const instill = instillByHash();
  const nodes = [];
  const records = [];
  for (const [hStr, p] of Object.entries(tree.passives)) {
    if (!p.is_keystone && !p.is_notable) continue;
    if (!p.name) continue; // unreleased placeholders (8 Ranger2 notables) — no name to label
    const id = `Passive/${p.id}`;
    const hash = Number(hStr);
    const statLines = resolveStatLines(p.stats);
    const flavourText = p.flavour_text || '';
    const props = {
      kind: p.is_keystone ? 'keystone' : 'notable',
      statLines,
      flavourText,
      reminderText: Array.isArray(p.reminder_text) ? p.reminder_text : [],
      iconDds: p.icon ?? null,
      ascendancy: p.ascendancy ?? null,
      // GGG tree node hash (the RePoE passives key). It equals the interactive
      // tree's node id, so a search/theorycraft result can deep-link straight to
      // /passives?node=<hash> and the client centers the camera on it.
      hash,
      // Instill recipe (Distilled Emotions), when this node is instillable.
      ...(instill.has(hash) ? { instill: instill.get(hash) } : {}),
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
