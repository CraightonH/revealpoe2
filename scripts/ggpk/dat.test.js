// Offline, deterministic decode test: a committed .datc64 fixture + a frozen
// mini dat-schema (scripts/ggpk/__fixtures__/). Does NOT hit the network or the
// gitignored mirror, so it runs in CI on a fresh checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema, parseTable } from './dat.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const SCHEMA = path.join(FIX, 'schema.min.json');

test('parseTable decodes a real .datc64 against dat-schema', async () => {
  const schema = await loadSchema(SCHEMA);
  const t = await parseTable('endgamecorruptionmods', { schema, dir: FIX });

  assert.equal(t.name, 'EndgameCorruptionMods');
  assert.equal(t.rowCount, 15);
  assert.equal(t.rows.length, 15);

  // columns: schema order, casing, types, and reverse-ref target preserved.
  assert.deepEqual(t.columns.map((c) => c.name), ['CorruptionMod', 'SpawnWeight', 'col2']);
  assert.deepEqual(t.columns.map((c) => c.type), ['foreignrow', 'i32[]', 'bool']);
  assert.equal(t.columns[0].references, 'Mods');

  // row 0: known values (foreignrow -> Mods row index, i32[] array, bool).
  const r0 = t.rows[0];
  assert.equal(typeof r0.CorruptionMod, 'number'); // a Mods row index
  assert.ok(Array.isArray(r0.SpawnWeight), 'SpawnWeight is an array');
  assert.equal(typeof r0.SpawnWeight[0], 'number');
  assert.equal(typeof r0.col2, 'boolean');
});

test('parseTable throws for an unknown table', async () => {
  const schema = await loadSchema(SCHEMA);
  await assert.rejects(() => parseTable('nope_not_a_table', { schema, dir: FIX }), /no dat-schema/);
});
