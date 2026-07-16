// scripts/ggpk/extract-gem-levels.js
//
// Reproducible extraction of the per-gem-level REQUIRED CHARACTER LEVEL curve from
// the GGPK mirror. This data does NOT exist in RePoE (skills.json per_level carries
// only costs; base_items requirements are null) — it lives in the game's own
// `ItemExperiencePerLevel` table, keyed by each gem's `SkillGems.ItemExperienceType`.
//
// Output: data/manual/gem-levels.generated.json — a COMMITTED artifact consumed by
// the graph builder (scripts/graph/gems.js). The graph build itself never reads the
// GGPK mirror (per repo policy: GGPK is manual-datamining, not wired into the build);
// this script is the single, re-runnable bridge. Regenerate after a game patch with
//   npm run build:gem-levels
//
// LOUD CANARY: `.datc64` decoding trusts dat-schema's column ORDER to compute byte
// offsets — a schema drift (GGG adds/reorders a column, community schema lags)
// silently misaligns every later column into garbage. So before writing, we assert a
// set of known-good anchor values decoded straight from the tables. If ANY fails the
// script throws and writes nothing, signalling "a remapping is necessary" rather than
// baking corrupt requirement data into the site. Update the anchors only after
// confirming the new values against poe2db.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTable, haveTable, loadSchema } from './dat.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(root, 'data', 'manual', 'gem-levels.generated.json');

const GEM_LEVEL_MAX = 20; // a skill gem's normal cap; poe2db shows Requires Level only 1..20

// Anchors decoded from the tables. A mismatch means the dat-schema column mapping
// drifted and columns are misaligned — fail loudly, do not emit data.
const CANARY = {
  // ItemExperienceType 0 (used by ~88% of gems) — required char level per gem level 1..20.
  type0Curve: [0, 3, 6, 10, 14, 18, 22, 26, 31, 36, 41, 46, 52, 58, 64, 66, 72, 78, 84, 90],
  // A pure-Strength gem (single-attribute) and a Str/Int hybrid — guards the
  // SkillGems attribute-percent columns and the BaseItemTypes join.
  anchors: [
    { id: 'Metadata/Items/Gem/SkillGemAncestralCry', type: 0, str: 100, dex: 0, int: 0 },
    { id: 'Metadata/Items/Gems/SkillGemDiscipline', type: 0, str: 25, dex: 0, int: 75 },
  ],
};

function fail(msg) {
  throw new Error(
    `[extract-gem-levels] GGPK schema drift — dat-schema column mapping likely changed, ` +
    `remapping required before this data can be trusted:\n  ${msg}`,
  );
}

async function main() {
  for (const t of ['BaseItemTypes', 'SkillGems', 'ItemExperiencePerLevel']) {
    if (!haveTable(t)) fail(`mirrored table "${t}" missing — run: npm run fetch:dat`);
  }
  const schema = await loadSchema();
  const base = (await parseTable('BaseItemTypes', { schema })).rows;
  const skillGems = (await parseTable('SkillGems', { schema })).rows;
  const xp = (await parseTable('ItemExperiencePerLevel', { schema })).rows;

  // ItemExperienceType (row index) -> Map(gemLevel -> requiredCharacterLevel)
  const curveByType = new Map();
  for (const r of xp) {
    const { ItemExperienceType: type, ItemCurrentLevel: lvl, Level: req } = r;
    if (type == null || lvl == null || req == null) continue;
    if (!curveByType.has(type)) curveByType.set(type, new Map());
    curveByType.get(type).set(lvl, req);
  }

  // Canary 1: the dominant type-0 curve.
  const t0 = curveByType.get(0);
  if (!t0) fail('no ItemExperienceType 0 curve found');
  const got0 = Array.from({ length: GEM_LEVEL_MAX }, (_, i) => t0.get(i + 1) ?? null);
  if (JSON.stringify(got0) !== JSON.stringify(CANARY.type0Curve)) {
    fail(`type-0 required-level curve mismatch:\n    expected ${JSON.stringify(CANARY.type0Curve)}\n    got      ${JSON.stringify(got0)}`);
  }

  // Index SkillGems by resolved base-item id.
  const skillGemById = new Map();
  for (const r of skillGems) {
    if (r.BaseItemType == null) continue;
    const id = base[r.BaseItemType]?.Id;
    if (id) skillGemById.set(id, r);
  }

  // Canary 2: known attribute-percent + experience-type anchors.
  for (const a of CANARY.anchors) {
    const r = skillGemById.get(a.id);
    if (!r) fail(`anchor gem "${a.id}" not found via SkillGems→BaseItemTypes join`);
    if (r.ItemExperienceType !== a.type) fail(`${a.id}: ItemExperienceType ${r.ItemExperienceType} ≠ expected ${a.type}`);
    const [s, d, i] = [r.StrengthRequirementPercent, r.DexterityRequirementPercent, r.IntelligenceRequirementPercent];
    if (s !== a.str || d !== a.dex || i !== a.int) {
      fail(`${a.id}: attribute percents ${s}/${d}/${i} ≠ expected ${a.str}/${a.dex}/${a.int}`);
    }
  }

  // Resolve each real skill gem's required-level curve (skip gems whose type has no curve).
  const reqLevelByGem = {};
  for (const [id, r] of skillGemById) {
    if (!id.includes('/SkillGem')) continue;
    const curve = curveByType.get(r.ItemExperienceType);
    if (!curve) continue;
    const arr = Array.from({ length: GEM_LEVEL_MAX }, (_, i) => curve.get(i + 1) ?? null);
    if (arr.some((v) => v != null)) reqLevelByGem[id] = arr;
  }

  const out = {
    kind: 'gem-levels',
    _generated: 'DO NOT HAND-EDIT. Produced by scripts/ggpk/extract-gem-levels.js from the '
      + 'GGPK mirror (ItemExperiencePerLevel × SkillGems × BaseItemTypes). Regenerate: npm run build:gem-levels.',
    description: 'Required character level per gem level (1..20) for each skill gem base item. '
      + 'Sourced from GGPK because RePoE lacks it. reqLevelByGem[baseItemId][n-1] = required level at gem level n '
      + '(null where the gem\'s experience type defines no curve at that level).',
    source: 'ggpk-poe2: ItemExperiencePerLevel, SkillGems, BaseItemTypes',
    gemCount: Object.keys(reqLevelByGem).length,
    reqLevelByGem,
  };
  await fsp.writeFile(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`extract-gem-levels: ${out.gemCount} gems → ${path.relative(root, OUT)}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
