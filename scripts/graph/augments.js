// scripts/graph/augments.js
//
// Build-time resolver for augments (socketables — patch 0.5 "Augment" items:
// Runes, Soul Cores, Idols, Abyssal Eyes, Congealed Mist). One `augment` node per
// augment *identity*, plus `sockets_into` edges to every item class the augment can
// be socketed into. The app (src/data/augments.js) reads these and owns rendering.
//
// Source: augments.json (per-category grants) joined to base_items.json (name,
// icon, stack size, description, tier tags). The numeric values are baked directly
// into each category's `stat_text` (stats[] carry no min/max), so rendering is just
// keyword-markup text — no value substitution.
//
// Tier collapsing: only Runes ship Lesser/Normal/Greater/Perfect variants of one
// identity (same base name, `rune_<tier>` tag, only values scale). Those collapse
// into a single node carrying `tiers[]` (mirrors affix `tiers[]`); the card shows
// the top tier and reveals the others on item pages. Every other family — and
// Ancient runes, which have no `rune_<tier>` tag — is one node per entry.
import { loadJson } from './loader.js';
import { REPOE } from './source.js';
import { slugify } from '../../src/data/slug.js';
import { makeNode, makeEdge, KINDS, EDGE_TYPES, SOURCES } from './schema.js';

// rune tier tag -> tier id; tier id -> rank (low→high). Non-rune / Ancient = 'base'.
const TIER_BY_TAG = {
  rune_lesser: 'lesser', rune_normal: 'normal', rune_greater: 'greater', rune_perfect: 'perfect',
};
const TIER_RANK = { lesser: 0, normal: 1, greater: 2, perfect: 3, base: 1 };
const TIER_PREFIX_RE = /^(Lesser|Greater|Perfect) /;

// Hand-authored category → item-class taxonomy: the one bridge not 1:1 in source.
// augments.json category keys (incl. groupings like "Martial Weapon"/"All") mapped
// to `item_class` ids (matching item_classes.json / bases.js). Note "Quarterstaff"
// → `Warstaff` (source class name). Guardrails below FAIL THE BUILD on an unmapped
// category key (coverage) or a class that has no Class node (referential integrity).
const ARMOUR = ['Body Armour', 'Boots', 'Gloves', 'Helmet'];
const OFFHAND = ['Shield', 'Buckler', 'Focus'];
const MARTIAL = [
  'Bow', 'Claw', 'Crossbow', 'Dagger', 'Flail', 'One Hand Axe', 'One Hand Mace',
  'One Hand Sword', 'Spear', 'Two Hand Axe', 'Two Hand Mace', 'Two Hand Sword', 'Warstaff',
];
const CASTER = ['Wand', 'Sceptre', 'Staff'];
const uniq = (...lists) => [...new Set(lists.flat())];

export const CATEGORY_CLASSES = {
  All: uniq(ARMOUR, OFFHAND, MARTIAL, CASTER),
  Armour: ARMOUR,
  'Martial Weapon': MARTIAL,
  'Caster Weapon': CASTER,
  'Martial Or Caster Weapon': uniq(MARTIAL, CASTER),
  'Martial Weapon Wand or Staff': uniq(MARTIAL, ['Wand', 'Staff']),
  'Wand or Staff': ['Wand', 'Staff'],
  'Shield or Buckler': ['Shield', 'Buckler'],
  'One Hand Mace or Quarterstaff': ['One Hand Mace', 'Warstaff'],
  'Crossbow Bow or Spear': ['Crossbow', 'Bow', 'Spear'],
  'Quarterstaff or Spear': ['Warstaff', 'Spear'],
  'Maces or Talisman': ['One Hand Mace', 'Two Hand Mace', 'Talisman'],
  'Body Armour': ['Body Armour'],
  Boots: ['Boots'],
  Gloves: ['Gloves'],
  Helmet: ['Helmet'],
  Shield: ['Shield'],
  Buckler: ['Buckler'],
  Focus: ['Focus'],
  Bow: ['Bow'],
  Crossbow: ['Crossbow'],
  Wand: ['Wand'],
  Sceptre: ['Sceptre'],
  Spear: ['Spear'],
  Staff: ['Staff'],
  Quarterstaff: ['Warstaff'],
  Talisman: ['Talisman'],
  'One Hand Mace': ['One Hand Mace'],
  'Two Hand Mace': ['Two Hand Mace'],
};

// Strip PoE display markup: [Ref|Display] -> Display, [Word] -> Word.
function clean(s) {
  if (!s) return '';
  return String(s).replace(/\[[^\]|]*\|([^\]]*)\]/g, '$1').replace(/\[([^\]]*)\]/g, '$1');
}

