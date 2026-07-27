import { slugify } from './slug.js';
import { ddsUrl } from './images.js';
import { tradeUrl } from './trade.js';
import { getGem } from './gems.js';
import { getBaseByName, listItemClasses } from './baseItems.js';
import { parseLocalMods, computeProperties } from './itemStats.js';
import { hasDefinition } from './keywordDefs.js';
import { linkifyPhrases, renderGameText } from './keywords.js';
import { nodesByKind, nodeBySlug, edgesFrom, edgesTo, getNode } from './graph.js';
import { augmentsForUnique } from './augments.js';

// Presentation adapter over the build-time graph (build/graph.json). Unique
// identity, variant resolution, resolved class/icon/flavour, and the has_base /
// grants relationships live in the graph (scripts/graph/uniques.js); this module
// reads `unique` nodes + edges and owns all rendering. It performs NO reads of
// $POE2DATADIR. The detail tooltip still derives item stats from the linked base
// (getBaseByName + parseLocalMods/computeProperties — already graph-backed).

const UNIQUE_BORDER = 'rgba(175,96,37,0.8)';
const UNIQUE_GLOW = 'rgba(175,96,37,0.45)';

// "Grants Skill: Name", "Grants Skill: Level (N-M) Name", or "Grants Skill: Level N Name".
const GRANTS_SKILL_RE = /^(Grants Skill: (?:Level (?:\([^)]+\)|\d+) )?)(.+)$/;

// Render affix text to safe HTML (value highlighting + keyword glossary hovers).
function renderAffix(text) {
  return linkifyPhrases(text, hasDefinition);
}

// Parse a stat line; for grant lines, attach a gemSlug + skill icon if the gem
// exists (rendering intentionally stays on the existing getGem(slug) lookup —
// the 70-linked / 2-unlinked split is unchanged from before the cutover).
function parseStatLine(text) {
  const m = text.match(GRANTS_SKILL_RE);
  if (!m) return { text, html: renderAffix(text) };
  const prefix = m[1];
  const skillName = m[2];
  const slug = slugify(skillName);
  const gem = getGem(slug);
  return {
    text,
    html: renderAffix(text),
    prefix,
    prefixHtml: renderAffix(prefix),
    skillName,
    gemSlug: gem ? slug : null,
    iconUrl: gem ? ddsUrl(gem.icon_dds_file) : null,
  };
}

// Reconstruct the legacy flat record from a unique graph node: current-variant
// stats + implicitCount, plus identity/icon/flavour. Keeps listUniques()/
// getUnique() stable for theorycraft.js and the card/VM builders.
function toUnique(node, variantIndex) {
  const p = node.props;
  // Default to the live variant; a reverse "granted by" lookup passes the index
  // of the variant that grants the looked-up skill. Guard against an out-of-range
  // index falling back to the default.
  const idx = (variantIndex != null && p.variants[variantIndex]) ? variantIndex : p.currentIndex;
  const cur = p.variants[idx];
  return {
    slug: node.slug,
    name: node.name,
    base: p.base,
    stats: [...cur.implicits, ...cur.explicits],
    itemClass: p.itemClass,
    iconUrl: ddsUrl(p.iconDds),
    flavour: p.flavour,
    implicitCount: cur.implicits.length,
    // Cultural origin (Kalguuran/Ezomyte/Vaal) where GGG assigns one, else null.
    // Overlay-derived (manual:unique-origins); see scripts/graph/manual.js.
    origin: p.origin ?? null,
    // Raw cultivated-mod display lines (RePoE "[Id|Display]" markup intact) — for
    // the search index. The rendered {text,html} form is built in the VMs.
    cultivatedText: (p.cultivatedMods ?? []).flatMap((m) => m.texts),
    // Pool-driven unique (no fixed mods). `base` is null for these, so baseLabel
    // carries the human-facing type line ("Any Body Armour") instead.
    isPool: !!p.isPool,
    baseLabel: p.baseLabel ?? null,
    // Raw pool-mod lines for the search index, mirroring cultivatedText.
    poolText: (p.poolMods ?? []).flatMap((m) => m.texts),
    tradeUrl: tradeUrl({ kind: 'unique', name: node.name, type: p.base }),
  };
}

// Cultivated (mutated Vaal) mods this unique can gain via the Vaal Cultivation
// Orb — overlay-derived (manual:cultivated-uniques), variant-independent. Each
// stored mod holds display-text line(s) carrying RePoE "[Id|Display]" keyword
// markup, so they render via renderGameText (resolves tokens + keyword hovers) —
// the same path base implicits use — NOT the plain-text affix renderer.
function renderCultivatedMods(node) {
  const cm = node.props.cultivatedMods;
  if (!cm || !cm.length) return [];
  return cm.flatMap((m) => m.texts).map((text) => ({ text, html: renderGameText(text, hasDefinition) }));
}

