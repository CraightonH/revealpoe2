// src/data/graph.js
//
// The app's read layer over the build-time graph artifact (build/graph.json).
// This is the ONLY module that knows the artifact's on-disk shape; everything
// else queries through getNode / nodesByKind / nodeBySlug / edgesFrom / edgesTo.
//
// Loading is memoized. The artifact is normally produced by `npm run build:graph`
// (a `prestart` step); it is gitignored, so when it is absent (bare `node --test`,
// a fresh checkout) we build it in memory as a fallback. The running server in
// production reads the on-disk file and never touches $POE2DATADIR for graph data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, toArtifact, hashSources } from '../../scripts/graph/build.js';
import { hashManual } from '../../scripts/graph/manual.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ARTIFACT_PATH = path.join(ROOT, 'build', 'graph.json');

let _state = null; // { nodes: Map<id,node>, byKind: Map, fromIdx: Map, toIdx: Map, meta }

// Best-effort staleness check: only meaningful when the artifact came from disk
// AND source is available (dev). In production $POE2DATADIR is absent and this is
// skipped — that absence is the whole point of the build-time cutover.
function warnIfStale(meta) {
  let fresh;
  try {
    fresh = hashSources();
  } catch {
    return; // $POE2DATADIR not available — nothing to compare against.
  }
  if (fresh !== meta.sourceHash) {
    console.warn(
      'src/data/graph.js: build/graph.json is stale relative to source — rebuild with `npm run build:graph`',
    );
  }
  // Overlay drift is independent of source — the data/manual/* files live in-repo
  // and are always available, so this check runs even when $POE2DATADIR is absent.
  if (meta.manualHash !== undefined && hashManual() !== meta.manualHash) {
    console.warn(
      'src/data/graph.js: build/graph.json is stale relative to data/manual overlay — rebuild with `npm run build:graph`',
    );
  }
}

function loadArtifact() {
  try {
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
    warnIfStale(artifact.meta);
    return artifact;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // Artifact not built yet — resolve it in memory (fresh by construction, so no
    // staleness check). Never written from here; `prestart` writes the prod file.
    console.warn('src/data/graph.js: build/graph.json missing — building in memory (run `npm run build:graph`)');
    return toArtifact(buildGraph());
  }
}

function state() {
  if (_state) return _state;
  const artifact = loadArtifact();

  const nodes = new Map();
  const byKind = new Map();
  for (const [id, rest] of Object.entries(artifact.nodes)) {
    const node = { id, ...rest };
    nodes.set(id, node);
    if (!byKind.has(node.kind)) byKind.set(node.kind, []);
    byKind.get(node.kind).push(node);
  }

  // Adjacency indexes so traversal is O(degree) rather than O(edges) per call.
  const fromIdx = new Map();
  const toIdx = new Map();
  for (const e of artifact.edges) {
    if (!fromIdx.has(e.from)) fromIdx.set(e.from, []);
    fromIdx.get(e.from).push(e);
    if (!toIdx.has(e.to)) toIdx.set(e.to, []);
    toIdx.get(e.to).push(e);
  }

  _state = { nodes, byKind, fromIdx, toIdx, meta: artifact.meta };
  return _state;
}

// Slug lookup maps are built lazily per kind on first use.
const _slugMaps = new Map();
function slugMap(kind) {
  if (_slugMaps.has(kind)) return _slugMaps.get(kind);
  const m = new Map();
  for (const n of nodesByKind(kind)) m.set(n.slug, n);
  _slugMaps.set(kind, m);
  return m;
}

export function getNode(id) {
  return state().nodes.get(id) ?? null;
}

export function nodesByKind(kind) {
  return state().byKind.get(kind) ?? [];
}

export function nodeBySlug(kind, slug) {
  return slugMap(kind).get(slug) ?? null;
}

export function edgesFrom(id, type) {
  const edges = state().fromIdx.get(id) ?? [];
  return type ? edges.filter((e) => e.type === type) : edges;
}

export function edgesTo(id, type) {
  const edges = state().toIdx.get(id) ?? [];
  return type ? edges.filter((e) => e.type === type) : edges;
}

// Test seam: drop memoized state so a test can force a reload.
export function _reset() {
  _state = null;
  _slugMaps.clear();
}
