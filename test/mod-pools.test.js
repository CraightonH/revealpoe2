// test/mod-pools.test.js — the mod-pools projection over the real graph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modPools } from '../src/data/modPools.js';

test('modPools: families carry origin, tiers with gen + display text', () => {
  const { families } = modPools();
  const slugs = Object.keys(families);
  assert.ok(slugs.length > 400, `expected a large family table, got ${slugs.length}`);
  // Every family is standard or corrupted; never desecrated.
  for (const f of Object.values(families)) {
    assert.ok(f.origin === 'standard' || f.origin === 'corrupted', `bad origin ${f.origin}`);
    assert.ok(f.tiers.length >= 1);
    for (const t of f.tiers) {
      assert.ok(typeof t.id === 'string' && t.id.length);
      assert.ok(['prefix', 'suffix', 'corrupted'].includes(t.gen), `bad gen ${t.gen}`);
      assert.ok(!/\[[^\]]*\|/.test(t.text), `tier text still has [a|b] markup: ${t.text}`);
    }
  }
});

test('modPools: a body-armour base has standard prefixes and suffixes', () => {
  const { families, bases } = modPools();
  const bodySlug = Object.keys(bases).find((slug) =>
    (bases[slug] || []).some((r) => families[r.a]?.origin === 'standard'));
  assert.ok(bodySlug, 'a base with standard families exists');
  const gens = new Set(
    bases[bodySlug].flatMap((r) => (families[r.a]?.tiers ?? []).map((t) => t.gen)));
  assert.ok(gens.has('prefix') && gens.has('suffix'), 'both prefix and suffix reachable');
});

test('modPools: corrupted families exist and reach bases (verification gate)', () => {
  const { families, bases } = modPools();
  const corrupted = Object.values(families).filter((f) => f.origin === 'corrupted');
  assert.ok(corrupted.length >= 50, `expected corrupted families, got ${corrupted.length}`);
  const basesWithCorrupt = Object.keys(bases).filter((slug) =>
    (bases[slug] || []).some((r) => families[r.a]?.origin === 'corrupted'));
  assert.ok(basesWithCorrupt.length > 500, `corrupted reaches many bases: ${basesWithCorrupt.length}`);
});

test('modPools: uniques map to a base slug present in bases', () => {
  const { bases, uniques } = modPools();
  const keys = Object.keys(uniques);
  assert.ok(keys.length > 300, `expected many uniques, got ${keys.length}`);
  const resolvable = keys.filter((u) => bases[uniques[u]]);
  assert.ok(resolvable.length > 300, `most uniques resolve a base pool: ${resolvable.length}`);
});

test('modPools: base eligibility tier indices are in range', () => {
  const { families, bases } = modPools();
  for (const refs of Object.values(bases)) {
    for (const r of refs) {
      const fam = families[r.a];
      assert.ok(fam, `ref points at a known family ${r.a}`);
      if (r.t) for (const i of r.t) assert.ok(i >= 0 && i < fam.tiers.length, `tier idx ${i} in range for ${r.a}`);
    }
  }
});
