// Compute displayed item properties (damage, defences, attack speed, …) by
// applying a unique item's text mods on top of its base item's raw properties.
// This mirrors how the in-game tooltip shows final values — e.g. a Pronged
// Spear (base 30–89 phys) with "(100–120)% increased Physical Damage" displays
// "(60–66) to (178–196)". Only *local* mods affect these numbers.

// Parse a number-or-range token like "(100-120)", "100", or "(30-15)".
function numRange(tok) {
  const m = String(tok).match(/^\(?(-?[\d.]+)(?:-(-?[\d.]+))?\)?$/);
  if (!m) return null;
  const lo = parseFloat(m[1]);
  const hi = m[2] != null ? parseFloat(m[2]) : lo;
  return { lo, hi };
}

const TOK = '(\\(?-?[\\d.]+(?:-[\\d.]+)?\\)?)';
const RE_PHYS_INC = new RegExp(`^${TOK}% increased Physical Damage$`);
const RE_AS_INC = new RegExp(`^${TOK}% increased Attack Speed$`);
const RE_ADDS = new RegExp(`^Adds ${TOK} to ${TOK} (Physical|Fire|Cold|Lightning|Chaos) Damage$`);
const RE_DEF_INC = new RegExp(`^${TOK}% increased (Armour|Evasion(?: Rating)?|Energy Shield)$`);
const RE_DEF_FLAT = new RegExp(`^\\+?${TOK} to (?:maximum )?(Armour|Evasion(?: Rating)?|Energy Shield)$`);

const DEF_KEY = {
  Armour: 'armour',
  Evasion: 'evasion',
  'Evasion Rating': 'evasion',
  'Energy Shield': 'energy_shield',
};

// Extract the local mods that change displayed item stats from a unique's
// cleaned stat text lines. Everything else is ignored (still shown as mod text).
export function parseLocalMods(lines) {
  const mods = { physInc: null, asInc: null, adds: [], defInc: {}, defFlat: {} };
  for (const line of lines) {
    let m;
    if ((m = line.match(RE_PHYS_INC))) {
      mods.physInc = numRange(m[1]);
    } else if ((m = line.match(RE_AS_INC))) {
      mods.asInc = numRange(m[1]);
    } else if ((m = line.match(RE_ADDS))) {
      mods.adds.push({ type: m[3], min: numRange(m[1]), max: numRange(m[2]) });
    } else if ((m = line.match(RE_DEF_INC))) {
      mods.defInc[DEF_KEY[m[2]]] = numRange(m[1]);
    } else if ((m = line.match(RE_DEF_FLAT))) {
      mods.defFlat[DEF_KEY[m[2]]] = numRange(m[1]);
    }
  }
  return mods;
}

const round = (n) => Math.round(n);

// Format a {lo,hi} range: single value when lo===hi, else "(lo-hi)".
function fmtRange({ lo, hi }, decimals = 0) {
  const f = (n) => (decimals ? Number(n.toFixed(decimals)) : round(n));
  const a = f(lo);
  const b = f(hi);
  return a === b ? `${a}` : `(${a}-${b})`;
}

const ZERO = { lo: 0, hi: 0 };

// Apply a flat-add range and an increase% range to a base min/max, returning
// the displayed {lo,hi} for the min stat and for the max stat.
function applyAddInc(baseMin, baseMax, flat = ZERO, inc = ZERO) {
  const lo = (v) => v * (1 + inc.lo / 100);
  const hi = (v) => v * (1 + inc.hi / 100);
  return {
    min: { lo: lo(baseMin + flat.lo), hi: hi(baseMin + flat.hi) },
    max: { lo: lo(baseMax + flat.lo), hi: hi(baseMax + flat.hi) },
  };
}

const ELEMENT_CLASS = {
  Physical: 'colourPhysicalDamage',
  Fire: 'colourFireDamage',
  Cold: 'colourColdDamage',
  Lightning: 'colourLightningDamage',
  Chaos: 'colourChaosDamage',
};

const DEFENCES = [
  ['armour', 'Armour'],
  ['evasion', 'Evasion Rating'],
  ['energy_shield', 'Energy Shield'],
  ['ward', 'Ward'],
];

