// scripts/graph/gems.js
import { loadJson } from '../../src/data/loader.js';
import { REPOE } from '../../src/config.js';
import { slugify } from '../../src/data/slug.js';
import { grantedSkillNames } from '../../src/data/grantedSkills.js';

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
