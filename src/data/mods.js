import { loadJson } from './loader.js';
import { slugify } from './slug.js';
import { renderGameText } from './keywords.js';
import { hasDefinition } from './keywordDefs.js';
import { REPOE } from '../config.js';

// Display-tag cleanup: drop structural/compound tags (has_attack_mod,
// elemental_damage) that duplicate the human-readable ones the pills show.
function cleanTags(tags) {
  const out = tags.filter((t) => !/^has_|_mod$|_damage$/.test(t));
  return out.length ? out : tags;
}

const ROLLABLE = new Set(['prefix', 'suffix']);

// Every desecrated (Abyssal) mod belongs to one of the three Well-of-Souls
// bosses, encoded as a `<boss>_mod` entry in implicit_tags. We surface this as a
// dedicated, colored pill on each family (the boss is the mod's defining origin).
const ABYSS_BOSSES = ['ulaman', 'amanamu', 'kurgal'];
function abyssBoss(implicitTags) {
  for (const b of ABYSS_BOSSES) if (implicitTags.includes(`${b}_mod`)) return b;
  return null;
}

// Collapse rolled numeric ranges to a single "#" placeholder so a family can be
// shown generically: "+(10-19) to maximum Life" -> "+# to maximum Life".
function toGenericText(text) {
  return text.replace(/\(-?\d[\d.]*--?\d[\d.]*\)/g, '#');
}

// Plain-text generic form for sorting (genericHtml carries keyword markup).
// Leading non-letters (the rolled range, "+", "%", "#") are dropped so families
// sort by the first alphabetical word of the mod — e.g. "(92-100)% increased
// Armour" sorts under "i", "+(31-33) to Strength" under "t" — not numerically.
function toSortKey(text) {
  return toGenericText(text)
    .replace(/\[[^\]|]*\|([^\]]*)\]/g, '$1')
    .replace(/[[\]]/g, '')
    .toLowerCase()
    .replace(/^[^a-z]+/, '');
}

// Internal mod-family identifiers are CamelCase ("LifeRegeneration",
// "AddedColdDamagePerFrenzyCharge"); split them into spaced words for display.
// Handles digit runs ("Exceed100%" -> "Exceed 100%") and acronym boundaries.
function humanizeType(type) {
  return type
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .trim();
}

