import { slugify } from './slug.js';
import { ddsUrl } from './images.js';
import { getGem } from './gems.js';
import { getBaseByName, listItemClasses } from './baseItems.js';
import { parseLocalMods, computeProperties } from './itemStats.js';
import { hasDefinition } from './keywordDefs.js';
import { linkifyPhrases } from './keywords.js';
import { nodesByKind, nodeBySlug, edgesTo, getNode } from './graph.js';

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
function toUnique(node) {
  const p = node.props;
  const cur = p.variants[p.currentIndex];
  return {
    slug: node.slug,
    name: node.name,
    base: p.base,
    stats: [...cur.implicits, ...cur.explicits],
    itemClass: p.itemClass,
    iconUrl: ddsUrl(p.iconDds),
    flavour: p.flavour,
    implicitCount: cur.implicits.length,
  };
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
function uniqueCardVM(node) {
  const u = toUnique(node);
  const baseRecord = getBaseByName(u.base);
  const parsed = u.stats.map(parseStatLine);
  const mods = parseLocalMods(u.stats);
  const properties = baseRecord
    ? computeProperties(baseRecord.rawProperties, mods).map((p) => ({ ...p, labelHtml: renderAffix(p.label) }))
    : [];
  return {
    slug: u.slug,
    name: u.name,
    base: u.base,
    itemClass: node.props.className,
    itemClassSlug: node.props.classSlug,
    iconUrl: u.iconUrl,
    inventorySize: baseRecord?.inventorySize ?? null,
    properties,
    requirements: baseRecord?.requirements ?? [],
    implicits: parsed.slice(0, u.implicitCount),
    explicits: parsed.slice(u.implicitCount),
  };
}

// Condensed view models for the /uniques browse grid.
export function listUniqueCards() {
  return nodesByKind('unique').map(uniqueCardVM);
}

// The browse-grid card for one unique by slug, or null if unknown. Lets other
// modules (e.g. gems.js "Granted by") render a real unique card without
// rebuilding the whole list.
export function getUniqueCard(slug) {
  const node = nodeBySlug('unique', slug);
  return node ? uniqueCardVM(node) : null;
}

export function buildUniqueViewModel(slug) {
  const u = getUnique(slug);
  if (!u) return null;

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
    properties,
    requirements,
    // Prefer the base's display name ("Spears") over the raw item class ("Spear").
    className: baseRecord?.className ?? u.itemClass,
    borderColor: UNIQUE_BORDER,
    glowColor: UNIQUE_GLOW,
    // Canonical slug of the linked base, or null when the base isn't a browsable
    // node (charms/flasks/jewels and PoB variant-parse artifacts). The macro
    // renders the base as plain text rather than a dead link when this is null.
    baseSlug: baseRecord?.slug ?? null,
  };
}
