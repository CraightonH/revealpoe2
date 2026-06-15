import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/server.js';

test('GET /healthz returns ok', async () => {
  const app = createApp();
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.text, 'ok');
});

test('GET /uniques returns 200 with unique names', async () => {
  const app = createApp();
  const res = await request(app).get('/uniques');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Astramentis'));
});

test('GET /unique/astramentis returns 200', async () => {
  const app = createApp();
  const res = await request(app).get('/unique/astramentis');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Astramentis'));
});

test('GET /unique/not-a-real-unique returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/unique/not-a-real-unique');
  assert.equal(res.status, 404);
});
