import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemMath } from '../src/data/itemMath.js';
import { plannerData } from '../src/data/planner.js';
import { parseStat } from '../public/js/build-math.js';

const IM = itemMath();

test('itemMath: every planner class resolves to base attributes', () => {
  const pd = plannerData();
  for (const c of pd.classes) {
    const base = IM.classBase[c.slug];
    assert.ok(base, `no classBase for ${c.slug}`);
    for (const k of ['str', 'dex', 'int', 'life', 'mana']) assert.equal(typeof base[k], 'number');
  }
});

test('itemMath: a known unique carries requirements + only whitelist-parseable lines', () => {
  const astra = IM.items.astramentis;
  assert.ok(astra, 'astramentis missing');
  assert.equal(typeof astra.req.level, 'number');
  // Astramentis grants "+(X-Y) to all Attributes" — every kept line must parse.
  assert.ok(astra.lines.length >= 1);
  for (const line of astra.lines) assert.ok(parseStat(line), `kept a non-whitelist line: ${line}`);
});

test('itemMath: kept lines are the whitelist subset (no aura/conditional lines survive)', () => {
  for (const [slug, it] of Object.entries(IM.items)) {
    for (const line of it.lines) assert.ok(parseStat(line), `${slug}: ${line}`);
  }
});

test('itemMath: gem crafting levels are exposed for the character-level requirement', () => {
  const anySlug = Object.keys(IM.gemLevel)[0];
  assert.equal(typeof IM.gemLevel[anySlug], 'number');
});
