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
  // meta carries everything the Worker needs
  for (const key of ['sourceHash', 'manualHash', 'builtAt', 'planner', 'schemaInfo',
    'classStarts', 'ascStarts', 'ascByClass', 'classAttrs', 'pointBudget', 'ascendancyBudget']) {
    assert.ok(db.prepare('SELECT value FROM meta WHERE key = ?').get(key), `meta.${key}`);
  }
  const starts = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='classStarts'").get().value);
  assert.equal(starts.Sorceress, 54447);
});
