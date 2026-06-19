import { loadJson } from './loader.js';
import { slugify } from './slug.js';
import { ddsUrl } from './images.js';
import { listUniques } from './uniques.js';
import { getModsForClass, getCorruptedForClass, getDesecratedForTags, resolveImplicits } from './mods.js';
import { computeProperties } from './itemStats.js';
import { getGemRefByKey } from './gems.js';
import { ATTR_ABBR } from './attributes.js';
import { hasDefinition } from './keywordDefs.js';
import { linkifyRequirement, linkifyPhrases } from './keywords.js';
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

// Armour defence/attribute subtypes — derived straight from GGG base-item tags
// (no hand-maintained map). Player-facing labels per the in-game defence each
// attribute grants, plus a stable display order (pure types, then hybrids).
const ATTR_ORDER = ['str_armour', 'dex_armour', 'int_armour', 'str_dex_armour', 'str_int_armour', 'dex_int_armour'];
const ATTR_LABELS = {
  str_armour: 'Armour',
  dex_armour: 'Evasion',
  int_armour: 'Energy Shield',
  str_dex_armour: 'Armour/Evasion',
  str_int_armour: 'Armour/Energy Shield',
  dex_int_armour: 'Evasion/Energy Shield',
};
const attrOf = (tags) => ATTR_ORDER.find((t) => tags.includes(t)) ?? null;

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
let _runeByParent = null;

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
  _runeByParent = new Map();

  for (const [classId, info] of Object.entries(classesRaw)) {
    if (!BROWSABLE_CLASSES.has(classId)) continue;
    _classInfo.set(classId, { name: info.name || classId, classSlug: slugify(classId) });
    _byClass.set(classId, []);
  }

  const seenNameClass = new Set();
  // Name+class → record, so rune variants can find their parent base below.
  const byNameClass = new Map();
  // Runeforged/Runemastered variants are collected here and folded onto their
  // parent base in a second pass — they don't get their own grid card or page.
  const runeRaw = [];

  for (const [metaKey, v] of Object.entries(raw)) {
    if (v.domain !== 'item' || v.release_state !== 'released') continue;
    if (!BROWSABLE_CLASSES.has(v.item_class)) continue;

    if (RUNE_VARIANT_RE.test(v.name)) { runeRaw.push(v); continue; }

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
      properties: computeProperties(v.properties).map(
        (p) => ({ ...p, labelHtml: linkifyPhrases(p.label, hasDefinition) }),
      ),
      rawProperties: v.properties ?? null,
      iconUrl: ddsUrl(v.visual_identity?.dds_file),
      attr: attrOf(v.tags ?? []),
      implicitIds: v.implicits ?? [],
      // Item-granted skills (a separate field from `implicits`): wands/sceptres/
      // staves grant a weapon-skill, shields/bucklers a block skill, etc. Resolve
      // each Metadata key to a linkable gem ref; unresolved keys ([DNT] dev
      // content) drop out so only real, browsable skills surface.
      grantedSkills: (v.skills_granted ?? []).map(getGemRefByKey).filter(Boolean),
    };

    if (!_index.has(slug)) _index.set(slug, record);
    if (!_byName.has(v.name)) _byName.set(v.name, record);
    byNameClass.set(nameClassKey, record);
    _byClass.get(v.item_class)?.push(record);
  }

  for (const [, list] of _byClass) {
    list.sort((a, b) => (a.dropLevel ?? 0) - (b.dropLevel ?? 0) || a.name.localeCompare(b.name));
  }

  _runeByParent = buildRuneVariants(runeRaw, byNameClass);
}

// Fold rune-system reissues onto the base they're variants of. A variant like
// "Runeforged Torment Club" maps to its parent ("Torment Club") by stripping the
// prefix and matching within the same item class. Variants are grouped by name,
// and each distinct rune-implicit option is collected (most have one; a few have
// several) so the parent's page can list every reissue and what it grants.
// Variants whose parent base doesn't exist (rare data quirks) are dropped.
function buildRuneVariants(runeRaw, byNameClass) {
  const byParent = new Map(); // parentSlug → Map(variantName → { name, seen, options })
  for (const v of runeRaw) {
    const parent = byNameClass.get(`${v.name.replace(RUNE_VARIANT_RE, '')}|${v.item_class}`);
    if (!parent) continue;
    if (!byParent.has(parent.slug)) byParent.set(parent.slug, new Map());
    const variants = byParent.get(parent.slug);
    if (!variants.has(v.name)) variants.set(v.name, { name: v.name, seen: new Set(), options: [] });
    const entry = variants.get(v.name);
    const ids = v.implicits ?? [];
    const key = ids.join(',');
    if (entry.seen.has(key)) continue;
    entry.seen.add(key);
    const lines = resolveImplicits(ids);
    if (lines.length) entry.options.push(lines);
  }
  const out = new Map();
  for (const [slug, variants] of byParent) {
    out.set(slug, [...variants.values()]
      .map((e) => ({ name: e.name, options: e.options }))
      .sort((a, b) => a.name.localeCompare(b.name)));
  }
  return out;
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
        // Representative icon: lowest-drop-level base in the class (the list is
        // pre-sorted by drop level), used as a generic class glyph in filters.
        iconUrl: _byClass.get(c)?.[0]?.iconUrl ?? null,
      })),
  }));
}

