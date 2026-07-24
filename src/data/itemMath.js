// Build-step projector for Phase 7 light math. Graph-only, mirrors planner.js /
// modPools.js. Emits per-class base attributes, gem crafting levels, and per-item
// equip requirements + the fixed stat lines that parse to a whitelist stat.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStat, stripStatMarkup } from '../../public/js/build-math.js';
import { plannerData } from './planner.js';
import { listUniques } from './uniques.js';
import { nodesByKind, getNode, edgesFrom } from './graph.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'source', 'repoe-poe2');

function classBaseByName() {
  const chars = JSON.parse(fs.readFileSync(path.join(SRC, 'characters.json'), 'utf8'));
  const byName = new Map();
  for (const c of chars) {
    const b = c.base_stats || {};
    byName.set(String(c.name).toLowerCase(), {
      str: b.strength ?? 0, dex: b.dexterity ?? 0, int: b.intelligence ?? 0,
      life: b.life ?? 0, mana: b.mana ?? 0,
    });
  }
  return byName;
}

// Keep only the lines that parse to a whitelist stat. Feeding EVERY source stat
// line through parseStat here is the build-time proof that the parser stays clean
// against real data; the browser re-parses the same kept lines at runtime.
function keepWhitelist(lines) {
  const kept = [];
  for (const raw of lines || []) {
    const t = stripStatMarkup(raw);
    if (t && parseStat(t)) kept.push(t);
  }
  return kept;
}

export function itemMath() {
  const pd = plannerData();
  const byName = classBaseByName();
  const classBase = {};
  for (const c of pd.classes) classBase[c.slug] = byName.get(c.slug.toLowerCase()) || { str: 0, dex: 0, int: 0, life: 0, mana: 0 };

  // Gem crafting level (character-level gate) from the gem nodes.
  const gemLevel = {};
  for (const n of nodesByKind('gem')) {
    const lvl = n.props?.craftingLevel;
    if (typeof lvl === 'number') gemLevel[n.slug] = lvl;
  }

  // Per-item requirements + whitelist lines.
  const items = {};
  const uniqueNodes = new Map(nodesByKind('unique').map((n) => [n.slug, n]));
  // Uniques: full stat lines (implicits + explicits) via listUniques(); requirement
  // is inherited from the unique's base item through the graph's has_base edge.
  for (const u of listUniques()) {
    const uniqueNode = uniqueNodes.get(u.slug);
    const baseEdge = uniqueNode && edgesFrom(uniqueNode.id, 'has_base')[0];
    const baseNode = baseEdge && getNode(baseEdge.to);
    const req = baseNode ? requirementFromNode(baseNode) : { level: 0, str: 0, dex: 0, int: 0 };
    items[u.slug] = { req, lines: keepWhitelist(u.stats) };
  }
  // Bases: requirement strings and resolved implicit text from the graph node.
  for (const b of nodesByKind('base')) {
    const req = requirementFromNode(b);
    const lines = keepWhitelist((b.props?.implicitTexts || []).map((x) => (typeof x === 'string' ? x : x?.text)));
    items[b.slug] = { req, lines };
  }
  return { classBase, gemLevel, items };
}

// Base graph nodes store already-formatted requirement strings: "Level 6",
// "9 Str", "9 Dex", and "9 Int".
function requirementFromNode(node) {
  const req = { level: 0, str: 0, dex: 0, int: 0 };
  for (const line of node?.props?.requirements || []) {
    const m = String(line).match(/^(\d+)\s+(Str|Dex|Int)$/);
    if (m) req[{ Str: 'str', Dex: 'dex', Int: 'int' }[m[2]]] = Number(m[1]);
    const level = String(line).match(/^Level\s+(\d+)$/);
    if (level) req.level = Number(level[1]);
  }
  return req;
}
