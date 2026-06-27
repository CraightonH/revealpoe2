// scripts/graph/build.js
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir, REPOE } from './source.js';
import { gemNodes, skillNodes, gemEdges } from './gems.js';
import { baseNodes, classNodes, tagNodes, baseEdges } from './bases.js';
import { affixNodes, affixEdges } from './affixes.js';
import { uniqueNodes, uniqueEdges } from './uniques.js';
import { passiveNodes, ascendancyNodes, passiveEdges, treeArtPaths } from './passives.js';
import { keywordNodes } from './keywords.js';
import { manualOverlay, hashManual } from './manual.js';
import { validateGraph } from './validate.js';

// Source files this build reads — the sourceHash covers exactly these.
const SOURCE_FILES = [
  `${REPOE}/skill_gems.json`,
  `${REPOE}/skills.json`,
  `${REPOE}/base_items.json`,
  `${REPOE}/item_classes.json`,
  `${REPOE}/mods.json`,
  `${REPOE}/mods_by_base.json`,
  `${REPOE}/stat_translations/stat_descriptions.json`,
  `${REPOE}/stat_translations/passive_skill_stat_descriptions.json`,
  `${REPOE}/uniques.json`,
  `${REPOE}/flavour.json`,
  `${REPOE}/passive_skill_trees/Default.json`,
  `${REPOE}/ascendancies.json`,
  `${REPOE}/keywords.json`,
  `${REPOE}/stat_translations/gem_stat_descriptions.json`,
  `${REPOE}/stat_translations/active_skill_gem_stat_descriptions.json`,
  `${REPOE}/stat_translations/skill_stat_descriptions.json`,
  `${REPOE}/gem_tags.json`,
];

// Hash of the source files this build reads. Reused by the app's boot-time
// staleness guard (src/data/graph.js) to detect an artifact built against
// different source. Requires $POE2DATADIR — call only when source is present.
export function hashSources() {
  const h = crypto.createHash('sha256');
  const dir = getDataDir();
  for (const rel of SOURCE_FILES) {
    const p = path.join(dir, rel);
    if (fs.existsSync(p)) h.update(fs.readFileSync(p));
  }
  // pob-uniques is a directory of per-class files; hash all of them sorted so a
  // re-scrape of any unique block invalidates the artifact. Subdirs (Special/)
  // are non-.json entries and fall out of the filter.
  const pobDir = path.join(dir, 'pob-uniques');
  for (const f of fs.readdirSync(pobDir).filter((name) => name.endsWith('.json')).sort()) {
    h.update(fs.readFileSync(path.join(pobDir, f)));
  }
  return h.digest('hex');
}

export function buildGraph() {
  const { nodes: gNodes, records: gemRecs } = gemNodes();
  const sNodes = skillNodes(gemRecs);
  const { nodes: bNodes, records: baseRecs } = baseNodes();
  const cNodes = classNodes();
  const tNodes = tagNodes(baseRecs);
  const { nodes: aNodes, records: affixRecs } = affixNodes();
  const { nodes: uNodes, records: uniqueRecs } = uniqueNodes();
  const { nodes: pNodes, records: passiveRecs } = passiveNodes();
  const ascNodes = ascendancyNodes();
  const { nodes: kNodes } = keywordNodes();

  const srcNodes = [...gNodes, ...sNodes, ...bNodes, ...cNodes, ...tNodes, ...aNodes, ...uNodes, ...pNodes, ...ascNodes, ...kNodes];
  const nodeIds = new Set(srcNodes.map((n) => n.id));
  const gemIds = new Set(gNodes.map((n) => n.id));
  const ascIds = new Set(ascNodes.map((n) => n.id));
  const srcEdges = [
    ...gemEdges(gemRecs, nodeIds),
    ...baseEdges(baseRecs, nodeIds),
    ...affixEdges(affixRecs, baseRecs, nodeIds),
    ...uniqueEdges(uniqueRecs, baseRecs, sNodes),
    ...passiveEdges(passiveRecs, gemIds, ascIds),
  ];

  // Hand-crafted overlay, applied LAST so its rules expand against the full
  // source graph. Referential failures fail the build; retirement notices warn.
  const overlay = manualOverlay({ nodes: srcNodes, edges: srcEdges });
  if (overlay.errors.length) throw new Error(`manual overlay failed:\n${overlay.errors.join('\n')}`);
  for (const w of overlay.warnings) console.warn(`[manual overlay] ${w}`);

  const nodes = [...srcNodes, ...overlay.nodes];
  const edges = [...srcEdges, ...overlay.edges];

  const errors = validateGraph({ nodes, edges });
  if (errors.length) throw new Error(`graph validation failed:\n${errors.join('\n')}`);

  return {
    meta: {
      schema: 2,
      sourceHash: hashSources(),
      manualHash: hashManual(),
      provenance: provenanceSummary(nodes, edges),
      // Passive-tree art asset list — present only so fetch-images.js discovers
      // these .dds paths (it walks graph.json). Not used by the app at runtime.
      treeArt: treeArtPaths(),
    },
    nodes,
    edges,
  };
}

// Counts of nodes/edges by provenance tier, recorded in meta for auditability.
function provenanceSummary(nodes, edges) {
  const tally = (arr) => arr.reduce((m, x) => {
    m[x.source] = (m[x.source] ?? 0) + 1;
    return m;
  }, {});
  return { nodes: tally(nodes), edges: tally(edges) };
}

export function toArtifact(graph) {
  const nodes = {};
  for (const { id, ...rest } of graph.nodes) nodes[id] = rest;
  return { meta: graph.meta, nodes, edges: graph.edges };
}
