#!/usr/bin/env node
// Capture GGG's PoE2 league list alongside the game data.
//
// Nothing in RePoE or the tree data names the league the data belongs to, and the
// public /leagues API ignores realm=poe2. The PoE2 trade site's league list is the
// one public endpoint that answers "what leagues exist right now" for PoE2, so
// the header badge's league name (and its in-game wordmark) derive from it —
// see scripts/graph/gameMeta.js for the rule that picks the current one.
//
// Writes data/source/ggg-poe2/leagues.json. Run right after scrape.py (locally,
// and in refresh-data.yml) so the label is captured with the data it labels; the
// cached deploy path never runs it, so a code-only deploy can't relabel old data.
//
// Failure policy: warn and keep the previous file. The badge is cosmetic, so an
// API hiccup must never fail a build — but a malformed body must never overwrite
// a good cache either (parseLeagues throws on anything that isn't a league list).

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'data', 'source', 'ggg-poe2', 'leagues.json');

export const LEAGUES_URL = 'https://www.pathofexile.com/api/trade2/data/leagues';
const UA = 'revealpoe2-league-sync/1.0 (+data-provenance badge)';
const TIMEOUT = 20_000;
const RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseLeagues(body) {
  const list = Array.isArray(body?.result) ? body.result : [];
  const ok = list.filter((l) => l && typeof l.id === 'string' && l.id.length > 0);
  if (!ok.length) throw new Error('no leagues in response');
  return ok;
}

async function fetchJson(url) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < RETRIES) await sleep(500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export async function run() {
  try {
    const leagues = parseLeagues(await fetchJson(LEAGUES_URL));
    await fsp.mkdir(path.dirname(OUT), { recursive: true });
    await fsp.writeFile(OUT, JSON.stringify({
      source: 'ggg-trade2',
      url: LEAGUES_URL,
      fetchedAt: new Date().toISOString(),
      leagues,
    }, null, 2));
    console.log(`fetch-ggg-leagues: ${leagues.length} leagues — ${leagues.map((l) => l.id).join(', ')}`);
  } catch (err) {
    const kept = await fsp.access(OUT).then(() => true, () => false);
    console.warn(
      `fetch-ggg-leagues: ${err.message} — ${kept ? 'keeping previous leagues.json' : 'no leagues.json; header badge will omit the league'}`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