// --- Pool-driven uniques ----------------------------------------------------
// A few uniques (Loreweave, Grip of Kulemak, Flesh Crucible) have no fixed stat
// block at all: their mods are a POOL the item can draw from. They exist only as
// overlay-created nodes (manual:pool-uniques) because Path of Building's data
// format can't express them — see data/manual/pool-uniques.json.
//
// The presentation must not read as "this item has these mods". Which mods a
// finished copy receives, and how they're chosen, are NOT in the game data, so the
// pool renders under its own label with an explicit note, never as explicits.

// Minimal inline markup for the hand-authored note lines: **bold** and *italic*
// only, on escaped text, so the overlay can emphasize the uncertainty without the
// note becoming an HTML injection point.
function renderNote(line) {
  const escaped = String(line)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// Pool mods with their source unique resolved to a live slug. The link target
// comes from the node's `pool_source` edges rather than slugifying the stored
// name, so a rendered origin link can never point at a slug that doesn't exist.
function renderPoolMods(node) {
  const pool = node.props.poolMods;
  if (!pool || !pool.length) return [];
  const slugByName = new Map();
  for (const e of edgesFrom(node.id, 'pool_source')) {
    const src = getNode(e.to);
    if (src) slugByName.set(src.name, src.slug);
  }
  return pool.flatMap((m) => m.texts.map((text) => ({
    text,
    html: renderGameText(text, hasDefinition),
    sourceUnique: m.sourceUnique ?? null,
    sourceSlug: m.sourceUnique ? (slugByName.get(m.sourceUnique) ?? null) : null,
  })));
}

// Reverse of pool_source: the pool uniques whose pool draws on THIS unique — e.g.
// Snakepit gets "Weaves into: Loreweave". Empty for most uniques.
function wovenInto(node) {
  return edgesTo(node.id, 'pool_source')
    .map((e) => getNode(e.from))
    .filter(Boolean)
    .map((n) => ({ name: n.name, slug: n.slug, label: n.props.poolLabel ?? null }));
}

export function listUniques() {
  return nodesByKind('unique').map(toUnique);
}

export function getUnique(slug) {
  const node = nodeBySlug('unique', slug);
  return node ? toUnique(node) : null;
}

// Canonical item-class lookup keyed by class slug, built from the base-item layer
// so unique filters line up with the /bases class taxonomy. Lazily memoized.
let _canonClassBySlug = null;
function canonClassBySlug() {
  if (_canonClassBySlug) return _canonClassBySlug;
  _canonClassBySlug = new Map();
  for (const group of listItemClasses()) {
    for (const c of group.classes) {
      _canonClassBySlug.set(c.classSlug, { label: c.name, slug: c.classSlug, iconUrl: c.iconUrl });
    }
  }
  return _canonClassBySlug;
}

let _groupByClassSlug = null;
function groupByClassSlug() {
  if (_groupByClassSlug) return _groupByClassSlug;
  _groupByClassSlug = new Map();
  for (const group of listItemClasses()) {
    for (const c of group.classes) _groupByClassSlug.set(c.classSlug, group.label);
  }
  return _groupByClassSlug;
}

// Distinct item-class filter options present among the uniques, ordered by the
// canonical /bases group order (Weapons -> Armour -> Accessories), with any
// non-browsable extras (Charm, Flask, Jewel, …) appended alphabetically. The
// class is read straight off the node (resolved at build).
export function listUniqueClassFilters() {
  const canon = canonClassBySlug();
  const present = new Map(); // slug -> { value, label, icon }
  for (const node of nodesByKind('unique')) {
    const { className: label, classSlug: slug } = node.props;
    const iconUrl = ddsUrl(node.props.iconDds);
    if (!present.has(slug)) {
      present.set(slug, { value: slug, label, icon: canon.get(slug)?.iconUrl ?? iconUrl ?? null });
    } else if (!present.get(slug).icon && iconUrl) {
      present.get(slug).icon = iconUrl;
    }
  }
  const ordered = [];
  const seen = new Set();
  for (const group of listItemClasses()) {
    for (const c of group.classes) {
      if (present.has(c.classSlug)) {
        ordered.push(present.get(c.classSlug));
        seen.add(c.classSlug);
      }
    }
  }
  const extras = [...present.values()]
    .filter((e) => !seen.has(e.value))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...ordered, ...extras];
}

