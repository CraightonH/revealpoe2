// Compiles build/graph.json + the planner projection + the passive-tree
// artifact into build/mcp.sql — the full D1 seed for the MCP Worker.
//
// Layout rules (measured, see docs/mcp-graph-server.md):
//   - DROP TABLE, never DELETE FROM (deleted rows bill as writes on D1)
//   - base tables as one INSERT per row; indexes + FTS as DDL + INSERT..SELECT
//
// Also the graph <-> projection parity gate: gems must diverge by ZERO; item
// divergence may contain only slotless item classes (jewels/talismans).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plannerData } from '../src/data/planner.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'graph.json'), 'utf8'));
const tree = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'generated', 'passive-tree.json'), 'utf8'));
const planner = plannerData();

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

// ---- parity gate -----------------------------------------------------------
const nodes = Object.entries(graph.nodes).map(([id, n]) => ({ id, ...n }));
const fitsSlotFrom = new Set(graph.edges.filter((e) => e.type === 'fits_slot').map((e) => e.from));
const baseOf = new Map(graph.edges.filter((e) => e.type === 'has_base').map((e) => [e.from, e.to]));

const gems = nodes.filter((n) => n.kind === 'gem');
const missingGems = gems.filter((n) => !planner.gems[n.slug]);
const orphanGems = Object.keys(planner.gems).filter((s) => !gems.some((n) => n.slug === s));
if (missingGems.length || orphanGems.length) {
  throw new Error(`[mcp-sql] gem parity broken: ${missingGems.length} graph gems missing from projection`
    + ` (${missingGems.slice(0, 5).map((n) => n.slug).join(', ')}), ${orphanGems.length} projection-only`);
}

const items = nodes.filter((n) => n.kind === 'base' || n.kind === 'unique');
const divergent = items.filter((n) => !planner.items[n.slug]);
const slotted = divergent.filter((n) => {
  const anchor = n.kind === 'base' ? n.id : baseOf.get(n.id);
  return anchor && fitsSlotFrom.has(anchor);
});
if (slotted.length) {
  console.warn(`[mcp-sql] WARNING: ${slotted.length} slotted item(s) absent from the projection —`
    + ` this is a projection bug: ${slotted.slice(0, 5).map((n) => `${n.kind}:${n.slug}`).join(', ')}`);
}
console.log(`[mcp-sql] items: ${items.length} in graph, ${Object.keys(planner.items).length} in projection,`
  + ` ${divergent.length} divergent (${slotted.length ? 'NOT all slotless!' : 'all slotless — expected'})`);

// ---- schemaInfo (same shape as the backends expose) ------------------------
const kindOf = (id) => graph.nodes[id]?.kind;
const kinds = {};
for (const n of nodes) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
const rel = new Map();
for (const e of graph.edges) {
  const r = rel.get(e.type) ?? { type: e.type, from: new Set(), to: new Set(), count: 0 };
  r.from.add(kindOf(e.from)); r.to.add(kindOf(e.to)); r.count++;
  rel.set(e.type, r);
}
const schemaInfo = {
  kinds,
  relations: [...rel.values()]
    .map((r) => ({ type: r.type, from: [...r.from].sort(), to: [...r.to].sort(), count: r.count }))
    .sort((a, b) => a.type.localeCompare(b.type)),
};

