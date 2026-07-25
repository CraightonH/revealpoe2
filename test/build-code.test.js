// test/build-code.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGroup, decodeGroup, CodecError } from '../public/js/build-code.js';
import { emptyBuild } from '../public/js/build-store.js';

const mk = (over = {}) => emptyBuild({ now: () => 1000, uuid: () => 'id-1', ...over });
const canon = ({ id, createdAt, updatedAt, ...rest }) => rest;

function realisticBuild(name = 'Stormweaver Arc') {
  const b = mk({ name, class: 'sorceress', ascendancy: 'stormweaver' });
  b.notes = 'League-start friendly. Swap to CI at 80.';
  b.description = 'Arc into Spark, lightning conversion.';
  const slots = ['weapon1a', 'weapon1b', 'helmet', 'body', 'gloves', 'boots',
    'belt', 'amulet', 'ring1', 'ring2', 'flask1', 'flask2', 'charm1'];
  for (const s of slots) {
    b.gear[s] = {
      item: { kind: s === 'body' ? 'unique' : 'base', slug: `some-item-for-${s}` },
      mods: [{ affix: 'maximum_life', tier: 'MaximumLife7' },
             { affix: 'lightning_resistance', tier: 'LightningResistance5' }],
      corrupted: null,
    };
  }
  b.skills = Array.from({ length: 8 }, (_, i) => ({
    gem: { slug: `skill-gem-${i}` }, level: 20,
    supports: Array.from({ length: 5 }, (_, j) => ({ slug: `support-${i}-${j}` })),
  }));
  b.tree = { code: 'A'.repeat(700), notablePriority: Array.from({ length: 20 }, (_, i) => 10000 + i) };
  return b;
}

// A code frozen from codec v1 (generated once, before the v1 encoder was removed).
// This is the ONLY way to prove v1 back-compat now that no v1 encoder exists.
const V1_CODE = '1eJwtkD1vxCAMhv9K5Dk33PVjyNabO3Q_ZXDASlEMpAZSRRH_vaY5FoPfx6-ND0jmmzzCcOshoCcY4JNmNHu3Xbt7cWxBhZgpqeLRUjftnYmWjAIqWUpG3JpdDApowjCmxqYohoT03gMmQ8FiMHsTchT_S7iRqDQTCgwHTNHuLbpMvsXFBatwCe6nkHKJy6zvjFNhvAgmhNqDj1Z7PUZtG0XKmkmLQmGuKpagk7g5tFxD0uKYG35o1_8mT9O0oizNjmkjPg0UL-saJZ8FT9KjZId80SHXCHWsapuFqJm1pSjyoed-7gwnpi9xUVzWvz2ut5f-9e19rPUPREx9VA';

test('round trip: a lone parent survives encode -> decode', async () => {
  const b = realisticBuild();
  const out = await decodeGroup(await encodeGroup({ parent: b, variants: [] }));
  assert.deepEqual(out, { parent: canon(b), variants: [] });
});

test('round trip: an ordered variant group survives encode -> decode', async () => {
  const parent = realisticBuild('Guide');
  const variants = [
    { label: 'Lv 1-30', build: realisticBuild('Early') },
    { label: 'Lv 30-60', build: realisticBuild('Mid') },
    { label: 'Lv 60+', build: realisticBuild('Late') },
  ];
  const out = await decodeGroup(await encodeGroup({ parent, variants }));
  assert.deepEqual(out.parent, canon(parent));
  assert.deepEqual(out.variants.map((v) => v.label), ['Lv 1-30', 'Lv 30-60', 'Lv 60+']);
  assert.deepEqual(out.variants.map((v) => v.build), variants.map((v) => canon(v.build)));
});

test('encode strips local identity and keeps unknown fields', async () => {
  const parent = { ...mk(), futureField: 42 };
  const { parent: out } = await decodeGroup(await encodeGroup({ parent, variants: [] }));
  assert.equal(out.id, undefined);
  assert.equal(out.createdAt, undefined);
  assert.equal(out.updatedAt, undefined);
  assert.equal(out.futureField, 42);
});

test('variants default to an empty list when omitted', async () => {
  const out = await decodeGroup(await encodeGroup({ parent: mk() }));
  assert.deepEqual(out.variants, []);
});

test('code is URL-fragment-safe and version-prefixed with 2', async () => {
  const code = await encodeGroup({ parent: mk(), variants: [] });
  assert.equal(code[0], '2');
  assert.match(code, /^[A-Za-z0-9_-]+$/);
});

test('an 8-variant heavy group stays well inside the fragment budget', async () => {
  const code = await encodeGroup({
    parent: realisticBuild('Guide'),
    variants: Array.from({ length: 8 }, (_, i) => ({ label: `Lv ${i * 12}-${(i + 1) * 12}`, build: realisticBuild(`V${i}`) })),
  });
  assert.ok(code.length < 4096, `code length ${code.length} exceeds 4096`);
});

test('legacy v1 codes still decode, as a group with no variants', async () => {
  const out = await decodeGroup(V1_CODE);
  assert.deepEqual(out.variants, []);
  assert.equal(out.parent.name, 'Legacy v1 Build');
  assert.equal(out.parent.class, 'sorceress');
  assert.equal(out.parent.tree.code, 'AAAAB');
  assert.deepEqual(out.parent.tree.notablePriority, [123, 456]);
  assert.deepEqual(out.parent.gear.body,
    { item: { kind: 'unique', slug: 'tabula-rasa' }, mods: [], corrupted: null });
  assert.equal(out.parent.id, undefined);
});

test('unknown version prefix rejects with bad-version', async () => {
  const code = await encodeGroup({ parent: mk(), variants: [] });
  await assert.rejects(decodeGroup('9' + code.slice(1)),
    (e) => e instanceof CodecError && e.code === 'bad-version');
  await assert.rejects(decodeGroup(''),
    (e) => e instanceof CodecError && e.code === 'bad-version');
  await assert.rejects(decodeGroup(null),
    (e) => e instanceof CodecError && e.code === 'bad-version');
});

test('garbage rejects with corrupt', async () => {
  await assert.rejects(decodeGroup('2zzzz-not-deflate'),
    (e) => e instanceof CodecError && e.code === 'corrupt');
});

test('a v2 payload with no parent rejects with corrupt', async () => {
  // Hand-pack a deflated payload that is valid JSON but the wrong shape.
  const { bytesToB64 } = await import('../public/js/passive-code.js');
  const bad = JSON.stringify({ v: [] });
  const stream = new Blob([new TextEncoder().encode(bad)]).stream()
    .pipeThrough(new CompressionStream('deflate'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  await assert.rejects(decodeGroup('2' + bytesToB64(packed)),
    (e) => e instanceof CodecError && e.code === 'corrupt');
});

test('an invalid parent rejects with invalid-build', async () => {
  const parent = mk();
  parent.name = 123; // break the schema post-hoc
  await assert.rejects(decodeGroup(await encodeGroup({ parent, variants: [] })),
    (e) => e instanceof CodecError && e.code === 'invalid-build');
});

test('an invalid variant build rejects with invalid-build', async () => {
  const bad = mk();
  bad.skills = 'nope';
  await assert.rejects(
    decodeGroup(await encodeGroup({ parent: mk(), variants: [{ label: 'A', build: bad }] })),
    (e) => e instanceof CodecError && e.code === 'invalid-build');
});

test('a variant with a missing label falls back to a positional one', async () => {
  const code = await encodeGroup({ parent: mk(), variants: [{ label: undefined, build: mk() }] });
  const out = await decodeGroup(code);
  assert.equal(out.variants[0].label, 'Variant 1');
});
