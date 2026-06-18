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

// Collapse rolled numeric ranges to a single "#" placeholder so a family can be
// shown generically: "+(10-19) to maximum Life" -> "+# to maximum Life".
function toGenericText(text) {
  return text.replace(/\(-?\d[\d.]*--?\d[\d.]*\)/g, '#');
}

// Plain-text generic form for sorting (genericHtml carries keyword markup).
function toSortKey(text) {
  return toGenericText(text).replace(/\[[^\]|]*\|([^\]]*)\]/g, '$1').replace(/[[\]]/g, '').toLowerCase();
}

let _byId = null;
let _byType = null;
let _forBase = null;

function buildIndex() {
  if (_byId) return;

  const raw = loadJson(`${REPOE}/mods.json`);
  _byId = new Map();
  _byType = new Map();

  for (const [id, v] of Object.entries(raw)) {
    if (v.domain !== 'item' || !ROLLABLE.has(v.generation_type)) continue;
    _byId.set(id, { id, ...v });

    if (!_byType.has(v.type)) _byType.set(v.type, []);
    _byType.get(v.type).push({
      id,
      name: v.name,
      text: v.text ?? '',
      html: renderGameText(v.text ?? '', hasDefinition),
      level: v.required_level ?? 0,
      generation_type: v.generation_type,
      stats: v.stats ?? [],
      tags: v.implicit_tags ?? [],
    });
  }

  for (const [, tiers] of _byType) {
    tiers.sort((a, b) => a.level - b.level);
  }
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

        for (const [genType, typeGroups] of Object.entries(modsByGenType)) {
          if (genType !== 'prefix' && genType !== 'suffix') continue;
          const out = genType === 'prefix' ? prefix : suffix;

          for (const [typeName, modMap] of Object.entries(typeGroups)) {
            if (!_byType.has(typeName)) continue;
            const allowedIds = new Set(Object.keys(modMap));
            const tiers = _byType.get(typeName).filter((t) => allowedIds.has(t.id));
            if (tiers.length === 0) continue;
            // tiers share template text and tags; take the top (highest-level) tier.
            const top = tiers[tiers.length - 1];
            out.push({
              type: typeName,
              typeSlug: slugify(typeName),
              genericHtml: renderGameText(toGenericText(top.text), hasDefinition),
              sortKey: toSortKey(top.text),
              tags: cleanTags(top.tags),
              tiers,
            });
          }
        }

        _forBase.set(metaKey, { prefix, suffix });
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
export function getModsForClass(metadataKeys) {
  buildBaseIndex();

  const merge = (pick) => {
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
  };

  return { prefix: merge((e) => e.prefix), suffix: merge((e) => e.suffix) };
}
