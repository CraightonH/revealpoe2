// test/passiveTreeArtifact.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArtifact, buildCards, buildSearch, buildStats } from '../scripts/build-passive-tree.js';
import { aggregate } from '../public/js/passive-stats-agg.js';

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

test('buildArtifact: only live ascendancies are surfaced (no null-name placeholders)', () => {
  const art = buildArtifact();
  const { ascByClass, ascendancyArt } = art.meta;
  // GGG ships not-yet-live ascendancy defs (e.g. Druid3, Ranger2) with null
  // name + image but a real start node. Those must not reach the selector.
  for (const [cls, list] of Object.entries(ascByClass)) {
    for (const a of list) {
      assert.ok(a.name, `${cls} ascendancy ${a.id} has a name`);
      assert.ok(ascendancyArt[a.id]?.img, `${cls} ascendancy ${a.id} has art`);
    }
  }
  // Druid and Ranger have exactly two live ascendancies right now.
  assert.equal(ascByClass.Druid.length, 2);
  assert.equal(ascByClass.Ranger.length, 2);
  assert.deepEqual(ascByClass.Druid.map((a) => a.name), ['Oracle', 'Shaman']);
  assert.deepEqual(ascByClass.Ranger.map((a) => a.name), ['Deadeye', 'Pathfinder']);
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

test('buildStats: raw stat lines keyed by hash, markup preserved, feed the agg module', () => {
  const art = buildArtifact();
  const stats = buildStats();
  // Keyed only for visible nodes that actually have stats (some jewel sockets none).
  const visibleWithStats = art.nodes.filter((n) => !n.hidden).filter((n) => stats[n.h]);
  assert.ok(visibleWithStats.length > 1000, 'most visible nodes carry stat lines');
  // Entries are arrays of raw GGG lines: markup is preserved (unlike buildSearch).
  const anyMarkup = Object.values(stats).some((lines) => lines.some((l) => /\[[^\]]+\]/.test(l)));
  assert.ok(anyMarkup, 'keyword markup preserved for the client renderer');
  for (const lines of Object.values(stats)) {
    assert.ok(Array.isArray(lines) && lines.length > 0);
    for (const l of lines) assert.equal(typeof l, 'string');
  }
  // End-to-end: feeding real node lines through aggregate() yields summed output.
  const sample = art.nodes.filter((n) => !n.hidden && stats[n.h]).slice(0, 50);
  const lines = sample.flatMap((n) => stats[n.h]);
  const agg = aggregate(lines);
  assert.ok(agg.categories.length > 0, 'real tree data aggregates into categories');
});

test('buildSearch: one lowercase plaintext entry per visible node, name + stats, no tokens', () => {
  const art = buildArtifact();
  const search = buildSearch();
  const visible = art.nodes.filter((n) => !n.hidden);
  assert.equal(Object.keys(search).length, visible.length);
  // Every entry is lowercase plaintext with the glossary tokens stripped.
  for (const text of Object.values(search)) {
    assert.equal(typeof text, 'string');
    assert.equal(text, text.toLowerCase());
    assert.doesNotMatch(text, /[[\]|]/, 'no leftover [tag|text] tokens');
  }
  // Each visible node's (lowercased) name is searchable.
  const sample = visible.find((n) => n.name && art.nodes.some((m) => m.h === n.h));
  assert.ok(search[sample.h].includes(sample.name.toLowerCase()), 'name is indexed');
});
