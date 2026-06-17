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
  assert.match(res.text, /data-keyword="Fire"/);
  assert.match(res.text, /data-keyword="Herald"/);
  // section headers
  assert.match(res.text, /<span class="ItemType">Explosion<\/span>/);
  // per-level range line
  assert.match(res.text, /\(16\.67—23\)%/);
  // footer
  assert.match(res.text, /Skills can be managed in the Skills Panel\./);
  // requirements row: level range (always) + attribute (fixed display ranges)
  assert.match(res.text, /Requires:/);
  assert.match(res.text, /Level \(1—90\)/);
  // "Str" abbreviation is linked to the Strength glossary keyword
  assert.match(res.text, /\(4—157\) <span class="kw" data-keyword="Strength">Str<\/span>/);
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

test('GET /keystone/:id renders a keystone passive popup', async () => {
  const res = await request(createApp()).get('/keystone/passive_keystone_zealots_oath');
  assert.equal(res.status, 200);
  assert.match(res.text, /Zealot&#39;s Oath/);
  // newItemPopup family + passive + keystone modifier
  assert.match(res.text, /newItemPopup/);
  assert.match(res.text, /PassivePopup/);
  assert.match(res.text, /is-keystone/);
  // reuses the glow-border machinery
  assert.match(res.text, /--card-border:/);
  // flat header with left-anchored icon and a "Keystone" type line
  assert.match(res.text, /passiveHeader/);
  assert.match(res.text, /leadPassiveIcon/);
  assert.match(res.text, /typeLine">.*Keystone.*<\/span>/);
  // under the size scaler
  const popupIdx = res.text.indexOf('newItemPopup');
  const detailIdx = res.text.indexOf('gem-detail');
  assert.ok(detailIdx > -1 && detailIdx < popupIdx, 'passive card must be wrapped in .gem-detail');
});

test('GET /notable/:id renders a notable passive popup', async () => {
  const res = await request(createApp()).get('/notable/armour_and_evasion53');
  assert.equal(res.status, 200);
  assert.match(res.text, /Knight of Izaro/);
  assert.match(res.text, /PassivePopup/);
  assert.match(res.text, /is-notable/);
  assert.match(res.text, /typeLine">.*Notable.*<\/span>/);
});

test('passive re-skin removes the legacy passive-detail card classes', async () => {
  const res = await request(createApp()).get('/keystone/passive_keystone_zealots_oath');
  assert.ok(!/passive-detail-card/.test(res.text), 'legacy passive-detail-card must be gone');
});

test('GET /keystone/:id/card returns the passive card fragment', async () => {
  const res = await request(createApp()).get('/keystone/passive_keystone_zealots_oath/card');
  assert.equal(res.status, 200);
  assert.match(res.text, /newItemPopup/);
  assert.match(res.text, /PassivePopup/);
  assert.match(res.text, /Zealot&#39;s Oath/);
});

test('GET /keystone/:id/card returns 404 empty body for unknown id', async () => {
  const res = await request(createApp()).get('/keystone/not-a-real-keystone/card');
  assert.equal(res.status, 404);
  assert.equal(res.text, '');
});

test('GET /keystones renders aligned index cards with hover previews', async () => {
  const res = await request(createApp()).get('/keystones');
  assert.equal(res.status, 200);
  // compact index-card layout (mirrors /uniques), not the old verbose tile
  assert.match(res.text, /keystone-index-grid/);
  assert.match(res.text, /keystone-index-card/);
  assert.ok(!/passive-node-card/.test(res.text), 'keystones page must not use the old passive-node-card tile');
  // hover-preview wiring + keystone header accent
  assert.match(res.text, /data-card-url="\/keystone\/[^"]+\/card"/);
  assert.match(res.text, /color:var\(--color-keystone\)/);
});

test('ascendancy page renders colorway-tinted notable index cards', async () => {
  const res = await request(createApp()).get('/ascendancy/Druid1');
  assert.equal(res.status, 200);
  // compact index cards, not the old verbose passive-node tiles
  assert.match(res.text, /asc-notable-card/);
  assert.ok(!/passive-node-card/.test(res.text), 'ascendancy must not use the old passive-node-card tile');
  // colorway var set on the page + hover preview wiring to the generic passive card
  assert.match(res.text, /--asc-color: #4fa3a3/); // Oracle (Druid1) teal
  assert.match(res.text, /data-card-url="\/passive\/[^"]+\/card"/);
});

test('GET /passive/:id and /card serve an ascendancy notable themed to its colorway', async () => {
  const card = await request(createApp()).get('/passive/AscendancyDruid1Notable4/card');
  assert.equal(card.status, 200);
  assert.match(card.text, /PassivePopup/);
  assert.match(card.text, /is-asc/);
  assert.match(card.text, /--card-border: #4fa3a3/);
  const page = await request(createApp()).get('/passive/AscendancyDruid1Notable4');
  assert.equal(page.status, 200);
  assert.match(page.text, /gem-detail/);
  // breadcrumb links back to the parent ascendancy
  assert.match(page.text, /href="\/ascendancy\/Druid1"/);
});

test('GET /passive/:id returns 404 for unknown id', async () => {
  const res = await request(createApp()).get('/passive/not-a-real-node');
  assert.equal(res.status, 404);
});

test('ascendancies list tints each card to its colorway', async () => {
  const res = await request(createApp()).get('/ascendancies');
  assert.equal(res.status, 200);
  assert.match(res.text, /--asc-color: #4fa3a3/); // Oracle teal present among the cards
});

test('layout loads Popper before Tippy before the keyword glue', async () => {
  // Tippy's UMD build requires window.Popper; it must load (and execute)
  // before tippy, which must load before keywords.js, or tooltips never show.
  const res = await request(createApp()).get('/gem/herald-of-ash');
  const popper = res.text.indexOf('popper.min.js');
  const tippy = res.text.indexOf('tippy.umd'); // the script, not tippy.css
  const glue = res.text.indexOf('js/keywords.js');
  assert.ok(popper > -1, 'Popper script must be present');
  assert.ok(tippy > -1, 'Tippy script must be present');
  assert.ok(glue > -1, 'keywords.js glue must be present');
  assert.ok(popper < tippy, 'Popper must load before Tippy');
  assert.ok(tippy < glue, 'Tippy must load before keywords.js');
});
