import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGear, rankDocs } from '../public/js/editor-render.js';
import { emptyBuild } from '../public/js/build-store.js';

const PLANNER = {
  slots: [
    { id: 'weapon1a', name: 'Main Hand (Set I)', group: 'weaponset1', accepts: 'weapon', order: 1 },
    { id: 'weapon1b', name: 'Off Hand (Set I)', group: 'weaponset1', accepts: 'offhand', order: 2 },
    { id: 'weapon2a', name: 'Main Hand (Set II)', group: 'weaponset2', accepts: 'weapon', order: 3 },
    { id: 'weapon2b', name: 'Off Hand (Set II)', group: 'weaponset2', accepts: 'offhand', order: 4 },
    { id: 'helmet', name: 'Helmet', group: null, accepts: 'helmet', order: 5 },
  ],
  items: {
    'big-maul': { slots: ['weapon1a', 'weapon2a'], twoHanded: true, class: 'two-hand-maces' },
    'iron-hat': { slots: ['helmet'], twoHanded: false, class: 'helmets' },
    buckler: { slots: ['weapon1b', 'weapon2b'], twoHanded: false, class: 'shields' },
  },
  gems: {}, granted: {}, recommends: {},
};
const fixed = (over = {}) => emptyBuild({ now: () => 1, uuid: () => 'b1', ...over });
const resolve = (ref) => ({ name: `N:${ref.slug}`, iconUrl: null, url: `/x/${ref.slug}` });
const ctx = { planner: PLANNER, resolveRef: resolve, weaponSet: 1 };

test('renderGear: wells for active weapon set + slotless slots, hooks present', () => {
  const html = renderGear(fixed(), ctx);
  for (const id of ['weapon1a', 'weapon1b', 'helmet']) assert.ok(html.includes(`data-slot-id=\"${id}\"`), id);
  assert.ok(!html.includes('data-slot-id="weapon2a"'), 'set II hidden');
  assert.match(html, /data-weapon-set="2"/);
});

test('renderGear: filled slot shows resolved item + clear hook + card hover; escapes names', () => {
  const b = fixed({ gear: { helmet: { item: { kind: 'base', slug: 'iron-hat' }, wishlist: [] } } });
  const html = renderGear(b, { ...ctx, resolveRef: () => ({ name: '<i>x</i>', iconUrl: null, url: null, cardUrl: '/base/iron-hat/card' }) });
  assert.ok(html.includes('&lt;i&gt;x&lt;/i&gt;'));
  assert.ok(!html.includes('<i>x</i>'));
  assert.match(html, /data-slot-clear="helmet"/);
  assert.match(html, /data-card-url="\/base\/iron-hat\/card"/);
});

test('renderGear: two-hander ghosts the off-hand and blocked off-hand renders a warning', () => {
  const b = fixed({ gear: {
    weapon1a: { item: { kind: 'base', slug: 'big-maul' }, wishlist: [] },
    weapon1b: { item: { kind: 'base', slug: 'buckler' }, wishlist: [] },
  } });
  const html = renderGear(b, ctx);
  assert.match(html, /editor-warnings/);
  assert.match(html, /editor-slot--violation/);
  const empty = fixed({ gear: { weapon1a: { item: { kind: 'base', slug: 'big-maul' }, wishlist: [] } } });
  assert.match(renderGear(empty, ctx), /editor-slot__ghost/);
});

test('renderGear: unassigned tray rows carry equip/remove hooks', () => {
  const b = fixed({ unassigned: [{ kind: 'gem', slug: 'spark' }, { kind: 'base', slug: 'iron-hat' }] });
  const html = renderGear(b, ctx);
  assert.match(html, /data-tray-equip="1"/);
  assert.match(html, /data-tray-remove="0"/);
});

test('rankDocs: stable partition by ranked slugs', () => {
  const docs = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }, { slug: 'd' }];
  assert.deepEqual(rankDocs(docs, ['c', 'a']).map((d) => d.slug), ['c', 'a', 'b', 'd']);
  assert.deepEqual(rankDocs(docs, []).map((d) => d.slug), ['a', 'b', 'c', 'd']);
});
