// test/passiveTreeArtifact.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArtifact, buildCards } from '../scripts/build-passive-tree.js';

test('buildArtifact produces nodes/edges/meta from GGG data', () => {
  const art = buildArtifact();
  assert.ok(art.nodes.length > 4000);
  assert.ok(art.edges.length > 5000);
  // arc geometry comes through on a good chunk of edges (the sweeping connectors)
  assert.ok(art.edges.filter((e) => e.arc).length > 1000);
  // nodes carry a raw GGG icon path + atlas icon-kind (resolved against the atlas)
  const withIcon = art.nodes.find((n) => n.icon);
  assert.match(withIcon.icon, /^Art\/.*\.png$/);
  assert.ok(['normal', 'notable', 'keystone'].includes(withIcon.iconKind));
  // meta wires the atlases + class placement
  assert.ok(art.meta.atlas && art.meta.atlas.img && art.meta.atlas.classFrame);
  assert.equal(typeof art.meta.classStarts.Monk, 'number');
  assert.ok(art.meta.classArt.Monk.atlas.endsWith('background-monk.webp'));
  // PoE2 class illustrations are pre-centred circular sprites; GGG's stale PoE1
  // image_offset must be dropped so the art centres in the MainCircle. Guards
  // against the Warrior/Ranger/Huntress/Mercenary/Druid off-centre regression.
  for (const [name, ca] of Object.entries(art.meta.classArt)) {
    assert.equal(ca.offsetX, 0, `${name} classArt offsetX`);
    assert.equal(ca.offsetY, 0, `${name} classArt offsetY`);
  }
});

test('buildCards renders a card per visible node, keyed by hash', () => {
  const art = buildArtifact();
  const cards = buildCards();
  const visible = art.nodes.filter((n) => !n.hidden);
  assert.equal(Object.keys(cards).length, visible.length);
  for (const n of visible) assert.equal(typeof cards[n.h], 'string', `card for ${n.h}`);
});

test('buildCards: a notable card has the banner header + keyword-linkified stats', () => {
  const cards = buildCards();
  // At least one card carries the ornate banner, keyword links, and a notable label.
  const htmls = Object.values(cards);
  assert.ok(htmls.some((h) => /itemHeader doubleLine/.test(h)), 'ornate banner present');
  assert.ok(htmls.some((h) => /class="kw" data-keyword=/.test(h)), 'keyword linkification present');
  assert.ok(htmls.some((h) => /Notable Passive/.test(h)), 'notable type-line label present');
});

test('buildCards: a small passive renders with the popup shell', () => {
  const art = buildArtifact();
  const cards = buildCards();
  const small = art.nodes.find((n) => n.k === 'small' && !n.hidden);
  const html = cards[small.h];
  assert.match(html, /newItemPopup/);
  assert.match(html, /itemHeader doubleLine/);
});
