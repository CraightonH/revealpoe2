// scripts/ggpk/extract-gem-quality.js
//
// Reproducible extraction of the GEMLING LEGIONNAIRE alternate quality effects
// from the GGPK mirror. Every skill gem has a standard quality effect (available
// to all — RePoE exports it in skills.json `quality_stats`) AND a *second* quality
// effect that only the Gemling Legionnaire ascendancy unlocks. That second effect
// lives in the game's `GrantedEffectQualityStats` table, in the `AltStats` /
// `AltStatValuesPermille` / `AltApplyToStatSets` columns — data RePoE does NOT
// export (it ships only the standard `Stats` columns).
//
// Output: data/manual/gem-quality.generated.json — a COMMITTED artifact consumed by
// the graph builder (scripts/graph/gemQuality.js → gems.js). The graph build itself
// never reads the GGPK mirror (per repo policy: GGPK is manual-datamining, not wired
// into the build); this script is the single, re-runnable bridge. Regenerate after a
// game patch with:  npm run build:gem-quality
//
// Shape (keyed by GrantedEffect Id, which equals the skills.json key):
//   { kind: 'gem-quality',
//     altQualityBySkill: { "<skillKey>": [ { set: <statSetIndex>, stats: [ {id, permille} ] } ] } }
// One entry per target stat_set. `set` indexes skills.json `stat_sets` (verified to
// align 1:1 with the game's stat-set ordering). An empty AltApplyToStatSets defaults
// to set 0 (the primary set) — matching how an empty ApplyToStatSets behaves for the
// standard quality. The raw {id, permille} pairs are rendered to display text at
// build time (gemQuality.js) through the SAME stat-translation + quality-scaling path
// as the standard quality, so the two always read consistently.
//
// LOUD CANARY: `.datc64` decoding trusts dat-schema's column ORDER to compute byte
// offsets — a schema drift (GGG adds/reorders a column, community schema lags)
// silently misaligns every later column into garbage. So before writing we assert a
// set of known-good anchor values decoded straight from the tables. If ANY fails the
// script throws and writes nothing, signalling "a remapping is necessary" rather than
// baking corrupt quality data into the site. Update the anchors only after confirming
// the new values against the game / poe2db.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTable, haveTable, loadSchema } from './dat.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(root, 'data', 'manual', 'gem-quality.generated.json');

// Anchors decoded from the tables. A mismatch means the dat-schema column mapping
// drifted and columns are misaligned — fail loudly, do not emit data. Each anchor
// pins the std column (Stats/StatsValuesPermille) AND the alt columns (AltStats/
// AltStatValuesPermille/AltApplyToStatSets) so a shift in any is caught.
const CANARY = [
  {
    skill: 'KillingPalmPlayer',
    std: { 'recover_%_maximum_mana_on_cull': 200 },
    alt: { 'recover_%_maximum_life_on_cull': 500 },
    altSets: [], // empty → primary set (0)
  },
  {
    skill: 'TempestFlurryPlayer',
    std: { 'melee_range_+': 200 },
    alt: { 'final_strike_number_of_spirit_strikes': 100 },
    altSets: [2],
  },
];

function fail(msg) {
  throw new Error(
    `[extract-gem-quality] GGPK schema drift — dat-schema column mapping likely changed, `
    + `remapping required before this data can be trusted:\n  ${msg}`,
  );
}

// Zip parallel [statIndex...] / [permille...] into resolved {id, permille} pairs.
function zipStats(statIdxs, permilles, stats) {
  const out = [];
  (statIdxs ?? []).forEach((idx, i) => {
    const id = stats[idx]?.Id;
    if (id == null) return;
    out.push({ id, permille: permilles?.[i] ?? 0 });
  });
  return out;
}

async function main() {
  for (const t of ['GrantedEffectQualityStats', 'GrantedEffects', 'Stats']) {
    if (!haveTable(t)) fail(`mirrored table "${t}" missing — run: npm run fetch:dat`);
  }
  const schema = await loadSchema();
  const rows = (await parseTable('GrantedEffectQualityStats', { schema })).rows;
  const grantedEffects = (await parseTable('GrantedEffects', { schema })).rows;
  const stats = (await parseTable('Stats', { schema })).rows;

  // GrantedEffect (row index) -> its Id (== skills.json key).
  const skillKeyOf = (idx) => grantedEffects[idx]?.Id ?? null;

  // Index rows by skill key for the canary lookup (a skill appears at most once here).
  const rowBySkill = new Map();
  for (const r of rows) {
    const key = skillKeyOf(r.GrantedEffect);
    if (key && !rowBySkill.has(key)) rowBySkill.set(key, r);
  }

  // Canary: decode known anchors straight from the tables and compare.
  for (const c of CANARY) {
    const r = rowBySkill.get(c.skill);
    if (!r) fail(`anchor skill "${c.skill}" not found in GrantedEffectQualityStats`);
    const gotStd = Object.fromEntries(zipStats(r.Stats, r.StatsValuesPermille, stats).map((s) => [s.id, s.permille]));
    const gotAlt = Object.fromEntries(zipStats(r.AltStats, r.AltStatValuesPermille, stats).map((s) => [s.id, s.permille]));
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (!eq(gotStd, c.std)) fail(`${c.skill}: std stats ${JSON.stringify(gotStd)} ≠ expected ${JSON.stringify(c.std)}`);
    if (!eq(gotAlt, c.alt)) fail(`${c.skill}: alt stats ${JSON.stringify(gotAlt)} ≠ expected ${JSON.stringify(c.alt)}`);
    if (!eq(r.AltApplyToStatSets ?? [], c.altSets)) {
      fail(`${c.skill}: AltApplyToStatSets ${JSON.stringify(r.AltApplyToStatSets)} ≠ expected ${JSON.stringify(c.altSets)}`);
    }
  }

  // Extract every row that carries an alt quality effect.
  const altQualityBySkill = {};
  for (const r of rows) {
    const key = skillKeyOf(r.GrantedEffect);
    if (!key) continue;
    const altStats = zipStats(r.AltStats, r.AltStatValuesPermille, stats);
    if (!altStats.length) continue;
    // Empty AltApplyToStatSets → the primary stat set (0), mirroring standard quality.
    const sets = (r.AltApplyToStatSets && r.AltApplyToStatSets.length) ? r.AltApplyToStatSets : [0];
    const entries = altQualityBySkill[key] ?? (altQualityBySkill[key] = []);
    for (const set of sets) entries.push({ set, stats: altStats });
  }

  const out = {
    kind: 'gem-quality',
    _generated: 'DO NOT HAND-EDIT. Produced by scripts/ggpk/extract-gem-quality.js from the '
      + 'GGPK mirror (GrantedEffectQualityStats × GrantedEffects × Stats). Regenerate: npm run build:gem-quality.',
    description: 'Gemling Legionnaire alternate ("second") quality effects per skill. RePoE ships only the '
      + 'standard quality; the alt effect lives in GrantedEffectQualityStats.Alt* columns. '
      + 'altQualityBySkill[skillKey] = [{ set: <stat_set index>, stats: [{id, permille}] }]. Rendered to '
      + 'display text at build time (scripts/graph/gemQuality.js) via the standard stat-translation path.',
    source: 'ggpk-poe2: GrantedEffectQualityStats, GrantedEffects, Stats',
    skillCount: Object.keys(altQualityBySkill).length,
    altQualityBySkill,
  };
  await fsp.writeFile(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`extract-gem-quality: ${out.skillCount} skills → ${path.relative(root, OUT)}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
