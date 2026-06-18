import { loadJson } from './loader.js';
import { slugify } from './slug.js';
import { ddsUrl } from './images.js';
import { listUniques } from './uniques.js';
import { getModsForClass, resolveImplicits } from './mods.js';
import { computeProperties } from './itemStats.js';
import { ATTR_ABBR } from './attributes.js';
import { hasDefinition } from './keywordDefs.js';
import { linkifyRequirement } from './keywords.js';
import { REPOE } from '../config.js';

const GROUPS = [
  {
    label: 'Weapons',
    classes: ['Bow', 'Claw', 'Crossbow', 'Dagger', 'Flail', 'FishingRod',
              'One Hand Axe', 'One Hand Mace', 'One Hand Sword', 'Sceptre',
              'Spear', 'Staff', 'TrapTool', 'Two Hand Axe', 'Two Hand Mace',
              'Two Hand Sword', 'Wand', 'Warstaff'],
  },
  {
    label: 'Armour',
    classes: ['Body Armour', 'Boots', 'Buckler', 'Focus', 'Gloves', 'Helmet', 'Shield'],
  },
  {
    label: 'Accessories',
    classes: ['Amulet', 'Belt', 'Quiver', 'Ring', 'Talisman'],
  },
];

const BROWSABLE_CLASSES = new Set(GROUPS.flatMap((g) => g.classes));

// Requirement display strings, with Str/Dex/Int abbreviations linked to their
// glossary keyword (returned as safe HTML — templates render with `| safe`).
function buildRequirements(req, dropLevel) {
  const out = [];
  if (dropLevel != null && dropLevel > 0) out.push(`Level ${dropLevel}`);
  if (req) {
    for (const [attr, label] of Object.entries(ATTR_ABBR)) {
      if (req[attr]) out.push(`${req[attr]} ${label}`);
    }
  }
  return out.map((r) => linkifyRequirement(r, hasDefinition));
}

function buildSlug(name, classId, nameAcrossClasses) {
  const base = slugify(name);
  return (nameAcrossClasses[name] ?? 1) > 1 ? `${base}--${slugify(classId)}` : base;
}

let _index = null;
let _byClass = null;
let _byName = null;
let _classInfo = null;

function buildIndex() {
  if (_index) return;

  const raw = loadJson(`${REPOE}/base_items.json`);
  const classesRaw = loadJson(`${REPOE}/item_classes.json`);

  // Count how many different item classes share each name (for slug disambiguation).
  const nameAcrossClasses = {};
  for (const v of Object.values(raw)) {
    if (v.domain !== 'item' || v.release_state !== 'released') continue;
    if (!BROWSABLE_CLASSES.has(v.item_class)) continue;
    nameAcrossClasses[v.name] = (nameAcrossClasses[v.name] ?? 0) + 1;
  }
  // Only names appearing in >1 distinct class need disambiguation;
  // dedupe same-name/same-class pairs to avoid inflating the count.
  const nameClassSeen = new Set();
  const nameAcrossClassesDeduped = {};
  for (const v of Object.values(raw)) {
    if (v.domain !== 'item' || v.release_state !== 'released') continue;
    if (!BROWSABLE_CLASSES.has(v.item_class)) continue;
    const key = `${v.name}|${v.item_class}`;
    if (nameClassSeen.has(key)) continue;
    nameClassSeen.add(key);
    nameAcrossClassesDeduped[v.name] = (nameAcrossClassesDeduped[v.name] ?? 0) + 1;
  }

  _index = new Map();
  _byClass = new Map();
  _byName = new Map();
  _classInfo = new Map();

  for (const [classId, info] of Object.entries(classesRaw)) {
    if (!BROWSABLE_CLASSES.has(classId)) continue;
    _classInfo.set(classId, { name: info.name || classId, classSlug: slugify(classId) });
    _byClass.set(classId, []);
  }

  const seenNameClass = new Set();

  for (const [metaKey, v] of Object.entries(raw)) {
    if (v.domain !== 'item' || v.release_state !== 'released') continue;
    if (!BROWSABLE_CLASSES.has(v.item_class)) continue;

    const nameClassKey = `${v.name}|${v.item_class}`;
    if (seenNameClass.has(nameClassKey)) continue;
    seenNameClass.add(nameClassKey);

    const slug = buildSlug(v.name, v.item_class, nameAcrossClassesDeduped);
    const record = {
      slug,
      metadataKey: metaKey,
      name: v.name,
      itemClass: v.item_class,
      className: _classInfo.get(v.item_class)?.name ?? v.item_class,
      classSlug: slugify(v.item_class),
      dropLevel: v.drop_level ?? null,
      inventorySize: { w: v.inventory_width, h: v.inventory_height },
      tags: v.tags ?? [],
      implicits: resolveImplicits(v.implicits),
      requirements: buildRequirements(v.requirements, v.drop_level),
      properties: computeProperties(v.properties),
      rawProperties: v.properties ?? null,
      iconUrl: ddsUrl(v.visual_identity?.dds_file),
    };

    if (!_index.has(slug)) _index.set(slug, record);
    if (!_byName.has(v.name)) _byName.set(v.name, record);
    _byClass.get(v.item_class)?.push(record);
  }

  for (const [, list] of _byClass) {
    list.sort((a, b) => (a.dropLevel ?? 0) - (b.dropLevel ?? 0) || a.name.localeCompare(b.name));
  }
}

export function listItemClasses() {
  buildIndex();
  return GROUPS.map((g) => ({
    label: g.label,
    classes: g.classes
      .filter((c) => _byClass.has(c))
      .map((c) => ({
        classId: c,
        classSlug: slugify(c),
        name: _classInfo.get(c)?.name ?? c,
        count: _byClass.get(c)?.length ?? 0,
      })),
  }));
}

export function getItemClass(classSlug) {
  buildIndex();
  for (const [classId, info] of _classInfo) {
    if (info.classSlug === classSlug) {
      const bases = _byClass.get(classId) ?? [];
      const affixes = getModsForClass(bases.map((b) => b.metadataKey));
      return { ...info, classId, classSlug, bases, affixes };
    }
  }
  return null;
}

export function getBaseItem(slug) {
  buildIndex();
  return _index.get(slug) ?? null;
}

// Look up a base item record by its display name (e.g. "Pronged Spear").
// Returns null for names whose item class isn't browsable (jewels, flasks, …).
export function getBaseByName(name) {
  buildIndex();
  return _byName.get(name) ?? null;
}

export function buildBaseItemViewModel(slug) {
  const b = getBaseItem(slug);
  if (!b) return null;

  const uniquesOnBase = listUniques()
    .filter((u) => u.base === b.name)
    .map((u) => ({ slug: u.slug, name: u.name, iconUrl: u.iconUrl }));

  return { ...b, uniquesOnBase };
}
