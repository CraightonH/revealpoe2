import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/server.js';

test('GET /api/keyword/:key returns a fragment for a known keyword', async () => {
  const res = await request(createApp()).get('/api/keyword/Accuracy');
  assert.equal(res.status, 200);
  assert.match(res.text, /<strong>Accuracy<\/strong>/);
  assert.match(res.headers['cache-control'] || '', /max-age/);
});

test('cross-referenced keywords become nested .kw spans', async () => {
  const res = await request(createApp()).get('/api/keyword/Accuracy');
  assert.match(res.text, /<span class="kw" data-keyword="Evasion"/);
});

test('newlines in the definition are rendered as <br>', async () => {
  const res = await request(createApp()).get('/api/keyword/Accuracy');
  assert.match(res.text, /<br>/);
});

test('unknown keyword returns 404', async () => {
  const res = await request(createApp()).get('/api/keyword/NotARealKeyword');
  assert.equal(res.status, 404);
});

test('empty-definition keyword returns 404', async () => {
  const res = await request(createApp()).get('/api/keyword/AbsentAmulet');
  assert.equal(res.status, 404);
});
