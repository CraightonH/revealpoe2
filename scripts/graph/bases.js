import { loadJson } from '../../src/data/loader.js';
import { REPOE } from '../../src/config.js';
import { slugify } from '../../src/data/slug.js';
import { makeNode, makeEdge, KINDS, EDGE_TYPES } from './schema.js';
import { computeProperties } from '../../src/data/itemStats.js';
import { ATTR_ABBR } from '../../src/data/attributes.js';

// Browsable item classes — mirrors src/data/baseItems.js GROUPS (the only bases
// that get pages/cards). Keep in sync with the app's GROUPS taxonomy.
export const BROWSABLE_CLASSES = new Set([
  'Bow', 'Claw', 'Crossbow', 'Dagger', 'Flail', 'FishingRod', 'One Hand Axe', 'One Hand Mace',
  'One Hand Sword', 'Sceptre', 'Spear', 'Staff', 'TrapTool', 'Two Hand Axe', 'Two Hand Mace',
  'Two Hand Sword', 'Wand', 'Warstaff',
  'Body Armour', 'Boots', 'Buckler', 'Focus', 'Gloves', 'Helmet', 'Shield',
  'Amulet', 'Belt', 'Quiver', 'Ring', 'Talisman',
]);

// Runeforged/Runemastered reissues are folded onto their parent base (Task 2),
// never their own node — mirrors src/data/baseItems.js.
const RUNE_VARIANT_RE = /^Rune(forged|mastered) /;

// A name appearing in >1 distinct browsable class gets a class-suffixed slug.
function buildSlug(name, classId, nameAcrossClasses) {
  const base = slugify(name);
  return (nameAcrossClasses[name] ?? 1) > 1 ? `${base}--${slugify(classId)}` : base;
}

export function selectBaseRecords() {
  const raw = loadJson(`${REPOE}/base_items.json`);

  // Count distinct browsable classes per name (deduped by name|class) for slug
  // disambiguation — matches baseItems.js nameAcrossClassesDeduped.
  const nameClassSeen = new Set();
  const nameAcrossClasses = {};
  for (const v of Object.values(raw)) {
    if (v.domain !== 'item' || v.release_state !== 'released') continue;
    if (!BROWSABLE_CLASSES.has(v.item_class)) continue;
    const key = `${v.name}|${v.item_class}`;
    if (nameClassSeen.has(key)) continue;
    nameClassSeen.add(key);
    nameAcrossClasses[v.name] = (nameAcrossClasses[v.name] ?? 0) + 1;
  }

  const records = [];
  const byNameClass = new Map(); // `${name}|${class}` -> record (rune parent join)
  const runeRaw = [];
  const seenNameClass = new Set();
  for (const [id, v] of Object.entries(raw)) {
    if (v.domain !== 'item' || v.release_state !== 'released') continue;
    if (!BROWSABLE_CLASSES.has(v.item_class)) continue;
    if (RUNE_VARIANT_RE.test(v.name)) { runeRaw.push(v); continue; }
    const nameClassKey = `${v.name}|${v.item_class}`;
    if (seenNameClass.has(nameClassKey)) continue;
    seenNameClass.add(nameClassKey);
    const rec = { id, slug: buildSlug(v.name, v.item_class, nameAcrossClasses), itemClass: v.item_class, raw: v };
    records.push(rec);
    byNameClass.set(nameClassKey, rec);
  }
  return { records, runeRaw, byNameClass };
}

export { RUNE_VARIANT_RE };

// Armour defence/attribute subtype, derived from base-item tags (no hand map) —
// mirrors src/data/baseItems.js ATTR_ORDER/attrOf.
const ATTR_SUBTYPE_ORDER = [
  'str_armour', 'dex_armour', 'int_armour', 'str_dex_armour', 'str_int_armour', 'dex_int_armour',
];
const attrOf = (tags) => ATTR_SUBTYPE_ORDER.find((t) => tags.includes(t)) ?? null;

// Plain requirement display strings (pre-linkify; the app linkifies). Level from
// drop_level, then Str/Dex/Int in ATTR_ABBR order — mirrors baseItems.js buildRequirements.
function requirementStrings(req, dropLevel) {
  const out = [];
  if (dropLevel != null && dropLevel > 0) out.push(`Level ${dropLevel}`);
  if (req) {
    for (const [attr, label] of Object.entries(ATTR_ABBR)) {
      if (req[attr]) out.push(`${req[attr]} ${label}`);
    }
  }
  return out;
}

