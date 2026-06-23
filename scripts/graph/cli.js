// scripts/graph/cli.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, toArtifact } from './build.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'build');
fs.mkdirSync(outDir, { recursive: true });

const artifact = toArtifact(buildGraph());
const outPath = path.join(outDir, 'graph.json');
fs.writeFileSync(outPath, JSON.stringify(artifact));
console.log(`graph.json: ${Object.keys(artifact.nodes).length} nodes, ${artifact.edges.length} edges -> ${outPath}`);
