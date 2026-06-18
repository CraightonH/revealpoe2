import path from 'node:path';
import { loadJson, listDataDir } from './loader.js';
import { slugify } from './slug.js';
import { ddsUrl } from './images.js';
import { getGem } from './gems.js';
import { getBaseByName, listItemClasses } from './baseItems.js';
import { parseLocalMods, computeProperties } from './itemStats.js';
import { getFlavourLines } from './flavour.js';
import { hasDefinition } from './keywordDefs.js';
import { escapeHtml, linkifyPhrases } from './keywords.js';
import { REPOE } from '../config.js';

const POB_DIR = 'pob-uniques';

const UNIQUE_BORDER = 'rgba(175,96,37,0.8)';
const UNIQUE_GLOW = 'rgba(175,96,37,0.45)';

// PoB metadata line prefixes — not item stats. These appear interspersed before
// the mod block; every one must be filtered or it leaks into `stats` and throws
// off the implicit/explicit split (which slices the first `Implicits: N` lines).
// NOTE: "Grants Skill:" is intentionally NOT here — it's a real granted-skill stat.
const META_COLON_RE = /^(Variant|Implicits|League|Source|Corrupted|Limited to|Drop level|Drop|Unreleased|Sockets|Radius|Has Alt Variant(?: Two| Three)?|Selected (?:Alt )?Variant(?: Two| Three)?|Left ring slot|Right ring slot):/;
// "Requires Level N" / "Requires N Str" appear WITHOUT a trailing colon.
const META_NOCOLON_RE = /^Requires\b/;
const isMetaLine = (line) => META_COLON_RE.test(line) || META_NOCOLON_RE.test(line);

// "Grants Skill: Name" or "Grants Skill: Level (N-M) Name"
const GRANTS_SKILL_RE = /^(Grants Skill: (?:Level \([^)]+\) )?)(.+)$/;

// Numeric values in affix text, e.g. "10", "1.5", "(100-150)" — highlighted as
// white .mod-value spans. Keyword phrases are handled by the shared linkifyPhrases.
const NUM_RE = /\(?\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?\)?/g;

// Render affix text to safe HTML: numeric values → white .mod-value spans; the
// text between numbers is run through the shared phrase linker so known glossary
// terms become hoverable .kw spans (and everything else is escaped).
function renderAffix(text) {
  let out = '';
  let last = 0;
  let m;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(text)) !== null) {
    out += linkifyPhrases(text.slice(last, m.index), hasDefinition);
    out += `<span class="mod-value">${escapeHtml(m[0])}</span>`;
    last = NUM_RE.lastIndex;
  }
  out += linkifyPhrases(text.slice(last), hasDefinition);
  return out;
}

// Parse a stat line; for grant lines, attach a gemSlug + skill icon if the gem
// exists. `html`/`prefixHtml` carry value-highlighted markup for | safe render.
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

// Count Variant: lines to determine the "current" variant index (last one = highest).
function currentVariantIndex(lines) {
  return lines.filter((l) => l.startsWith('Variant:')).length;
}

// Extract variant numbers from a {variant:N,M} prefix, or null if absent.
function variantSpec(line) {
  const m = line.match(/^\{variant:([^}]+)\}/);
  return m ? m[1].split(',').map(Number) : null;
}

// Strip all {…} tokens from a stat line to get clean display text.
function stripBraces(line) {
  return line.replace(/\{[^}]*\}/g, '').trim();
}

// Parse a pob-unique text block into a structured object, or null if invalid.
function parsePob(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const name = lines[0];
  const base = lines[1];

  // Reject manifest-artifact keys and anything that looks like a metadata field
  if (name.includes(':') || name === 'source' || name === 'base_url') return null;

  const curVariant = currentVariantIndex(lines);

  // PoB marks how many leading stat lines are implicits ("Implicits: N").
  const implicitsLine = lines.find((l) => /^Implicits:\s*\d+/.test(l));
  const implicitCount = implicitsLine ? Number(implicitsLine.match(/\d+/)[0]) : 0;

  const stats = [];
  for (const line of lines.slice(2)) {
    if (isMetaLine(line)) continue;
    const spec = variantSpec(line);
    // If this line is variant-gated and the current variant isn't listed, skip it.
    if (spec && !spec.includes(curVariant)) continue;
    const cleaned = stripBraces(line);
    if (cleaned) stats.push(cleaned);
  }

  return { name, base, stats, implicitCount };
}

// Build name → uniques.json entry mapping (skip alternate art).
function buildMetaByName() {
  const raw = loadJson(`${REPOE}/uniques.json`);
  const out = {};
  for (const v of Object.values(raw)) {
    if (!v.name || v.is_alternate_art) continue;
    if (!out[v.name]) out[v.name] = v;
  }
  return out;
}

let _index = null;