// Fold rune-system reissues onto the base they're variants of, keyed by parent
// source id. A variant ("Runemastered Torment Club") maps to its parent ("Torment
// Club") by stripping the prefix and matching within the same item class. Each
// distinct implicit-id set is kept once (the app resolves the text later). Mirrors
// baseItems.js buildRuneVariants, but stores RAW id-sets (resolveImplicits is deferred).
function buildRuneVariants(runeRaw, byNameClass) {
  const byParent = new Map(); // parentId -> Map(variantName -> { name, seen, optionIdSets })
  for (const v of runeRaw) {
    const parent = byNameClass.get(`${v.name.replace(RUNE_VARIANT_RE, '')}|${v.item_class}`);
    if (!parent) continue;
    if (!byParent.has(parent.id)) byParent.set(parent.id, new Map());
    const variants = byParent.get(parent.id);
    if (!variants.has(v.name)) variants.set(v.name, { name: v.name, seen: new Set(), optionIdSets: [] });
    const entry = variants.get(v.name);
    const ids = v.implicits ?? [];
    const key = ids.join(',');
    if (entry.seen.has(key)) continue;
    entry.seen.add(key);
    entry.optionIdSets.push(ids);
  }
  const out = new Map();
  for (const [pid, variants] of byParent) {
    out.set(pid, [...variants.values()]
      .map((e) => ({ name: e.name, optionIdSets: e.optionIdSets }))
      .sort((a, b) => a.name.localeCompare(b.name)));
  }
  return out;
}

export function baseNodes() {
  const { records, runeRaw, byNameClass } = selectBaseRecords();
  const classes = loadJson(`${REPOE}/item_classes.json`);
  const runeByParent = buildRuneVariants(runeRaw, byNameClass);
  const nodes = records.map((r) => {
    const v = r.raw;
    const tags = v.tags ?? [];
    const className = classes[r.itemClass]?.name || r.itemClass;
    const props = {
      itemClass: r.itemClass,
      className,
      classSlug: slugify(r.itemClass),
      dropLevel: v.drop_level ?? null,
      inventorySize: { w: v.inventory_width, h: v.inventory_height },
      tags,
      attr: attrOf(tags),
      iconDds: v.visual_identity?.dds_file ?? null,
      implicitIds: v.implicits ?? [],
      skillsGranted: v.skills_granted ?? [],
      requirements: requirementStrings(v.requirements, v.drop_level),
      properties: computeProperties(v.properties),
      rawProperties: v.properties ?? null,
      runeVariants: runeByParent.get(r.id) ?? [],
    };
    const search = [v.name, className, ...tags].join(' ').toLowerCase();
    return makeNode({ id: r.id, kind: KINDS.BASE, name: v.name, slug: r.slug, props, search });
  });
  return { nodes, records };
}

export function classNodes() {
  const classes = loadJson(`${REPOE}/item_classes.json`);
  const nodes = [];
  for (const classId of BROWSABLE_CLASSES) {
    const info = classes[classId];
    nodes.push(makeNode({
      id: `Class/${classId}`, kind: KINDS.CLASS,
      name: info?.name || classId, slug: slugify(classId), props: { classId },
    }));
  }
  return nodes;
}

export function tagNodes(records) {
  const seen = new Set();
  const nodes = [];
  for (const r of records) {
    for (const tag of r.raw.tags ?? []) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      nodes.push(makeNode({
        id: `Tag/${tag}`, kind: KINDS.TAG, name: tag, slug: slugify(tag), search: tag.toLowerCase(),
      }));
    }
  }
  return nodes;
}

export function baseEdges(records, nodeIds) {
  const edges = [];
  for (const r of records) {
    const classId = `Class/${r.itemClass}`;
    if (nodeIds.has(classId)) {
      edges.push(makeEdge({ type: EDGE_TYPES.IN_CLASS, from: r.id, to: classId }));
    }
    for (const tag of r.raw.tags ?? []) {
      const tagId = `Tag/${tag}`;
      if (nodeIds.has(tagId)) {
        edges.push(makeEdge({ type: EDGE_TYPES.TAGGED, from: r.id, to: tagId }));
      }
    }
  }
  return edges;
}
