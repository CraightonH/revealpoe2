// scripts/graph/gameMeta.js — "which patch / league does this data describe?"
//
// Neither RePoE's JSON tables nor GGG's tree data name the patch or league they
// belong to, so the badge in the site header is derived from two small files
// captured alongside the data at scrape time:
//
//   repoe-poe2/version.txt  — the client build RePoE exported from (scrape.py
//                             mirrors it with the tables, so it is atomic with them)
//   ggg-poe2/leagues.json   — GGG's PoE2 trade league list (scripts/fetch-ggg-leagues.js)
//
// Everything here is a pure rule over those inputs; the builder stamps the result
// into build/graph.json as `meta.game`. Missing inputs yield nulls, never a throw:
// the badge simply doesn't render until the data is refreshed.
import fs from 'node:fs';
import path from 'node:path';

export const GAME_META_FILES = ['repoe-poe2/version.txt', 'ggg-poe2/leagues.json'];

// GGG numbers the PoE2 client 4.<major>.<minor>.<hotfix…> (PoE1 is 3.x); the
// public patch is 0.<major>.<minor>. Anything else is not a PoE2 build.
export function patchFromBuild(build) {
  const m = /^4\.(\d+)\.(\d+)(?:\.|$)/.exec(String(build ?? '').trim());
  return m ? `0.${m[1]}.${m[2]}` : null;
}

// Trade lists leagues newest-first: [league, HC league, …older…, Standard, Hardcore].
// The first softcore entry that is not a permanent league is "the current league".
// Rule, not a name table: when a league ends, the next one is picked automatically.
const PERMANENT = new Set(['Standard', 'Hardcore']);
const VARIANT_PREFIX = /^(HC|SSF)\b/;

export function pickLeague(leagues) {
  for (const l of leagues ?? []) {
    const id = String(l?.id ?? '');
    if (!id || PERMANENT.has(id) || VARIANT_PREFIX.test(id)) continue;
    return { id, name: String(l.text ?? id) };
  }
  return null;
}

// The game ships a wordmark per league at Art/2DArt/Logos/POELeagueLogo<Name>.dds
// (verified for Dawn of the Hunt → Forbidden Rites). Derived, so a new league
// picks up its art with no hand edit; fetch-images falls back to a placeholder if
// GGG ever breaks the pattern.
export function leagueLogoDds(name) {
  const compact = String(name)
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  return `Art/2DArt/Logos/POELeagueLogo${compact}.dds`;
}

export function gameMeta({ build, leagues, leaguesFetchedAt, dataFetchedAt } = {}) {
  const trimmed = build ? String(build).trim() : null;
  const picked = pickLeague(leagues);
  return {
    patch: patchFromBuild(trimmed),
    build: trimmed || null,
    league: picked ? { ...picked, logoDds: leagueLogoDds(picked.name) } : null,
    dataFetchedAt: dataFetchedAt ?? null,
    leaguesFetchedAt: leaguesFetchedAt ?? null,
    source: 'derived',
    via: 'repoe:version.txt+ggg:trade2/leagues',
  };
}

function readIf(p, parse) {
  try {
    return parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw err;
  }
}

export function readGameMeta(dataDir) {
  const build = readIf(path.join(dataDir, GAME_META_FILES[0]), (s) => s);
  const leagueFile = readIf(path.join(dataDir, GAME_META_FILES[1]), JSON.parse);
  const manifest = readIf(path.join(dataDir, 'repoe-poe2', '_manifest.json'), JSON.parse);
  return gameMeta({
    build,
    leagues: leagueFile?.leagues,
    leaguesFetchedAt: leagueFile?.fetchedAt,
    dataFetchedAt: manifest?.fetched_at,
  });
}
