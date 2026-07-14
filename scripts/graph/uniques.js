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
import { loadJson, listDataDir } from './loader.js';
import { REPOE } from './source.js';
import { slugify } from '../../src/data/slug.js';
import { getFlavourLines } from './flavour.js';
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

// For each skill this unique grants, the variant index whose card best
// represents the grant in a reverse "granted by" lookup: the current/default
// variant when it grants the skill (so always-granted skills keep the canonical
// item view), else the first variant that does (so a variant-gated grant — e.g.
// The Unborn Lich's per-variant skills — renders the variant that actually
// grants the looked-up skill, not the unrelated default). Returns [{name, variantIndex}].
function grantsWithVariant(variants, currentIndex) {
  const idxsByName = new Map(); // skill name -> [variant indices that grant it]
  variants.forEach((v, i) => {
    for (const name of grantNamesOf(v)) {
      if (!idxsByName.has(name)) idxsByName.set(name, []);
      idxsByName.get(name).push(i);
    }
  });
  return [...idxsByName].map(([name, idxs]) => ({
    name,
    variantIndex: idxs.includes(currentIndex) ? currentIndex : idxs[0],
  }));
}

// ---------------------------------------------------------------------------
// uniqueNodes — Task 2
// ---------------------------------------------------------------------------

// uniques.json metadata keyed by display name (skip alternate art; first wins).
function buildMetaByName() {
  const raw = loadJson(`${REPOE}/uniques.json`);
  const out = {};
  for (const v of Object.values(raw)) {
    if (!v.name || v.is_alternate_art) continue;
    if (!out[v.name]) out[v.name] = v;
  }
  return out;
}

// Base-class lookup derived from the base nodes: display name -> canonical
// {className, classSlug}, plus classSlug -> className for the non-browsable
// normalization fallback. Computed once.
let _baseClass = null;
function baseClassIndex() {
  if (_baseClass) return _baseClass;
  const { nodes } = baseNodes();
  const byName = new Map();
  const canonBySlug = new Map();
  for (const n of nodes) {
    if (!byName.has(n.name)) byName.set(n.name, { className: n.props.className, classSlug: n.props.classSlug });
    if (!canonBySlug.has(n.props.classSlug)) canonBySlug.set(n.props.classSlug, n.props.className);
  }
  _baseClass = { byName, canonBySlug };
  return _baseClass;
}

// Filterable item class (graph rule: resolved at build). Browsable base -> the
// base's canonical class; otherwise the unique's own item_class normalized to a
// canonical class by slug when one matches, else raw (charms, flasks, jewels).
function classify(baseName, rawItemClass) {
  const { byName, canonBySlug } = baseClassIndex();
  const b = byName.get(baseName);
  if (b) return { className: b.className, classSlug: b.classSlug };
  const slug = slugify(rawItemClass);
  const canon = canonBySlug.get(slug);
  return canon ? { className: canon, classSlug: slug } : { className: rawItemClass, classSlug: slug };
}

export function uniqueNodes() {
  const metaByName = buildMetaByName();
  const nodes = [];
  const records = [];
  const seenSlug = new Set();
  for (const file of listDataDir(POB_DIR)) {
    if (file === '_manifest.json' || !file.endsWith('.json')) continue;
    const entries = loadJson(`${POB_DIR}/${file}`);
    if (!Array.isArray(entries)) continue;
    for (const text of entries) {
      const parsed = parseBlock(text);
      if (!parsed) continue;
      const slug = slugify(parsed.name);
      if (seenSlug.has(slug)) continue; // same-name dedup: keep first
      seenSlug.add(slug);

      const meta = metaByName[parsed.name] ?? null;
      const id = meta?.id ? `Unique/${meta.id}` : `Unique/${slug}`;
      const rawItemClass = meta?.item_class ?? path.basename(file, '.json');
      const { className, classSlug } = classify(parsed.base, rawItemClass);
      const variants = resolveVariants(parsed);
      const currentIndex = currentIndexOf(variants);
      const flavour = getFlavourLines(meta?.visual_identity?.id);

      const props = {
        base: parsed.base,
        itemClass: rawItemClass,
        className,
        classSlug,
        vid: meta?.visual_identity?.id ?? null,
        iconDds: meta?.visual_identity?.dds_file ?? null,
        flavour,
        inventorySize: meta ? { w: meta.inventory_width, h: meta.inventory_height } : null,
        currentIndex,
        variants,
      };

      const cur = variants[currentIndex];
      const search = [parsed.name, parsed.base, className, ...cur.implicits, ...cur.explicits, ...(flavour ?? [])]
        .join(' ')
        .toLowerCase();

      // Grant edges span EVERY variant, not just the live one: a variant-gated
      // unique (e.g. The Unborn Lich, one granted skill per variant) genuinely
      // *can* grant each, so "what grants this skill" must see them all. Each
      // grant also carries the variant index that grants it, so a reverse lookup
      // can render the matching variant rather than the default.
      const grants = grantsWithVariant(variants, currentIndex);

      nodes.push(makeNode({ id, kind: KINDS.UNIQUE, name: parsed.name, slug, props, search }));
      records.push({ id, slug, name: parsed.name, base: parsed.base, grants });
    }
  }
  return { nodes, records };
}

// ---------------------------------------------------------------------------
// uniqueEdges — Task 3
// ---------------------------------------------------------------------------

export function uniqueEdges(records, baseRecords, skillNodes) {
  // Mirror getBaseByName's name index (FIRST write wins, per baseItems.js) so the
  // has_base reverse edge resolves to the same browsable base the forward
  // getBaseByName path does; non-browsable bases (jewels/flasks/charms) are
  // simply absent -> no edge.
  const baseIdByName = new Map();
  for (const r of baseRecords) if (!baseIdByName.has(r.raw.name)) baseIdByName.set(r.raw.name, r.id);
  const skillIdBySlug = new Map(skillNodes.map((n) => [n.slug, n.id]));

  const edges = [];
  for (const r of records) {
    const baseId = baseIdByName.get(r.base);
    if (baseId) edges.push(makeEdge({ type: EDGE_TYPES.HAS_BASE, from: r.id, to: baseId }));
    for (const { name, variantIndex } of r.grants) {
      const skillId = skillIdBySlug.get(slugify(name));
      if (skillId) edges.push(makeEdge({ type: EDGE_TYPES.GRANTS, from: r.id, to: skillId, props: { variantIndex } }));
    }
  }
  return edges;
}
