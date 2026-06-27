// scripts/graph/gggTree.js — parser for GGG's official passive-tree dataset
// (data/source/ggg-poe2/passive-tree.json, fetched by scripts/fetch-ggg-tree.js).
// Build-time only. This is the authoritative geometry/structure source for the
// passive tree render artifact: absolute node positions, node kinds, icon paths,
// pre-translated stats, and — crucially — precomputed per-edge arc geometry so
// connections sweep instead of cross.
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './source.js';

const REL = 'ggg-poe2/passive-tree.json';

let _raw = null;
function rawData() {
  if (_raw) return _raw;
  const p = path.join(getDataDir(), REL);
  if (!fs.existsSync(p)) {
    throw new Error(`GGG tree data missing: ${p}\nRun: node scripts/fetch-ggg-tree.js`);
  }
  _raw = JSON.parse(fs.readFileSync(p, 'utf8')).context.data;
  return _raw;
}

// GGG node names carry description tokens: "[Ref|Display]" shows Display and
// "[Word]" shows Word — e.g. "[SinisterJewelSockets|Sinister] [Jewel] Socket"
// -> "Sinister Jewel Socket". Reduce ref|display tokens to their display word,
// then strip the brackets off the remaining bare tokens. Mirrors the same
// two-step pass in src/data/affixText.js.
function cleanName(name) {
  return name
    .replace(/\[[^\]|]*\|([^\]]*)\]/g, '$1')
    .replace(/[[\]]/g, '');
}

// Node kind from GGG flags. Masteries are auto-activated pass-throughs (not
// selectable — see TODO #7) and are dropped entirely, like the RePoE path did.
function kindOf(n) {
  if (n.isJewelSocket) return 'jewel';
  if (n.isAscendancyStart) return 'ascStart';
  if (n.ascendancyId) return n.isNotable ? 'ascNotable' : 'ascSmall';
  if (n.isKeystone) return 'keystone';
  if (n.isNotable) return 'notable';
  return 'small';
}

// Atlas icon-prefix (skills.json keys are `${prefix}${Active|Inactive}:${icon}`).
function iconKindOf(k) {
  if (k === 'keystone') return 'keystone';
  if (k === 'notable' || k === 'ascNotable') return 'notable';
  return 'normal';
}

// Minor-arc parameters in canvas convention (angle 0 = +x, +y downward).
function arcFor(ax, ay, bx, by, cx, cy) {
  const r = Math.hypot(ax - cx, ay - cy);
  const a0 = Math.atan2(ay - cy, ax - cx);
  const a1 = Math.atan2(by - cy, bx - cx);
  let d = a1 - a0;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return { cx, cy, r, a0, a1, ccw: d < 0 };
}