// Group a class's bases by defence subtype, in display order, keeping each
// group's bases (already drop-level sorted, so [0] is the representative).
function subtypesOf(bases) {
  const bySub = new Map();
  for (const b of bases) {
    if (!b.attr) continue;
    if (!bySub.has(b.attr)) bySub.set(b.attr, []);
    bySub.get(b.attr).push(b);
  }
  return ATTR_ORDER.filter((k) => bySub.has(k)).map((k) => ({ key: k, bases: bySub.get(k) }));
}

// Strip an implicit id's trailing tier number so its tiers collapse to one
// archetype — QuarterstaffImplicitBaseLightningDamage 1/2/3 (Crackling/Arcing/
// Bolting) are one "lightning" line, represented by its highest-tier member.
const normImplicit = (id) => id.replace(/\d+$/, '');

// Most common non-null value of a raw property across the class — the "default"
// a named variant deviates from. Returns null when no base carries the property
// (e.g. crit/attack-time on armour), so those classes get no stat-bias split.
function modeProp(bases, key) {
  const counts = new Map();
  for (const b of bases) {
    const val = b.rawProperties?.[key];
    if (val == null) continue;
    counts.set(val, (counts.get(val) ?? 0) + 1);
  }
  let best = null;
  let bestN = -1;
  for (const [val, n] of counts) if (n > bestN) { best = val; bestN = n; }
  return best;
}

// Highest-tier ("crafting") base per archetype. An archetype is identified by
// structured data, not by parsing implicit text:
//   - attribute subtype (armour defence types)
//   - tier-normalized implicit mod ids (e.g. every talisman with
//     TalismanImplicitAdditionalBlock is the Block archetype)
//   - weapon stat bias: crit chance and attack time relative to the class's
//     modal values, which is how weapon lines differ when implicits don't —
//     the crit line (Sinister: 12% vs 10% default) vs the attack-speed line
//     (Lunar: faster) vs the balanced line are otherwise indistinguishable.
// Each archetype's highest drop-level member (Alpha) is its endgame base.
// (Runeforged/Runemastered variants never reach here — they're folded onto
// their parent base in buildIndex and excluded from the class list entirely.)
const RUNE_VARIANT_RE = /^Rune(forged|mastered) /;
function topTierBases(bases) {
  const baseCrit = modeProp(bases, 'critical_strike_chance');
  const baseAtk = modeProp(bases, 'attack_time');
  const bias = (val, base) => (val == null || base == null || val === base ? '=' : (val > base ? '+' : '-'));
  const byArchetype = new Map();
  for (const b of bases) {
    const impl = b.implicitIds.map(normImplicit).join(',') || 'plain';
    const crit = bias(b.rawProperties?.critical_strike_chance, baseCrit);
    const spd = bias(b.rawProperties?.attack_time, baseAtk);
    const key = `${b.attr ?? '-'}::${impl}::c${crit}s${spd}`;
    const cur = byArchetype.get(key);
    if (!cur || b.dropLevel > cur.dropLevel) byArchetype.set(key, b);
  }
  const attrIdx = (b) => {
    const i = ATTR_ORDER.indexOf(b.attr);
    return i < 0 ? ATTR_ORDER.length : i;
  };
  return [...byArchetype.values()].sort(
    (a, b) => attrIdx(a) - attrIdx(b) || b.dropLevel - a.dropLevel || a.name.localeCompare(b.name),
  );
}

