import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../src/data/search.js';

test('search finds gems by case-insensitive substring', () => {
  const hits = search('herald');
  const gem = hits.find((h) => h.name === 'Herald of Ash');
  assert.ok(gem);
  assert.ok(gem.slug && gem.url.startsWith('/gems#'));
  assert.ok(hits.every((h) => h.slug)); // every result is addressable (url may be null for affixes)
});

test('search returns [] for blank query', () => {
  assert.deepEqual(search('  '), []);
});

test('search caps results', () => {
  assert.ok(search('e').length <= 20);
});

test('search finds unique items by name', () => {
  const results = search('astramentis');
  assert.ok(results.length > 0);
  const hit = results.find((r) => r.name === 'Astramentis');
  assert.ok(hit, 'Astramentis should appear in search results');
  assert.equal(hit.url, '/uniques#astramentis');
});

test('search finds both gems and uniques when distinct query terms match', () => {
  // gems returned for gem-only query
  const gemResults = search('herald');
  assert.ok(gemResults.some((r) => r.url.startsWith('/gems#')));

  // unique returned for unique-only query
  const uniResults = search('astramentis');
  assert.ok(uniResults.some((r) => r.url.startsWith('/uniques#')));
});

import request from 'supertest';
import { createApp } from '../src/server.js';

test('GET /search returns an HTML fragment with links', async () => {
  const res = await request(createApp()).get('/search?q=herald');
  assert.equal(res.status, 200);
  assert.match(res.text, /\/gems#herald-of-ash/);
  assert.doesNotMatch(res.text, /<html/); // fragment, not full page
});

test('search results include category field', () => {
  const hits = search('herald');
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => typeof h.category === 'string' && h.category.length > 0));
});

test('search finds gems by stat text, not just by name', () => {
  // The point of backing the dropdown with the full-text doc set: a gem whose
  // name says nothing about energy shield still surfaces via its stat lines.
  const hits = search('energy shield');
  assert.ok(hits.some((h) => h.url.startsWith('/gems#')));
});

test('a broad stat query shows category variety, not 20 of one type', () => {
  // Round-robin keeps the capped preview varied — keystones aren't buried under
  // the 100+ uniques that also match. The full result set lives in Theory
  // Crafting (the dropdown's "Search everything" row), not this preview.
  const cats = new Set(search('energy shield').map((h) => h.category));
  assert.ok(cats.size >= 4, `expected varied categories, got ${[...cats].join(', ')}`);
  assert.ok(cats.has('Keystone'));
});

test('search finds notables by name', () => {
  const hits = search('fast acting toxins');
  assert.ok(hits.some((h) => h.name === 'Fast Acting Toxins'));
});

test('search finds notables by stat text', () => {
  const hits = search('damaging ailments');
  // The notable is surfaced; its click-through now deep-links the interactive
  // tree (/passives?node=<hash>) while the hover card still points at the
  // detail fragment (/passive/ailments38/card).
  const hit = hits.find((h) => h.cardUrl && h.cardUrl.includes('ailments38'));
  assert.ok(hit, 'expected the ailments38 notable among the hits');
  assert.match(hit.url, /^\/passives\?node=\d+$/);
});

test('affixes never link to a standalone mod page', () => {
  // The deprecation guarantee: an affix either links to a /bases page (single
  // base target) or carries a /mod/:slug/card flyout (multiple), never a mod page.
  const affixes = search('maximum life').filter((h) => h.category === 'Affix');
  assert.ok(affixes.length, 'expected affix hits for "maximum life"');
  for (const a of affixes) {
    if (a.url) assert.ok(a.url.startsWith('/bases#') || a.url.startsWith('/bases?'), `affix url should be the bases index, got ${a.url}`);
    if (a.cardUrl) assert.match(a.cardUrl, /^\/mod\/.+\/card$/);
  }
});

test('search returns category Keystone for keystones', () => {
  const hits = search('zealot');
  const k = hits.find((h) => h.cardUrl && h.cardUrl.includes('passive_keystone_zealots_oath'));
  assert.ok(k);
  assert.equal(k.category, 'Keystone');
  assert.match(k.url, /^\/passives\?node=\d+$/); // click-through goes to the tree
});

test('search returns category Notable for notables', () => {
  const hits = search('fast acting toxins');
  const n = hits.find((h) => h.name === 'Fast Acting Toxins');
  assert.ok(n);
  assert.equal(n.category, 'Notable');
});

test('search labels gems by type (Skill/Support/Spirit), not a bare Gem', () => {
  const hits = search('herald of ash');
  assert.ok(hits.some((h) => ['Skill', 'Support', 'Spirit'].includes(h.category)));
  assert.ok(!hits.some((h) => h.category === 'Gem'));
});

test('search exposes a cardUrl for hover-card categories', () => {
  // Notable cards live under /passive, not /notable — the distinction the
  // search index has to bridge so the hover tooltip resolves.
  const notable = search('fast acting toxins').find((h) => h.name === 'Fast Acting Toxins');
  assert.match(notable.cardUrl, /^\/passive\/.+\/card$/);
  const support = search('unleash').find((h) => h.category === 'Support');
  assert.equal(support.cardUrl, '/gem/unleash-support/card');
});

test('search returns category Affix for mods', () => {
  const hits = search('maximum life');
  assert.ok(hits.some((h) => h.category === 'Affix'));
});

test('search finds gems by quality-effect text, including keyword-marked phrases', () => {
  // Quality bonus lines are effect text, not just names — and the phrase spans a
  // glossary keyword ("Power Charge"), which renders with surrounding spaces. A
  // single-spaced substring query must still match (norm() collapses whitespace).
  const hits = search('more damage per power charge consumed', 40);
  assert.ok(
    hits.some((h) => h.name === 'Falling Thunder' && h.url === '/gems#falling-thunder'),
    'Falling Thunder should surface via its quality-effect text'
  );
});

test('search finds gems by Gemling alternate-quality (altQuality) effect', () => {
  // The Gemling Legionnaire "second" quality is a separate effect from the
  // standard quality; it must be indexed too or building around it is unsearchable.
  const hits = search('chance to not remove charges on use', 40);
  assert.ok(
    hits.some((h) => h.name === 'Falling Thunder'),
    "Falling Thunder should surface via its Gemling alt-quality effect"
  );
});
