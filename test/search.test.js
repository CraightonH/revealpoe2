import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../src/data/search.js';

test('search finds gems by case-insensitive substring', () => {
  const hits = search('herald');
  assert.ok(hits.some((h) => h.name === 'Herald of Ash'));
  assert.ok(hits.every((h) => h.slug && h.url.startsWith('/gem/')));
});

test('search returns [] for blank query', () => {
  assert.deepEqual(search('  '), []);
});

test('search caps results', () => {
  assert.ok(search('e').length <= 20);
});

import request from 'supertest';
import { createApp } from '../src/server.js';

test('GET /search returns an HTML fragment with links', async () => {
  const res = await request(createApp()).get('/search?q=herald');
  assert.equal(res.status, 200);
  assert.match(res.text, /\/gem\/herald-of-ash/);
  assert.doesNotMatch(res.text, /<html/); // fragment, not full page
});
