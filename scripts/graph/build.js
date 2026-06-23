// scripts/graph/build.js
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir, REPOE } from '../../src/config.js';
import { gemNodes, skillNodes, gemEdges } from './gems.js';
import { validateGraph } from './validate.js';

// Source files this build reads — the sourceHash covers exactly these.
const SOURCE_FILES = [
  `${REPOE}/skill_gems.json`,
  `${REPOE}/skills.json`,
  `${REPOE}/base_items.json`,
];

// Hash of the source files this build reads. Reused by the app's boot-time
// staleness guard (src/data/graph.js) to detect an artifact built against
// different source. Requires $POE2DATADIR — call only when source is present.
export function hashSources() {
  const h = crypto.createHash('sha256');
  for (const rel of SOURCE_FILES) h.update(fs.readFileSync(path.join(getDataDir(), rel)));
  return h.digest('hex');
}

export function buildGraph() {
  const { nodes: gNodes, records } = gemNodes();
  const sNodes = skillNodes(records);
  const nodes = [...gNodes, ...sNodes];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = gemEdges(records, nodeIds);

  const errors = validateGraph({ nodes, edges });
  if (errors.length) throw new Error(`graph validation failed:\n${errors.join('\n')}`);

  return { meta: { sourceHash: hashSources(), schema: 1 }, nodes, edges };
}

export function toArtifact(graph) {
  const nodes = {};
  for (const { id, ...rest } of graph.nodes) nodes[id] = rest;
  return { meta: graph.meta, nodes, edges: graph.edges };
}
