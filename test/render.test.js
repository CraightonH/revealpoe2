import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/server.js';

test('GET /gem/herald-of-ash renders the card', async () => {
  const res = await request(createApp()).get('/gem/herald-of-ash');
  assert.equal(res.status, 200);
  assert.match(res.text, /Herald of Ash/);
  assert.match(res.text, /newItemPopup/);
  assert.match(res.text, /--card-border:/);
  assert.match(res.text, /leadSkillIcon/);
  // type line + properties (type line is now a hoverable keyword span)
  assert.match(res.text, /class="lc">.*Buff.*<\/span>/);
  assert.match(res.text, /Tier: <span class="colourDefault">4</);
  assert.match(res.text, /Reservation: <span class="colourDefault">30 Spirit</);
  // tags as hoverable keyword spans
  assert.match(res.text, /data-keyword="Persistent"/);
  // section headers
  assert.match(res.text, /<span class="ItemType">Explosion<\/span>/);
  // per-level range line
  assert.match(res.text, /\(16\.67—23\)%/);
  // footer
  assert.match(res.text, /Skills can be managed in the Skills Panel\./);
  // requirements row: level range (always) + attribute (fixed display ranges)
  assert.match(res.text, /Requires:/);
  assert.match(res.text, /Level \(1—90\)/);
  assert.match(res.text, /\(4—157\) Str/);
  // Recommended Supports must NOT be inside the in-game card popup...
  const supIdx = res.text.indexOf('recommended-supports');
  assert.ok(supIdx > -1, 'recommended-supports section should be present on the page');
  const popupToSupports = res.text.slice(res.text.indexOf('newItemPopup'), supIdx);
  assert.ok(!/Recommended Supports/.test(popupToSupports), 'supports must be rendered outside the card');
  // ...but they ARE rendered (below the card) with support links
  const sectionHtml = res.text.slice(supIdx);
  assert.match(sectionHtml, /Recommended Supports/);
  assert.match(sectionHtml, /<a class="[rgbw]" href="\/gem\//);
});

test('GET /gem/unknown returns 404', async () => {
  const res = await request(createApp()).get('/gem/does-not-exist');
  assert.equal(res.status, 404);
});
