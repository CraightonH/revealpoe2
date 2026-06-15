import path from 'node:path';
import { loadJson, listDataDir } from './loader.js';
import { slugify } from './slug.js';
import { ddsUrl } from './images.js';
import { getGem } from './gems.js';
import { getBaseByName } from './baseItems.js';
import { parseLocalMods, computeProperties } from './itemStats.js';
import { getFlavourLines } from './flavour.js';
import { hasDefinition } from './keywordDefs.js';

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

// Curated surface-phrase → keyword-id map for affix text. The pob-uniques text
// has no [keyword] tokens (unlike gem skill text), so we detect known terms and
// make them hoverable via the existing .kw glossary tooltips. Longest phrases
// first so e.g. "Critical Hit" wins over "Hit"; gated by hasDefinition so dead
// keywords never become hovers.
const KEYWORD_PHRASES = [
  ['Critical Strike', 'Critical'], ['Critical Hits', 'Critical'], ['Critical Hit', 'Critical'],
  ['Energy Shield', 'EnergyShield'], ['Spear Skills', 'Spear'],
  ['Physical', 'Physical'], ['Fire', 'Fire'], ['Cold', 'Cold'],
  ['Lightning', 'Lightning'], ['Chaos', 'Chaos'],
  ['Attacks', 'Attack'], ['Attack', 'Attack'], ['Presence', 'Presence'],
  ['Spells', 'Spell'], ['Spell', 'Spell'], ['Projectiles', 'Projectile'], ['Projectile', 'Projectile'],
  ['Minions', 'Minion'], ['Minion', 'Minion'], ['Melee', 'Melee'],
  ['Spears', 'Spear'], ['Spear', 'Spear'], ['Hit', 'HitDamage'],
  ['Ignite', 'Ignite'], ['Bleeding', 'Bleeding'], ['Poison', 'Poison'],
  ['Freeze', 'Freeze'], ['Shock', 'Shock'], ['Chill', 'Chill'],
  ['Block', 'Block'], ['Curses', 'Curse'], ['Curse', 'Curse'], ['Auras', 'Aura'], ['Aura', 'Aura'],
].filter(([, id]) => hasDefinition(id));

const PHRASE_TO_ID = new Map(KEYWORD_PHRASES.map(([p, id]) => [p, id]));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUM_PAT = '\\(?\\d+(?:\\.\\d+)?(?:-\\d+(?:\\.\\d+)?)?\\)?';
const KW_PAT = KEYWORD_PHRASES.map(([p]) => p).sort((a, b) => b.length - a.length).map(escapeRe).join('|');
const AFFIX_RE = new RegExp(`(${NUM_PAT})|\\b(${KW_PAT})\\b`, 'g');

// Render affix text to safe HTML: numeric values → white .mod-value spans,
// known keywords → hoverable .kw spans, everything else escaped.
function renderAffix(text) {
  let out = '';
  let last = 0;
  let m;
  AFFIX_RE.lastIndex = 0;
  while ((m = AFFIX_RE.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out += `<span class="mod-value">${escapeHtml(m[1])}</span>`;
    } else {
      const id = PHRASE_TO_ID.get(m[2]);
      out += `<span class="kw" data-keyword="${escapeHtml(id)}">${escapeHtml(m[2])}</span>`;
    }
    last = AFFIX_RE.lastIndex;
  }
  out += escapeHtml(text.slice(last));
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
    if (META_RE.test(line)) continue;
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
