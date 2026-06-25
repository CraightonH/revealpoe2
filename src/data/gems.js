import { renderGameText, linkifyRequirement } from './keywords.js';
import { ddsUrl } from './images.js';
import { hasDefinition } from './keywordDefs.js';
import { ATTR_ABBR, ATTR_KEY, ATTR_ORDER } from './attributes.js';
import { getNode, nodeBySlug, nodesByKind, edgesFrom, edgesTo } from './graph.js';
import { getUniqueCard } from './uniques.js';
import { getPassiveNode } from './passiveTree.js';

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

// Condensed view model for a single gem node: the at-a-glance fields
// (type/tags, requirements, and the skill's effect lines) plus the filter
// metadata. Drives the /gems browse grid and any other gemBrowseCard usage
// (e.g. recommended supports on the gem detail page).
function gemBrowseCardVM(node) {
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
}

// Condensed view models for the /gems browse grid.
export function listGemCards() {
  return nodesByKind('gem').map(gemBrowseCardVM);
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

// Recommended supports for a gem, resolved via recommends_support edges.
// Returns full browse-card view models so they render identically to /gems
// (with the same hover tooltip via data-card-url).
export function getRecommendedSupports(gem) {
  const out = [];
  for (const edge of edgesFrom(gem.id, 'recommends_support')) {
    const node = getNode(edge.to);
    if (!node) continue;
    out.push(gemBrowseCardVM(node));
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
    out.push(gemBrowseCardVM(node));
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Every non-gem node that grants this skill (the reverse of the `grants` edge).
// Two edge topologies converge here and both must be walked:
//   • unique items grant the shared *skill* node — gem→skill→source
//   • passives grant the *gem* node directly       — source→gem
// so we collect inbound grants on the gem itself AND on each skill it grants.
// Gems are excluded — a gem granting its own skill is not an external source.
// Deduped by node id. Callers filter by kind and build the appropriate card.
function getGrantingSourceNodes(gem) {
  const seen = new Set();
  const out = [];
  const collect = (id) => {
    for (const edge of edgesTo(id, 'grants')) {
      const node = getNode(edge.from);
      if (!node || node.kind === 'gem' || seen.has(node.id)) continue;
      seen.add(node.id);
      out.push(node);
    }
  };
  collect(gem.id); // passives grant the gem node directly
  for (const e of edgesFrom(gem.id, 'grants')) collect(e.to); // uniques grant the skill node
  return out;
}

// Unique items that grant this gem's skill. Returns full browse cards, deduped
// by slug and sorted by name. Empty for the common (gem-only) case.
export function getGrantingUniques(gem) {
  const seen = new Set();
  const out = [];
  for (const node of getGrantingSourceNodes(gem)) {
    if (node.kind !== 'unique' || seen.has(node.slug)) continue;
    seen.add(node.slug);
    const card = getUniqueCard(node.slug);
    if (card) out.push(card);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Passive nodes (keystones, notables, ascendancy notables) that grant this gem.
// Returns passive browse records (name, icon, stat lines, ascendancy theming),
// sorted by name. Empty unless the skill has a passive-tree source.
export function getGrantingPassives(gem) {
  const out = [];
  for (const node of getGrantingSourceNodes(gem)) {
    if (node.kind !== 'passive') continue;
    const rec = getPassiveNode(node.slug);
    if (rec) out.push(rec);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Weapon classes whose default attack is this skill gem — the reverse of the
// derived `default_skill` overlay edge (see CLAUDE.md "Data Provenance" policy;
// this relationship is hand-authored in data/manual, not from source). Equipping
// any weapon of these classes grants the skill. Rather than list every base, we
// roll the edges up to /bases class nav cards (name, icon, base count, link).
// Empty for non-default gems.
export function getDefaultSkillClasses(gem) {
  const byClass = new Map(); // classSlug -> { name, slug, href, iconUrl, count }
  for (const edge of edgesTo(gem.id, 'default_skill')) {
    const node = getNode(edge.from);
    if (!node || node.kind !== 'base') continue;
    const slug = node.props.classSlug;
    if (!byClass.has(slug)) {
      byClass.set(slug, {
        name: node.props.className,
        slug,
        href: `/bases/${slug}`,
        // Representative class icon: the first base seen, mirroring /bases.
        iconUrl: ddsUrl(node.props.iconDds),
        count: 0,
      });
    }
    byClass.get(slug).count += 1;
  }
  return [...byClass.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Forward side of the default_skill overlay edge, for the /bases/:class page:
// the default-attack gem(s) granted by equipping any weapon of the class. Walks
// class -> in_class -> bases -> default_skill -> gem, deduped. Returns gem browse
// cards so the class page renders them identically to /gems. Empty for classes
// with no default-attack mapping (armour, caster weapons, etc.).
export function getDefaultSkillGemsForClass(classSlug) {
  const classNode = nodeBySlug('class', classSlug);
  if (!classNode) return [];
  const gemIds = new Set();
  for (const e of edgesTo(classNode.id, 'in_class')) {
    for (const ds of edgesFrom(e.from, 'default_skill')) gemIds.add(ds.to);
  }
  const out = [];
  for (const gemId of gemIds) {
    const node = getNode(gemId);
    if (node && node.kind === 'gem') out.push(gemBrowseCardVM(node));
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
    // Sources that grant this gem's skill (reverse of the grants edge). Usually
    // empty; uniques and passive-tree nodes are rendered as separate groups.
    grantedBy: getGrantingUniques(gem),
    grantedByPassives: getGrantingPassives(gem),
    // Weapon classes whose default attack is this gem (reverse of the derived
    // default_skill overlay edge). Populated only for default weapon skills.
    defaultSkillClasses: getDefaultSkillClasses(gem),
    recommendedSupports: getRecommendedSupports(gem),
    // Reverse of recommendedSupports: skills that recommend this support gem.
    // Same edges walked backwards — populated only for support gems.
    recommendedBy: getRecommendedBy(gem),
  };
}
