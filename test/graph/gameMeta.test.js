// test/graph/gameMeta.test.js — the "which patch / league is this data" rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  patchFromBuild,
  pickLeague,
  leagueLogoDds,
  gameMeta,
  readGameMeta,
} from '../../scripts/graph/gameMeta.js';

// GGG numbers the PoE2 client 4.<major>.<minor>.<hotfix…>; the public patch is
// 0.<major>.<minor>. RePoE publishes the client build in version.txt.
test('patchFromBuild maps the RePoE client build to the public patch number', () => {
  assert.equal(patchFromBuild('4.5.5.1.6'), '0.5.5');
  assert.equal(patchFromBuild('4.5.0.3'), '0.5.0');
  assert.equal(patchFromBuild('4.5.5.1.6\n'), '0.5.5'); // trailing newline from the .txt
});

test('patchFromBuild returns null for anything that is not a 4.x.y build', () => {
  assert.equal(patchFromBuild(''), null);
  assert.equal(patchFromBuild(null), null);
  assert.equal(patchFromBuild('3.25.0'), null);
  assert.equal(patchFromBuild('garbage'), null);
});

const TRADE2 = [
  { id: 'Forbidden Rites', realm: 'poe2', text: 'Forbidden Rites' },
  { id: 'HC Forbidden Rites', realm: 'poe2', text: 'HC Forbidden Rites' },
  { id: 'Runes of Aldur', realm: 'poe2', text: 'Runes of Aldur' },
  { id: 'HC Runes of Aldur', realm: 'poe2', text: 'HC Runes of Aldur' },
  { id: 'Standard', realm: 'poe2', text: 'Standard' },
  { id: 'Hardcore', realm: 'poe2', text: 'Hardcore' },
];

test('pickLeague takes the first softcore challenge league in trade order', () => {
  assert.deepEqual(pickLeague(TRADE2), { id: 'Forbidden Rites', name: 'Forbidden Rites' });
});

test('pickLeague falls back to the next league once the leading one is gone', () => {
  const later = TRADE2.filter((l) => !/Forbidden Rites/.test(l.id));
  assert.deepEqual(pickLeague(later), { id: 'Runes of Aldur', name: 'Runes of Aldur' });
});

test('pickLeague skips HC/SSF variants and permanent leagues; null when none', () => {
  assert.equal(pickLeague([{ id: 'Standard', text: 'Standard' }, { id: 'Hardcore', text: 'Hardcore' }]), null);
  assert.equal(pickLeague([{ id: 'HC Foo', text: 'HC Foo' }, { id: 'SSF Foo', text: 'SSF Foo' }]), null);
  assert.equal(pickLeague([]), null);
  assert.equal(pickLeague(undefined), null);
});

test('leagueLogoDds derives the in-game wordmark path from the league name', () => {
  assert.equal(leagueLogoDds('Forbidden Rites'), 'Art/2DArt/Logos/POELeagueLogoForbiddenRites.dds');
  assert.equal(leagueLogoDds('Runes of Aldur'), 'Art/2DArt/Logos/POELeagueLogoRunesOfAldur.dds');
  assert.equal(leagueLogoDds('Rise of the Abyssal'), 'Art/2DArt/Logos/POELeagueLogoRiseOfTheAbyssal.dds');
});

test('gameMeta assembles patch + league + dates, with provenance', () => {
  const m = gameMeta({
    build: '4.5.5.1.6\n',
    leagues: TRADE2,
    leaguesFetchedAt: '2026-09-08T00:00:00Z',
    dataFetchedAt: '2026-09-07T12:00:00Z',
  });
  assert.deepEqual(m, {
    patch: '0.5.5',
    build: '4.5.5.1.6',
    league: {
      id: 'Forbidden Rites',
      name: 'Forbidden Rites',
      logoDds: 'Art/2DArt/Logos/POELeagueLogoForbiddenRites.dds',
    },
    dataFetchedAt: '2026-09-07T12:00:00Z',
    leaguesFetchedAt: '2026-09-08T00:00:00Z',
    source: 'derived',
    via: 'repoe:version.txt+ggg:trade2/leagues',
  });
});

test('gameMeta tolerates missing inputs — null fields, never a throw', () => {
  const m = gameMeta({});
  assert.equal(m.patch, null);
  assert.equal(m.build, null);
  assert.equal(m.league, null);
});

function tmpDataDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamemeta-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}

test('readGameMeta reads version.txt, leagues.json and the RePoE manifest date', () => {
  const dir = tmpDataDir({
    'repoe-poe2/version.txt': '4.5.5.1.6\n',
    'repoe-poe2/_manifest.json': JSON.stringify({ fetched_at: '2026-09-07T12:00:00-06:00' }),
    'ggg-poe2/leagues.json': JSON.stringify({ fetchedAt: '2026-09-08T00:00:00Z', leagues: TRADE2 }),
  });
  const m = readGameMeta(dir);
  assert.equal(m.patch, '0.5.5');
  assert.equal(m.league.name, 'Forbidden Rites');
  assert.equal(m.dataFetchedAt, '2026-09-07T12:00:00-06:00');
  assert.equal(m.leaguesFetchedAt, '2026-09-08T00:00:00Z');
});

test('readGameMeta on an empty data dir yields nulls (pre-refresh mirror), not an error', () => {
  const m = readGameMeta(tmpDataDir({}));
  assert.equal(m.patch, null);
  assert.equal(m.league, null);
  assert.equal(m.dataFetchedAt, null);
});

test('GAME_META_FILES lists the two inputs so the source hash covers them', async () => {
  const { GAME_META_FILES } = await import('../../scripts/graph/gameMeta.js');
  assert.deepEqual(GAME_META_FILES, ['repoe-poe2/version.txt', 'ggg-poe2/leagues.json']);
});
