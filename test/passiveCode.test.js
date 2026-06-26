import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decode, encode, b64ToBytes } from '../public/js/passive-code.js';

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
