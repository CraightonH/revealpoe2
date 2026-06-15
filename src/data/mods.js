import { loadJson } from './loader.js';
import { slugify } from './slug.js';

const REPOE = 'repoe-poe2';
const ROLLABLE = new Set(['prefix', 'suffix']);

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
      level: v.required_level ?? 0,
      generation_type: v.generation_type,
      stats: v.stats ?? [],
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
            out.push({ type: typeName, typeSlug: slugify(typeName), tiers });
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

export function getModsForBase(metadataKey, className) {
  buildBaseIndex();
  return _forBase.get(metadataKey) ?? { prefix: [], suffix: [] };
}
