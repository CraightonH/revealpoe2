// scripts/check-mcp-seed.js — CI gate: the remote D1 seed must carry exactly
// the hashes of the graph this run just built. Run AFTER seeding.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const local = JSON.parse(fs.readFileSync('build/graph.json', 'utf8')).meta;
const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'revealpoe2-graph', '--remote', '-y',
  '--json', '--config', 'workers/mcp/wrangler.jsonc',
  '--command', "SELECT key, value FROM meta WHERE key IN ('sourceHash','manualHash')"], { encoding: 'utf8' });
const rows = Object.fromEntries(JSON.parse(out)[0].results.map((r) => [r.key, r.value]));
let failed = false;
for (const key of ['sourceHash', 'manualHash']) {
  if (rows[key] !== local[key]) {
    console.error(`[check-mcp-seed] ${key} mismatch: D1=${rows[key]} local=${local[key]}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('[check-mcp-seed] D1 seed matches the built graph');
