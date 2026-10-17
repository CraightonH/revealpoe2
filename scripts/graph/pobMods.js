// scripts/graph/pobMods.js — PoB mod-pool overlay. Builder-only.
//
// PoB (repoe-fork pob-data JSON) is the display/curation authority for item
// mods: affix names, tier text, trade hashes. RePoE's mods.json stays the
// *mechanical* authority (selection, structured stats, domains, eligibility)
// because PoB's export bakes numeric ranges into text and carries no stat ids.
//
// Mod ids are shared verbatim between the two sources (verified: every
// ModItem.json id exists in RePoE mods.json), so the overlay joins on id with
// a RePoE fallback for the 61 RePoE-only mods PoB doesn't list
// (e.g. LocalTrapThrowSpeed1-6).
import { loadJson } from './loader.js';
import { POBDATA } from './source.js';

// Rollable-affix pool files. Excluded: ModItemExclusive (unique-generation
// implicits — RePoE's coverage is complete there and PoB adds no new fields),
// ModRunes (socketable rune mods), ModScalability (calc scaffolding).
const POOL_FILES = [
  'ModItem',
  'ModFlask',
  'ModJewel',
  'ModCharm',
  'ModVeiled',
  'ModCorrupted',
];

let _pool = null;
function pool() {
  if (!_pool) {
    _pool = new Map();
    for (const f of POOL_FILES) {
      for (const [id, e] of Object.entries(loadJson(`${POBDATA}/${f}.json`))) {
        if (!_pool.has(id)) _pool.set(id, e);
      }
    }
  }
  return _pool;
}

// Tier display text: numeric string keys "1", "2", … sorted numerically and
// joined with "\n" (multi-line mods split their lines across keys).
export function pobTierText(entry) {
  return Object.keys(entry)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => entry[k])
    .join('\n');
}

// Display overlay for a rollable mod id, or null when PoB has no record.
export function pobModOverlay(id) {
  const e = pool().get(id);
  if (!e) return null;
  return {
    name: e.affix || null,
    text: pobTierText(e) || null,
    tradeHashes: Object.keys(e.tradeHashes ?? {}),
  };
}
