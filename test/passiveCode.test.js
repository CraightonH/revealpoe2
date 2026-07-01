import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decode, encode, b64ToBytes, synthesizeState, ATTR_TAG, TAG_ATTR } from '../public/js/passive-code.js';

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/passive-tree-codes.json', import.meta.url)));
const byName = Object.fromEntries(fx.vectors.map((v) => [v.name, v]));

test('decode reads version 7 and the ascendancy byte', () => {
  for (const v of fx.vectors) {
    const d = decode(v.code);
    assert.equal(d.version, 7, v.name);
    assert.equal(d.ascendancy, v.ascendancy, v.name);
  }
});

test('decode: weapon-set section present iff weapon passives allocated', () => {
  assert.ok(decode(byName.A_noasc_weaponset.code).weaponSet.length > 0);
  assert.ok(decode(byName.B_asc_weaponset.code).weaponSet.length > 0);
  assert.equal(decode(byName.C_asc_noweaponset.code).weaponSet.length, 0);
});

test('decode: ascendancy nodes present iff an ascendancy is chosen', () => {
  assert.equal(decode(byName.A_noasc_weaponset.code).ascNodes.length, 0);
  assert.ok(decode(byName.B_asc_weaponset.code).ascNodes.length > 0);
  assert.ok(decode(byName.C_asc_noweaponset.code).ascNodes.length > 0);
});

test('decode: all node hashes are valid tree nodes', () => {
  const art = JSON.parse(fs.readFileSync(new URL('../public/generated/passive-tree.json', import.meta.url)));
  const valid = new Set(art.nodes.map((n) => n.h));
  for (const v of fx.vectors) {
    const d = decode(v.code);
    for (const h of d.nodes) assert.ok(valid.has(h), `${v.name} main:${h}`);
    for (const h of d.weaponSet) assert.ok(valid.has(h), `${v.name} ws:${h}`);
    for (const h of d.ascNodes) assert.ok(valid.has(h), `${v.name} asc:${h}`);
  }
});

test('encode(decode(code)) round-trips byte-for-byte for every fixture', () => {
  for (const v of fx.vectors) {
    const reencoded = encode(decode(v.code));
    assert.deepEqual([...b64ToBytes(reencoded)], [...b64ToBytes(v.code)], v.name);
  }
});

// ---------------------------------------------------------------------------
// synthesizeState — build a v7 state from a fresh (non-imported) allocation.
// Regression cover for the two share-code replay bugs: a freshly-built tree
// (no decodedState) must still round-trip its ascendancy and per-node attribute
// picks through encode → decode.
// ---------------------------------------------------------------------------

test('ATTR_TAG / TAG_ATTR are inverse and cover str/dex/int', () => {
  for (const attr of ['str', 'dex', 'int']) {
    assert.equal(TAG_ATTR[ATTR_TAG[attr]], attr);
  }
});

test('synthesizeState routes ascendancy nodes into the trailing section + sets the ascendancy byte', () => {
  const state = synthesizeState({
    allocated: [100, 200, 300], // 200,300 are ascendancy nodes
    ascByte: 2,
    ascOf: (h) => (h === 200 || h === 300 ? 'Warrior2' : null),
    isAttr: () => false,
    attrOf: () => 'str',
  });
  const d = decode(encode(state));
  assert.equal(d.ascendancy, 2);
  assert.deepEqual(d.nodes, [100]);
  assert.deepEqual([...d.ascNodes].sort((a, b) => a - b), [200, 300]);
});

test('synthesizeState writes the chosen-attribute tag word on generic-attribute nodes', () => {
  const state = synthesizeState({
    allocated: [10, 11, 12], // all generic-attribute nodes, distinct picks
    ascByte: 0,
    ascOf: () => null,
    isAttr: () => true,
    attrOf: (h) => ({ 10: 'str', 11: 'dex', 12: 'int' }[h]),
  });
  const d = decode(encode(state));
  const tagByHash = Object.fromEntries(d.records.main.map((r) => [r.hash, r.tag]));
  assert.equal(TAG_ATTR[tagByHash[10]], 'str');
  assert.equal(TAG_ATTR[tagByHash[11]], 'dex');
  assert.equal(TAG_ATTR[tagByHash[12]], 'int');
});

test('synthesizeState keeps weapon-set nodes in their per-set trailing records', () => {
  const state = synthesizeState({
    allocated: [1],
    ws1: [50],
    ws2: [60],
    ascByte: 0,
    ascOf: () => null,
    isAttr: () => false,
    attrOf: () => 'str',
  });
  const d = decode(encode(state));
  assert.deepEqual(d.nodes, [1]);
  const ws = d.records.trailing.filter((r) => r.subType !== 0x01);
  assert.deepEqual(ws.find((r) => r.hash === 50).subType, 0x02);
  assert.deepEqual(ws.find((r) => r.hash === 60).subType, 0x03);
});
