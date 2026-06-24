// scripts/graph/passives.js
//
// Build-time resolver for passive tree nodes. Emits one `passive` node per
// keystone/notable (incl. ascendancy notables) and one `ascendancy` node per
// live ascendancy. Stat-id -> English string resolution runs here (the
// passive_skill_stat_descriptions map over the general stat_descriptions map);
// the resolved strings are stored raw — keyword linkification stays in the app
// (graph rule #8), exactly the uniques split. Two edge kinds connect them:
// `grants` (passive -> granted gem) and `in_ascendancy` (ascNotable -> ascendancy).
//
// src/data/passiveTree.js consumes these nodes/edges and owns all rendering; it
// no longer reads $POE2DATADIR.
import { loadJson } from '../../src/data/loader.js';
import { REPOE } from '../../src/config.js';
import { makeNode, makeEdge, KINDS, EDGE_TYPES } from './schema.js';

// ---------------------------------------------------------------------------
// Stat translation (verbatim logic from src/data/passiveTree.js buildStatMap /
// rawString, minus the renderGameText/stripGameText steps — those stay app-side).
// ---------------------------------------------------------------------------
let _statMap = null;
function statMap() {
  if (_statMap) return _statMap;
  const general = loadJson(`${REPOE}/stat_translations/stat_descriptions.json`);
  const passive = loadJson(`${REPOE}/stat_translations/passive_skill_stat_descriptions.json`);
  _statMap = new Map();
  // general first so passive-specific entries override
  for (const entry of general) {
    const eng = entry.English?.[0];
    if (!eng) continue;
    for (const id of entry.ids ?? []) _statMap.set(id, eng);
  }
  for (const entry of passive) {
    const eng = entry.English?.[0];
    if (!eng) continue;
    for (const id of entry.ids ?? []) _statMap.set(id, eng);
  }
  return _statMap;
}

function rawString(entry, val) {
  return entry.format?.[0] === 'ignore' ? entry.string : entry.string.replace('{0}', val);
}

// Resolved (value-substituted) English lines for a stats object, in source order.
// Raw text — no keyword linkification, no HTML.
function resolveStatLines(stats) {
  const map = statMap();
  const lines = [];
  for (const [id, val] of Object.entries(stats ?? {})) {
    const entry = map.get(id);
    if (!entry) continue;
    for (const line of rawString(entry, val).split('\n')) {
      if (line.trim()) lines.push(line);
    }
  }
  return lines;
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
