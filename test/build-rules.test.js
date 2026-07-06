// test/build-rules.test.js — pure slot/socket legality rules (dual-use module).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legalSlots, gearViolations, setupViolations } from '../public/js/build-rules.js';

const PD = {
  slots: [
    { id: 'weapon1a' }, { id: 'weapon1b' }, { id: 'weapon2a' }, { id: 'weapon2b' }, { id: 'body' },
  ],
  items: {
    'great-mace': { slots: ['weapon1a', 'weapon2a'], twoHanded: true, class: 'two-hand-mace' },
    'war-bow': { slots: ['weapon1a', 'weapon2a'], twoHanded: true, class: 'bow' },
    'rusted-sword': { slots: ['weapon1a', 'weapon2a'], twoHanded: false, class: 'one-hand-sword' },
    'tower-shield': { slots: ['weapon1b', 'weapon2b'], twoHanded: false, class: 'shield' },
    'broadhead-quiver': { slots: ['weapon1b', 'weapon2b'], twoHanded: false, class: 'quiver', requiresMainhand: ['bow'] },
    'plate-vest': { slots: ['body'], twoHanded: false, class: 'body-armour' },
  },
  gems: {
    fireball: { gemType: 'active', maxSupports: 5 },
    'tiny-active': { gemType: 'active', maxSupports: 2 },
  },
};

const build = (over) => ({ gear: {}, skills: [], ...over });

test('legalSlots returns the item’s slot list; unknown slug -> []', () => {
  assert.deepEqual(legalSlots({ kind: 'base', slug: 'plate-vest' }, PD), ['body']);
  assert.deepEqual(legalSlots({ kind: 'base', slug: 'nope' }, PD), []);
});

test('gearViolations: two-hander in main hand blocks a filled off-hand', () => {
  const b = build({ gear: {
    weapon1a: { item: { kind: 'base', slug: 'great-mace' } },
    weapon1b: { item: { kind: 'base', slug: 'tower-shield' } },
  } });
  const v = gearViolations(b, PD);
  assert.ok(v.some((x) => x.code === 'two-hander-blocks-offhand' && x.slotId === 'weapon1b'));
});

test('gearViolations: one-hander + shield is legal', () => {
  const b = build({ gear: {
    weapon1a: { item: { kind: 'base', slug: 'rusted-sword' } },
    weapon1b: { item: { kind: 'base', slug: 'tower-shield' } },
  } });
  assert.equal(gearViolations(b, PD).length, 0);
});

test('gearViolations: quiver requires a bow in the same-set main hand', () => {
  const noBow = build({ gear: {
    weapon1a: { item: { kind: 'base', slug: 'rusted-sword' } },
    weapon1b: { item: { kind: 'base', slug: 'broadhead-quiver' } },
  } });
  assert.ok(gearViolations(noBow, PD).some((x) => x.code === 'requires-mainhand' && x.slotId === 'weapon1b'));

  const withBow = build({ gear: {
    weapon1a: { item: { kind: 'base', slug: 'war-bow' } },
    weapon1b: { item: { kind: 'base', slug: 'broadhead-quiver' } },
  } });
  // war-bow is two-handed, so quiver is satisfied on the bow requirement but the
  // two-hander still blocks the off-hand — assert the requires-mainhand rule passed.
  assert.ok(!gearViolations(withBow, PD).some((x) => x.code === 'requires-mainhand'));
});

test('gearViolations: item placed in a slot it does not fit', () => {
  const b = build({ gear: { body: { item: { kind: 'base', slug: 'great-mace' } } } });
  assert.ok(gearViolations(b, PD).some((x) => x.code === 'illegal-slot' && x.slotId === 'body'));
});

test('setupViolations: duplicate support across setups', () => {
  const b = build({ skills: [
    { gem: { slug: 'fireball' }, supports: [{ slug: 'faster-casting' }] },
    { gem: { slug: 'tiny-active' }, supports: [{ slug: 'faster-casting' }] },
  ] });
  const v = setupViolations(b, PD.gems);
  assert.ok(v.some((x) => x.code === 'duplicate-support' && x.support === 'faster-casting'));
});

test('setupViolations: socket overflow beyond the gem’s maxSupports', () => {
  const b = build({ skills: [
    { gem: { slug: 'tiny-active' }, supports: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }] },
  ] });
  const v = setupViolations(b, PD.gems);
  assert.ok(v.some((x) => x.code === 'socket-overflow' && x.setup === 0));
});

test('setupViolations: a legal setup yields no violations', () => {
  const b = build({ skills: [
    { gem: { slug: 'fireball' }, supports: [{ slug: 'a' }, { slug: 'b' }] },
  ] });
  assert.equal(setupViolations(b, PD.gems).length, 0);
});
