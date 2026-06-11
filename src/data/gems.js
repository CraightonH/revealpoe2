import { loadJson } from './loader.js';
import { slugify } from './slug.js';
import { renderGameText } from './keywords.js';
import { ddsUrl } from './images.js';
import { displayTags } from './gemTags.js';
import { buildSections } from './statText.js';

const REPOE = 'repoe-poe2';

const TYPE_LABEL = { active: 'Skill', support: 'Support', spirit: 'Spirit' };

const RESERVATION_LABEL = { spirit: 'Spirit', mana: 'Mana', life: 'Life' };
const GEM_LEVEL_CAP = 20; // fixed display cap (plan data fact: "Display level cap: 20")
const SKILL_PANEL_FOOTER = 'Skills can be managed in the Skills Panel.';

// Attribute requirement display. The dataset carries requirement_weights (the
// proportional split) but NOT the magnitude progression. ATTR_REQ_RANGE is the
// observed pure-attribute range from the reference card (gem levels 1–20); it is
// split proportionally by weight, analogous to the fixed levelRange. Adjust the
// bounds here if the true values differ — they are a deliberate display approximation.
const ATTR_REQ_RANGE = { min: 4, max: 157 };
const ATTR_ABBR = { strength: 'Str', dexterity: 'Dex', intelligence: 'Int' };
const ATTR_ORDER = ['strength', 'dexterity', 'intelligence'];

// Character-level requirement display range. Like ATTR_REQ_RANGE, the magnitude
// progression is not in the dataset; this is the observed reference range across
// gem levels 1–20, shown for every gem as a deliberate display approximation.
const CHAR_LEVEL_RANGE = { min: 1, max: 90 };

// Player-facing primary skill categories. A granted skill's `active_skill.types`
// interleaves internal mechanic/descriptor tokens (OngoingSkill, Trappable, Fire,
// Area, ...) with its primary category; we take the first token that maps to a
// category label here, preserving the game's own ordering. Verb-form categories
// (e.g. "SummonsTotem") map to their player-facing noun ("Totem").
const SKILL_TYPE_CATEGORY = {
  Attack: 'Attack', Spell: 'Spell', Minion: 'Minion', Buff: 'Buff',
  Aura: 'Aura', Herald: 'Herald', Curse: 'Curse', Mark: 'Mark',
  Warcry: 'Warcry', Banner: 'Banner', Companion: 'Companion',
  Offering: 'Offering', Channel: 'Channel', Movement: 'Movement',
  Travel: 'Travel', Slam: 'Slam', Nova: 'Nova', Grenade: 'Grenade',
  Projectile: 'Projectile', Melee: 'Melee',
  SummonsTotem: 'Totem', SummonsAttackTotem: 'Totem',
};

// First player-facing category among a skill's types, or null if none.
function skillTypeLine(skill) {
  for (const t of skill?.active_skill?.types ?? []) {
    if (t in SKILL_TYPE_CATEGORY) return SKILL_TYPE_CATEGORY[t];
  }
  return null;
}

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

// Attribute requirement lines from requirement_weights, e.g. {strength:100} ->
// ['(4—157) Str']; {strength:50,dexterity:50} -> ['(2—79) Str','(2—79) Dex'].
// Returns [] when there is no attribute requirement (all-zero or missing weights).
export function attributeRequirements(weights) {
  if (!weights) return [];
  const out = [];
  for (const attr of ATTR_ORDER) {
    const w = weights[attr];
    if (!w) continue;
    const min = Math.round((ATTR_REQ_RANGE.min * w) / 100);
    const max = Math.round((ATTR_REQ_RANGE.max * w) / 100);
    out.push(`(${min}—${max}) ${ATTR_ABBR[attr]}`);
  }
  return out;
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

  // Type line: spirit gems keep their gem-type label ("Spirit"); their granted
  // skill's first category is a buff/etc. but "Spirit" is the meaningful label.
  // Other gems use the first player-facing category from the granted skill,
  // falling back to the gem-type label.
  const typeLine =
    gem.gem_type === 'spirit'
      ? (TYPE_LABEL.spirit ?? 'Spirit')
      : (skillTypeLine(skill) ?? (TYPE_LABEL[gem.gem_type] ?? 'Skill'));

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
    // Fixed display range (not derived per-gem) — see GEM_LEVEL_CAP.
    levelRange: { min: 1, max: GEM_LEVEL_CAP },
    reservation,
    // Every gem shows a character-level requirement; attribute lines follow when present.
    requirements: [
      `Level (${CHAR_LEVEL_RANGE.min}—${CHAR_LEVEL_RANGE.max})`,
      ...attributeRequirements(gem.requirement_weights),
    ],
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
