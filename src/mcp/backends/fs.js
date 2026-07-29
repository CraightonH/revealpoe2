// src/mcp/backends/fs.js
// fs-side implementation of the MCP backend interface. This is the ONLY mcp
// module allowed to touch the filesystem or src/data (which reads build/graph.json).
// The Worker uses backends/d1.js; the two must stay behaviourally identical
// (test/mcp/backend-suite.js is the contract).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNode, nodeBySlug, nodesByKind, edgesFrom, edgesTo } from '../../data/graph.js';
import { plannerData } from '../../data/planner.js';
import { KINDS } from '../kinds.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TREE_PATH = path.join(ROOT, 'public', 'generated', 'passive-tree.json');

export function createFsBackend() {
  let _planner = null;
  let _tree = null;
  let _schemaInfo = null;
  let _adj = null;
  let _passives = null;

  const planner = () => (_planner ??= plannerData());
  const tree = () => (_tree ??= JSON.parse(fs.readFileSync(TREE_PATH, 'utf8')));

  function buildable(n) {
    if (n.kind === 'gem') return Boolean(planner().gems[n.slug]);
    if (n.kind === 'base' || n.kind === 'unique') return Boolean(planner().items[n.slug]);
    return null;
  }
  const wrap = (n) => (n ? { ...n, buildable: buildable(n) } : null);
  const edge = (e) => ({ type: e.type, from: e.from, to: e.to });

  function schemaInfo() {
    if (_schemaInfo) return _schemaInfo;
    const kinds = {};
    for (const k of KINDS) kinds[k] = nodesByKind(k).length;
    const rel = new Map();
    for (const k of KINDS) {
      for (const n of nodesByKind(k)) {
        for (const e of edgesFrom(n.id)) {
          const r = rel.get(e.type) ?? { type: e.type, from: new Set(), to: new Set(), count: 0 };
          r.from.add(k);
          const toNode = getNode(e.to);
          if (toNode) r.to.add(toNode.kind);
          r.count++;
          rel.set(e.type, r);
        }
      }
    }
    _schemaInfo = {
      kinds,
      relations: [...rel.values()]
        .map((r) => ({ type: r.type, from: [...r.from].sort(), to: [...r.to].sort(), count: r.count }))
        .sort((a, b) => a.type.localeCompare(b.type)),
    };
    return _schemaInfo;
  }

  function passives() {
    if (_passives) return _passives;
    const byHash = new Map();
    for (const n of tree().nodes) {
      byHash.set(n.h, { h: n.h, name: n.name ?? null, kind: n.k, asc: n.asc ?? null, attr: n.attr ? 1 : 0 });
    }
    _passives = byHash;
    return _passives;
  }

  return {
    async getNode(id) { return wrap(getNode(id)); },
    async nodeBySlug(kind, slug) { return wrap(nodeBySlug(kind, slug)); },
    async nodesByName(name, kinds = null) {
      const want = String(name).toLowerCase();
      const out = [];
      for (const k of kinds ?? KINDS) {
        for (const n of nodesByKind(k)) if (n.name.toLowerCase() === want) out.push(wrap(n));
      }
      return out;
    },
    async nodesByIds(ids) { return ids.map((id) => wrap(getNode(id))).filter(Boolean); },
    async edgesFrom(id, type = null) { return edgesFrom(id, type ?? undefined).map(edge); },
    async edgesTo(id, type = null) { return edgesTo(id, type ?? undefined).map(edge); },
    async search(query, { kind = null, limit = 25 } = {}) {
      const q = String(query).toLowerCase();
      const tokens = q.split(/\s+/).filter(Boolean);
      if (!tokens.length) return [];
      const scored = [];
      for (const k of kind ? [kind] : KINDS) {
        for (const n of nodesByKind(k)) {
          const name = n.name.toLowerCase();
          const hay = `${name}\n${n.search ?? ''}`;
          if (!tokens.every((t) => hay.includes(t))) continue;
          const score = name === q ? 0 : name.includes(q) ? 1 : 2;
          scored.push({ score, n });
        }
      }
      scored.sort((a, b) => a.score - b.score || a.n.name.localeCompare(b.n.name));
      return scored.slice(0, limit).map(({ n }) => ({ id: n.id, kind: n.kind, name: n.name, slug: n.slug }));
    },
    async schemaInfo() { return schemaInfo(); },
    async meta() {
      // graph.js keeps meta private; read the fields off the artifact directly.
      const { meta } = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'graph.json'), 'utf8'));
      return { sourceHash: meta.sourceHash, manualHash: meta.manualHash, builtAt: null };
    },
    async planner() { return planner(); },
    async passiveAdj() {
      if (_adj) return _adj;
      const adj = new Map();
      const add = (x, y) => { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); };
      for (const e of tree().edges) { add(e.a, e.b); add(e.b, e.a); }
      _adj = adj;
      return _adj;
    },
    async passiveNodes() { return [...passives().values()]; },
    async passiveNode(h) { return passives().get(h) ?? null; },
    async passiveNodesByName(name) {
      const want = String(name).toLowerCase();
      return [...passives().values()].filter((p) => (p.name ?? '').toLowerCase() === want);
    },
    async treeMeta() {
      const m = tree().meta;
      const classAttrs = Object.fromEntries(Object.entries(m.classArt ?? {}).map(([n, c]) => [n, c.attr]));
      return {
        classStarts: m.classStarts, ascStarts: m.ascStarts, ascByClass: m.ascByClass,
        classAttrs, pointBudget: m.pointBudget, ascendancyBudget: m.ascendancyBudget,
      };
    },
  };
}
