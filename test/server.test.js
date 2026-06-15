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

test('GET /bases returns 200 with weapon classes', async () => {
  const app = createApp();
  const res = await request(app).get('/bases');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Weapons'));
});

test('GET /bases/amulet returns 200 with base items', async () => {
  const app = createApp();
  const res = await request(app).get('/bases/amulet');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Stellar Amulet'));
});

test('GET /base/stellar-amulet returns 200', async () => {
  const app = createApp();
  const res = await request(app).get('/base/stellar-amulet');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Stellar Amulet'));
});

test('GET /base/not-a-real-base returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/base/not-a-real-base');
  assert.equal(res.status, 404);
});
