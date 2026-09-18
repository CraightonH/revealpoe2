import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSearchDocs, searchRank, groupQuery } from '../public/js/query-core.js';

// query-core is pure (no DOM, no graph), so the glossary-pinning logic is
// testable here with synthetic docs instead of the real game data.

const rawDoc = (over) => ({
  name: 'Maim',
  slug: 'maim',
  url: null,
  cardUrl: null,
  category: 'glossary',
  keyword: 'Maim',
  color: '',
  tags: [],
  req: [],
  grants: [],
  text: 'maim',
  ...over,
});

const gemDoc = (name) => rawDoc({
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  url: `/gems#${name.toLowerCase().replace(/\s+/g, '-')}`,
  category: 'gem',
  keyword: undefined,
  text: name.toLowerCase(),
});

function rawDocs() {
  return [
    rawDoc({}),                                          // glossary: Maim
    rawDoc({ name: 'Maimed', slug: 'maimed', keyword: 'Maimed', text: 'maimed' }),
    gemDoc('Maim Support'),
    gemDoc('Herald of Ash'),
  ];
}

function docs() {
  return toSearchDocs(rawDocs());
}

test('toSearchDocs passes the keyword id through', () => {
  const d = toSearchDocs([rawDoc({})])[0];
  assert.equal(d.keyword, 'Maim');
  assert.equal(d.category, 'Glossary');
});

test('glossary term pins to the front on term-name match', () => {
  const hits = searchRank(docs(), 'maim');
  assert.ok(hits.length > 0);
  assert.equal(hits[0].name, 'Maim');
  assert.equal(hits[0].category, 'Glossary');
  assert.equal(hits[0].keyword, 'Maim');
  assert.equal(hits[0].url, null);
});

test('exact term match wins over partial matches, and only one glossary result shows', () => {
  const hits = searchRank(docs(), 'maim');
  const gloss = hits.filter((h) => h.category === 'Glossary');
  assert.equal(gloss.length, 1);
  assert.equal(gloss[0].name, 'Maim'); // exact 'maim', not 'Maimed'
});

test('partial term match still pins a single glossary term', () => {
  const only = toSearchDocs([rawDoc({ name: 'Maimed', slug: 'maimed', keyword: 'Maimed', text: 'maimed' }), gemDoc('Herald of Ash')]);
  const hits = searchRank(only, 'maim');
  assert.equal(hits[0].category, 'Glossary');
  assert.equal(hits[0].name, 'Maimed');
});

test('no glossary match leaves ranking untouched', () => {
  const hits = searchRank(docs(), 'herald');
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.category !== 'Glossary'));
  assert.equal(hits[0].name, 'Herald of Ash');
});

test('glossary term never appears mid-list via the round-robin', () => {
  // 'support' matches the gem's text blob but no glossary name.
  const hits = searchRank(docs(), 'support');
  assert.ok(hits.every((h) => h.category !== 'Glossary'));
});

test('pinned glossary result counts toward the limit', () => {
  const hits = searchRank(docs(), 'maim', 1);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].category, 'Glossary');
});

test('blank query returns nothing', () => {
  assert.deepEqual(searchRank(docs(), '  '), []);
});

test('groupQuery excludes glossary docs (Theory Crafting untouched)', () => {
  // 'maimed' matches only the glossary doc's text blob — nothing else in rawDocs.
  const res = groupQuery('maimed', { docs: rawDocs() });
  assert.equal(res.total, 0);
  assert.deepEqual(res.groups, []);
});
