// scripts/graph/uniques.js
//
// Build-time resolver for unique items. Parses the pob-uniques/*.json text blocks
// once, resolves the full set of PoB variants (implicit/explicit split per variant),
// joins to uniques.json metadata (id, icon, inventory size) and flavour text, and
// emits one `unique` node per source unique. Two edge kinds connect them:
// `has_base` (unique -> browsable base) and `grants` (unique -> granted skill).
//
// src/data/uniques.js consumes these nodes/edges and owns all rendering; it no
// longer reads $POE2DATADIR. grantedSkillNames() (formerly src/data/grantedSkills.js)
// folds in here as a pure source parse used by scripts/graph/gems.js origin
// classification — ported verbatim (same regex) to keep gem nodes byte-identical.
import path from 'node:path';
import { loadJson, listDataDir } from '../../src/data/loader.js';
import { REPOE } from '../../src/config.js';
import { slugify } from '../../src/data/slug.js';
import { getFlavourLines } from '../../src/data/flavour.js';
import { makeNode, makeEdge, KINDS, EDGE_TYPES } from './schema.js';
import { baseNodes } from './bases.js';

const POB_DIR = 'pob-uniques';

// PoB metadata line prefixes — not item stats (mirrors src/data/uniques.js).
// "Grants Skill:" is intentionally NOT here — it's a real granted-skill stat.
const META_COLON_RE = /^(Variant|Implicits|League|Source|Corrupted|Limited to|Drop level|Drop|Unreleased|Sockets|Radius|Has Alt Variant(?: Two| Three)?|Selected (?:Alt )?Variant(?: Two| Three)?|Left ring slot|Right ring slot):/;
const META_NOCOLON_RE = /^Requires\b/;
const isMetaLine = (line) => META_COLON_RE.test(line) || META_NOCOLON_RE.test(line);

// Matches "Grants Skill: Name", "Grants Skill: Level (N-M) Name", and
// "Grants Skill: Level N Name"; capture group 2 is the skill display name.
const GRANTS_SKILL_RE = /^(Grants Skill: (?:Level (?:\([^)]+\)|\d+) )?)(.+)$/;

// Strip all {…} tokens from a stat line to get clean display text.
function stripBraces(line) {
  return line.replace(/\{[^}]*\}/g, '').trim();
}

// {variant:1,3} -> [1,3] (1-based), or null when the line applies to all variants.
function variantSpec(line) {
  const m = line.match(/^\{variant:([^}]+)\}/);
  return m ? m[1].split(',').map(Number) : null;
}

// ---------------------------------------------------------------------------
// grantedSkillNames — verbatim port of the former src/data/grantedSkills.js.
// Keep the regex and all-lines scan identical: scripts/graph/gems.js uses this
// Set for gem-origin classification, and any change would shift gem nodes.
// ---------------------------------------------------------------------------
const LEGACY_GRANTS_RE = /^Grants Skill:\s*(?:Level \([^)]+\)\s*)?(.+)$/;
let _grantedNames = null;
export function grantedSkillNames() {
  if (_grantedNames) return _grantedNames;
  _grantedNames = new Set();
  for (const file of listDataDir(POB_DIR)) {
    if (file === '_manifest.json' || !file.endsWith('.json')) continue;
    const entries = loadJson(`${POB_DIR}/${file}`);
    if (!Array.isArray(entries)) continue;
    for (const text of entries) {
      if (typeof text !== 'string') continue;
      for (const raw of text.split('\n')) {
        const line = raw.replace(/\{[^}]*\}/g, '').trim();
        const m = line.match(LEGACY_GRANTS_RE);
        if (m) _grantedNames.add(m[1].trim());
      }
    }
  }
  return _grantedNames;
}

// ---------------------------------------------------------------------------
// PoB block parsing + variant resolution.
// ---------------------------------------------------------------------------

// Parse one block into { name, base, variantNames, stats, implicitCount } where
// `stats` are the raw (brace-prefixed) mod lines in source order. Returns null
// for manifest artifacts / malformed blocks (mirrors src/data/uniques.js).
function parseBlock(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const name = lines[0];
  const base = lines[1];
  if (name.includes(':') || name === 'source' || name === 'base_url') return null;

  const variantNames = lines
    .filter((l) => l.startsWith('Variant:'))
    .map((l) => l.slice('Variant:'.length).trim());

  const implicitsLine = lines.find((l) => /^Implicits:\s*\d+/.test(l));
  const implicitCount = implicitsLine ? Number(implicitsLine.match(/\d+/)[0]) : 0;

  const stats = lines.slice(2).filter((l) => !isMetaLine(l));
  return { name, base, variantNames, stats, implicitCount };
}

// For each variant index i (1-based), keep lines that apply (untagged, or whose
// {variant:…} list includes i), in source order, braces stripped. The first
// `implicitCount` are implicits, the rest explicits. A block with no Variant:
// lines resolves to a single variant (name null) over all untagged lines.
function resolveVariants({ variantNames, stats, implicitCount }) {
  const count = variantNames.length || 1;
  const variants = [];
  for (let i = 1; i <= count; i++) {
    const filtered = [];
    for (const line of stats) {
      const spec = variantSpec(line);
      if (spec && !spec.includes(i)) continue;
      const cleaned = stripBraces(line);
      if (cleaned) filtered.push(cleaned);
    }
    variants.push({
      name: variantNames[i - 1] ?? null,
      implicits: filtered.slice(0, implicitCount),
      explicits: filtered.slice(implicitCount),
    });
  }
  return variants;
}

// The live variant: the one named exactly "Current", else the last index.
function currentIndexOf(variants) {
  const idx = variants.findIndex((v) => v.name === 'Current');
  return idx >= 0 ? idx : variants.length - 1;
}

// Skill display names granted by a variant's "Grants Skill:" lines, in order.
function grantNamesOf(variant) {
  const out = [];
  for (const line of [...variant.implicits, ...variant.explicits]) {
    const m = line.match(GRANTS_SKILL_RE);
    if (m) out.push(m[2].trim());
  }
  return out;
}
