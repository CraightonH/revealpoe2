// scripts/graph/passiveSource.js — canonical parser for passive tree data. Build-time only.
import { loadJson } from './loader.js';
import { REPOE } from './source.js';

let _statMap = null;
function statMap() {
  if (_statMap) return _statMap;
  const general = loadJson(`${REPOE}/stat_translations/stat_descriptions.json`);
  const passive = loadJson(`${REPOE}/stat_translations/passive_skill_stat_descriptions.json`);
  _statMap = new Map();
  for (const entry of general) {
    if (!entry.English) continue;
    for (const id of entry.ids ?? []) _statMap.set(id, entry.English);
  }
  for (const entry of passive) {
    if (!entry.English) continue;
    for (const id of entry.ids ?? []) _statMap.set(id, entry.English);
  }
  return _statMap;
}

// Pick the translation entry whose condition matches val. Falls back to first entry.
function pickEntry(entries, val) {
  for (const e of entries) {
    const cond = e.condition?.[0];
    if (!cond) return e;
    const min = cond.min ?? -Infinity;
    const max = cond.max ?? Infinity;
    if (val >= min && val <= max) return e;
  }
  return entries[0];
}

// RePoE index_handlers transform the stored value before substitution. The
// stat data stores e.g. -20 and pairs it with a "reduced" entry whose `negate`
// handler flips it to 20 ("20% reduced", not the double-negative "-20% reduced").
// Likewise durations are stored in ms, rates per minute, etc.
const VALUE_HANDLERS = {
  negate: (v) => -v,
  add_one: (v) => v + 1,
  divide_by_one_hundred: (v) => v / 100,
  divide_by_ten_1dp_if_required: (v) => v / 10,
  milliseconds_to_seconds: (v) => v / 1000,
  milliseconds_to_seconds_2dp_if_required: (v) => v / 1000,
  per_minute_to_per_second: (v) => v / 60,
  per_minute_to_per_second_2dp_if_required: (v) => v / 60,
};

// Format a number for display: round to at most 2 decimals, drop trailing zeros
// (the "_if_required" handlers mean "show decimals only when needed").
function fmtNum(v) {
  return String(Math.round(v * 100) / 100);
}

function rawString(entries, val) {
  const e = pickEntry(entries, val);
  if (!e) return null;
  if (e.format?.[0] === 'ignore') return e.string;
  let v = val;
  for (const h of e.index_handlers?.[0] ?? []) {
    if (VALUE_HANDLERS[h]) v = VALUE_HANDLERS[h](v);
  }
  return e.string.replace('{0}', fmtNum(v));
}

// Angle convention: slot 0 points straight up (12 o'clock, -y), increasing
// clockwise. Screen y grows downward, so clockwise = +angle in screen space.
export function nodePosition(group, radiusIdx, posClockwise, orbitRadii, skillsPerOrbit) {
  const r = orbitRadii[radiusIdx];
  const slots = skillsPerOrbit[radiusIdx] || 1;
  const angle = (2 * Math.PI * posClockwise) / slots; // 0 = up, clockwise
  // Collapse floating-point noise to +0. cos/sin of exact π/2 multiples yield a
  // tiny residual (~1e-15) instead of 0; left alone, Math.round turns it into -0,
  // which fails assert/strict (Object.is) and pollutes output. The 1e-9 epsilon is
  // far below any real coordinate (orbit radii are integers), so legitimate
  // fractional positions are untouched.
  const snap = (v) => (Math.abs(v) < 1e-9 ? 0 : v);
  return {
    x: snap(group.x + r * Math.sin(angle)),
    y: snap(group.y - r * Math.cos(angle)),
  };
}

export function resolveStatLines(stats) {
  const map = statMap();
  const lines = [];
  for (const [id, val] of Object.entries(stats ?? {})) {
    const entries = map.get(id);
    if (!entries) continue;
    const str = rawString(entries, val);
    if (!str) continue;
    for (const line of str.split('\n')) {
      if (line.trim()) lines.push(line);
    }
  }
  return lines;
}

function kindOf(p) {
  if (p.is_jewel_socket) return 'jewel';
  if (p.is_ascendancy_starting_node) return 'ascStart';
  if (p.ascendancy) return p.is_notable ? 'ascNotable' : 'ascSmall';
  if (p.is_keystone) return 'keystone';
  if (p.is_notable) return 'notable';
  return 'small';
}

export function buildAdjacency(nodes, edges) {
  const adj = new Map();
  for (const n of nodes) adj.set(n.h, []);
  // Adjacency is a map OVER the named node set. Edges touching a nameless (ghost)
  // node — an unreleased placeholder that can never be allocated or rendered — are
  // dropped, so a ghost can't bridge two real nodes and create phantom connectivity
  // the allocation engine's BFS would otherwise traverse.
  for (const e of edges) {
    if (adj.has(e.a) && adj.has(e.b)) {
      adj.get(e.a).push(e.b);
      adj.get(e.b).push(e.a);
    }
  }
  return adj;
}

