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

// Resolve a base item's innate implicit mod ids (from base_items.json
// `implicits`) to rendered display lines. Implicits are encoded with
// generation_type "unique" in mods.json, so they sit outside the rollable
// prefix/suffix index built above — look them up in the raw table directly.
// Mods with no display text (hidden internal mechanics like
// "%_base_damage_is_fire", or zero-roll placeholders) are skipped.
export function resolveImplicits(ids) {
  if (!ids || !ids.length) return [];
  const raw = loadJson(`${REPOE}/mods.json`);
  const out = [];
  for (const id of ids) {
    const text = raw[id]?.text;
    if (!text || !text.trim()) continue;
    out.push({ id, html: renderGameText(text, hasDefinition) });
  }
  return out;
}

export function getModGroup(type) {
  buildIndex();
  const tiers = _byType.get(type);
  if (!tiers) return null;
  const first = tiers[0];
  return {
    type,
    typeSlug: slugify(type),
    generation_type: first.generation_type,
    tiers,
  };
}

export function listModGroups() {
  buildIndex();
  const out = [];
  for (const [type, tiers] of _byType) {
    const first = tiers[0];
    out.push({
      type,
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
