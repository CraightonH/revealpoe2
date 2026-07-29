import test from 'node:test';
import assert from 'node:assert/strict';
import { createFsBackend } from '../../src/mcp/backends/fs.js';
import { gem, item, affix, slot, ascendancy, passives } from '../../src/mcp/tools/entities.js';

const b = createFsBackend();

test('gem: grants, supports, granted_by; unknown name refuses', async () => {
  const r = await gem(b, { name: 'Fireball' });
  assert.equal(r.slug, 'fireball');
  assert.ok(r.gemType);
  assert.ok(r.recommended_supports.items.length > 0);
  assert.ok(r.grants.items.length >= 1, 'fireball grants its skill');
  const miss = await gem(b, { name: 'Nonsense Gem' });
  assert.equal(miss.error.code, 'not_found');
});

test('item(base): summarized affixes by default, list opt-in', async () => {
  const r = await item(b, { name: 'Crude Bow' });
  assert.equal(r.kind, 'base');
  assert.ok(r.fits_slots.includes('weapon1a'));
  assert.equal(typeof r.affixes.count, 'number');
  assert.ok(!r.affixes.items, 'no enumeration without list: true');
  const listed = await item(b, { name: 'Crude Bow', list: true });
  assert.ok(Array.isArray(listed.affixes.items));
  assert.ok(listed.affixes.items.length <= 100);
});

test('item(unique): base, flavour, buildable', async () => {
  // pick a verified unique via the backend rather than hardcoding
  const uniques = await b.nodesByName('Widowhail', ['unique']);
  const name = uniques[0]?.name ?? (await b.search('bow', { kind: 'unique', limit: 1 }))[0].name;
  const r = await item(b, { name });
  assert.equal(r.kind, 'unique');
  assert.ok(r.base, 'unique reports its base');
});

test('affix: rolls_on summarized by item class', async () => {
  const hits = await b.search('increased physical damage', { kind: 'affix', limit: 1 });
  const r = await affix(b, { name: hits[0].name });
  if (r.error?.code === 'ambiguous') {
    assert.ok(r.error.candidates.length > 1); // ambiguity is a valid, explicit outcome
  } else {
    assert.ok(r.rolls_on.count > 0);
    assert.ok(Array.isArray(r.rolls_on.by_class));
    assert.ok(!r.rolls_on.items, 'summarize by default');
  }
});

test('slot: bases summarized', async () => {
  const r = await slot(b, { name: 'weapon1a' });
  assert.ok(r.base_count > 0);
  assert.ok(r.by_class.length > 0);
});

test('ascendancy: passives with hashes and stat lines', async () => {
  const r = await ascendancy(b, { name: 'Stormweaver' });
  assert.equal(r.class, 'Sorceress');
  assert.ok(r.passives.items.length > 0);
  assert.ok(r.passives.items.every((p) => typeof p.hash === 'number' || p.hash === null));
});

test('passives: intent search returns hash + statLines, capped', async () => {
  const r = await passives(b, { query: 'fire damage', limit: 10 });
  assert.ok(r.passives.items.length <= 10);
  assert.ok(r.passives.items.some((p) => typeof p.hash === 'number'));
  assert.ok(r.passives.items.every((p) => Array.isArray(p.statLines)));
});