export function getItemClass(classSlug) {
  buildIndex();
  for (const [classId, info] of _classInfo) {
    if (info.classSlug === classSlug) {
      const bases = _byClass.get(classId) ?? [];
      // Affixes split by how they're obtained: Standard (basic currency),
      // Corrupted (Vaal, flat list), Desecrated (Abyssal, via item-tag spawn weights).
      const metaKeys = bases.map((b) => b.metadataKey);
      const classTags = new Set(bases.flatMap((b) => b.tags));
      const affixes = {
        standard: getModsForClass(metaKeys),
        corrupted: getCorruptedForClass(metaKeys),
        desecrated: getDesecratedForTags(classTags),
      };
      // Defence-subtype filter options (icon chips) — only when the class spans
      // more than one, so single-subtype classes (e.g. Foci) get no redundant filter.
      const subs = subtypesOf(bases);
      const attrSubtypes = subs.length > 1
        ? subs.map((s) => ({ value: s.key, label: ATTR_LABELS[s.key], icon: s.bases[0].iconUrl, count: s.bases.length }))
        : [];
      // When the class spans multiple defence subtypes, tag each affix family
      // with the subtypes it can actually roll on (e.g. "increased Armour" only
      // on str/hybrid bases, never Evasion-only). The archetype filter then
      // restricts the affix list client-side in lockstep with the base cards.
      // Applied uniformly across all three origins so the filter stays in sync.
      if (subs.length > 1) {
        const setsBySub = subs.map((s) => {
          const keys = s.bases.map((b) => b.metadataKey);
          const tags = new Set(s.bases.flatMap((b) => b.tags));
          const std = getModsForClass(keys);
          const des = getDesecratedForTags(tags);
          return {
            key: s.key,
            standardPrefix: new Set(std.prefix.map((f) => f.type)),
            standardSuffix: new Set(std.suffix.map((f) => f.type)),
            corrupted: new Set(getCorruptedForClass(keys).map((f) => f.type)),
            desecratedPrefix: new Set(des.prefix.map((f) => f.type)),
            desecratedSuffix: new Set(des.suffix.map((f) => f.type)),
          };
        });
        const tagFamilies = (families, field) => {
          for (const f of families) f.attrs = setsBySub.filter((s) => s[field].has(f.type)).map((s) => s.key);
        };
        tagFamilies(affixes.standard.prefix, 'standardPrefix');
        tagFamilies(affixes.standard.suffix, 'standardSuffix');
        tagFamilies(affixes.corrupted, 'corrupted');
        tagFamilies(affixes.desecrated.prefix, 'desecratedPrefix');
        tagFamilies(affixes.desecrated.suffix, 'desecratedSuffix');
      }
      return { ...info, classId, classSlug, bases, affixes, attrSubtypes, topBases: topTierBases(bases) };
    }
  }
  return null;
}

// Off-hand slot classes. PoE2 has no "offhand" tag, so this is a small explicit
// taxonomy (the only hand-maintained list here). Order = display order.
const OFFHAND_CLASSES = ['Shield', 'Buckler', 'Focus', 'Quiver'];

// Landing-page navigation model. Buckets are tag-driven, not GROUPS-driven, so
// data quirks self-correct: Weapons split into One-/Two-Handed by onehand/twohand
// tags (Talismans carry two_hand_weapon, so they land in Two-Handed); Off-Hand is
// the explicit slot set above; armour classes expand into defence subtypes (Armour
// / Evasion / Energy Shield + hybrids) with a deep link that pre-filters the class
// page; accessories list flat.
// Shape: [{ label, sections: [{ title, cards: [{ name, count, iconUrl, href }] }] }]
export function listBaseNav() {
  buildIndex();
  const card = (name, count, iconUrl, href) => ({ name, count, iconUrl, href });
  const get = (classId) => ({ classId, info: _classInfo.get(classId), bases: _byClass.get(classId) ?? [] });
  const classCard = (c) => card(c.info.name, c.bases.length, c.bases[0].iconUrl, `/bases/${c.info.classSlug}`);
  const offhandSet = new Set(OFFHAND_CLASSES);

  // Bucket every browsable class by its tags (off-hand handled separately, in a
  // fixed order). GROUPS is used only as a stable iteration order.
  const oneHand = [];
  const twoHand = [];
  const armourClasses = [];
  const accCards = [];
  for (const g of GROUPS) {
    for (const classId of g.classes) {
      if (offhandSet.has(classId)) continue;
      const c = get(classId);
      if (!c.bases.length) continue;
      const tags = c.bases[0].tags;
      if (tags.includes('twohand')) twoHand.push(classCard(c));
      else if (tags.includes('onehand')) oneHand.push(classCard(c));
      else if (tags.includes('armour')) armourClasses.push(c);
      else accCards.push(classCard(c));
    }
  }
  const offhand = OFFHAND_CLASSES.map(get).filter((c) => c.bases.length).map(classCard);

  // Armour → one section per class; defence subtypes when the class spans >1.
  const armourSections = armourClasses.map((c) => {
    const subs = subtypesOf(c.bases);
    if (subs.length > 1) {
      return {
        title: c.info.name,
        cards: subs.map((s) => card(
          ATTR_LABELS[s.key], s.bases.length, s.bases[0].iconUrl,
          `/bases/${c.info.classSlug}?attr=${s.key}`,
        )),
      };
    }
    return { title: c.info.name, cards: [classCard(c)] };
  });

  return [
    { label: 'Weapons', sections: [
      { title: 'One-Handed', cards: oneHand },
      { title: 'Two-Handed', cards: twoHand },
      { title: 'Off-Hand', cards: offhand },
    ] },
    { label: 'Armour', sections: armourSections },
    { label: 'Accessories', sections: [{ title: null, cards: accCards }] },
  ];
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

  return { ...b, uniquesOnBase, runeVariants: _runeByParent.get(b.slug) ?? [] };
}
