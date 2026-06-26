import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tradeUrl, TRADE_LEAGUE } from '../src/data/trade.js';

// Decode the `q` param back into the query object for assertions.
function queryOf(url) {
  const q = new URL(url).searchParams.get('q');
  return JSON.parse(q).query;
}

test('TRADE_LEAGUE is set and URL-encoded into the path', () => {
  assert.ok(TRADE_LEAGUE);
  const url = tradeUrl({ kind: 'base', type: 'Heavy Belt' });
  assert.ok(url.startsWith('https://www.pathofexile.com/trade2/search/poe2/'));
  assert.ok(url.includes(encodeURIComponent(TRADE_LEAGUE)));
});

test('every kind searches with securable status', () => {
  for (const url of [
    tradeUrl({ kind: 'unique', name: 'Headhunter', type: 'Heavy Belt' }),
    tradeUrl({ kind: 'base', type: 'Heavy Belt' }),
    tradeUrl({ kind: 'gem', type: 'Snipe' }),
  ]) {
    assert.equal(queryOf(url).status.option, 'securable');
  }
});

test('unique pins both name and base type', () => {
  const q = queryOf(tradeUrl({ kind: 'unique', name: 'Headhunter', type: 'Heavy Belt' }));
  assert.equal(q.name, 'Headhunter');
  assert.equal(q.type, 'Heavy Belt');
  assert.equal(q.filters, undefined); // no gem filters on uniques
});

test('base searches type only, no name', () => {
  const q = queryOf(tradeUrl({ kind: 'base', type: 'Heavy Belt' }));
  assert.equal(q.type, 'Heavy Belt');
  assert.equal(q.name, undefined);
});

test('gem searches type plus min-bound default filters', () => {
  const q = queryOf(tradeUrl({ kind: 'gem', type: 'Snipe' }));
  assert.equal(q.type, 'Snipe');
  assert.equal(q.filters.misc_filters.filters.gem_level.min, 20);
  assert.equal(q.filters.misc_filters.filters.corrupted.option, 'true');
  assert.equal(q.filters.type_filters.filters.quality.min, 20);
});

test('returns null when there is no type to search on', () => {
  assert.equal(tradeUrl({ kind: 'unique', name: 'Headhunter' }), null);
  assert.equal(tradeUrl({}), null);
  assert.equal(tradeUrl(), null);
});

test('special characters in names are encoded', () => {
  const url = tradeUrl({ kind: 'unique', name: "Atziri's Disfavour", type: 'Vaal Axe' });
  // Round-trips cleanly despite the apostrophe/space.
  assert.equal(queryOf(url).name, "Atziri's Disfavour");
});
