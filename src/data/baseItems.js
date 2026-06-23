import { ddsUrl } from './images.js';
import { listUniques } from './uniques.js';
import { getModsForClass, getCorruptedForClass, getDesecratedForTags, resolveImplicits } from './mods.js';
import { getGemRefByKey } from './gems.js';
import { hasDefinition } from './keywordDefs.js';
import { linkifyRequirement, linkifyPhrases } from './keywords.js';
import { nodesByKind, nodeBySlug } from './graph.js';

// Presentation adapter over the graph artifact (build/graph.json). Base identity,
// selection, slugs, props, and rune-variant folding live in the build-time graph
// (scripts/graph/bases.js); this module reads nodes and owns the view layer. It
// performs NO reads of base_items.json/item_classes.json. Mod/affix resolution
// (resolveImplicits, the affix tables) and uniquesOnBase still read source — those
// kinds are migrated in later plans (a deliberate partial cutover).

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

// Armour defence/attribute subtypes — player-facing labels and stable display
// order (pure types, then hybrids). The per-base `attr` is resolved in the graph.
const ATTR_ORDER = ['str_armour', 'dex_armour', 'int_armour', 'str_dex_armour', 'str_int_armour', 'dex_int_armour'];
const ATTR_LABELS = {
  str_armour: 'Armour',
  dex_armour: 'Evasion',
  int_armour: 'Energy Shield',
  str_dex_armour: 'Armour/Evasion',
  str_int_armour: 'Armour/Energy Shield',
  dex_int_armour: 'Evasion/Energy Shield',
};

let _index = null;
let _byClass = null;
let _byName = null;
let _classInfo = null;
let _runeByParent = null;

// Normalize a base node into the record shape the rest of the app reads. Field
// names mirror the original raw-derived record so consumers (uniques.js,
// theorycraft.js) and tests need no change; values come from the graph node.
// Presentation is applied here: requirement linkification, property labelHtml,
// icon URL, implicit-text resolution (deferred → mods.js), and granted-skill refs
// (graph-backed → gems.js).
function toBase(node) {
  const p = node.props;
  return {
    slug: node.slug,
    metadataKey: node.id,
    name: node.name,
    itemClass: p.itemClass,
    className: p.className,
    classSlug: p.classSlug,
    dropLevel: p.dropLevel,
    inventorySize: p.inventorySize,
    tags: p.tags ?? [],
    implicits: resolveImplicits(p.implicitIds),
    requirements: (p.requirements ?? []).map((r) => linkifyRequirement(r, hasDefinition)),
    properties: (p.properties ?? []).map((pr) => ({ ...pr, labelHtml: linkifyPhrases(pr.label, hasDefinition) })),
    rawProperties: p.rawProperties,
    iconUrl: ddsUrl(p.iconDds),
    attr: p.attr,
    implicitIds: p.implicitIds,
    grantedSkills: (p.skillsGranted ?? []).map(getGemRefByKey).filter(Boolean),
  };
}

function buildIndex() {
  if (_index) return;

  _index = new Map();
  _byClass = new Map();
  _byName = new Map();
  _classInfo = new Map();
  _runeByParent = new Map();

  for (const cnode of nodesByKind('class')) {
    _classInfo.set(cnode.props.classId, { name: cnode.name, classSlug: cnode.slug });
    _byClass.set(cnode.props.classId, []);
  }

  for (const bnode of nodesByKind('base')) {
    const rec = toBase(bnode);
    if (!_index.has(rec.slug)) _index.set(rec.slug, rec);
    if (!_byName.has(rec.name)) _byName.set(rec.name, rec);
    _byClass.get(rec.itemClass)?.push(rec);

    // Rune variants: resolve each raw implicit-id set to display lines now
    // (resolveImplicits is the deferred mod path); drop sets that resolve empty.
    const rv = bnode.props.runeVariants ?? [];
    if (rv.length) {
      _runeByParent.set(rec.slug, rv.map((v) => ({
        name: v.name,
        options: v.optionIdSets.map((ids) => resolveImplicits(ids)).filter((o) => o.length),
      })));
    }
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
        classSlug: _classInfo.get(c)?.classSlug ?? c,
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

// Reverse of the affix tables: for a mod family (by typeSlug), which browsable
// bases can roll it. Mirrors getItemClass's per-class affix computation, then
// inverts it. Armour classes split into defence subtypes — a mod that only rolls
// on the str/hybrid bases lists "Armour Body Armour", never "Evasion ..." —
// deep-linking the class page's defence filter (?attr=). Built once, cached.
let _affixTargets = null;
export function affixBaseTargets(typeSlug) {
  if (!_affixTargets) _affixTargets = buildAffixTargets();
  return _affixTargets.get(typeSlug) ?? [];
}

function buildAffixTargets() {
  buildIndex();
  const map = new Map(); // typeSlug -> [{ label, href }]
  const add = (slug, entry) => {
    if (!map.has(slug)) map.set(slug, []);
    map.get(slug).push(entry);
  };
  for (const [, info] of _classInfo) {
    const cls = getItemClass(info.classSlug);
    if (!cls) continue;
    const subKeys = cls.attrSubtypes.map((s) => s.value);
    const subLabel = new Map(cls.attrSubtypes.map((s) => [s.value, s.label]));
    const families = [...cls.affixes.standard.prefix, ...cls.affixes.standard.suffix];
    for (const f of families) {
      // f.attrs is populated only when the class spans >1 defence subtype; a
      // family tagged with a strict subset rolls on just those bases, so list
      // each defence variant separately. Otherwise it rolls class-wide.
      if (subKeys.length > 1 && f.attrs && f.attrs.length && f.attrs.length < subKeys.length) {
        for (const sub of f.attrs) {
          add(f.typeSlug, { label: `${subLabel.get(sub)} ${cls.name}`, href: `/bases/${cls.classSlug}?attr=${sub}` });
        }
      } else {
        add(f.typeSlug, { label: cls.name, href: `/bases/${cls.classSlug}` });
      }
    }
  }
  for (const [slug, entries] of map) {
    const uniq = new Map();
    for (const e of entries) uniq.set(e.href, e);
    map.set(slug, [...uniq.values()].sort((a, b) => a.label.localeCompare(b.label)));
  }
  return map;
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
