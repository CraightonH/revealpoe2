// scripts/ggpk/extract-weapon-reqs.js
//
// Reproducible extraction of each active skill's WEAPON REQUIREMENT from the GGPK
// mirror. Many PoE2 skills can only be used with a specific weapon type — crossbow
// skills need a Crossbow, bow skills a Bow, slams a Mace, etc. RePoE does NOT export
// this: skills.json `active_skill.weapon_restrictions` is empty for every skill, and
// the `types` array only flags crossbows. The authoritative data lives in the game's
// `ActiveSkills.WeaponRequirements` → `ActiveSkillWeaponRequirement` → `WieldableClasses`
// chain, keyed to each skill by `ActiveSkills.Id` (== skills.json `active_skill.id`).
//
// Output: data/manual/weapon-reqs.generated.json — a COMMITTED artifact consumed by
// the graph builder (scripts/graph/weaponReqs.js → gems.js). The graph build itself
// never reads the GGPK mirror; this script is the single re-runnable bridge.
// Regenerate after a game patch with:  npm run build:weapon-reqs
//
// Shape (keyed by ActiveSkills.Id, == skills.json active_skill.id):
//   { kind: 'weapon-reqs',
//     weaponReqByActiveSkill: { "<activeSkillId>": { reqId: "Crossbow", classIds: ["Crossbow"] } } }
// `reqId` is the requirement's semantic id (e.g. "Any Mace", "Any Martial Weapon"),
// used to label mega-groups concisely; `classIds` are the eligible ItemClasses ids.
// The human-facing label ("Crossbows", "Maces", …) is derived at build time from these
// + RePoE item_classes.json (see scripts/graph/weaponReqs.js) — kept out of this raw fact.
//
// LOUD CANARY: `.datc64` decoding trusts dat-schema's column ORDER; a schema drift
// silently misaligns columns into garbage. Before writing we assert known-good anchors
// decoded straight from the tables; any mismatch throws and writes nothing.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTable, haveTable, loadSchema } from './dat.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(root, 'data', 'manual', 'weapon-reqs.generated.json');

// Anchors: (activeSkillId) -> expected {reqId, classIds}. Pins the ActiveSkills →
// ActiveSkillWeaponRequirement → WieldableClasses → ItemClasses join across columns.
const CANARY = [
  { id: 'explosive_shot', reqId: 'Crossbow', classIds: ['Crossbow'] },
  { id: 'rain_of_arrows_new', reqId: 'Bow', classIds: ['Bow'] },
  { id: 'permafrost_bolts', reqId: 'Crossbow', classIds: ['Crossbow'] },
];

function fail(msg) {
  throw new Error(
    `[extract-weapon-reqs] GGPK schema drift — dat-schema column mapping likely changed, `
    + `remapping required before this data can be trusted:\n  ${msg}`,
  );
}

async function main() {
  for (const t of ['ActiveSkills', 'ActiveSkillWeaponRequirement', 'WieldableClasses', 'ItemClasses']) {
    if (!haveTable(t)) fail(`mirrored table "${t}" missing — run: npm run fetch:dat`);
  }
  const schema = await loadSchema();
  const activeSkills = (await parseTable('ActiveSkills', { schema })).rows;
  const awr = (await parseTable('ActiveSkillWeaponRequirement', { schema })).rows;
  const wieldable = (await parseTable('WieldableClasses', { schema })).rows;
  const itemClasses = (await parseTable('ItemClasses', { schema })).rows;

  // WieldableClasses row index -> ItemClasses.Id (e.g. "Crossbow", "One Hand Mace").
  const classIdOfWieldable = (wIdx) => {
    const icIdx = wieldable[wIdx]?.ItemClass;
    return icIdx != null ? (itemClasses[icIdx]?.Id ?? null) : null;
  };
  // ActiveSkillWeaponRequirement row -> { reqId, classIds } (empty class names kept out).
  const reqOf = (awrIdx) => {
    const r = awr[awrIdx];
    if (!r) return null;
    const classIds = (r.WieldableClasses ?? []).map(classIdOfWieldable).filter(Boolean);
    return { reqId: r.Id, classIds };
  };

  const bySkill = {};
  for (const a of activeSkills) {
    const wr = a.WeaponRequirements;
    if (!Number.isInteger(wr)) continue;
    if (!a.Id) continue;
    const req = reqOf(wr);
    if (!req || !req.classIds.length) continue; // no eligible classes → nothing to require
    bySkill[a.Id] = req;
  }

  // Canary: known anchors decoded straight from the join.
  for (const c of CANARY) {
    const got = bySkill[c.id];
    if (!got) fail(`anchor active skill "${c.id}" has no weapon requirement`);
    if (got.reqId !== c.reqId) fail(`${c.id}: reqId '${got.reqId}' ≠ expected '${c.reqId}'`);
    if (JSON.stringify(got.classIds) !== JSON.stringify(c.classIds)) {
      fail(`${c.id}: classIds ${JSON.stringify(got.classIds)} ≠ expected ${JSON.stringify(c.classIds)}`);
    }
  }

  const out = {
    kind: 'weapon-reqs',
    _generated: 'DO NOT HAND-EDIT. Produced by scripts/ggpk/extract-weapon-reqs.js from the '
      + 'GGPK mirror (ActiveSkills × ActiveSkillWeaponRequirement × WieldableClasses × ItemClasses). '
      + 'Regenerate: npm run build:weapon-reqs.',
    description: 'Weapon-type requirement per active skill (skills.json active_skill.id). RePoE lacks it. '
      + 'weaponReqByActiveSkill[activeSkillId] = { reqId, classIds }. Rendered to a display label '
      + '("Requires: Crossbows") at build time by scripts/graph/weaponReqs.js.',
    source: 'ggpk-poe2: ActiveSkills, ActiveSkillWeaponRequirement, WieldableClasses, ItemClasses',
    skillCount: Object.keys(bySkill).length,
    weaponReqByActiveSkill: bySkill,
  };
  await fsp.writeFile(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`extract-weapon-reqs: ${out.skillCount} active skills → ${path.relative(root, OUT)}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
