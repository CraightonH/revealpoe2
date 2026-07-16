// test/graph/weaponReqs.test.js — skill weapon requirements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weaponReqLabel, loadWeaponReqs } from '../../scripts/graph/weaponReqs.js';
import { gemNodes } from '../../scripts/graph/gems.js';

test('weaponReqLabel emits glossary token markup, plural display, singular keyword id', () => {
  assert.equal(weaponReqLabel('explosive_shot'), '[Crossbow|Crossbows]');
  assert.equal(weaponReqLabel('rain_of_arrows_new'), '[Bow|Bows]');
  // "Any Mace" (One Hand + Two Hand Mace) collapses to the base plural.
  assert.equal(weaponReqLabel('leap_slam'), '[Mace|Maces]');
});

test('weaponReqLabel returns null for skills with no weapon requirement', () => {
  assert.equal(weaponReqLabel('fireball'), null);
  assert.equal(weaponReqLabel('no_such_active_skill'), null);
});

test('generated overlay is populated and well-formed', () => {
  const data = loadWeaponReqs();
  const keys = Object.keys(data);
  assert.ok(keys.length > 100, `expected many active skills, got ${keys.length}`);
  for (const req of Object.values(data)) {
    assert.equal(typeof req.reqId, 'string');
    assert.ok(Array.isArray(req.classIds) && req.classIds.length);
  }
});

test('gem nodes carry the weapon requirement label', () => {
  const { nodes } = gemNodes();
  const byName = (n) => nodes.find((x) => x.kind === 'gem' && x.name === n);
  assert.equal(byName('Armour Piercing Rounds').props.weaponReq, '[Crossbow|Crossbows]');
  assert.equal(byName('Rain of Arrows').props.weaponReq, '[Bow|Bows]');
  // A spell gem has no weapon requirement.
  assert.equal(byName('Fireball').props.weaponReq, null);
});
