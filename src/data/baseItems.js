import { ddsUrl } from './images.js';
import { tradeUrl } from './trade.js';
import { getModsForClass, getCorruptedForClass, getDesecratedForClass } from './mods.js';
import { augmentsForClass } from './augments.js';
import { getGemRefByKey } from './gems.js';
import { hasDefinition } from './keywordDefs.js';
import { linkifyRequirement, linkifyPhrases, renderGameText } from './keywords.js';
import { nodesByKind, edgesTo, getNode } from './graph.js';
import { GROUPS, ATTR_SUBTYPE_ORDER, CONSUMABLE_CLASSES } from './itemTaxonomy.js';

// Presentation adapter over the graph artifact (build/graph.json). Base identity,
// selection, slugs, props, rune-variant folding, and resolved implicit/affix data
// live in the build-time graph (scripts/graph/bases.js, scripts/graph/affixes.js);
// this module reads nodes/edges and owns the view layer. It performs NO reads of
// $POE2DATADIR. Implicit and affix-table text arrive pre-resolved (the graph holds
// the strings; this module renders them). uniquesOnBase is resolved via the
// has_base reverse edge (unique -> base) — no source read, no uniques.js import.

// GROUPS and ATTR_SUBTYPE_ORDER are the shared item-class taxonomy (./itemTaxonomy.js).
// Armour defence/attribute subtype display labels are presentation-only and stay here.
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
    // Implicit lines arrive pre-resolved as text on the node; render to HTML here.
    implicits: (p.implicitTexts ?? []).map(({ id, text }) => ({ id, html: renderGameText(text, hasDefinition) })),
    requirements: (p.requirements ?? []).map((r) => linkifyRequirement(r, hasDefinition)),
    properties: (p.properties ?? []).map((pr) => ({ ...pr, labelHtml: linkifyPhrases(pr.label, hasDefinition) })),
    rawProperties: p.rawProperties,
    iconUrl: ddsUrl(p.iconDds),
    attr: p.attr,
    implicitIds: p.implicitIds,
    grantedSkills: (p.skillsGranted ?? []).map(getGemRefByKey).filter(Boolean),
    tradeUrl: tradeUrl({ kind: 'base', type: node.name }),
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

    // Rune variants: option texts arrive pre-resolved on the node (empty options
    // already dropped at build); render each option's lines to HTML.
    const rv = bnode.props.runeVariants ?? [];
    if (rv.length) {
      _runeByParent.set(rec.slug, rv.map((v) => ({
        name: v.name,
        options: v.optionTexts.map((opt) => opt.map(({ id, text }) => ({ id, html: renderGameText(text, hasDefinition) }))),
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

// Unified /bases index model. Keep the class taxonomy on each row so the
// landing page can offer a small group-chip row plus a precise class dropdown
// without rebuilding graph relationships in the route or template.
export function listBaseIndex() {
  buildIndex();
  const groupByClass = new Map(
    GROUPS.flatMap((group) => group.classes.map((classId) => [classId, group.label])),
  );
  return [..._index.values()].map((base) => ({
    ...base,
    group: groupByClass.get(base.itemClass) ?? 'Other',
    groupSlug: (groupByClass.get(base.itemClass) ?? 'Other').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    statHint: base.properties[0]
      ? `${base.properties[0].labelHtml}: ${base.properties[0].value}`
      : (base.implicits[0]?.html ?? `Drop level ${base.dropLevel ?? 1}`),
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
  return ATTR_SUBTYPE_ORDER.filter((k) => bySub.has(k)).map((k) => ({ key: k, bases: bySub.get(k) }));
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
  const attrIdx = (b) => {
    const i = ATTR_SUBTYPE_ORDER.indexOf(b.attr);
    return i < 0 ? ATTR_SUBTYPE_ORDER.length : i;
  };
  const sort = (list) => [...list].sort(
    (a, b) => attrIdx(a) - attrIdx(b) || b.dropLevel - a.dropLevel || a.name.localeCompare(b.name),
  );

  // Archetype-collapsing models a drop-level tier progression (a low-tier base
  // superseded by its endgame Alpha). Classes with no drop-level spread (jewels:
  // every base is level 20) have no such progression — Diamond/Emerald/Ruby are
  // distinct siblings, not tiers of one line — so every base is itself top-tier.
  if (new Set(bases.map((b) => b.dropLevel ?? 0)).size <= 1) return sort(bases);

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
  return sort([...byArchetype.values()]);
}

export function getItemClass(classSlug) {
  buildIndex();
  for (const [classId, info] of _classInfo) {
    if (info.classSlug === classSlug) {
      const bases = _byClass.get(classId) ?? [];
      // Affixes split by how they're obtained: Standard (basic currency),
      // Corrupted (Vaal, flat list), Desecrated (Abyssal, via item-tag spawn weights).
      const metaKeys = bases.map((b) => b.metadataKey);
      const affixes = {
        standard: getModsForClass(metaKeys),
        corrupted: getCorruptedForClass(metaKeys),
        desecrated: getDesecratedForClass(metaKeys),
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
          const std = getModsForClass(keys);
          const des = getDesecratedForClass(keys);
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
      // Socketables (augments) that can slot into this class — the reverse of the
      // augment nodes' sockets_into edges, grouped by family for display.
      const augments = augmentsForClass(classId);
      return { ...info, classId, classSlug, bases, affixes, attrSubtypes, augments, topBases: topTierBases(bases) };
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
    // Per-base-nav classes (jewels) have no class page — point each family at the
    // individual bases that roll it, resolved per base from its own affix set.
    if (PER_BASE_NAV_CLASSES.has(cls.classId)) {
      for (const b of cls.bases) {
        const a = baseAffixes(b.metadataKey);
        for (const f of [...a.standard.prefix, ...a.standard.suffix]) {
          add(f.typeSlug, { label: b.name, href: `/base/${b.slug}` });
        }
      }
      continue;
    }
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

// Consumable/jewel classes get their own top-level nav groups (label -> class ids
// in display order). They carry none of the onehand/twohand/armour tags the
// weapon/armour bucketing keys off, so they're routed here explicitly instead of
// falling through to Accessories. Mirrors the GROUPS taxonomy in itemTaxonomy.js.
const EXTRA_NAV_GROUPS = [
  { label: 'Flasks & Charms', classes: ['LifeFlask', 'ManaFlask', 'UtilityFlask'] },
  { label: 'Jewels', classes: ['Jewel'] },
];
const EXTRA_NAV_CLASSES = new Set(EXTRA_NAV_GROUPS.flatMap((g) => g.classes));

// Classes navigated per-base on the /bases landing rather than via a class page —
// each base rolls a distinct affix set, so listing one base page per type is more
// useful than a union class page. These have NO /bases/:class page (the route
// 404s); breadcrumbs render the class as plain text and affix flyouts target the
// individual bases that roll a mod.
export const PER_BASE_NAV_CLASSES = new Set(['Jewel']);

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
      if (offhandSet.has(classId) || EXTRA_NAV_CLASSES.has(classId)) continue;
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

  // Per-base nav card for jewels — each jewel base rolls its own affix set, so the
  // landing lists them individually (Ruby, Emerald, …) rather than one "Jewel"
  // class card. Count is rollable-mod families ("mods"), not bases.
  const jewelBaseCard = (b) =>
    ({ ...card(b.name, affixFamilyCount(baseAffixes(b.metadataKey)), b.iconUrl, `/base/${b.slug}`), unit: 'mods' });

  // Consumable groups: one flat section each, skipping empties. Per-base-nav
  // classes (jewels) expand to a card per base; other groups (flasks/charms) list
  // class cards that link to their class page.
  const extraGroups = EXTRA_NAV_GROUPS.map((g) => {
    const perBase = g.classes.some((c) => PER_BASE_NAV_CLASSES.has(c));
    const cards = perBase
      ? g.classes.flatMap((classId) => _byClass.get(classId) ?? []).map(jewelBaseCard)
      : g.classes.map(get).filter((c) => c.bases.length).map(classCard);
    return { label: g.label, sections: [{ title: null, cards }] };
  }).filter((g) => g.sections[0].cards.length);

  return [
    { label: 'Weapons', sections: [
      { title: 'One-Handed', cards: oneHand },
      { title: 'Two-Handed', cards: twoHand },
      { title: 'Off-Hand', cards: offhand },
    ] },
    { label: 'Armour', sections: armourSections },
    { label: 'Accessories', sections: [{ title: null, cards: accCards }] },
    ...extraGroups,
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

// The three affix origins rollable on a single base, in the shape the affix-table
// macros consume. Consumable/jewel bases each roll a *distinct* set (a Ruby ≠ an
// Emerald), so they get per-base tables; equipment mods are uniform class-wide, so
// those bases defer to the class page instead.
function baseAffixes(metadataKey) {
  return {
    standard: getModsForClass([metadataKey]),
    corrupted: getCorruptedForClass([metadataKey]),
    desecrated: getDesecratedForClass([metadataKey]),
  };
}

function affixFamilyCount(a) {
  return a.standard.prefix.length + a.standard.suffix.length
    + a.corrupted.length + a.desecrated.prefix.length + a.desecrated.suffix.length;
}

export function buildBaseItemViewModel(slug) {
  const b = getBaseItem(slug);
  if (!b) return null;

  // "Uniques on this base" — the reverse of the unique's has_base edge. Replaces
  // the former listUniques().filter(u.base === b.name) source scan.
  const uniquesOnBase = edgesTo(b.metadataKey, 'has_base')
    .map((e) => getNode(e.from))
    .filter(Boolean)
    .map((n) => ({ slug: n.slug, name: n.name, iconUrl: ddsUrl(n.props.iconDds) }));

  // Per-base affix tables for consumable/jewel bases; equipment keeps the
  // "see the class page" pointer (its mods don't vary base to base).
  const affixes = CONSUMABLE_CLASSES.has(b.itemClass) ? baseAffixes(b.metadataKey) : null;
  // Jewels have no class page (PER_BASE_NAV_CLASSES) — the breadcrumb shows the
  // class as plain text rather than a dead link to /bases/:class.
  const classHasPage = !PER_BASE_NAV_CLASSES.has(b.itemClass);

  return { ...b, uniquesOnBase, affixes, classHasPage, runeVariants: _runeByParent.get(b.slug) ?? [] };
}
