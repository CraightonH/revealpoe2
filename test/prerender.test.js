import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affixCardSeeds } from '../scripts/prerender.js';
import { search } from '../src/data/search.js';

// Regression: affix flyout fragments (/mod/:typeSlug/card) are linked ONLY from
// search dropdown rows, which the crawler never sees (/search is excluded; the
// static dropdown is client-rendered). So they must be seeded explicitly or they
// 404 on the static site — the "Can roll on" flyout silently shows nothing.
test('prerender seeds every affix flyout card url the search can open', () => {
  const seeds = new Set(affixCardSeeds());
  assert.ok(seeds.size > 0, 'expected affix card seeds');
  for (const u of seeds) assert.match(u, /^\/mod\/.+\/card$/);

  const affixes = search('maximum life').filter((h) => h.category === 'Affix' && h.cardUrl);
  assert.ok(affixes.length, 'expected affix hits carrying a flyout cardUrl');
  for (const a of affixes) assert.ok(seeds.has(a.cardUrl), `missing prerender seed for ${a.cardUrl}`);
});
