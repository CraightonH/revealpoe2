// D1 implementation of the MCP backend interface. Pure SQL over the seeded
// tables — no node: imports, so it bundles cleanly into the Worker. Must stay
// behaviourally identical to backends/fs.js (test/mcp/backend-suite.js).
const NODE_COLS = 'id, kind, name, slug, source, props, buildable';
const CHUNK = 90; // D1 caps bound parameters at 100 per query

const toNode = (r) => (r ? {
  id: r.id, kind: r.kind, name: r.name, slug: r.slug, source: r.source,
  props: JSON.parse(r.props),
  buildable: (r.kind === 'gem' || r.kind === 'base' || r.kind === 'unique') ? r.buildable === 1 : null,
} : null);
const toEdge = (r) => ({ type: r.type, from: r.src, to: r.dst });
const toPassive = (r) => (r ? { h: r.h, name: r.name, kind: r.kind, asc: r.asc, attr: r.attr } : null);

function ftsQuery(q) {
  // Quote every token so user text can't hit FTS5 query syntax.
  return String(q).split(/\s+/).map((t) => t.replace(/"/g, '')).filter(Boolean)
    .map((t) => `"${t}"`).join(' ');
}

export function createD1Backend(db) {
  const metaCache = new Map();
  async function metaValue(key) {
    if (!metaCache.has(key)) {
      const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
      if (row) {
        metaCache.set(key, row.value);
      } else {
        // Oversized values (e.g. the planner projection) are split across
        // `<key>:chunk:0..n-1` rows by scripts/build-mcp-sql.js, with a
        // `<key>:chunks` row recording the count — see that file for why.
        const chunksRow = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(`${key}:chunks`).first();
        if (chunksRow) {
          const n = Number(chunksRow.value);
          const rows = await Promise.all(Array.from({ length: n }, (_, i) =>
            db.prepare('SELECT value FROM meta WHERE key = ?').bind(`${key}:chunk:${i}`).first()));
          metaCache.set(key, rows.map((r) => r?.value ?? '').join(''));
        } else {
          metaCache.set(key, null);
        }
      }
    }
    return metaCache.get(key);
  }
  const metaJson = async (key) => JSON.parse((await metaValue(key)) ?? 'null');

  async function edgeQuery(col, id, type) {
    const sql = `SELECT type, src, dst FROM edges WHERE ${col} = ?${type ? ' AND type = ?' : ''}`;
    const stmt = type ? db.prepare(sql).bind(id, type) : db.prepare(sql).bind(id);
    return (await stmt.all()).results.map(toEdge);
  }

  // Batched sibling of edgeQuery — one IN(...) query per CHUNK ids instead of
  // one query per id, so a wide traversal frontier doesn't spend one D1
  // subrequest per node (Workers free tier caps subrequests at 50/request).
  async function edgeQueryMany(col, ids, type) {
    const out = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      if (!chunk.length) continue;
      const placeholders = chunk.map(() => '?').join(',');
      const sql = `SELECT type, src, dst FROM edges WHERE ${col} IN (${placeholders})${type ? ' AND type = ?' : ''}`;
      const stmt = type ? db.prepare(sql).bind(...chunk, type) : db.prepare(sql).bind(...chunk);
      out.push(...(await stmt.all()).results.map(toEdge));
    }
    return out;
  }

  return {
    async getNode(id) {
      return toNode(await db.prepare(`SELECT ${NODE_COLS} FROM nodes WHERE id = ?`).bind(id).first());
    },
    async nodeBySlug(kind, slug) {
      return toNode(await db.prepare(`SELECT ${NODE_COLS} FROM nodes WHERE kind = ? AND slug = ?`).bind(kind, slug).first());
    },
    async nodesByName(name, kinds = null) {
      const filter = kinds ? ` AND kind IN (${kinds.map(() => '?').join(',')})` : '';
      const { results } = await db.prepare(
        `SELECT ${NODE_COLS} FROM nodes WHERE name = ? COLLATE NOCASE${filter}`,
      ).bind(name, ...(kinds ?? [])).all();
      return results.map(toNode);
    },
    async nodesByIds(ids) {
      const out = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const { results } = await db.prepare(
          `SELECT ${NODE_COLS} FROM nodes WHERE id IN (${chunk.map(() => '?').join(',')})`,
        ).bind(...chunk).all();
        const byId = new Map(results.map((r) => [r.id, toNode(r)]));
        for (const id of chunk) { const n = byId.get(id); if (n) out.push(n); }
      }
      return out;
    },
    async edgesFrom(id, type = null) { return edgeQuery('src', id, type); },
    async edgesTo(id, type = null) { return edgeQuery('dst', id, type); },
    async edgesFromMany(ids, type = null) { return edgeQueryMany('src', ids, type); },
    async edgesToMany(ids, type = null) { return edgeQueryMany('dst', ids, type); },
    async search(query, { kind = null, limit = 25 } = {}) {
      const match = ftsQuery(query);
      if (!match) return [];
      const sql = `SELECT n.id, n.kind, n.name, n.slug FROM nodes_fts f
        JOIN nodes n ON n.rowid = f.rowid
        WHERE nodes_fts MATCH ?${kind ? ' AND n.kind = ?' : ''} ORDER BY rank LIMIT ?`;
      const stmt = kind ? db.prepare(sql).bind(match, kind, limit) : db.prepare(sql).bind(match, limit);
      return (await stmt.all()).results.map((r) => ({ id: r.id, kind: r.kind, name: r.name, slug: r.slug }));
    },
    async schemaInfo() { return metaJson('schemaInfo'); },
    async meta() {
      return {
        sourceHash: await metaValue('sourceHash'),
        manualHash: await metaValue('manualHash'),
        builtAt: await metaValue('builtAt'),
      };
    },
    async planner() { return metaJson('planner'); },
    async passiveAdj() {
      const { results } = await db.prepare('SELECT a, b FROM passive_edges').all();
      const adj = new Map();
      const add = (x, y) => { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); };
      for (const r of results) { add(r.a, r.b); add(r.b, r.a); }
      return adj;
    },
    async passiveNodes() {
      const { results } = await db.prepare('SELECT h, name, kind, asc, attr FROM passive_nodes').all();
      return results.map(toPassive);
    },
    async passiveNode(h) {
      return toPassive(await db.prepare('SELECT h, name, kind, asc, attr FROM passive_nodes WHERE h = ?').bind(h).first());
    },
    async passiveNodesByName(name) {
      const { results } = await db.prepare(
        'SELECT h, name, kind, asc, attr FROM passive_nodes WHERE name = ? COLLATE NOCASE',
      ).bind(name).all();
      return results.map(toPassive);
    },
    async treeMeta() {
      return {
        classStarts: await metaJson('classStarts'),
        ascStarts: await metaJson('ascStarts'),
        ascByClass: await metaJson('ascByClass'),
        classAttrs: await metaJson('classAttrs'),
        pointBudget: Number(await metaValue('pointBudget')),
        ascendancyBudget: Number(await metaValue('ascendancyBudget')),
      };
    },
  };
}