// Per-category grant record. stat_text keeps keyword markup (app renders); target
// is flattened to a display string (source is inconsistently string | array).
function categoriesOf(a) {
  const out = [];
  for (const [category, c] of Object.entries(a.categories ?? {})) {
    const target = Array.isArray(c.target) ? c.target.join(', ') : c.target;
    out.push({
      category,
      target: clean(target),
      statText: c.stat_text ?? [],
      bondedStatText: c.bonded_stat_text ?? [],
    });
  }
  return out;
}

// Group augment entries into identities. Rune tier-variants (same stripped name +
// rune_<tier> tag) collapse; everything else is its own single-member group.
function selectAugmentGroups() {
  const augments = loadJson(`${REPOE}/augments.json`);
  const bases = loadJson(`${REPOE}/base_items.json`);
  const groups = new Map();
  for (const [key, a] of Object.entries(augments)) {
    const b = bases[key] ?? {};
    const family = a.type_id;
    const familyLabel = clean(a.type_name) || family;
    let tier = 'base';
    for (const t of b.tags ?? []) if (TIER_BY_TAG[t]) tier = TIER_BY_TAG[t];
    const collapse = family === 'Rune' && tier !== 'base';
    const rawName = b.name || key;
    const groupName = collapse ? rawName.replace(TIER_PREFIX_RE, '') : rawName;
    const groupKey = collapse ? `${family}|${groupName}` : key;
    if (!groups.has(groupKey)) groups.set(groupKey, { family, familyLabel, groupName, members: [] });
    groups.get(groupKey).members.push({ key, tier, rank: TIER_RANK[tier] ?? 1, rawName, a, b });
  }
  return groups;
}

export function augmentNodes() {
  const groups = selectAugmentGroups();
  const nodes = [];
  const records = [];
  const usedSlugs = new Set();
  const slugFor = (name, family) => {
    let slug = slugify(name);
    if (usedSlugs.has(slug)) slug = `${slugify(name)}--${slugify(family)}`;
    for (let n = 2; usedSlugs.has(slug); n += 1) slug = `${slugify(name)}--${slugify(family)}-${n}`;
    usedSlugs.add(slug);
    return slug;
  };

  for (const g of groups.values()) {
    const tiers = g.members.slice().sort((x, y) => x.rank - y.rank);
    const top = tiers[tiers.length - 1];
    const name = g.groupName;
    // Some fields (stack size, the generic flavour text) are populated on only some
    // tier entries in source — take the first tier that has one so the full card
    // still shows them regardless of which tier is displayed by default.
    const firstWith = (fn) => {
      for (const t of tiers) { const v = fn(t); if (v != null && v !== '') return v; }
      return null;
    };
    const props = {
      family: g.family,
      familyLabel: g.familyLabel,
      limit: clean(top.a.limit) || null,
      iconDds: top.b.visual_identity?.dds_file ?? null,
      requiredLevel: top.a.required_level ?? null,
      stackSize: firstWith((t) => t.b.stack_size),
      description: firstWith((t) => t.b.properties?.description),
      categories: categoriesOf(top.a),
      // Sorted low→high; item pages render the extra tiers highest-range on top.
      tiers: tiers.map((t) => ({
        tier: t.tier,
        name: t.rawName,
        requiredLevel: t.a.required_level ?? null,
        iconDds: t.b.visual_identity?.dds_file ?? null,
        categories: categoriesOf(t.a).map(({ category, statText, bondedStatText }) => ({
          category, statText, bondedStatText,
        })),
      })),
    };
    const search = [name, g.familyLabel, ...props.categories.flatMap((c) => c.statText.map(clean))]
      .join(' ').toLowerCase();
    nodes.push(makeNode({
      id: top.key, kind: KINDS.AUGMENT, name, slug: slugFor(name, g.family), props, search,
    }));
    records.push({ id: top.key, categories: props.categories.map((c) => c.category) });
  }
  return { nodes, records };
}

// One `sockets_into` edge per (augment, eligible item class). Guardrails fail the
// build rather than silently dropping a relationship (Data Provenance policy).
export function augmentEdges(records, nodeIds) {
  const edges = [];
  for (const r of records) {
    const classes = new Set();
    for (const category of r.categories) {
      const mapped = CATEGORY_CLASSES[category];
      if (!mapped) {
        throw new Error(`augments: unmapped category '${category}' — add it to CATEGORY_CLASSES`);
      }
      for (const c of mapped) classes.add(c);
    }
    for (const c of classes) {
      const classId = `Class/${c}`;
      if (!nodeIds.has(classId)) {
        throw new Error(`augments: category maps to class '${c}' with no Class node (renamed in source?)`);
      }
      edges.push(makeEdge({
        type: EDGE_TYPES.SOCKETS_INTO, from: r.id, to: classId,
        source: SOURCES.DERIVED, via: 'augment-category-map',
      }));
    }
  }
  return edges;
}
