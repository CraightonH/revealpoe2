// test/planner-data.test.js — the planner-data adapter over the real graph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannerData } from '../src/data/planner.js';
import { nodeBySlug, edgesFrom, getNode } from '../src/data/graph.js';

test('plannerData emits all 15 ordered slots', () => {
  const d = plannerData();
  assert.equal(d.slots.length, 15);
  const orders = d.slots.map((s) => s.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), 'slots are ordered by `order`');
  const helmet = d.slots.find((s) => s.id === 'helmet');
  assert.equal(helmet.accepts, 'helmet');
});

test('plannerData maps a body-armour base to the body slot', () => {
  const d = plannerData();
  const body = nodeBySlug('base', 'body-armour') || null; // sanity: not asserting a specific base slug
  // Pick any body-armour base slug from the items map instead:
  const bodySlug = Object.keys(d.items).find((slug) => d.items[slug].class === 'body-armour');
  assert.ok(bodySlug, 'at least one body-armour base present');
  assert.deepEqual(d.items[bodySlug].slots, ['body']);
  assert.equal(d.items[bodySlug].twoHanded, false);
});

test('plannerData flags two-handed weapons via the source twohand tag', () => {
  const d = plannerData();
  const twoHander = Object.values(d.items).find((it) => it.class === 'two-hand-mace');
  assert.ok(twoHander, 'a two-hand-mace base present');
  assert.equal(twoHander.twoHanded, true);
  assert.deepEqual(twoHander.slots.sort(), ['weapon1a', 'weapon2a']);
});

test('plannerData carries requiresMainhand for quivers', () => {
  const d = plannerData();
  const quiver = Object.values(d.items).find((it) => it.class === 'quiver');
  assert.ok(quiver);
  assert.deepEqual(quiver.requiresMainhand, ['bow']);
  assert.deepEqual(quiver.slots.sort(), ['weapon1b', 'weapon2b']);
});

test('plannerData: a unique inherits its base slot mapping via has_base', () => {
  const d = plannerData();
  // Find a unique in the items map whose has_base target is a mapped base.
  const uniqueSlug = Object.keys(d.items).find((slug) => {
    const n = getNode(nodeBySlug('unique', slug)?.id);
    return n && edgesFrom(n.id, 'has_base').length > 0;
  });
  assert.ok(uniqueSlug, 'at least one unique resolves through has_base');
  assert.ok(d.items[uniqueSlug].slots.length > 0, 'unique has inherited slots');
});

test('plannerData: active gems default to 5 support sockets; spirit gems tagged', () => {
  const d = plannerData();
  const gems = Object.values(d.gems);
  assert.ok(gems.some((g) => g.gemType === 'active' && g.maxSupports === 5));
  assert.ok(gems.some((g) => g.gemType === 'spirit' && g.maxSupports === 5));
  assert.ok(gems.some((g) => g.gemType === 'support' && g.maxSupports === 0));
});

test('granted maps granting uniques to gem slugs that resolve in the gems map', () => {
  const { granted, gems } = plannerData();
  assert.ok(Object.keys(granted).length >= 50, 'expect a substantial granted map');
  assert.ok(granted['choir-of-the-storm'].includes('lightning-bolt'));
  assert.ok(granted['the-last-lament'].includes('requiem'));
  assert.ok(granted['the-dark-defiler'].includes('skeletal-warrior'));
  for (const [slug, skills] of Object.entries(granted)) {
    assert.ok(Array.isArray(skills) && skills.length > 0, `${slug}: non-empty`);
    for (const s of skills) assert.ok(gems[s], `${slug} grants unknown gem ${s}`);
  }
});

test('recommends maps gems to support slugs, all resolving to support-type gems', () => {
  const { recommends, gems } = plannerData();
  assert.ok(recommends['alchemists-boon'].includes('precision-i'));
  for (const [slug, sups] of Object.entries(recommends)) {
    assert.ok(gems[slug], `unknown recommending gem ${slug}`);
    for (const s of sups) assert.equal(gems[s]?.gemType, 'support', `${slug} recommends non-support ${s}`);
  }
});