// Condensed view model for a single unique node: the /uniques browse-grid card,
// also reused for the "Granted by" section on a gem page (uniques that grant a
// gem's skill) and theorycraft results.
function uniqueCardVM(node, variantIndex) {
  const u = toUnique(node, variantIndex);
  const baseRecord = getBaseByName(u.base);
  const parsed = u.stats.map(parseStatLine);
  const mods = parseLocalMods(u.stats);
  const properties = baseRecord
    ? computeProperties(baseRecord.rawProperties, mods).map((p) => ({ ...p, labelHtml: renderAffix(p.label) }))
    : [];
  const group = groupByClassSlug().get(node.props.classSlug) ?? 'Other';
  return {
    slug: u.slug,
    name: u.name,
    base: u.base,
    itemClass: node.props.className,
    itemClassSlug: node.props.classSlug,
    group,
    groupSlug: group.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    iconUrl: u.iconUrl,
    // Pool uniques have no browsable base to size the icon box from, so fall back
    // to the inventory size RePoE records on the unique itself.
    inventorySize: baseRecord?.inventorySize ?? node.props.inventorySize ?? null,
    properties,
    requirements: baseRecord?.requirements ?? [],
    levelHint: baseRecord?.requirements?.[0] ?? 'No level requirement',
    implicits: parsed.slice(0, u.implicitCount),
    explicits: parsed.slice(u.implicitCount),
    origin: u.origin,
    isPool: u.isPool,
    baseLabel: u.baseLabel,
    poolLabel: node.props.poolLabel ?? null,
    poolMods: renderPoolMods(node),
    tradeUrl: u.tradeUrl,
  };
}

// Condensed view models for the /uniques browse grid.
export function listUniqueCards() {
  return nodesByKind('unique').map(uniqueCardVM);
}

// The browse-grid card for one unique by slug, or null if unknown. Lets other
// modules (e.g. gems.js "Granted by") render a real unique card without
// rebuilding the whole list. `variantIndex` selects a non-default variant — used
// by reverse "granted by" lookups so the card shows the variant that grants the
// looked-up skill rather than the item's default variant.
export function getUniqueCard(slug, variantIndex) {
  const node = nodeBySlug('unique', slug);
  return node ? uniqueCardVM(node, variantIndex) : null;
}

export function buildUniqueViewModel(slug) {
  const node = nodeBySlug('unique', slug);
  if (!node) return null;
  const u = toUnique(node);

  const baseRecord = getBaseByName(u.base);
  const mods = parseLocalMods(u.stats);
  const properties = baseRecord
    ? computeProperties(baseRecord.rawProperties, mods).map((p) => ({ ...p, labelHtml: renderAffix(p.label) }))
    : [];
  const requirements = baseRecord?.requirements ?? [];

  const parsedStats = u.stats.map(parseStatLine);
  const implicits = parsedStats.slice(0, u.implicitCount);
  const explicits = parsedStats.slice(u.implicitCount);

  return {
    ...u,
    stats: parsedStats,
    implicits,
    explicits,
    cultivatedMods: renderCultivatedMods(node),
    // Pool-driven unique: the craftable mod pool, its label, and the note that
    // spells out these are mods the item CAN have. `wideRangeCount` is how many of
    // them also exist as wider-range duplicates in the data (not listed — they'd
    // imply more distinct mods than there are).
    poolMods: renderPoolMods(node),
    poolLabel: node.props.poolLabel ?? null,
    poolNote: (node.props.poolNote ?? []).map(renderNote),
    wideRangeCount: node.props.wideRangeCount ?? 0,
    // Pool uniques whose pool draws on this unique (reverse pool_source).
    wovenInto: wovenInto(node),
    properties,
    requirements,
    // Prefer the base's display name ("Spears") over the raw item class ("Spear").
    // Pool uniques have no base record, so fall back to the canonical class the
    // builder resolved on the node before the raw class.
    className: baseRecord?.className ?? node.props.className ?? u.itemClass,
    classSlug: baseRecord?.classSlug ?? node.props.classSlug,
    borderColor: UNIQUE_BORDER,
    glowColor: UNIQUE_GLOW,
    // Canonical slug of the linked base, or null when the base isn't a browsable
    // node (charms/flasks/jewels and PoB variant-parse artifacts). The macro
    // renders the base as plain text rather than a dead link when this is null.
    baseSlug: baseRecord?.slug ?? null,
    // Socketables (augments) that slot into this unique's base class, grouped by
    // family — the reverse of the augment nodes' sockets_into edges.
    augments: augmentsForUnique(u),
  };
}