export function parseGggTree() {
  const d = rawData();
  const rawNodes = d.nodes;

  // Keep only renderable nodes: skip the synthetic root, masteries, and any
  // class-start roots are kept but flagged hidden (anchors for allocation).
  const classStartHashes = new Set();
  for (const [h, n] of Object.entries(rawNodes)) {
    if (Array.isArray(n.classStartIndex)) classStartHashes.add(Number(h));
  }

  const nodes = [];
  const keep = new Set();
  const ascStarts = {}; // ascendancyId -> start node hash
  for (const [hStr, n] of Object.entries(rawNodes)) {
    if (hStr === 'root') continue;
    if (n.isMastery) continue;
    if (n.x == null || n.y == null) continue;
    const h = Number(hStr);
    const k = kindOf(n);
    keep.add(h);
    if (n.isAscendancyStart && n.ascendancyId) ascStarts[n.ascendancyId] = h;
    // unlockConstraint: a set of "locked" nodes that only become visible once
    // their gating node(s) are allocated — e.g. Oracle's "The Unseen Path" (node
    // 5571) reveals ~190 main-tree "Paths Not Taken" nodes. These carry no
    // ascendancyId, so without this gate they'd render in the main tree always.
    const uc = n.unlockConstraint;
    const lock = uc && Array.isArray(uc.nodes) && uc.nodes.length
      ? { nodes: uc.nodes.map(Number), asc: uc.ascendancy ?? null }
      : undefined;
    nodes.push({
      h,
      x: Math.round(n.x),
      y: Math.round(n.y),
      k,
      name: cleanName(n.name ?? ''),
      icon: n.icon ?? null,
      iconKind: iconKindOf(k),
      stats: Array.isArray(n.stats) ? n.stats : [],
      asc: n.ascendancyId ?? null,
      lock,
      // "+5 to any Attribute" — the player picks Str/Int/Dex when allocating.
      attr: n.isGenericAttribute || undefined,
      hidden: classStartHashes.has(h) || undefined, // class-start roots: anchor only
      ws: 0,
    });
  }

  const pos = new Map(nodes.map((n) => [n.h, n]));

  // Classes → start node + central illustration placement. A start node carries
  // classStartIndex [i, …] indexing into d.classes; map each class to its node.
  // Ascendancies hang off each class; only those with renderable nodes (a start
  // node in ascStarts) are surfaced — GGG ships a few defs with no node data.
  const classStarts = {};
  const classes = {};
  const ascByClass = {};  // className -> [{ id, name }]
  const ascArt = {};      // ascendancyId -> { art, offsetX, offsetY, class }
  const ascOf = {};       // ascendancyId -> className
  d.classes.forEach((c, i) => {
    const startHash = [...classStartHashes].find((h) =>
      (rawNodes[h].classStartIndex || []).includes(i));
    classStarts[c.name] = startHash ?? null;
    classes[c.name] = {
      start: startHash ?? null,
      art: c.image,                 // Art/2DArt/BaseClassIllustrations/<X>.png
      offsetX: c.image_offset_x ?? 0,
      offsetY: c.image_offset_y ?? 0,
      str: c.base_str, dex: c.base_dex, int: c.base_int,
    };
    for (const a of c.ascendancies || []) {
      if (ascStarts[a.id] == null) continue; // no renderable cluster — skip
      (ascByClass[c.name] ||= []).push({ id: a.id, name: a.name });
      ascOf[a.id] = c.name;
      ascArt[a.id] = {
        art: a.image,
        offsetX: a.offsetX ?? 0,
        offsetY: a.offsetY ?? 0,
        class: c.name,
      };
    }
  });

  // Translate each ascendancy cluster so its start node lands on its owning
  // class's hexagon start node (per the in-game layout: the ascendancy sub-tree
  // occupies the central ring, entering from the class start position). Nodes
  // and their arc-edge centres shift by the same delta so connectors stay true.
  // Hidden unless the ascendancy is selected, so baking centred coords is safe.
  const ascDelta = {}; // ascendancyId -> { dx, dy }
  for (const [ascId, startHash] of Object.entries(ascStarts)) {
    const className = ascOf[ascId];
    const classStartHash = className ? classStarts[className] : null;
    const ascStartNode = pos.get(startHash);
    const classStartNode = classStartHash != null ? pos.get(classStartHash) : null;
    if (!ascStartNode || !classStartNode) continue;
    ascDelta[ascId] = {
      dx: classStartNode.x - ascStartNode.x,
      dy: classStartNode.y - ascStartNode.y,
    };
  }
  for (const n of nodes) {
    const d2 = n.asc != null ? ascDelta[n.asc] : null;
    if (!d2) continue;
    n.x += d2.dx;
    n.y += d2.dy;
  }

  // Edges: straight (bare) or arc (orbit center given). Drop edges touching a
  // dropped node (root/mastery). De-dupe undirected pairs. Arc centres for
  // intra-ascendancy edges shift by the cluster delta (node coords already did).
  const seen = new Set();
  const edges = [];
  for (const e of d.edges) {
    const a = Number(e.from), b = Number(e.to);
    if (!keep.has(a) || !keep.has(b)) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (e.orbit && e.orbitX != null && e.orbitY != null) {
      const na = pos.get(a), nb = pos.get(b);
      const d2 = na.asc != null ? ascDelta[na.asc] : null;
      const cx = e.orbitX + (d2 ? d2.dx : 0);
      const cy = e.orbitY + (d2 ? d2.dy : 0);
      edges.push({ a, b, arc: arcFor(na.x, na.y, nb.x, nb.y, cx, cy) });
    } else {
      edges.push({ a, b });
    }
  }

  return {
    nodes,
    edges,
    classStarts,
    classes,
    ascStarts,
    ascByClass,
    ascArt,
    extent: { minX: d.min_x, minY: d.min_y, maxX: d.max_x, maxY: d.max_y },
  };
}