// ---- emit ------------------------------------------------------------------
const out = [];
for (const t of ['nodes_fts', 'nodes', 'edges', 'passive_nodes', 'passive_edges', 'meta']) {
  out.push(`DROP TABLE IF EXISTS ${t};`);
}
out.push(
  `CREATE TABLE nodes(id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL, source TEXT NOT NULL, props TEXT NOT NULL, search TEXT NOT NULL DEFAULT '', buildable INTEGER NOT NULL DEFAULT 0);`,
  `CREATE TABLE edges(type TEXT NOT NULL, src TEXT NOT NULL, dst TEXT NOT NULL, source TEXT NOT NULL, props TEXT);`,
  `CREATE TABLE passive_nodes(h INTEGER PRIMARY KEY, name TEXT, kind TEXT NOT NULL, asc TEXT, attr INTEGER NOT NULL DEFAULT 0);`,
  `CREATE TABLE passive_edges(a INTEGER NOT NULL, b INTEGER NOT NULL);`,
  `CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
);

const buildableOf = (n) => {
  if (n.kind === 'gem') return planner.gems[n.slug] ? 1 : 0;
  if (n.kind === 'base' || n.kind === 'unique') return planner.items[n.slug] ? 1 : 0;
  return 0;
};
for (const n of nodes) {
  out.push(`INSERT INTO nodes VALUES(${q(n.id)},${q(n.kind)},${q(n.name)},${q(n.slug)},${q(n.source)},${q(JSON.stringify(n.props ?? {}))},${q(n.search ?? '')},${buildableOf(n)});`);
}
for (const e of graph.edges) {
  out.push(`INSERT INTO edges VALUES(${q(e.type)},${q(e.from)},${q(e.to)},${q(e.source)},${e.props ? q(JSON.stringify(e.props)) : 'NULL'});`);
}
for (const n of tree.nodes) {
  out.push(`INSERT INTO passive_nodes VALUES(${n.h},${q(n.name ?? null)},${q(n.k)},${q(n.asc ?? null)},${n.attr ? 1 : 0});`);
}
for (const e of tree.edges) out.push(`INSERT INTO passive_edges VALUES(${e.a},${e.b});`);

const classAttrs = Object.fromEntries(Object.entries(tree.meta.classArt ?? {}).map(([n, c]) => [n, c.attr]));
const metaRows = {
  sourceHash: graph.meta.sourceHash,
  manualHash: graph.meta.manualHash,
  builtAt: new Date().toISOString(),
  planner: JSON.stringify(planner),
  schemaInfo: JSON.stringify(schemaInfo),
  classStarts: JSON.stringify(tree.meta.classStarts),
  ascStarts: JSON.stringify(tree.meta.ascStarts),
  ascByClass: JSON.stringify(tree.meta.ascByClass),
  classAttrs: JSON.stringify(classAttrs),
  pointBudget: String(tree.meta.pointBudget),
  ascendancyBudget: String(tree.meta.ascendancyBudget),
};
// D1/miniflare cap a single SQL statement around 100KB. A few meta values
// (the planner projection) blow past that as one row, so split any oversized
// value into fixed-size chunks BEFORE escaping — reassembly on read is pure
// concatenation, so a plain character-boundary slice of the raw string is fine.
const META_CHUNK_SIZE = 80_000;
for (const [k, v] of Object.entries(metaRows)) {
  if (v.length <= META_CHUNK_SIZE) {
    out.push(`INSERT INTO meta VALUES(${q(k)},${q(v)});`);
    continue;
  }
  const n = Math.ceil(v.length / META_CHUNK_SIZE);
  for (let i = 0; i < n; i++) {
    const piece = v.slice(i * META_CHUNK_SIZE, (i + 1) * META_CHUNK_SIZE);
    out.push(`INSERT INTO meta VALUES(${q(`${k}:chunk:${i}`)},${q(piece)});`);
  }
  out.push(`INSERT INTO meta VALUES(${q(`${k}:chunks`)},${q(String(n))});`);
  console.log(`[mcp-sql] meta.${k} is ${v.length} chars — split into ${n} chunks of <=${META_CHUNK_SIZE}`);
}

out.push(
  `CREATE INDEX idx_edges_src ON edges(src, type);`,
  `CREATE INDEX idx_edges_dst ON edges(dst, type);`,
  `CREATE INDEX idx_nodes_kind ON nodes(kind);`,
  `CREATE UNIQUE INDEX idx_nodes_slug ON nodes(kind, slug);`,
  `CREATE INDEX idx_nodes_name ON nodes(name COLLATE NOCASE);`,
  `CREATE VIRTUAL TABLE nodes_fts USING fts5(name, body, content='');`,
  `INSERT INTO nodes_fts(rowid, name, body) SELECT rowid, name, name || char(10) || search FROM nodes;`,
);

const dest = path.join(ROOT, 'build', 'mcp.sql');
// Publish atomically: write to a unique temp file in the same directory, then
// rename onto dest. Same-directory rename is atomic on POSIX, so a concurrent
// reader (e.g. test/mcp/d1-adapter.js) always sees either the old complete
// file or the new one — never a torn write.
const tmp = `${dest}.tmp-${process.pid}`;
fs.writeFileSync(tmp, out.join('\n') + '\n');
fs.renameSync(tmp, dest);
const rows = nodes.length + graph.edges.length + tree.nodes.length + tree.edges.length
  + Object.keys(metaRows).length + nodes.length; // + FTS rows
console.log(`[mcp-sql] wrote ${dest}: ${out.length} statements, ~${rows} rows written on import`
  + ` (free tier allows 100k/day — one reseed per day max)`);