let _tree = null;
export function parseTree() {
  if (_tree) return _tree;
  const raw = loadJson(`${REPOE}/passive_skill_trees/Default.json`);
  const asc = loadJson(`${REPOE}/ascendancies.json`);
  const orbitRadii = raw.orbit_radii;
  const skillsPerOrbit = raw.skills_per_orbit;

  // geometry lookup: hash -> { gi, radius, posClockwise, gx, gy, x, y, connections }
  const geo = new Map();
  raw.groups.forEach((g, gi) => {
    for (const gp of g.passives ?? []) {
      const pos = nodePosition(g, gp.radius, gp.position_clockwise, orbitRadii, skillsPerOrbit);
      geo.set(gp.hash, {
        gi, radius: gp.radius, posClockwise: gp.position_clockwise,
        gx: g.x, gy: g.y, x: pos.x, y: pos.y, connections: gp.connections ?? [],
      });
    }
  });

  // Mastery nodes (is_icon_only, e.g. "Lightning Mastery") aren't selectable
  // in-game — they auto-activate as free pass-throughs when a connected node is
  // allocated. We drop them as nodes and contract them out of the edge graph below.
  const masterySet = new Set();
  for (const [hStr, p] of Object.entries(raw.passives)) {
    if (p.is_icon_only) masterySet.add(Number(hStr));
  }

  const nodes = [];
  for (const [hStr, p] of Object.entries(raw.passives)) {
    const h = Number(hStr);
    if (!p.name) continue; // unreleased placeholder, no label
    if (p.is_icon_only) continue; // mastery / decorative node — not selectable
    const g = geo.get(h);
    if (!g) continue;
    nodes.push({
      h,
      x: g.x,
      y: g.y,
      k: kindOf(p),
      name: p.name,
      slug: p.id, // matches the graph node slug (Passive/${p.id}) for card lookup
      stats: resolveStatLines(p.stats),
      iconDds: p.icon ?? null,
      asc: p.ascendancy ?? null,
      ws: p.weapon_set_points ?? 0,
    });
  }

  // Edges: direct real↔real connections plus CONTRACTION edges that bypass each
  // mastery. A mastery component's real neighbours are wired into a clique, so a
  // path that ran A→mastery→B now runs A→B directly — preserving exact in-game
  // connectivity (the mastery is a free pass-through) without keeping the node.
  const nodeHashes = new Set(nodes.map((n) => n.h));

  // Full undirected adjacency over the raw connection graph (incl. masteries).
  const fullAdj = new Map();
  for (const [h, g] of geo) {
    for (const c of g.connections) {
      if (h === c) continue;
      if (!fullAdj.has(h)) fullAdj.set(h, new Set());
      if (!fullAdj.has(c)) fullAdj.set(c, new Set());
      fullAdj.get(h).add(c);
      fullAdj.get(c).add(h);
    }
  }

  const seen = new Set();
  const pairs = [];
  const addPair = (x, y) => {
    if (x === y || !nodeHashes.has(x) || !nodeHashes.has(y)) return;
    const a = Math.min(x, y), b = Math.max(x, y);
    const key = `${a}-${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push([a, b]);
  };

  // Direct edges between two real (non-mastery) nodes.
  for (const [h, g] of geo) {
    if (masterySet.has(h)) continue;
    for (const c of g.connections) {
      if (!masterySet.has(c)) addPair(h, c);
    }
  }

  // Contraction: clique the real neighbours of each connected mastery component.
  const visitedM = new Set();
  for (const m of masterySet) {
    if (visitedM.has(m)) continue;
    const realNb = new Set();
    const q = [m];
    visitedM.add(m);
    while (q.length) {
      const cur = q.shift();
      for (const nb of fullAdj.get(cur) ?? []) {
        if (masterySet.has(nb)) { if (!visitedM.has(nb)) { visitedM.add(nb); q.push(nb); } }
        else if (nodeHashes.has(nb)) realNb.add(nb);
      }
    }
    const rn = [...realNb];
    for (let i = 0; i < rn.length; i++) {
      for (let j = i + 1; j < rn.length; j++) addPair(rn[i], rn[j]);
    }
  }

  // Classify each pair as an arc (same group + orbit) or a straight line.
  const edges = pairs.map(([a, b]) => {
    const ga = geo.get(a), gb = geo.get(b);
    if (ga && gb && ga.gi === gb.gi && ga.radius === gb.radius && ga.radius > 0) {
      const slots = skillsPerOrbit[ga.radius] || 1;
      const a0 = (2 * Math.PI * ga.posClockwise) / slots;
      const a1 = (2 * Math.PI * gb.posClockwise) / slots;
      // minor arc: go counter-clockwise iff the clockwise delta is the long way around
      const d = (a1 - a0 + 2 * Math.PI) % (2 * Math.PI);
      const ccw = d > Math.PI;
      return { a, b, arc: { cx: ga.gx, cy: ga.gy, r: orbitRadii[ga.radius], a0, a1, ccw } };
    }
    return { a, b };
  });

  const liveAscendancies = Object.entries(asc)
    .filter(([, v]) => !v.disabled && !(v.name && v.name.includes('[DNT')))
    .map(([id]) => id);

  // class start nodes are roots; ascendancy starts are the ascStart nodes.
  const ascStarts = {};
  for (const n of nodes) {
    if (n.k === 'ascStart' && n.asc) ascStarts[n.asc] = n.h;
  }

  _tree = {
    nodes,
    edges,
    meta: {
      orbitRadii,
      skillsPerOrbit,
      roots: raw.roots,
      classStarts: Object.fromEntries(
        raw.roots
          .filter(h => raw.passives[h]?.name)
          .map(h => [raw.passives[h].name, h])
      ),
      ascStarts,
      liveAscendancies,
    },
  };
  return _tree;
}
