// src/data/augments.js
//
// Presentation adapter over the graph artifact (build/graph.json) for augments
// (socketables — Runes, Soul Cores, Idols, Abyssal Eyes, Congealed Mist). Augment
// identity, per-slot grants, rune tier-collapsing, and the sockets_into edges live
// in the build-time graph (scripts/graph/augments.js); this module reads `augment`
// nodes + `sockets_into` edges and owns the view layer (stat text -> HTML render,
// family grouping, top-tier vs tier-block shaping). It performs NO reads of source.
//
// "Which augments can socket into this item, and what does each grant here?" is the
// relationship the wiki surfaces — answered by the reverse edge lookup
// edgesTo('Class/<class>', 'sockets_into'), grouped by family for display.
import { getNode, nodeBySlug, nodesByKind, edgesTo } from './graph.js';
import { ddsUrl, placeholder } from './images.js';
import { renderGameText } from './keywords.js';
import { hasDefinition } from './keywordDefs.js';

// Family display order (augments.json `type_id`). Runes lead (the largest, most
// build-relevant family), then Soul Cores, Idols, Abyssal Eyes, Congealed Mist.
const FAMILY_ORDER = ['Rune', 'SoulCore', 'Idol', 'AbyssalEye', 'CongealedMist'];

// The Rune family further splits three ways (the source distinguishes them via
// tier tags + the `limit` field + naming): common tiered runes (lesser→perfect),
// Ancient runes (single-tier, per-item Limit 1), and the Kalguuran "Aldur" runes
// (the shared "Aldur's Legacy" group limit, plus the "… of Aldur" set).
const RUNE_SUBGROUPS = [
  { key: 'common', label: 'Common' },
  { key: 'ancient', label: 'Ancient' },
  { key: 'kalguuran', label: 'Kalguuran' },
];
function runeSubfamily(aug) {
  if (aug.hasTiers) return 'common'; // only the tiered families collapse to >1 tier
  if (/aldur/i.test(`${aug.limit ?? ''} ${aug.sortName}`)) return 'kalguuran';
  return 'ancient';
}
// Split a family group's augments into display subgroups. Only Runes subdivide;
// every other family is a single unlabelled subgroup.
function subgroupsOf(family, augments) {
  if (family !== 'Rune') return [{ label: null, augments }];
  const byKey = new Map(RUNE_SUBGROUPS.map((s) => [s.key, []]));
  for (const a of augments) byKey.get(runeSubfamily(a)).push(a);
  return RUNE_SUBGROUPS
    .map((s) => ({ label: s.label, augments: byKey.get(s.key) }))
    .filter((sg) => sg.augments.length);
}

// Rune tier progression, low -> high; non-rune families carry the single 'base'.
const TIER_RANK = { base: 0, lesser: 0, normal: 1, greater: 2, perfect: 3 };
// Short tier badge for the condensed other-tiers list ('base' has none).
const TIER_LABEL = { lesser: 'Lesser', normal: 'Normal', greater: 'Greater', perfect: 'Perfect', base: '' };

// Render a list of stat-text lines to HTML. Augment stat text carries the same
// "[Id|Display]" keyword markup as affix/implicit text, so it MUST go through
// renderGameText (which resolves tokens AND linkifies surface phrases) — the same
// path base-item implicits take (see baseItems.js). No raw markup leaks.
function renderLines(texts) {
  return (texts ?? []).map((t) => renderGameText(t, hasDefinition));
}

// One per-slot grant: the gear category it applies to, its stat lines, and the
// "bonded" bonus lines (the extra grant recorded in bonded_stat_text). The
// category label is itself linkified — some keys arrive as markup ("[MartialWeapon|
// Martial Weapon]") and all should surface glossary hovers.
function renderCategory(cat) {
  return {
    category: cat.category,
    categoryHtml: renderGameText(cat.category, hasDefinition),
    lines: renderLines(cat.statText),
    bondedLines: renderLines(cat.bondedStatText),
  };
}

// View model for one tier. `flatLines` is every category's DEFAULT lines flattened
// (no per-category label, no bonded) for the greatly-condensed other-tiers list.
function renderTier(t) {
  const categories = t.categories.map(renderCategory);
  return {
    tier: t.tier,
    tierLabel: TIER_LABEL[t.tier] ?? t.name,
    name: t.name,
    requiredLevel: t.requiredLevel,
    iconUrl: ddsUrl(t.iconDds),
    categories,
    flatLines: categories.flatMap((c) => c.lines),
  };
}

