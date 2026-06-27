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
  for (const [hStr, n] of Object.entries(rawNodes)) {
    if (hStr === 'root') continue;
    if (n.isMastery) continue;
    if (n.x == null || n.y == null) continue;
    const h = Number(hStr);
    const k = kindOf(n);
    keep.add(h);
    nodes.push({
      h,
      x: Math.round(n.x),
      y: Math.round(n.y),
      k,
      name: n.name ?? '',
      icon: n.icon ?? null,
      iconKind: iconKindOf(k),
      stats: Array.isArray(n.stats) ? n.stats : [],
      asc: n.ascendancyId ?? null,
      hidden: classStartHashes.has(h) || undefined, // class-start roots: anchor only
      ws: 0,
    });
  }

  // Edges: straight (bare) or arc (orbit center given). Drop edges touching a
  // dropped node (root/mastery). De-dupe undirected pairs.
  const pos = new Map(nodes.map((n) => [n.h, n]));
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
      edges.push({ a, b, arc: arcFor(na.x, na.y, nb.x, nb.y, e.orbitX, e.orbitY) });
    } else {
      edges.push({ a, b });
    }
  }

  // Classes → start node + central illustration placement. A start node carries
  // classStartIndex [i, …] indexing into d.classes; map each class to its node.
  const classStarts = {};
  const classes = {};
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
  });

  return {
    nodes,
    edges,
    classStarts,
    classes,
    extent: { minX: d.min_x, minY: d.min_y, maxX: d.max_x, maxY: d.max_y },
  };
}
