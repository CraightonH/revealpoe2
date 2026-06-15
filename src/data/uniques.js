import path from 'node:path';
import { loadJson, listDataDir } from './loader.js';
import { slugify } from './slug.js';
import { ddsUrl } from './images.js';
import { getGem } from './gems.js';
import { getBaseByName } from './baseItems.js';
import { parseLocalMods, computeProperties } from './itemStats.js';

const REPOE = 'repoe-poe2';
const POB_DIR = 'pob-uniques';

const UNIQUE_BORDER = 'rgba(175,96,37,0.8)';
const UNIQUE_GLOW = 'rgba(175,96,37,0.45)';

// PoB metadata line prefixes — not item stats
const META_RE = /^(Variant|Implicits|League|Source|Corrupted|Limited to|Drop level|Drop|Unreleased):/;

// "Grants Skill: Name" or "Grants Skill: Level (N-M) Name"
const GRANTS_SKILL_RE = /^(Grants Skill: (?:Level \([^)]+\) )?)(.+)$/;

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Wrap numeric values and ranges — e.g. "(100-120)", "1", "30" — in a
// .mod-value span so they render white, leaving the surrounding mod text blue.
function highlightValues(text) {
  return escapeHtml(text).replace(
    /\(?\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?\)?/g,
    (m) => `<span class="mod-value">${m}</span>`,
  );
}

// Parse a stat line; for grant lines, attach a gemSlug + skill icon if the gem
// exists. `html`/`prefixHtml` carry value-highlighted markup for | safe render.
function parseStatLine(text) {
  const m = text.match(GRANTS_SKILL_RE);
  if (!m) return { text, html: highlightValues(text) };
  const prefix = m[1];
  const skillName = m[2];
  const slug = slugify(skillName);
  const gem = getGem(slug);
  return {
    text,
    html: highlightValues(text),
    prefix,
    prefixHtml: highlightValues(prefix),
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
  const stats = [];

  for (const line of lines.slice(2)) {
    if (META_RE.test(line)) continue;
    const spec = variantSpec(line);
    // If this line is variant-gated and the current variant isn't listed, skip it.
    if (spec && !spec.includes(curVariant)) continue;
    const cleaned = stripBraces(line);
    if (cleaned) stats.push(cleaned);
  }

  return { name, base, stats };
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
      });
    }
  }

  return _index;
}

export function listUniques() {
  return [...index().values()];
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
  const properties = baseRecord ? computeProperties(baseRecord.rawProperties, mods) : [];
  const requirements = baseRecord?.requirements ?? [];

  // Grant lines ("Grants Skill: …") are implicits — shown above the explicit
  // affixes, separated by a divider (matching the in-game / poe2db layout).
  const parsedStats = u.stats.map(parseStatLine);
  const implicits = parsedStats.filter((s) => s.prefix);
  const explicits = parsedStats.filter((s) => !s.prefix);

  return {
    ...u,
    stats: parsedStats,
    implicits,
    explicits,
    properties,
    requirements,
    borderColor: UNIQUE_BORDER,
    glowColor: UNIQUE_GLOW,
    baseSlug: slugify(u.base),
  };
}
