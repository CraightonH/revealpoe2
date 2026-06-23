// scripts/graph/gems.js
import { loadJson } from '../../src/data/loader.js';
import { REPOE } from '../../src/config.js';
import { slugify } from '../../src/data/slug.js';
import { grantedSkillNames } from '../../src/data/grantedSkills.js';
import { makeNode, makeEdge, KINDS, EDGE_TYPES } from './schema.js';
import { buildSections } from '../../src/data/statText.js';

// Mirrors src/data/gems.js — placeholder/unreleased gem-table entries to drop.
const GARBAGE_RE = /Coming Soon|Removed Skill|Playtest|\{0\}/;
const SLUG_PRECEDENCE = ['active', 'support', 'spirit'];

// How a gem enters the game (see src/data/gems.js classifyOrigin for rationale).
function classifyOrigin(rec, baseTags) {
  if (rec.crafting_types != null) return 'gem';
  if (baseTags?.some((t) => t !== 'gem' && t.endsWith('_gem'))) return 'gem';
  if (rec.base_item.id?.includes('SkillGemPlayerDefault')) return 'item';
  if (grantedSkillNames().has(rec.base_item.display_name)) return 'item';
  return 'other';
}

export function selectGemRecords() {
  const gems = loadJson(`${REPOE}/skill_gems.json`);
  const baseItems = loadJson(`${REPOE}/base_items.json`);

  const byCombo = new Map();      // `${baseSlug}|${gem_type}` -> staged record
  const typesBySlug = new Map();  // baseSlug -> Set<gem_type>
  for (const [id, rec] of Object.entries(gems)) {
    const name = rec?.base_item?.display_name;
    if (!name) continue;
    if (name.includes('[DNT')) continue;
    if (GARBAGE_RE.test(name)) continue;
    const baseSlug = slugify(name);
    const combo = `${baseSlug}|${rec.gem_type}`;
    if (byCombo.has(combo)) continue;
    const origin = classifyOrigin(rec, baseItems[rec.base_item.id]?.tags);
    byCombo.set(combo, { id, origin, baseSlug, raw: rec });
    if (!typesBySlug.has(baseSlug)) typesBySlug.set(baseSlug, new Set());
    typesBySlug.get(baseSlug).add(rec.gem_type);
  }

  const out = [];
  for (const rec of byCombo.values()) {
    const types = typesBySlug.get(rec.baseSlug);
    let slug = rec.baseSlug;
    if (types.size > 1) {
      const primary = SLUG_PRECEDENCE.find((t) => types.has(t)) ?? rec.raw.gem_type;
      if (rec.raw.gem_type !== primary) slug = `${rec.baseSlug}-${rec.raw.gem_type}`;
    }
    out.push({ id: rec.id, slug, origin: rec.origin, raw: rec.raw });
  }
  return out;
}

const GEM_LEVEL_CAP = 20; // matches src/data/gems.js display cap

function effectSections(skill) {
  return buildSections(skill, GEM_LEVEL_CAP)
    .map((s) => ({ label: s.label, lines: s.lines, quality: s.quality }));
}

export function gemNodes() {
  const records = selectGemRecords();
  const skills = loadJson(`${REPOE}/skills.json`);
  const nodes = records.map((r) => {
    const skill = skills[r.raw.grants_skills?.[0]] ?? null;
    const sections = effectSections(skill);
    const props = {
      color: r.raw.color,
      gemType: r.raw.gem_type,
      origin: r.origin,
      tags: r.raw.tags ?? [],
      requirementWeights: r.raw.requirement_weights ?? null,
      craftingLevel: r.raw.crafting_level ?? null,
      iconDds: r.raw.icon_dds_file ?? null,
      grantsSkills: r.raw.grants_skills ?? [],
      effectSections: sections,
    };
    const search = [r.raw.base_item.display_name, r.raw.gem_type, ...sections.flatMap((s) => s.lines)]
      .join(' ').toLowerCase();
    return makeNode({
      id: r.id, kind: KINDS.GEM, name: r.raw.base_item.display_name, slug: r.slug, props, search,
    });
  });
  return { nodes, records };
}

export function skillNodes(records) {
  const skills = loadJson(`${REPOE}/skills.json`);
  const seen = new Set();
  const slugsSeen = new Set();
  const out = [];
  for (const r of records) {
    for (const key of r.raw.grants_skills ?? []) {
      if (seen.has(key)) continue;
      const skill = skills[key];
      if (!skill) continue;
      seen.add(key);
      // empty display_name in source; fall back to key so makeNode doesn't throw
      const name = skill.active_skill?.display_name || key;
      const nameSlug = slugify(name);
      // Some internal skills share identical display_name (e.g. "Command: {0}"); fall back
      // to slugifying the unique source key so validateGraph never sees duplicate slugs.
      // validateGraph is the safety net — it would throw if even the key-based slug collides.
      const slug = slugsSeen.has(nameSlug) ? slugify(key) : nameSlug;
      slugsSeen.add(slug);
      out.push(makeNode({
        id: key, kind: KINDS.SKILL, name, slug,
        props: { types: skill.active_skill?.types ?? [], description: skill.active_skill?.description ?? null },
        search: name.toLowerCase(),
      }));
    }
  }
  return out;
}

// NOTE: gemEdges resolves support/skill keys directly against nodeIds (raw source keys),
// which may differ from the app's getGemRefByKey path (slug-winner-only _byKey map) —
// the two are not assumed identical; parity is validated by the all-gems test in gems.test.js.
export function gemEdges(records, nodeIds) {
  const edges = [];
  for (const r of records) {
    for (const skillKey of r.raw.grants_skills ?? []) {
      if (nodeIds.has(skillKey)) {
        edges.push(makeEdge({ type: EDGE_TYPES.GRANTS, from: r.id, to: skillKey }));
      }
    }
    for (const supKey of r.raw.recommended_supports ?? []) {
      if (nodeIds.has(supKey)) {
        edges.push(makeEdge({ type: EDGE_TYPES.RECOMMENDS_SUPPORT, from: r.id, to: supKey }));
      }
    }
  }
  return edges;
}
