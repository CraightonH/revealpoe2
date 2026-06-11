import { loadJson } from './loader.js';
import { slugify } from './slug.js';
import { renderGameText } from './keywords.js';
import { ddsUrl } from './images.js';

const REPOE = 'repoe-poe2';

const BORDER = {
  r: { border: 'rgba(139,48,48,0.7)', glow: 'rgba(139,48,48,0.45)' },
  g: { border: 'rgba(48,100,48,0.7)', glow: 'rgba(48,100,48,0.45)' },
  b: { border: 'rgba(48,48,139,0.7)', glow: 'rgba(48,48,139,0.45)' },
  w: { border: 'rgba(100,100,100,0.7)', glow: 'rgba(100,100,100,0.45)' },
};

let _index = null;

function index() {
  if (_index) return _index;
  const gems = loadJson(`${REPOE}/skill_gems.json`);
  _index = new Map();
  for (const [key, rec] of Object.entries(gems)) {
    const name = rec?.base_item?.display_name;
    if (!name) continue;
    const slug = slugify(name);
    if (!_index.has(slug)) _index.set(slug, { key, ...rec });
  }
  return _index;
}

export function listGems() {
  return [...index().entries()].map(([slug, rec]) => ({
    slug,
    name: rec.base_item.display_name,
    color: rec.color,
    gemType: rec.gem_type,
  }));
}

export function getGem(slug) {
  return index().get(slug) ?? null;
}

export function getRecommendedSupports(gem) {
  const gems = loadJson(`${REPOE}/skill_gems.json`);
  const out = [];
  for (const key of gem.recommended_supports ?? []) {
    const rec = gems[key];
    if (!rec?.base_item?.display_name) continue;
    out.push({
      slug: slugify(rec.base_item.display_name),
      name: rec.base_item.display_name,
      color: rec.color,
    });
  }
  return out;
}

function explicitMods(gem) {
  const grants = gem.grants_skills?.[0];
  if (!grants) return { description: null, mods: [] };
  const skills = loadJson(`${REPOE}/skills.json`);
  const skill = skills[grants];
  if (!skill) return { description: null, mods: [] };
  const description = skill.active_skill?.description ?? null;
  const set = skill.stat_sets?.[0];
  const statText = set?.static?.stat_text ?? {};
  const mods = Object.values(statText).filter((t) => t && t.trim().length > 0);
  return { description, mods };
}

export function buildGemViewModel(slug) {
  const gem = getGem(slug);
  if (!gem) return null;
  const { description, mods } = explicitMods(gem);
  const b = BORDER[gem.color] ?? BORDER.w;
  return {
    slug,
    name: gem.base_item.display_name,
    attribute: gem.color,
    gemType: gem.gem_type,
    borderColor: b.border,
    glowColor: b.glow,
    typeLine: gem.gem_type === 'support' ? 'Support' : 'Skill',
    tags: gem.tags ?? [],
    craftingLevel: gem.crafting_level ?? null,
    skillIconUrl: ddsUrl(gem.icon_dds_file),
    hoverImageUrl: ddsUrl(gem.ui_image),
    description: description ? renderGameText(description) : null,
    mods: mods.map(renderGameText),
    supportText: gem.support_text ? renderGameText(gem.support_text) : null,
    recommendedSupports: getRecommendedSupports(gem),
  };
}
