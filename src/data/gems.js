import { renderGameText, linkifyRequirement } from './keywords.js';
import { ddsUrl } from './images.js';
import { hasDefinition } from './keywordDefs.js';
import { ATTR_ABBR, ATTR_KEY, ATTR_ORDER } from './attributes.js';
import { getNode, nodeBySlug, nodesByKind, edgesFrom, edgesTo } from './graph.js';

// Presentation adapter over the graph artifact (build/graph.json). All gem/skill
// data resolution (identity, slugs, origins, effect sections, recommended
// supports) lives in the build-time graph; this module reads nodes/edges and
// owns *only* the view layer (renderGameText, borders, card layout). It performs
// no reads of $POE2DATADIR. See scripts/graph/gems.js for the resolution logic.

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

// Character-level requirement display range. Like ATTR_REQ_RANGE, the magnitude
// progression is not in the dataset; this is the observed reference range across
// gem levels 1–20, shown for every gem as a deliberate display approximation.
const CHAR_LEVEL_RANGE = { min: 1, max: 90 };

// Player-facing primary skill categories. A granted skill's `types`
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
function skillTypeLine(types) {
  for (const t of types ?? []) {
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
const REQ_BORDER_KEY = { str: 'r', dex: 'g', int: 'b' };

// Normalize a gem node into the record shape the rest of the app reads. Field
// names mirror the original raw record so existing consumers (uniques.js,
// theorycraft.js) and tests need no change; values come from the graph node.
function toGem(node) {
  if (!node) return null;
  const p = node.props;
  return {
    id: node.id,                 // source Metadata key (for edge traversal)
    slug: node.slug,
    name: node.name,
    base_item: { display_name: node.name },
    color: p.color,
    gem_type: p.gemType,
    origin: p.origin,
    tags: p.tags ?? [],
    requirement_weights: p.requirementWeights ?? null,
    crafting_level: p.craftingLevel ?? null,
    icon_dds_file: p.iconDds ?? null,
    gem_icon_dds: p.gemIconDds ?? null,
    ui_image: p.hoverDds ?? null,
    grants_skills: p.grantsSkills ?? [],
    effect_sections: p.effectSections ?? [],
    tagTokens: p.tagTokens ?? [],
  };
}

// Token strings for a gem's displayable tags, dropping any whose display name is
// in `exclude` (e.g. the one already shown as the type line). Tokens are now
// resolved at build time onto the node (formerly a runtime read of gem_tags.json).
function tagTokensExcluding(tagTokens, exclude = []) {
  const skip = new Set(exclude);
  return (tagTokens ?? []).filter((t) => !skip.has(t.display)).map((t) => t.token);
}

function reqKeys(weights) {
  if (!weights) return [];
  return ATTR_ORDER.filter((a) => weights[a]).map((a) => ATTR_KEY[a]);
}

// CSS class suffix for the browse-card left-border accent.
// Hybrid gems get a combo token (rg/rb/gb) instead of the socket color (w).
function cardColor(req, socketColor) {
  if (req.length === 2) {
    const has = (k) => req.includes(k);
    if (has('str') && has('dex')) return 'rg';
    if (has('str') && has('int')) return 'rb';
    if (has('dex') && has('int')) return 'gb';
  }
  if (req.length === 1) {
    if (req[0] === 'str') return 'r';
    if (req[0] === 'dex') return 'g';
    if (req[0] === 'int') return 'b';
  }
  return socketColor;
}

// The granted skill node for a gem record (the first grants_skills key that
// resolved to a skill node), or null.
function grantedSkillNode(gem) {
  const key = gem.grants_skills?.[0];
  return key ? getNode(key) : null;
}

export function listGems() {
  return nodesByKind('gem').map((node) => {
    const gem = toGem(node);
    const req = reqKeys(gem.requirement_weights);
    return {
      slug: gem.slug,
      name: gem.name,
      color: gem.color,
      cardColor: cardColor(req, gem.color),
      gemType: gem.gem_type,
      origin: gem.origin,
      iconUrl: ddsUrl(gem.icon_dds_file),
      req,
    };
  });
}

// Condensed view models for the /gems browse grid: the at-a-glance fields
// (type/tags, requirements, and the skill's effect lines) plus the filter
// metadata. Reads resolved effect sections from the graph; renders them here.
export function listGemCards() {
  return nodesByKind('gem').map((node) => {
    const gem = toGem(node);
    const skill = grantedSkillNode(gem);
    const req = reqKeys(gem.requirement_weights);
    const typeLine =
      gem.gem_type === 'spirit'
        ? (TYPE_LABEL.spirit ?? 'Spirit')
        : (skillTypeLine(skill?.props?.types) ?? (TYPE_LABEL[gem.gem_type] ?? 'Skill'));
    const tagTokens = tagTokensExcluding(gem.tagTokens, [typeLine]);
    const effect = gem.effect_sections
      .flatMap((s) => s.lines)
      .map((t) => renderGameText(t, hasDefinition));
    return {
      slug: gem.slug,
      name: gem.name,
      cardColor: cardColor(req, gem.color),
      gemType: gem.gem_type,
      origin: gem.origin,
      req,
      iconUrl: ddsUrl(gem.icon_dds_file),
      typeLineHtml: renderGameText(`[${typeLine}]`, hasDefinition),
      tags: tagTokens.map((t) => renderGameText(t, hasDefinition)),
      requirements: [
        `Level (${CHAR_LEVEL_RANGE.min}—${CHAR_LEVEL_RANGE.max})`,
        ...attributeRequirements(gem.requirement_weights),
      ].map((r) => linkifyRequirement(r, hasDefinition)),
      effect,
    };
  });
}

export function getGem(slug) {
  return toGem(nodeBySlug('gem', slug));
}

// Resolve a gem by its raw Metadata key (e.g. a passive node's `granted_skill`
// or a unique's grant) to a lightweight reference for linking. Returns null if
// the key is not a gem node.
export function getGemRefByKey(key) {
  const node = getNode(key);
  if (!node || node.kind !== 'gem') return null;
  return { slug: node.slug, name: node.name, iconUrl: ddsUrl(node.props.iconDds) };
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

// Chip accent color for a gem node: the requirement-derived attribute color
// (r/g/b or hybrid rg/rb/gb), falling back to the socket color. Matches the
// browse-card accent so a support with an attribute requirement isn't shown as
// a plain white chip just because its socket color is white.
function chipColor(node) {
  return cardColor(reqKeys(node.props.requirementWeights), node.props.color);
}

// Recommended supports for a gem, resolved via recommends_support edges. Each
// target gem node keeps its real (possibly collision-suffixed) slug.
export function getRecommendedSupports(gem) {
  const out = [];
  for (const edge of edgesFrom(gem.id, 'recommends_support')) {
    const node = getNode(edge.to);
    if (!node) continue;
    out.push({ slug: node.slug, name: node.name, color: chipColor(node) });
  }
  return out;
}

// The inverse of getRecommendedSupports: every gem that recommends THIS gem,
// resolved by walking the same recommends_support edges backwards. Only support
// gems have inbound edges, so this is empty for active skills. Sorted by name
// (the list can be large — supports are recommended by up to ~100 skills).
export function getRecommendedBy(gem) {
  const out = [];
  for (const edge of edgesTo(gem.id, 'recommends_support')) {
    const node = getNode(edge.from);
    if (!node) continue;
    out.push({ slug: node.slug, name: node.name, color: chipColor(node) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function buildGemViewModel(slug) {
  const gem = getGem(slug);
  if (!gem) return null;

  const skill = grantedSkillNode(gem);
  const sp = skill?.props ?? null;

  const req = reqKeys(gem.requirement_weights);
  const b  = BORDER[REQ_BORDER_KEY[req[0]] ?? gem.color] ?? BORDER.w;
  const b2 = req.length === 2 ? (BORDER[REQ_BORDER_KEY[req[1]]] ?? BORDER.w) : null;

  // Type line: spirit gems keep their gem-type label ("Spirit"); their granted
  // skill's first category is a buff/etc. but "Spirit" is the meaningful label.
  // Other gems use the first player-facing category from the granted skill,
  // falling back to the gem-type label.
  const typeLine =
    gem.gem_type === 'spirit'
      ? (TYPE_LABEL.spirit ?? 'Spirit')
      : (skillTypeLine(sp?.types) ?? (TYPE_LABEL[gem.gem_type] ?? 'Skill'));

  // Tag tokens, excluding the one already shown as the type line; rendered to
  // gated keyword HTML so defined tags become hoverable.
  const tagTokens = tagTokensExcluding(gem.tagTokens, [typeLine]);

  // Reservation, e.g. { kind: 'spirit', amount: 30 } -> "30 Spirit".
  let reservation = null;
  if (sp?.reservation) {
    const { kind, amount } = sp.reservation;
    reservation = `${amount} ${RESERVATION_LABEL[kind] ?? kind}`;
  }

  // Sections (resolved plain strings from the graph), each line/quality string
  // rendered to safe token HTML here.
  const sections = gem.effect_sections.map((s) => ({
    label: s.label,
    lines: s.lines.map((t) => renderGameText(t, hasDefinition)),
    quality: s.quality.map((t) => renderGameText(t, hasDefinition)),
  }));

  return {
    slug,
    name: gem.name,
    attribute: gem.color,
    gemType: gem.gem_type,
    borderColor: b.border,
    glowColor: b.glow,
    borderColor2: b2?.border ?? null,
    glowColor2: b2?.glow ?? null,
    typeLine,
    typeLineHtml: renderGameText(`[${typeLine}]`, hasDefinition),
    tags: tagTokens.map((t) => renderGameText(t, hasDefinition)),
    tier: gem.crafting_level ?? null,
    // Fixed display range (not derived per-gem) — see GEM_LEVEL_CAP.
    levelRange: { min: 1, max: GEM_LEVEL_CAP },
    reservation,
    // Every gem shows a character-level requirement; attribute lines follow when present.
    requirements: [
      `Level (${CHAR_LEVEL_RANGE.min}—${CHAR_LEVEL_RANGE.max})`,
      ...attributeRequirements(gem.requirement_weights),
    ].map((r) => linkifyRequirement(r, hasDefinition)),
    skillIconUrl: ddsUrl(gem.icon_dds_file),
    gemIconUrl: ddsUrl(gem.gem_icon_dds),
    hoverImageUrl: ddsUrl(gem.ui_image),
    description: sp?.description
      ? renderGameText(sp.description, hasDefinition)
      : null,
    sections,
    footer: sp?.isActiveSkill ? SKILL_PANEL_FOOTER : null,
    recommendedSupports: getRecommendedSupports(gem),
    // Reverse of recommendedSupports: skills that recommend this support gem.
    // Same edges walked backwards — populated only for support gems.
    recommendedBy: getRecommendedBy(gem),
  };
}
