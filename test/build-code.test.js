// test/build-code.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBuild, decodeBuild, CodecError } from '../public/js/build-code.js';
import { emptyBuild } from '../public/js/build-store.js';

const mk = (over = {}) => emptyBuild({ now: () => 1000, uuid: () => 'id-1', ...over });

function realisticBuild() {
  const b = mk({ name: 'Stormweaver Arc', class: 'Sorceress', ascendancy: 'Stormweaver' });
  b.notes = 'League-start friendly. Swap to CI at 80.';
  const slots = ['weapon1a', 'weapon1b', 'helmet', 'body', 'gloves', 'boots',
    'belt', 'amulet', 'ring1', 'ring2', 'flask1', 'flask2'];
  for (const s of slots) {
    b.gear[s] = {
      item: { kind: s === 'body' ? 'unique' : 'base', slug: `some-item-for-${s}` },
      wishlist: ['maximum-life', 'lightning-resistance'],
    };
  }
  b.skills = Array.from({ length: 8 }, (_, i) => ({
    gem: { slug: `skill-gem-${i}` }, level: 20,
    supports: Array.from({ length: 5 }, (_, j) => ({ slug: `support-${i}-${j}` })),
  }));
  // plausible v7 code length + 15 priorities
  b.tree = { code: 'A'.repeat(600), notablePriority: Array.from({ length: 15 }, (_, i) => 10000 + i) };
  return b;
}

test('round trip: decode(encode(b)) equals the canonical form', async () => {
  const b = realisticBuild();
  const out = await decodeBuild(await encodeBuild(b));
  const { id, createdAt, updatedAt, ...canonical } = b;
  assert.deepEqual(out, canonical);
});

test('encode strips local identity, keeps unknown fields', async () => {
  const b = { ...mk(), futureField: 42 };
  const out = await decodeBuild(await encodeBuild(b));
  assert.equal(out.id, undefined);
  assert.equal(out.createdAt, undefined);
  assert.equal(out.futureField, 42);
});

test('code is URL-fragment-safe and version-prefixed', async () => {
  const code = await encodeBuild(mk());
  assert.equal(code[0], '1');
  assert.match(code, /^[A-Za-z0-9_-]+$/);
});

test('realistic build stays under the fragment budget', async () => {
  const code = await encodeBuild(realisticBuild());
  assert.ok(code.length < 2048, `code length ${code.length} exceeds 2048`);
});

test('unknown version prefix rejects with bad-version', async () => {
  const code = await encodeBuild(mk());
  await assert.rejects(decodeBuild('9' + code.slice(1)),
    (e) => e instanceof CodecError && e.code === 'bad-version');
});

test('garbage rejects with corrupt', async () => {
  await assert.rejects(decodeBuild('1zzzz-not-deflate'),
    (e) => e instanceof CodecError && e.code === 'corrupt');
});

test('valid deflate of an invalid build rejects with invalid-build', async () => {
  const b = mk();
  b.name = 123; // break the schema post-hoc
  await assert.rejects(decodeBuild(await encodeBuild(b)),
    (e) => e instanceof CodecError && e.code === 'invalid-build');
});
