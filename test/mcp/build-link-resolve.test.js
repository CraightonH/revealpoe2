import test from 'node:test';
import assert from 'node:assert/strict';
import { createFsBackend } from '../../src/mcp/backends/fs.js';
import { resolveSpec } from '../../src/mcp/tools/build-link.js';

const b = createFsBackend();
const planner = await b.planner();

test('resolves class + ascendancy by name or slug', async () => {
  const r = await resolveSpec(b, planner, { class: 'Sorceress', ascendancy: 'stormweaver', skills: [] });
  assert.equal(r.cls.slug, 'sorceress');
  assert.equal(r.asc.slug, 'stormweaver');
  assert.match(r.asc.gggId, /^Sorceress\d$/);
});

test('unknown class refuses with the class list', async () => {
  const r = await resolveSpec(b, planner, { class: 'Paladin', skills: [] });
  assert.equal(r.error.code, 'not_found');
  assert.ok(r.error.classes.includes('sorceress'));
});

test('wrong-class ascendancy refuses', async () => {
  const r = await resolveSpec(b, planner, { class: 'sorceress', ascendancy: 'deadeye', skills: [] });
  assert.equal(r.error.code, 'not_found');
});

test('skills resolve; non-support in supports refuses', async () => {
  const ok = await resolveSpec(b, planner, {
    class: 'sorceress',
    skills: [{ gem: 'Fireball', supports: [] }],
  });
  assert.equal(ok.skills[0].gem.slug, 'fireball');
  const bad = await resolveSpec(b, planner, {
    class: 'sorceress',
    skills: [{ gem: 'Fireball', supports: ['Spark'] }], // Spark is an active gem
  });
  assert.equal(bad.error.code, 'invalid');
});

test('gear: jewels/talismans refuse as unbuildable, naming the class', async () => {
  // find a verified-unbuildable unique straight from the divergence set
  const uniques = await b.nodesByName('The Adorned', ['unique']);
  if (!uniques.length) return; // data moved on — the parity gate covers this
  const r = await resolveSpec(b, planner, {
    class: 'sorceress', skills: [],
    gear: { helmet: { item: 'The Adorned' } },
  });
  assert.equal(r.error.code, 'unbuildable');
  assert.match(r.error.message, /jewel/i);
});

test('gear: item must fit the slot', async () => {
  const r = await resolveSpec(b, planner, {
    class: 'sorceress', skills: [],
    gear: { helmet: { item: 'Crude Bow' } },
  });
  assert.equal(r.error.code, 'invalid');
  assert.ok(r.error.fits.includes('weapon1a'));
});

test('notables: name resolves to hash; duplicates refuse with candidates; hash passes through', async () => {
  const all = await b.passiveNodes();
  const notables = all.filter((p) => p.kind === 'notable' && p.name);
  const counts = new Map();
  for (const p of notables) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  const uniqueName = notables.find((p) => counts.get(p.name) === 1);
  const dupName = [...counts.entries()].find(([, c]) => c > 1)?.[0];

  const r = await resolveSpec(b, planner, { class: 'sorceress', skills: [], notables: [uniqueName.name] });
  assert.equal(r.notables[0].h, uniqueName.h);
  const byHash = await resolveSpec(b, planner, { class: 'sorceress', skills: [], notables: [uniqueName.h] });
  assert.equal(byHash.notables[0].h, uniqueName.h);
  if (dupName) {
    const dup = await resolveSpec(b, planner, { class: 'sorceress', skills: [], notables: [dupName] });
    assert.equal(dup.error.code, 'ambiguous');
    assert.ok(dup.error.candidates.every((c) => typeof c.hash === 'number'));
  }
});
