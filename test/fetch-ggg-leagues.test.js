// test/fetch-ggg-leagues.test.js — the pure parts of the league-list fetcher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLeagues, LEAGUES_URL } from '../scripts/fetch-ggg-leagues.js';

test('LEAGUES_URL is GGG\'s PoE2 trade league list', () => {
  assert.equal(LEAGUES_URL, 'https://www.pathofexile.com/api/trade2/data/leagues');
});

test('parseLeagues keeps only well-formed poe2 entries, in upstream order', () => {
  const body = {
    result: [
      { id: 'Forbidden Rites', realm: 'poe2', text: 'Forbidden Rites' },
      { id: 'HC Forbidden Rites', realm: 'poe2', text: 'HC Forbidden Rites' },
      { id: 'Standard', realm: 'poe2', text: 'Standard' },
    ],
  };
  assert.deepEqual(parseLeagues(body), body.result);
});

test('parseLeagues rejects an empty or malformed payload so a bad response never overwrites the cache', () => {
  assert.throws(() => parseLeagues({}), /no leagues/);
  assert.throws(() => parseLeagues({ result: [] }), /no leagues/);
  assert.throws(() => parseLeagues({ result: [{ nope: 1 }] }), /no leagues/);
  assert.throws(() => parseLeagues('<!doctype html>'), /no leagues/);
});