function index() {
  if (_index) return _index;

  const metaByName = buildMetaByName();
  _index = new Map();

  const files = listDataDir(POB_DIR);
  for (const file of files) {
    if (file === '_manifest.json' || !file.endsWith('.json')) continue;

    const entries = loadJson(`${POB_DIR}/${file}`);
    if (!Array.isArray(entries)) continue;

    for (const text of entries) {
      const parsed = parsePob(text);
      if (!parsed) continue;

      const slug = slugify(parsed.name);
      if (_index.has(slug)) continue;

      const meta = metaByName[parsed.name] ?? null;
      _index.set(slug, {
        slug,
        name: parsed.name,
        base: parsed.base,
        stats: parsed.stats,
        itemClass: meta?.item_class ?? path.basename(file, '.json'),
        iconUrl: ddsUrl(meta?.visual_identity?.dds_file),
        flavour: getFlavourLines(meta?.visual_identity?.id),
        implicitCount: parsed.implicitCount,
      });
    }
  }

  return _index;
}

export function listUniques() {
  return [...index().values()];
}

// Canonical item-class lookup (clean in-game class names + stable slugs),
// keyed by class slug. Built from the base-item layer so unique filters line up
// with the /bases class taxonomy. Lazily memoized.
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

// Resolve a unique's filterable item class. Prefer the base item's canonical
// class (clean plural name, e.g. "Two Hand Maces"); fall back to the unique's
// own item_class for bases that aren't browsable (charms, flasks, jewels) or
// whose base name doesn't resolve, normalizing to the canonical class when one
// matches by slug.
function classifyUnique(baseRecord, rawItemClass) {
  if (baseRecord) return { label: baseRecord.className, slug: baseRecord.classSlug };
  const slug = slugify(rawItemClass);
  return canonClassBySlug().get(slug) ?? { label: rawItemClass, slug };
}

// Distinct item-class filter options present among the uniques, ordered by the
// canonical /bases group order (Weapons → Armour → Accessories), with any
// non-browsable extras (Charm, Flask, Jewel, …) appended alphabetically.
export function listUniqueClassFilters() {
  const canon = canonClassBySlug();
  const present = new Map(); // slug -> { value, label, icon }  (filterBar option schema)
  for (const u of index().values()) {
    const { label, slug } = classifyUnique(getBaseByName(u.base), u.itemClass);
    if (!present.has(slug)) {
      // Generic class glyph: the canonical base-item rep icon when the class is
      // browsable, else fall back to a member unique's own art (charms, flasks,
      // jewels — classes with no browsable base).
      present.set(slug, { value: slug, label, icon: canon.get(slug)?.iconUrl ?? u.iconUrl ?? null });
    } else if (!present.get(slug).icon && u.iconUrl) {
      present.get(slug).icon = u.iconUrl;
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

// Condensed view models for the /uniques browse grid: enough to render the
// at-a-glance card (name, base, icon, inventory size for the icon box, and the
// parsed implicit/explicit mod lines). Lighter than the full detail VM — no
// derived item stats or flavour.
export function listUniqueCards() {
  return [...index().values()].map((u) => {
    const baseRecord = getBaseByName(u.base);
    const itemClass = classifyUnique(baseRecord, u.itemClass);
    const parsed = u.stats.map(parseStatLine);
    // Derived item stats (defences, damage) — base properties with the unique's
    // local mods applied, same as the full tooltip. Keyword-linked labels.
    const mods = parseLocalMods(u.stats);
    const properties = baseRecord
      ? computeProperties(baseRecord.rawProperties, mods).map((p) => ({ ...p, labelHtml: renderAffix(p.label) }))
      : [];
    return {
      slug: u.slug,
      name: u.name,
      base: u.base,
      itemClass: itemClass.label,
      itemClassSlug: itemClass.slug,
      iconUrl: u.iconUrl,
      inventorySize: baseRecord?.inventorySize ?? null,
      properties,
      implicits: parsed.slice(0, u.implicitCount),
      explicits: parsed.slice(u.implicitCount),
    };
  });
}

export function getUnique(slug) {
  return index().get(slug) ?? null;
}

export function buildUniqueViewModel(slug) {
  const u = getUnique(slug);
  if (!u) return null;

  // Derive in-game item stats from the base item with the unique's local mods
  // applied (e.g. base phys × increased phys%). Bases whose class isn't
  // browsable (jewels, flasks) have no record — properties/requirements stay empty.
  const baseRecord = getBaseByName(u.base);
  const mods = parseLocalMods(u.stats);
  // Keyword-link the property labels too (e.g. "Physical" in Physical Damage,
  // "Critical Hit" in Critical Hit Chance) — same .kw glossary treatment.
  const properties = baseRecord
    ? computeProperties(baseRecord.rawProperties, mods).map((p) => ({ ...p, labelHtml: renderAffix(p.label) }))
    : [];
  const requirements = baseRecord?.requirements ?? [];

  // Implicits (the leading PoB-flagged lines — granted skills, base implicit
  // mods) are shown above the explicit affixes, separated by a divider, as in
  // the in-game / poe2db layout.
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
    baseSlug: slugify(u.base),
  };
}
