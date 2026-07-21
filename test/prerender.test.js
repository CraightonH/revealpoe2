import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affixCardSeeds, baseDetailSeeds, passiveDocSeeds, searchCardSeeds, extractLinks } from '../scripts/prerender.js';
import { search } from '../src/data/search.js';
import { allDocs } from '../src/data/theorycraft.js';

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

test('prerender seeds every non-affix card url the client search can open', () => {
  const seeds = new Set(searchCardSeeds());
  for (const doc of allDocs()) {
    if (doc.category !== 'affix' && doc.cardUrl) {
      assert.ok(seeds.has(doc.cardUrl), `missing search card seed for ${doc.cardUrl}`);
    }
  }
});

test('prerender discovers gem detail pages from row hrefs only', () => {
  const links = extractLinks('<a href="/gem/arc">Arc</a>');
  assert.ok(links.has('/gem/arc'));
  assert.equal(links.size, 1);
});

test('prerender discovers dedicated item-index rows while public cards use deep links', () => {
  const links = extractLinks([
    '<a href="/unique/astramentis">Astramentis</a>',
    '<a class="item-index-row" href="/bases/bow">Bows</a>',
    '<a class="bases-list-card" href="/bases#amulet" data-card-url="/base/stellar-amulet/card">Stellar Amulet</a>',
  ].join(''));
  assert.deepEqual([...links], ['/unique/astramentis', '/bases/bow', '/bases', '/base/stellar-amulet/card']);
});

test('prerender explicitly seeds every base detail pane source', () => {
  const seeds = new Set(baseDetailSeeds());
  assert.ok(seeds.has('/base/stellar-amulet'));
  assert.ok([...seeds].every((u) => /^\/base\/[^/]+$/.test(u)));
  const bases = allDocs().filter((d) => d.category === 'base');
  assert.equal(seeds.size, bases.length);
  for (const base of bases) assert.ok(seeds.has(`/base/${base.slug}`));
});

test('prerender seeds canonical passive detail URLs fetched by Theory Crafting', () => {
  const seeds = new Set(passiveDocSeeds());
  assert.ok(seeds.has('/keystone/passive_keystone_zealots_oath'));
  assert.ok(seeds.has('/notable/ailments38'));
  for (const doc of allDocs()) {
    if (doc.category === 'keystone') assert.ok(seeds.has(`/keystone/${doc.slug}`));
    if (doc.category === 'notable') assert.ok(seeds.has(`/notable/${doc.slug}`));
  }
});