// Plain-text generic form of a mod, for compact labels (e.g. the search bar):
// rolled ranges collapsed to "#", keyword markup reduced to its display words,
// multi-line mods joined. "+(31-33) to [Strength|Strength]" -> "+# to Strength".
function toGenericDisplay(text) {
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
function familyGenericText(tiers) {
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

let _byId = null;
let _byType = null;          // standard (currency) prefix/suffix families, by type
let _corruptedByType = null; // Vaal corruption mods (item domain), by type
let _desecratedByType = null; // Abyssal (Well of Souls) mods, by type, with spawn tags
let _forBase = null;

// A single renderable tier row shared by every origin's family.
function tierRecord(id, v) {
  return {
    id,
    name: v.name,
    text: v.text ?? '',
    html: renderGameText(v.text ?? '', hasDefinition),
    level: v.required_level ?? 0,
    generation_type: v.generation_type,
    stats: v.stats ?? [],
    tags: v.implicit_tags ?? [],
  };
}

function pushTier(map, type, tier) {
  if (!map.has(type)) map.set(type, []);
  map.get(type).push(tier);
}

// Collapse a type's tiers into the family shape the affix tables consume.
function makeFamily(type, tiers) {
  const top = tiers[tiers.length - 1];
  return {
    type,
    displayName: humanizeType(type),
    typeSlug: slugify(type),
    genericHtml: renderGameText(toGenericText(top.text), hasDefinition),
    sortKey: toSortKey(top.text),
    tags: cleanTags(top.tags),
    tiers,
  };
}

function buildIndex() {
  if (_byId) return;

  const raw = loadJson(`${REPOE}/mods.json`);
  _byId = new Map();
  _byType = new Map();
  _corruptedByType = new Map();
  _desecratedByType = new Map();

  for (const [id, v] of Object.entries(raw)) {
    const dom = v.domain;
    const gen = v.generation_type;

    if (dom === 'item' && ROLLABLE.has(gen)) {
      // Standard currency-rollable prefixes/suffixes.
      _byId.set(id, { id, ...v });
      pushTier(_byType, v.type, tierRecord(id, v));
    } else if (dom === 'item' && gen === 'corrupted') {
      // Vaal Orb corruption mods — applied directly, no prefix/suffix split.
      pushTier(_corruptedByType, v.type, tierRecord(id, v));
    } else if (dom === 'desecrated' && ROLLABLE.has(gen)) {
      // Abyssal mods aren't in mods_by_base; their item eligibility lives in
      // spawn_weights (item-class tags). Track the positively-weighted tags so a
      // base/class can be matched against them later.
      let e = _desecratedByType.get(v.type);
      if (!e) {
        e = { type: v.type, gen, tiers: [], spawnTags: new Set(), boss: null };
        _desecratedByType.set(v.type, e);
      }
      if (!e.boss) e.boss = abyssBoss(v.implicit_tags ?? []);
      e.tiers.push(tierRecord(id, v));
      for (const sw of v.spawn_weights ?? []) {
        if (sw.weight > 0) e.spawnTags.add(sw.tag);
      }
    }
  }

  for (const map of [_byType, _corruptedByType]) {
    for (const [, tiers] of map) tiers.sort((a, b) => a.level - b.level);
  }
  for (const [, e] of _desecratedByType) e.tiers.sort((a, b) => a.level - b.level);
}

function buildBaseIndex() {
  if (_forBase) return;
  buildIndex();

  const mbb = loadJson(`${REPOE}/mods_by_base.json`);
  _forBase = new Map();

  for (const [, tagCombos] of Object.entries(mbb)) {
    for (const [, entry] of Object.entries(tagCombos)) {
      const bases = entry.bases ?? [];
      const modsByGenType = entry.mods ?? {};

      for (const metaKey of bases) {
        if (_forBase.has(metaKey)) continue;

        const prefix = [];
        const suffix = [];
        const corrupted = [];

        for (const [genType, typeGroups] of Object.entries(modsByGenType)) {
          let out;
          let index;
          if (genType === 'prefix') { out = prefix; index = _byType; }
          else if (genType === 'suffix') { out = suffix; index = _byType; }
          else if (genType === 'corrupted') { out = corrupted; index = _corruptedByType; }
          else continue;

          for (const [typeName, modMap] of Object.entries(typeGroups)) {
            if (!index.has(typeName)) continue;
            const allowedIds = new Set(Object.keys(modMap));
            const tiers = index.get(typeName).filter((t) => allowedIds.has(t.id));
            if (tiers.length === 0) continue;
            out.push(makeFamily(typeName, tiers));
          }
        }

        _forBase.set(metaKey, { prefix, suffix, corrupted });
      }
    }
  }
}

export function getMod(id) {
  buildIndex();
  return _byId.get(id) ?? null;
}

// Stat-id → its stat_descriptions entry, so an implicit with no mod `text` can
// still be rendered from its stats. Lazily built (loaded on first implicit miss).
let _statDescById = null;
function statDescById() {
  if (_statDescById) return _statDescById;
  _statDescById = new Map();
  for (const entry of loadJson(`${REPOE}/stat_translations/stat_descriptions.json`)) {
    if (!entry.English?.[0]) continue;
    for (const id of entry.ids ?? []) if (!_statDescById.has(id)) _statDescById.set(id, entry);
  }
  return _statDescById;
}

// Weapon "Adds X to Y <Element> Damage" implicits (e.g. Bolting Quarterstaff)
// carry their effect on hidden stat ids with no visible translation. They map
// 1:1 onto the ordinary added-damage stats, so unhide the id to reuse the
// canonical "Adds {0} to {1} … Damage" string.
function unhideStatId(id) {
  return id.replace(/^local_weapon_implicit_hidden_added_(min|max)imum_(.+)_damage$/, 'local_$1imum_added_$2_damage');
}

// Elemental-weapon bases convert their physical damage to an element via a
// hidden "%_base_damage_is_<element>" flag that has no stat_descriptions string,
// so synthesize the canonical "N% of Physical Damage Converted to … Damage" line
// (the element/physical wrapped as keywords so they link like every other line).
const CONVERT_RE = /^local_weapon_implicit_hidden_%_base_damage_is_(fire|cold|lightning|chaos)$/;

// Render a mod's stats to display lines. Damage-conversion flags are synthesized;
// everything else goes through stat_descriptions, rendering only entries whose
// values need no numeric transform (empty index_handlers) — anything requiring
// unit conversion stays hidden rather than risk a wrong number. Returns [] when
// no stat resolves (true internal mechanics, zero-roll placeholders).
function renderStatLines(stats) {
  const map = statDescById();
  const values = new Map();
  for (const s of stats) values.set(unhideStatId(s.id), s);
  const out = [];
  const used = new Set();
  for (const s of stats) {
    const conv = s.id.match(CONVERT_RE);
    if (conv) {
      if (s.min === 0 && s.max === 0) continue;
      const pct = s.min === s.max ? String(s.min) : `(${s.min}–${s.max})`;
      const el = conv[1][0].toUpperCase() + conv[1].slice(1);
      out.push(`${pct}% of [Physical|Physical] Damage Converted to [${el}|${el}] Damage`);
      continue;
    }
    const entry = map.get(unhideStatId(s.id));
    if (!entry || used.has(entry)) continue;
    if (!entry.ids.every((eid) => values.has(eid))) continue;
    const eng = entry.English[0];
    if ((eng.index_handlers ?? []).some((h) => h.length)) continue;
    // Skip zero-roll placeholders (e.g. "Adds 0 to 0 Lightning Damage").
    if (entry.ids.every((eid) => values.get(eid).min === 0 && values.get(eid).max === 0)) continue;
    used.add(entry);
    if (eng.format?.[0] === 'ignore') { out.push(eng.string); continue; }
    let str = eng.string;
    entry.ids.forEach((eid, i) => {
      const v = values.get(eid);
      const num = v.min === v.max ? String(v.min) : `(${v.min}–${v.max})`;
      const sign = eng.format?.[i]?.startsWith('+') && v.min >= 0 ? '+' : '';
      str = str.replace(`{${i}}`, sign + num);
    });
    out.push(str);
  }
  return out.map((t) => ({ html: renderGameText(t, hasDefinition) }));
}

// Resolve a base item's innate implicit mod ids (from base_items.json
// `implicits`) to rendered display lines. Implicits are encoded with
// generation_type "unique" in mods.json, so they sit outside the rollable
// prefix/suffix index built above — look them up in the raw table directly.
// Mods with no display text fall back to rendering from their stats (the hidden
// "Adds X to Y … Damage" and "N% of Physical Damage Converted to … Damage" weapon
// implicits); true internal mechanics and zero-roll placeholders resolve to nothing.
export function resolveImplicits(ids) {
  if (!ids || !ids.length) return [];
  const raw = loadJson(`${REPOE}/mods.json`);
  const out = [];
  for (const id of ids) {
    const mod = raw[id];
    if (!mod) continue;
    if (mod.text && mod.text.trim()) {
      out.push({ id, html: renderGameText(mod.text, hasDefinition) });
    } else if (mod.stats?.length) {
      for (const line of renderStatLines(mod.stats)) out.push({ id, html: line.html });
    }
  }
  return out;
}

export function listModGroups() {
  buildIndex();
  const out = [];
  for (const [type, tiers] of _byType) {
    const first = tiers[0];
    out.push({
      type,
      displayName: humanizeType(type),
      genericText: familyGenericText(tiers),
      typeSlug: slugify(type),
      generation_type: first.generation_type,
      text: first.text,
      tierCount: tiers.length,
    });
  }
  return out.sort((a, b) => a.type.localeCompare(b.type));
}

function sortFamilies(families) {
  return [...families].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

// Affix families rollable on a single base, prefixes and suffixes each sorted
// alphabetically by their modifier text for scanning. (RePoE-fork only encodes
// can/can't-roll as a binary spawn weight, so there is no rarity to sort by.)
export function getModsForBase(metadataKey) {
  buildBaseIndex();
  const entry = _forBase.get(metadataKey);
  if (!entry) return { prefix: [], suffix: [] };
  return { prefix: sortFamilies(entry.prefix), suffix: sortFamilies(entry.suffix) };
}

// Affix families rollable across an item class — the union over every base in
// the class (e.g. all Bows). Affixes are gated by class/item tags, so they are a
// property of the class, not the individual base. Where bases within a class
// allow different tier sets for the same family (e.g. higher-level bases unlock
// more tiers), the family carries the superset of tiers.
// Union a family list across bases, deduping by type and keeping the superset of
// tiers (some bases unlock more tiers of the same family than others).
function mergeFamilies(metadataKeys, pick) {
  const byType = new Map();
  for (const key of metadataKeys) {
    const entry = _forBase.get(key);
    if (!entry) continue;
    for (const f of pick(entry)) {
      const existing = byType.get(f.type);
      if (!existing) {
        byType.set(f.type, { ...f, tiers: [...f.tiers] });
      } else if (f.tiers.length > existing.tiers.length) {
        existing.tiers = [...f.tiers];
      }
    }
  }
  return sortFamilies([...byType.values()]);
}

export function getModsForClass(metadataKeys) {
  buildBaseIndex();
  return {
    prefix: mergeFamilies(metadataKeys, (e) => e.prefix),
    suffix: mergeFamilies(metadataKeys, (e) => e.suffix),
  };
}

// Vaal-corruption mods rollable across an item class — a flat list (corruption
// has no prefix/suffix distinction). Sourced from mods_by_base like the standard
// affixes, so it is already gated to the class's bases.
export function getCorruptedForClass(metadataKeys) {
  buildBaseIndex();
  return mergeFamilies(metadataKeys, (e) => e.corrupted ?? []);
}

// Abyssal (desecrated) mods that can land on an item carrying any of `tags`.
// These aren't in mods_by_base, so eligibility comes straight from each mod's
// spawn_weights (item-class tags) intersected with the base/class tag set.
export function getDesecratedForTags(tags) {
  buildIndex();
  const tagSet = tags instanceof Set ? tags : new Set(tags ?? []);
  const matches = (e) => {
    for (const t of e.spawnTags) if (tagSet.has(t)) return true;
    return false;
  };
  const pick = (gen) => sortFamilies(
    [..._desecratedByType.values()]
      .filter((e) => e.gen === gen && matches(e))
      .map((e) => {
        const f = makeFamily(e.type, e.tiers);
        // Boss pill leads the tag list. Drop any `<...>_mod` tag here: cleanTags
        // normally strips them, but for mods whose only tags are `_mod` ones its
        // "never empty" fallback resurrects them — leaving a redundant raw pill
        // (e.g. "Amanamu Mod") beside the boss pill. The boss pill is the origin.
        if (e.boss) f.tags = [e.boss, ...f.tags.filter((t) => t !== e.boss && !/_mod$/.test(t))];
        return f;
      }),
  );
  return { prefix: pick('prefix'), suffix: pick('suffix') };
}
