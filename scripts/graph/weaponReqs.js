// scripts/graph/weaponReqs.js — build-time resolver for skill weapon requirements.
// Builder-only.
//
// The raw {reqId, classIds} facts are extracted from the GGPK mirror into the
// committed artifact data/manual/weapon-reqs.generated.json (see
// scripts/ggpk/extract-weapon-reqs.js). This module turns them into the display
// label shown on the gem card ("Requires: Crossbows"), using RePoE item_classes.json
// for the plural class names. Keyed by active skill id (== skills.json active_skill.id).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from './loader.js';
import { REPOE } from './source.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GENERATED = path.join(ROOT, 'data', 'manual', 'weapon-reqs.generated.json');

// The label is emitted as glossary "[Id|Display]" token markup so every weapon term
// becomes a hoverable keyword when rendered (same convention as effect lines). The
// keyword id is the singular class id ("Crossbow", "Mace"); the display is the plural.

// Mega-group requirements span so many classes that listing each is noise; the game
// treats them as a single category with its own glossary keyword.
const GROUP_LABELS = {
  'Any Martial Weapon': '[MartialWeapon|Martial Weapons]',
  'Any Martial Weapon and Unarmed': '[MartialWeapon|Martial Weapons] or [Unarmed]',
  'Non-Talisman Martial Weapon': '[MartialWeapon|Martial Weapons]',
  'Any Melee Weapon': '[Melee|Melee Weapons]',
  'Any Melee Weapon and Unarmed': '[Melee|Melee Weapons] or [Unarmed]',
  'Non-Talisman Melee Weapon': '[Melee|Melee Weapons]',
};

// reqIds that mean "no real weapon requirement" — never render a line for these.
const NO_REQUIREMENT = new Set(['Nothing']);

// Class id -> glossary keyword id, where they differ (the base class id is the
// keyword otherwise). Only the Quarterstaff class is internally "Warstaff".
const CLASS_KEYWORD = { Warstaff: 'Quarterstaff' };

let _itemClasses = null;
function itemClassName(id) {
  if (!_itemClasses) _itemClasses = loadJson(`${REPOE}/item_classes.json`);
  return _itemClasses[id]?.name ?? '';
}

// Build the label from the eligible class ids: collapse One/Two Hand pairs of the
// same weapon to the base plural ("Maces"), keep a lone handedness specific
// ("Two Hand Maces"), emit each as a "[keyword|display]" token, join with " or ".
function deriveLabel(reqId, classIds) {
  if (GROUP_LABELS[reqId]) return GROUP_LABELS[reqId];
  const order = [];
  const byBase = new Map(); // base class id -> { keyword, names:Set }
  for (const id of classIds) {
    const name = itemClassName(id);
    if (!name) continue;
    const baseId = id.replace(/^(One|Two) Hand /, '');
    const keyword = CLASS_KEYWORD[baseId] ?? baseId;
    if (!byBase.has(baseId)) { byBase.set(baseId, { keyword, names: new Set() }); order.push(baseId); }
    byBase.get(baseId).names.add(name);
  }
  const parts = order.map((baseId) => {
    const { keyword, names } = byBase.get(baseId);
    // Both handedness present → base plural (strip the "One/Two Hand " prefix); a lone
    // variant keeps its full plural name.
    const display = names.size > 1 ? [...names][0].replace(/^(One|Two) Hand /, '') : [...names][0];
    return `[${keyword}|${display}]`;
  });
  const label = parts.join(' or ');
  if (label) return label;
  return reqId === 'Unarmed' ? '[Unarmed]' : null;
}

// Load the committed generated overlay: activeSkillId -> { reqId, classIds }.
let _data = null;
function data() {
  if (_data) return _data;
  try {
    _data = JSON.parse(fs.readFileSync(GENERATED, 'utf8')).weaponReqByActiveSkill ?? {};
  } catch {
    _data = {};
  }
  return _data;
}

export function loadWeaponReqs() {
  return data();
}

// Display label for an active skill id (skills.json active_skill.id), or null when
// the skill has no weapon requirement / it resolves to nothing meaningful.
export function weaponReqLabel(activeSkillId) {
  const req = data()[activeSkillId];
  if (!req || NO_REQUIREMENT.has(req.reqId)) return null;
  return deriveLabel(req.reqId, req.classIds ?? []);
}
