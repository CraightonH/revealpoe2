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

test('GET /mods returns 200 with prefix/suffix headings', async () => {
  const app = createApp();
  const res = await request(app).get('/mods');
  assert.equal(res.status, 200);
  assert.ok(res.text.toLowerCase().includes('prefix'));
});

test('GET /mod/increasedlife returns 200 with tier names', async () => {
  const app = createApp();
  const res = await request(app).get('/mod/increasedlife');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Hale'));
});

test('GET /mod/not-a-real-mod returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/mod/not-a-real-mod');
  assert.equal(res.status, 404);
});

test('GET /base/stellar-amulet includes affix section', async () => {
  const app = createApp();
  const res = await request(app).get('/base/stellar-amulet');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Affix') || res.text.includes('affix') || res.text.includes('IncreasedLife'));
});

test('GET /keystones returns 200 with Keystones heading', async () => {
  const app = createApp();
  const res = await request(app).get('/keystones');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Keystones'));
});

test("GET /keystone/passive_keystone_zealots_oath returns 200 with Zealot's Oath", async () => {
  const app = createApp();
  const res = await request(app).get('/keystone/passive_keystone_zealots_oath');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Zealot'));
});

test('GET /keystone/not-a-real-keystone returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/keystone/not-a-real-keystone');
  assert.equal(res.status, 404);
});

test('GET /ascendancies returns 200 with Ascendancies heading', async () => {
  const app = createApp();
  const res = await request(app).get('/ascendancies');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Ascendancies'));
});

test('GET /ascendancy/Ranger1 returns 200 with Deadeye', async () => {
  const app = createApp();
  const res = await request(app).get('/ascendancy/Ranger1');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Deadeye'));
});

test('GET /ascendancy/NotReal returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/ascendancy/NotReal');
  assert.equal(res.status, 404);
});

test('GET /gems returns 200 with gem sections', async () => {
  const app = createApp();
  const res = await request(app).get('/gems');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Herald of Ash'));
  assert.ok(res.text.includes('Active Skills'));
  assert.ok(res.text.includes('Support Gems'));
});

test('GET /notable/ailments38 returns 200 with Fast Acting Toxins', async () => {
  const app = createApp();
  const res = await request(app).get('/notable/ailments38');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Fast Acting Toxins'));
});

test('GET /notable/not-a-real-notable returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/notable/not-a-real-notable');
  assert.equal(res.status, 404);
});

test('GET /search?q=maximum+life returns Affix results', async () => {
  const app = createApp();
  const res = await request(app).get('/search?q=maximum+life');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Affix'));
});
