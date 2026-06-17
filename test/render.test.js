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
