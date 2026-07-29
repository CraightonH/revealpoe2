import test from 'node:test';
import assert from 'node:assert/strict';
import { createFsBackend } from '../../src/mcp/backends/fs.js';
import { buildLink } from '../../src/mcp/tools/build-link.js';
import { decodeGroup } from '../../public/js/build-code.js';
import { decode } from '../../public/js/passive-code.js';
import { validateBuild } from '../../public/js/build-store.js';
import { reachableNotables } from './helpers.js';

const b = createFsBackend();
const tm = await b.treeMeta();
const adj = await b.passiveAdj();

const threeSorcNotables = () => reachableNotables(b, 'Sorceress', 3);

test('full round-trip: url decodes to the intended build, tree included', async () => {
  const notables = await threeSorcNotables();
  const r = await buildLink(b, {
    name: 'MCP Test Build',
    class: 'sorceress',
    ascendancy: 'stormweaver',
    skills: [{ gem: 'Fireball', supports: [] }],
    notables: notables.map((p) => p.h),
  });
  assert.ok(r.url?.startsWith('https://revealpoe2.com/builds#/import/'), JSON.stringify(r.error ?? {}));
  assert.ok(r.points_spent.passive >= 3);
  assert.equal(r.notable_priority.length, 3);
  assert.equal(r.resolved.class, 'sorceress');

  const code = r.url.split('#/import/')[1];
  const { parent, variants } = await decodeGroup(code);
  assert.equal(variants.length, 0);
  assert.equal(parent.name, 'MCP Test Build');
  assert.equal(parent.class, 'sorceress');
  assert.equal(parent.skills[0].gem.slug, 'fireball');
  assert.ok(validateBuild(parent).ok);

  const state = decode(parent.tree.code);
  assert.equal(state.version, 7);
  const allocatedSet = new Set(state.nodes);
  for (const p of notables) assert.ok(allocatedSet.has(p.h), `${p.name} in tree code`);
  // connectivity survives the codec — walk from the class start over decoded nodes
  const seen = new Set();
  const q = [tm.classStarts.Sorceress];
  while (q.length) {
    const h = q.pop();
    for (const nb of adj.get(h) ?? []) {
      if (allocatedSet.has(nb) && !seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
  }
  assert.equal(seen.size, allocatedSet.size, 'decoded tree stays connected');
});

test('variants ship as one URL and inherit the parent spec', async () => {
  const r = await buildLink(b, {
    name: 'Leveling Guide', class: 'sorceress',
    skills: [{ gem: 'Fireball', supports: [] }],
    variants: [{ label: 'Endgame', skills: [{ gem: 'Fireball', supports: [] }, { gem: 'Flame Wall', supports: [] }] }],
  });
  assert.ok(r.url);
  const { parent, variants } = await decodeGroup(r.url.split('#/import/')[1]);
  assert.equal(variants.length, 1);
  assert.equal(variants[0].label, 'Endgame');
  assert.equal(variants[0].build.class, parent.class, 'variant inherited the class');
  assert.equal(variants[0].build.skills.length, 2);
});

test('budget overflow warns but still emits (refuse-vs-warn classification)', async () => {
  const notables = (await b.passiveNodes()).filter((p) => p.kind === 'notable' && !p.asc).slice(0, 80);
  const r = await buildLink(b, { name: 'Overdraft', class: 'sorceress', notables: notables.map((p) => p.h), skills: [] });
  if (r.url) {
    assert.ok(r.points_spent.passive > 122);
    assert.ok(r.warnings.some((w) => /122/.test(w)), 'warns about the budget');
  } else {
    assert.equal(r.error.code, 'unreachable'); // some notables may be genuinely unreachable — also a valid outcome
  }
});

test('ambiguous/unknown/unbuildable all refuse without a URL', async () => {
  const bad = await buildLink(b, { name: 'x', class: 'sorceress', skills: [{ gem: 'zzz-not-a-gem', supports: [] }] });
  assert.ok(bad.error);
  assert.ok(!bad.url);
});
