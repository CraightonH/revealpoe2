// scripts/graph/manual.js — hand-crafted data overlay (builder-only).
//
// Implements the "Data Provenance & Hand-Crafted Data Policy" in CLAUDE.md.
// Relationships/data that genuinely aren't in RePoE source live as declarative
// overlay files under data/manual/*.json. This module loads them, expands each
// rule against the already-built SOURCE graph, and returns nodes/edges stamped
// source:'manual' (irreducible hand facts) or source:'derived' (builder-expanded
// from a rule), each derived element carrying a `via` basis pointer.
//
// Author RULES, not enumerations: an overlay states the irreducible fact (e.g.
// "this default-skill gem belongs to this weapon class") and the handler expands
// it (an edge per base in that class), so new source bases pick it up for free.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeEdge, EDGE_TYPES, SOURCES } from './schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANUAL_DIR = path.join(ROOT, 'data', 'manual');

function overlayFiles() {
  if (!fs.existsSync(MANUAL_DIR)) return [];
  return fs.readdirSync(MANUAL_DIR).filter((f) => f.endsWith('.json')).sort();
}

// Combined hash of overlay file contents, so the staleness guard can tell
// "source changed" apart from "overlay changed". Stable when data/manual is absent.
export function hashManual() {
  const h = crypto.createHash('sha256');
  for (const f of overlayFiles()) h.update(fs.readFileSync(path.join(MANUAL_DIR, f)));
  return h.digest('hex');
}

// --- Expansion handlers, keyed by an overlay file's `kind`. -----------------
// Each receives (data, ctx, via) and returns { nodes, edges, errors, warnings }.
// Referential failures (a key that no longer resolves to a live source node) are
// ERRORS — they fail the build rather than silently dropping a relationship.

// "Default attack skill per weapon class." Overlay shape:
//   { "kind": "weapon-default-skills",
//     "map": { "<default-skill gem metadata key>": "<class slug>" | ["<slug>", ...], ... } }
// A gem may serve more than one class (e.g. 2H weapons inherit the 1H default
// attack), so the value is a class slug or an array of them. Expands to a
// `default_skill` edge from every base in each class to the gem.
function expandWeaponDefaultSkills(data, ctx, via) {
  const edges = [];
  const errors = [];
  for (const [gemId, classValue] of Object.entries(data.map ?? {})) {
    const gem = ctx.node(gemId);
    if (!gem || gem.kind !== 'gem') {
      errors.push(`${via}: '${gemId}' is not a live gem node (source renamed/removed?)`);
      continue;
    }
    for (const classSlug of Array.isArray(classValue) ? classValue : [classValue]) {
      const bases = ctx.basesByClassSlug(classSlug);
      if (!bases.length) {
        errors.push(`${via}: base class slug '${classSlug}' has no bases (gem ${gemId})`);
        continue;
      }
      for (const base of bases) {
        edges.push(makeEdge({
          type: EDGE_TYPES.DEFAULT_SKILL,
          from: base.id,
          to: gemId,
          source: SOURCES.DERIVED,
          via,
        }));
      }
    }
  }
  return { nodes: [], edges, errors, warnings: [] };
}

const HANDLERS = {
  'weapon-default-skills': expandWeaponDefaultSkills,
};

// Read overlay files from disk as [{ name, data }] (sorted, deterministic). A
// file that fails to parse becomes { name, parseError } so applyOverlays can
// turn it into a build error rather than throwing here.
function loadOverlays() {
  return overlayFiles().map((file) => {
    const name = file.replace(/\.json$/, '');
    try {
      return { name, data: JSON.parse(fs.readFileSync(path.join(MANUAL_DIR, file), 'utf8')) };
    } catch (err) {
      return { name, parseError: err.message };
    }
  });
}

// Pure expansion: apply the given overlays against the source graph. Separated
// from disk I/O so the guardrails (referential integrity, retirement) are
// unit-testable. `overlays` is [{ name, data } | { name, parseError }].
// Returns the overlay's own nodes/edges plus build-blocking `errors` and
// non-blocking `warnings` (e.g. retirement notices).
export function applyOverlays({ nodes, edges, overlays }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const basesByClass = new Map();
  for (const n of nodes) {
    if (n.kind !== 'base') continue;
    const cs = n.props?.classSlug;
    if (!cs) continue;
    if (!basesByClass.has(cs)) basesByClass.set(cs, []);
    basesByClass.get(cs).push(n);
  }
  const ctx = {
    node: (id) => byId.get(id) ?? null,
    basesByClassSlug: (slug) => basesByClass.get(slug) ?? [],
  };

  const outNodes = [];
  const outEdges = [];
  const errors = [];
  const warnings = [];

  for (const ov of overlays) {
    const via = `manual:${ov.name}`;
    if (ov.parseError) {
      errors.push(`${via}: invalid JSON — ${ov.parseError}`);
      continue;
    }
    const handler = HANDLERS[ov.data.kind];
    if (!handler) {
      errors.push(`${via}: unknown overlay kind '${ov.data.kind}'`);
      continue;
    }
    const res = handler(ov.data, ctx, via);
    outNodes.push(...res.nodes);
    outEdges.push(...res.edges);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
  }

  // Retirement detection: if source already expresses an identical relationship
  // (same type/from/to), the hand-authored copy is redundant — drop it and warn
  // so it can be deleted. Source always wins.
  const sourceEdgeKeys = new Set(edges.map((e) => `${e.type}|${e.from}|${e.to}`));
  const kept = [];
  for (const e of outEdges) {
    const key = `${e.type}|${e.from}|${e.to}`;
    if (sourceEdgeKeys.has(key)) {
      warnings.push(`retire ${e.via ?? 'manual'}: source now provides ${key} — remove the overlay entry`);
      continue;
    }
    kept.push(e);
  }

  return { nodes: outNodes, edges: kept, errors, warnings };
}

// Build-facing entry: load overlays from data/manual and apply them. `nodes`/
// `edges` are the source-derived graph built so far.
export function manualOverlay({ nodes, edges }) {
  return applyOverlays({ nodes, edges, overlays: loadOverlays() });
}
