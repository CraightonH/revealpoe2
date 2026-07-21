import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affixCardSeeds, passiveDocSeeds, extractLinks } from '../scripts/prerender.js';
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

test('prerender discovers gem detail pages from row hrefs only', () => {
  const links = extractLinks('<a href="/gem/arc">Arc</a>');
  assert.ok(links.has('/gem/arc'));
  assert.equal(links.size, 1);
});

test('prerender discovers item-index detail pages and bases class rows', () => {
  const links = extractLinks([
    '<a href="/unique/astramentis">Astramentis</a>',
    '<a class="item-index-row" href="/bases/bow">Bows</a>',
    '<a class="bases-list-card" href="/base/stellar-amulet">Stellar Amulet</a>',
  ].join(''));
  assert.deepEqual([...links], ['/unique/astramentis', '/bases/bow', '/base/stellar-amulet']);
});

test('prerender seeds canonical passive detail URLs fetched by Theory Crafting', () => {
  const seeds = new Set(passiveDocSeeds());
  assert.ok(seeds.has('/keystone/passive_keystone_zealots_oath'));
  assert.ok(seeds.has('/notable/ailments38'));
});
