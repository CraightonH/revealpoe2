import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* skipped below */ }

test('build-mcp-sql emits a loadable, complete seed', { skip: !DatabaseSync && 'node:sqlite unavailable' }, () => {
  execFileSync(process.execPath, ['scripts/build-mcp-sql.js'], { encoding: 'utf8' });
  const sql = fs.readFileSync('build/mcp.sql', 'utf8');
  assert.match(sql, /DROP TABLE IF EXISTS nodes;/);
  assert.doesNotMatch(sql, /DELETE FROM/);

  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  const one = (q) => db.prepare(q).get();
  assert.equal(one('SELECT count(*) AS n FROM nodes').n, 7369);
  assert.equal(one('SELECT count(*) AS n FROM edges').n, 65973);
  assert.equal(one('SELECT count(*) AS n FROM passive_nodes').n, 4784);
  assert.equal(one('SELECT count(*) AS n FROM passive_edges').n, 5426);
  // FTS wired to nodes rowids
  const hit = db.prepare(
    "SELECT n.name FROM nodes_fts f JOIN nodes n ON n.rowid = f.rowid WHERE nodes_fts MATCH '\"flame\"' LIMIT 1",
  ).get();
  assert.ok(hit?.name);
  // buildable stamped from the projection
  const fb = one("SELECT buildable FROM nodes WHERE kind='gem' AND slug='fireball'");
  assert.equal(fb.buildable, 1);
  // meta carries everything the Worker needs — a value may be chunked
  // (see build-mcp-sql.js) so accept either the direct row or a `<key>:chunks` row.
  const metaExists = (key) => Boolean(
    db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
      ?? db.prepare('SELECT value FROM meta WHERE key = ?').get(`${key}:chunks`),
  );
  for (const key of ['sourceHash', 'manualHash', 'builtAt', 'planner', 'schemaInfo',
    'classStarts', 'ascStarts', 'ascByClass', 'classAttrs', 'pointBudget', 'ascendancyBudget']) {
    assert.ok(metaExists(key), `meta.${key}`);
  }
  const starts = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='classStarts'").get().value);
  assert.equal(starts.Sorceress, 54447);

  // Regression guard: D1/miniflare cap a single SQL statement near 100KB
  // (this is the bug — the planner meta row alone was ~364,096 chars).
  const statements = sql.split('\n').filter(Boolean);
  const maxLen = Math.max(...statements.map((s) => s.length));
  assert.ok(maxLen <= 95_000, `longest statement is ${maxLen} chars, expected <= 95,000`);

  // planner is the value known to exceed the chunk threshold — prove it is
  // actually chunked and that reassembly round-trips to valid JSON.
  const chunksRow = db.prepare("SELECT value FROM meta WHERE key='planner:chunks'").get();
  assert.ok(chunksRow, 'expected planner:chunks meta row');
  const n = Number(chunksRow.value);
  assert.ok(n > 1, `expected planner to be split into multiple chunks, got ${n}`);
  let reassembled = '';
  for (let i = 0; i < n; i++) {
    reassembled += db.prepare('SELECT value FROM meta WHERE key = ?').get(`planner:chunk:${i}`).value;
  }
  const planner = JSON.parse(reassembled);
  assert.ok(Array.isArray(planner.classes), 'reassembled planner JSON has a classes array');
});
