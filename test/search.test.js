import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../src/data/search.js';

test('search finds gems by case-insensitive substring', () => {
  const hits = search('herald');
  assert.ok(hits.some((h) => h.name === 'Herald of Ash'));
  assert.ok(hits.every((h) => h.slug && h.url));
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
  assert.equal(hit.url, '/unique/astramentis');
});

test('search finds both gems and uniques when distinct query terms match', () => {
  // gems returned for gem-only query
  const gemResults = search('herald');
  assert.ok(gemResults.some((r) => r.url.startsWith('/gem/')));

  // unique returned for unique-only query
  const uniResults = search('astramentis');
  assert.ok(uniResults.some((r) => r.url.startsWith('/unique/')));
});

import request from 'supertest';
import { createApp } from '../src/server.js';

test('GET /search returns an HTML fragment with links', async () => {
  const res = await request(createApp()).get('/search?q=herald');
  assert.equal(res.status, 200);
  assert.match(res.text, /\/gem\/herald-of-ash/);
  assert.doesNotMatch(res.text, /<html/); // fragment, not full page
});

test('search results include category field', () => {
  const hits = search('herald');
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => typeof h.category === 'string' && h.category.length > 0));
});

test('search finds keystones by stat text', () => {
  const hits = search('energy shield');
  const zealots = hits.find((h) => h.url.includes('passive_keystone_zealots_oath'));
  assert.ok(zealots, "Zealot's Oath not found by stat text 'energy shield'");
});

test('search finds notables by name', () => {
  const hits = search('fast acting toxins');
  assert.ok(hits.some((h) => h.name === 'Fast Acting Toxins'));
});

test('search finds notables by stat text', () => {
  const hits = search('damaging ailments');
  assert.ok(hits.some((h) => h.url.includes('ailments38')));
});

test('search finds mod groups by text', () => {
  const hits = search('maximum life');
  assert.ok(hits.some((h) => h.url.startsWith('/mod/')));
});

test('search returns category Keystone for keystones', () => {
  const hits = search('zealot');
  const k = hits.find((h) => h.url.includes('passive_keystone_zealots_oath'));
  assert.ok(k);
  assert.equal(k.category, 'Keystone');
});

test('search returns category Notable for notables', () => {
  const hits = search('fast acting toxins');
  const n = hits.find((h) => h.name === 'Fast Acting Toxins');
  assert.ok(n);
  assert.equal(n.category, 'Notable');
});

test('search returns category Gem for gems', () => {
  const hits = search('herald of ash');
  assert.ok(hits.some((h) => h.category === 'Gem'));
});

test('search returns category Affix for mods', () => {
  const hits = search('maximum life');
  assert.ok(hits.some((h) => h.category === 'Affix'));
});