// Build the ordered property list (poe2db layout) for a base's raw properties
// with a unique's local mods applied. `mods` may be omitted for plain bases.
export function computeProperties(props, mods = { adds: [], defInc: {}, defFlat: {} }) {
  const out = [];
  if (!props) return out;

  // Physical damage — base × (1 + increased), plus any local flat physical adds.
  if (props.physical_damage_min != null && props.physical_damage_max != null) {
    const physAdd = mods.adds.find((a) => a.type === 'Physical');
    const augmented = !!(mods.physInc || physAdd);
    const r = applyAddInc(
      props.physical_damage_min,
      props.physical_damage_max,
      physAdd?.min ?? ZERO,
      mods.physInc ?? ZERO,
    );
    out.push({
      label: 'Physical Damage',
      value: `${fmtRange(r.min)} to ${fmtRange(r.max)}`,
      colorClass: augmented ? 'colourAugmented' : 'colourDefault',
    });
  }

  if (props.critical_strike_chance != null) {
    out.push({
      label: 'Critical Hit Chance',
      value: `${Number((props.critical_strike_chance / 100).toFixed(2))}%`,
      colorClass: 'colourDefault',
    });
  }

  if (props.attack_time != null) {
    const base = 1000 / props.attack_time;
    const inc = mods.asInc;
    const r = inc
      ? { lo: base * (1 + inc.lo / 100), hi: base * (1 + inc.hi / 100) }
      : { lo: base, hi: base };
    out.push({
      label: 'Attacks per Second',
      value: fmtRange(r, 2),
      colorClass: inc ? 'colourAugmented' : 'colourDefault',
    });
  }

  if (props.range != null) {
    out.push({
      label: 'Weapon Range',
      value: `${Number((props.range / 10).toFixed(1))}`,
      colorClass: 'colourDefault',
    });
  }

  // Added elemental / chaos damage — straight from the "Adds" mods, in mod order.
  for (const add of mods.adds) {
    if (add.type === 'Physical') continue; // folded into Physical Damage above
    out.push({
      label: `${add.type} Damage`,
      value: `${fmtRange(add.min)} to ${fmtRange(add.max)}`,
      colorClass: ELEMENT_CLASS[add.type] ?? 'colourDefault',
    });
  }

  // Defences — base range with local flat adds and increases applied.
  for (const [key, label] of DEFENCES) {
    const val = props[key];
    if (!val) continue;
    const flat = mods.defFlat[key];
    const inc = mods.defInc[key];
    const augmented = !!(flat || inc);
    const lo = (val.min + (flat?.lo ?? 0)) * (1 + (inc?.lo ?? 0) / 100);
    const hi = (val.max + (flat?.hi ?? 0)) * (1 + (inc?.hi ?? 0) / 100);
    out.push({
      label,
      value: fmtRange({ lo, hi }),
      colorClass: augmented ? 'colourAugmented' : 'colourDefault',
    });
  }

  if (props.block != null) {
    out.push({ label: 'Block Chance', value: `${props.block}%`, colorClass: 'colourDefault' });
  }
  if (props.movement_speed != null) {
    out.push({
      label: 'Movement Speed',
      value: `${props.movement_speed / 100}%`,
      colorClass: 'colourDefault',
    });
  }

  // Flask / charm stats. `duration` is in tenths of a second (like weapon range).
  // Life/mana flasks recover an amount over that duration; charms (no recovery
  // amount) simply last for it. Charges drain on use.
  const seconds = (d) => Number((d / 10).toFixed(1));
  if (props.life_per_use != null) {
    out.push({
      label: 'Recovery',
      value: `${props.life_per_use} Life over ${seconds(props.duration)} Seconds`,
      colorClass: 'colourDefault',
    });
  } else if (props.mana_per_use != null) {
    out.push({
      label: 'Recovery',
      value: `${props.mana_per_use} Mana over ${seconds(props.duration)} Seconds`,
      colorClass: 'colourDefault',
    });
  } else if (props.duration != null) {
    out.push({ label: 'Duration', value: `${seconds(props.duration)} Seconds`, colorClass: 'colourDefault' });
  }
  if (props.charges_max != null) {
    out.push({
      label: 'Charges',
      value: `${props.charges_per_use} of ${props.charges_max} per use`,
      colorClass: 'colourDefault',
    });
  }

  return out;
}
