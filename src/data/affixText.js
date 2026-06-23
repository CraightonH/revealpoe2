// src/data/affixText.js
//
// Pure text transforms shared by the affix build resolver (scripts/graph/affixes.js,
// which assembles per-node search text) and the app's affix presentation adapter
// (src/data/mods.js, which derives generic/sort/display forms from stored tier data).
// NOTHING here renders HTML or reads source — these are deterministic string shaping
// helpers over already-resolved tier text/stats. Keeping them in one neutral module
// means the build and the app can never drift in how a family's generic form is derived.

// Display-tag cleanup: drop structural/compound tags (has_attack_mod,
// elemental_damage) that duplicate the human-readable ones the pills show.
export function cleanTags(tags) {
  const out = tags.filter((t) => !/^has_|_mod$|_damage$/.test(t));
  return out.length ? out : tags;
}

// Every desecrated (Abyssal) mod belongs to one of the three Well-of-Souls bosses,
// encoded as a `<boss>_mod` entry in implicit_tags. Surfaced as a dedicated pill.
export const ABYSS_BOSSES = ['ulaman', 'amanamu', 'kurgal'];
export function abyssBoss(implicitTags) {
  for (const b of ABYSS_BOSSES) if (implicitTags.includes(`${b}_mod`)) return b;
  return null;
}

// Collapse rolled numeric ranges to a single "#" placeholder so a family can be
// shown generically: "+(10-19) to maximum Life" -> "+# to maximum Life".
export function toGenericText(text) {
  return text.replace(/\(-?\d[\d.]*--?\d[\d.]*\)/g, '#');
}

// Plain-text generic form for sorting (genericHtml carries keyword markup).
// Leading non-letters (the rolled range, "+", "%", "#") are dropped so families
// sort by the first alphabetical word of the mod — e.g. "(92-100)% increased
// Armour" sorts under "i", "+(31-33) to Strength" under "t" — not numerically.
export function toSortKey(text) {
  return toGenericText(text)
    .replace(/\[[^\]|]*\|([^\]]*)\]/g, '$1')
    .replace(/[[\]]/g, '')
    .toLowerCase()
    .replace(/^[^a-z]+/, '');
}

// Internal mod-family identifiers are CamelCase ("LifeRegeneration",
// "AddedColdDamagePerFrenzyCharge"); split them into spaced words for display.
// Handles digit runs ("Exceed100%" -> "Exceed 100%") and acronym boundaries.
export function humanizeType(type) {
  return type
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .trim();
}

// Plain-text generic form of a mod, for compact labels (e.g. the search bar):
// rolled ranges collapsed to "#", keyword markup reduced to its display words,
// multi-line mods joined. "+(31-33) to [Strength|Strength]" -> "+# to Strength".
export function toGenericDisplay(text) {
  return toGenericText(text)
    .replace(/\[[^\]|]*\|([^\]]*)\]/g, '$1')
    .replace(/[[\]]/g, '')
    .replace(/\s*\n\s*/g, '; ')
    .trim();
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Generic label for a whole mod family. A tier may pin a value as a single
// number when min==max ("10% of Damage"), so collapsing parenthesised ranges
// isn't enough — a value that varies *across tiers* is still a roll and should
// read as "#". We detect which stat ids vary across the family, then blank their
// pinned literals before the usual generic transform. Values constant across
// every tier (e.g. "+1 Charm Slot") are genuine fixed values and kept.
export function familyGenericText(tiers) {
  const seen = new Map();      // stat id -> the single value seen so far
  const variable = new Set();  // stat ids whose value rolls across the family
  for (const t of tiers) {
    for (const s of t.stats) {
      if (s.min !== s.max) { variable.add(s.id); continue; }
      if (seen.has(s.id)) { if (seen.get(s.id) !== s.min) variable.add(s.id); }
      else seen.set(s.id, s.min);
    }
  }
  const base = tiers[0];
  let text = base.text;
  for (const s of base.stats) {
    if (s.min === s.max && variable.has(s.id)) {
      text = text.replace(new RegExp(`(?<![\\d.])${escapeRe(s.min)}(?![\\d.])`, 'g'), '#');
    }
  }
  return toGenericDisplay(text);
}
