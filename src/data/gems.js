import { loadJson } from './loader.js';
import { slugify } from './slug.js';
import { renderGameText } from './keywords.js';
import { ddsUrl } from './images.js';
import { displayTags } from './gemTags.js';
import { buildSections } from './statText.js';

const REPOE = 'repoe-poe2';

const TYPE_LABEL = { active: 'Skill', support: 'Support', spirit: 'Spirit' };

const RESERVATION_LABEL = { spirit: 'Spirit', mana: 'Mana', life: 'Life' };
const GEM_LEVEL_CAP = 20;
const SKILL_PANEL_FOOTER = 'Skills can be managed in the Skills Panel.';

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
    if (!_index.has(slug)) {
      _index.set(slug, { key, ...rec });
    } else if (_index.get(slug).gem_type !== rec.gem_type) {
      const existing = _index.get(slug);
      console.warn(
        `[gems] cross-type slug collision: "${slug}" — keeping ${existing.base_item.display_name} (${existing.gem_type}), skipping ${name} (${rec.gem_type})`
      );
    }
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

export function buildGemViewModel(slug) {
  const gem = getGem(slug);
  if (!gem) return null;

  const skills = loadJson(`${REPOE}/skills.json`);
  const skill = skills[gem.grants_skills?.[0]] ?? null;

  const b = BORDER[gem.color] ?? BORDER.w;

  // Type line: spirit gems keep their gem-type label ("Spirit") — their granted
  // skill's first type is an internal token ("HasReservation"), not player-facing.
  // For other gems, prefer the granted active skill's first type (e.g. "Buff"),
  // falling back to the gem-type label.
  const typeLine =
    gem.gem_type === 'spirit'
      ? (TYPE_LABEL.spirit ?? 'Spirit')
      : (skill?.active_skill?.types?.[0] ?? (TYPE_LABEL[gem.gem_type] ?? 'Skill'));

  // Tags as display names, excluding the one already shown as the type line.
  const tags = displayTags(gem.tags, [typeLine]);

  // Reservation, e.g. { spirit: 30 } -> "30 Spirit".
  let reservation = null;
  const res = skill?.static?.reservations;
  if (res) {
    const [kind, amount] = Object.entries(res)[0] ?? [];
    if (kind != null) reservation = `${amount} ${RESERVATION_LABEL[kind] ?? kind}`;
  }

  // Sections, with every line/quality string rendered to safe token HTML.
  const sections = buildSections(skill, GEM_LEVEL_CAP).map((s) => ({
    label: s.label,
    lines: s.lines.map(renderGameText),
    quality: s.quality.map(renderGameText),
  }));

  return {
    slug,
    name: gem.base_item.display_name,
    attribute: gem.color,
    gemType: gem.gem_type,
    borderColor: b.border,
    glowColor: b.glow,
    typeLine,
    tags,
    tier: gem.crafting_level ?? null,
    levelRange: { min: 1, max: GEM_LEVEL_CAP },
    reservation,
    skillIconUrl: ddsUrl(gem.icon_dds_file),
    hoverImageUrl: ddsUrl(gem.ui_image),
    description: skill?.active_skill?.description
      ? renderGameText(skill.active_skill.description)
      : null,
    sections,
    footer: skill?.active_skill ? SKILL_PANEL_FOOTER : null,
    recommendedSupports: getRecommendedSupports(gem),
  };
}