// View model for a single augment node. We display the highest (Perfect) tier by
// default — its name, icon, required level and grants must all agree, so everything
// reads off `primary` rather than mixing the node's base name with a tier's values.
// `otherTiers` lists the remaining tiers highest-first (greater → normal → lesser)
// for the condensed item-page tier list.
function toAugment(node) {
  const p = node.props;
  const tiers = [...p.tiers]
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]) // high → low
    .map(renderTier);
  const primary = tiers[0];
  const others = tiers.slice(1);
  return {
    id: node.id,
    slug: node.slug,
    sortName: node.name, // base name (no tier prefix) — for stable family sort
    name: primary.name,
    tierLabel: primary.tierLabel,
    family: p.family,
    familyLabel: p.familyLabel,
    limit: p.limit,
    requiredLevel: primary.requiredLevel,
    iconUrl: primary.iconUrl,
    placeholder: placeholder({ name: node.name }),
    stackSize: p.stackSize,
    flavourHtml: p.description ? renderGameText(p.description, hasDefinition) : null,
    categories: primary.categories,
    // Bonded modifiers isolated from the default grant — they apply only to the
    // Shaman ascendancy, but are surfaced for completeness (labelled in the card).
    bonded: primary.categories
      .filter((c) => c.bondedLines.length)
      .map((c) => ({ categoryHtml: c.categoryHtml, lines: c.bondedLines })),
    hasTiers: others.length > 0,
    // All tiers high→low (Perfect first) for the full hover tooltip; `otherTiers`
    // drops the shown primary for the condensed on-card list.
    allTiers: tiers,
    otherTiers: others,
  };
}

// Group augment view models by family in the stable FAMILY_ORDER; within a family,
// alphabetical by name. Any unexpected family (defensive — a future scrape adding a
// sixth type) is appended alphabetically rather than dropped.
function groupByFamily(augments) {
  const byFam = new Map();
  for (const a of augments) {
    if (!byFam.has(a.family)) byFam.set(a.family, []);
    byFam.get(a.family).push(a);
  }
  const groups = [];
  const emit = (fam) => {
    const list = byFam.get(fam);
    if (!list || !list.length) return;
    list.sort((a, b) => a.sortName.localeCompare(b.sortName));
    groups.push({
      family: fam,
      familyLabel: list[0].familyLabel,
      augments: list,
      subgroups: subgroupsOf(fam, list),
    });
    byFam.delete(fam);
  };
  for (const fam of FAMILY_ORDER) emit(fam);
  for (const fam of [...byFam.keys()].sort()) emit(fam);
  return groups;
}

// The augments that socket into an item class, grouped by family for display.
// `itemClassId` is the raw class id (e.g. "Body Armour"), matching the class node
// id `Class/<classId>` the sockets_into edges point at.
export function augmentsForClass(itemClassId) {
  if (!itemClassId) return [];
  const augments = edgesTo(`Class/${itemClassId}`, 'sockets_into')
    .map((e) => getNode(e.from))
    .filter(Boolean)
    .map(toAugment);
  return groupByFamily(augments);
}

// The augments that socket into a unique's base class. Accepts the unique view
// model (which already carries `itemClass`) or a unique slug/node id — both resolve
// to the same item class, then the same reverse lookup as a class page.
export function augmentsForUnique(uniqueOrSlug) {
  let itemClass;
  if (uniqueOrSlug && typeof uniqueOrSlug === 'object') {
    itemClass = uniqueOrSlug.itemClass;
  } else if (typeof uniqueOrSlug === 'string') {
    const node = nodeBySlug('unique', uniqueOrSlug) ?? getNode(uniqueOrSlug);
    itemClass = node?.props?.itemClass;
  }
  return augmentsForClass(itemClass);
}

// Full view model for one augment (all tiers, every category), by slug — backs the
// hover tooltip fragment (/augment/:slug/card). Returns null if the slug is unknown.
export function getAugmentVM(slug) {
  const node = nodeBySlug('augment', slug);
  return node ? toAugment(node) : null;
}

// Every augment as a view model — the flat list search + theorycraft index over.
export function listAugments() {
  return nodesByKind('augment').map(toAugment);
}
