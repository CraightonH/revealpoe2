// test/passiveTreeArtifact.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArtifact, buildCards } from '../scripts/build-passive-tree.js';

test('buildArtifact produces nodes/edges/meta with webp icon urls', () => {
  const art = buildArtifact();
  assert.ok(art.nodes.length > 4000);
  assert.equal(art.edges.length, 5566);
  const withIcon = art.nodes.find((n) => n.icon);
  assert.match(withIcon.icon, /^\/static\/img\/.*\.webp$/);
  assert.ok(Array.isArray(art.meta.liveAscendancies));
});

test('buildCards pre-renders a passive card per node, keyed by hash', () => {
  const art = buildArtifact();
  const cards = buildCards();
  // one card per node
  assert.equal(Object.keys(cards).length, art.nodes.length);
  for (const n of art.nodes) assert.equal(typeof cards[n.h], 'string', `card for ${n.h}`);
});

test('buildCards: notable card has the banner header + keyword-linkified stats', () => {
  const art = buildArtifact();
  const cards = buildCards();
  // "Essence of the Mountain" — a notable with Cold/Freeze keywords.
  const node = art.nodes.find((n) => n.name === 'Essence of the Mountain');
  assert.ok(node, 'sample node present');
  const html = cards[node.h];
  assert.match(html, /itemHeader doubleLine/);          // ornate banner header
  assert.match(html, /class="kw" data-keyword=/);        // keyword linkification
  assert.match(html, /Notable Passive/);                 // type-line label
});

test('buildCards: small passive (no graph card) still renders with a Passive label', () => {
  const art = buildArtifact();
  const cards = buildCards();
  const small = art.nodes.find((n) => n.k === 'small' && n.stats.length);
  const html = cards[small.h];
  assert.match(html, /newItemPopup/);
  assert.match(html, /itemHeader doubleLine/);
});
