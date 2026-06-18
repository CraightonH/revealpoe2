import { loadJson } from './loader.js';
import { slugify } from './slug.js';
import { renderGameText, linkifyRequirement } from './keywords.js';
import { ddsUrl } from './images.js';
import { displayTagTokens } from './gemTags.js';
import { hasDefinition } from './keywordDefs.js';
import { buildSections } from './statText.js';
import { ATTR_ABBR, ATTR_KEY, ATTR_ORDER } from './attributes.js';
import { grantedSkillNames } from './grantedSkills.js';
import { REPOE } from '../config.js';

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
const REQ_BORDER_KEY = { str: 'r', dex: 'g', int: 'b' };

// Non-skill placeholder entries in the game's gem table: unreleased ("Coming
// Soon"), disabled ("Removed Skill"), dev ("Playtest …"), and templated stubs
// ("Soul Crystal: {0}"). Never shown — same treatment as [DNT].
const GARBAGE_RE = /Coming Soon|Removed Skill|Playtest|\{0\}/;

// Origin = how a gem enters the game. Surfaced as a filter on /gems.
//   gem   – obtainable as a socketable gem (cut from an uncut gem). The signal
//           is crafting_types (the uncut-gem tag) OR a base-item progression tag
//           (up_to_levelN_gem); the latter covers tiered/spirit supports whose
//           crafting_types are unpopulated in the dataset.
//   item  – not gem-obtainable, but granted by a unique item (matched via the
//           unique's "Grants Skill:" text), or a weapon's default attack
//           (SkillGemPlayerDefault*, e.g. "Bow Shot") — the equipped item
//           determines availability either way.
//   other – everything else: ascendancy/quest/boss-granted skills with no
//           obtain method in the data. We can't reliably split ascendancy from
//           monster skills (no field distinguishes them), so they share a bucket.
function classifyOrigin(rec, baseTags) {
  if (rec.crafting_types != null) return 'gem';
  if (baseTags?.some((t) => t !== 'gem' && t.endsWith('_gem'))) return 'gem';
  if (rec.base_item.id?.includes('SkillGemPlayerDefault')) return 'item';
  if (grantedSkillNames().has(rec.base_item.display_name)) return 'item';
  return 'other';
}

let _index = null;

function index() {
  if (_index) return _index;
  const gems = loadJson(`${REPOE}/skill_gems.json`);
  const baseItems = loadJson(`${REPOE}/base_items.json`);
  _index = new Map();
  for (const [key, rec] of Object.entries(gems)) {
    const name = rec?.base_item?.display_name;
    if (!name) continue;
    // [DNT]/[DNT-UNUSED] = "do not translate" — unimplemented content present in
    // the game files but not playable. Exclude from the wiki (cf. passiveTree.js).
    if (name.includes('[DNT')) continue;
    if (GARBAGE_RE.test(name)) continue;
    const origin = classifyOrigin(rec, baseItems[rec.base_item.id]?.tags);
    const slug = slugify(name);
    if (!_index.has(slug)) {
      _index.set(slug, { key, origin, ...rec });
    } else if (_index.get(slug).gem_type !== rec.gem_type) {
      const existing = _index.get(slug);
      console.warn(
        `[gems] cross-type slug collision: "${slug}" — keeping ${existing.base_item.display_name} (${existing.gem_type}), skipping ${name} (${rec.gem_type})`
      );
    }
  }
  return _index;
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

export function listGems() {
  return [...index().entries()].map(([slug, rec]) => {
    const req = reqKeys(rec.requirement_weights);
    return {
      slug,
      name: rec.base_item.display_name,
      color: rec.color,
      cardColor: cardColor(req, rec.color),
      gemType: rec.gem_type,
      origin: rec.origin,
      iconUrl: ddsUrl(rec.icon_dds_file),
      req,
    };
  });
}

// Condensed view models for the /gems browse grid: the at-a-glance fields
// (type/tags, requirements, and the skill's effect lines) plus the filter
// metadata. Builds sections like the full VM — cheap enough across ~1000 gems
// (~70ms) — but skips quality lines and per-section labels.
export function listGemCards() {
  const skills = loadJson(`${REPOE}/skills.json`);
  return [...index().entries()].map(([slug, gem]) => {
    const skill = skills[gem.grants_skills?.[0]] ?? null;
    const req = reqKeys(gem.requirement_weights);
    const typeLine =
      gem.gem_type === 'spirit'
        ? (TYPE_LABEL.spirit ?? 'Spirit')
        : (skillTypeLine(skill) ?? (TYPE_LABEL[gem.gem_type] ?? 'Skill'));
    const tagTokens = displayTagTokens(gem.tags, [typeLine]);
    const effect = buildSections(skill, GEM_LEVEL_CAP)
      .flatMap((s) => s.lines)
      .map((t) => renderGameText(t, hasDefinition));
    return {
      slug,
      name: gem.base_item.display_name,
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
  return index().get(slug) ?? null;
}

// Resolve a gem by its raw Metadata key (e.g. a passive node's `granted_skill`
// or a unique's grant) to a lightweight reference for linking. Returns null if
// the key has no indexed gem. The reverse map is built once from the index, so
// only the slug-winning record for each key resolves (no collision losers).
let _byKey = null;
export function getGemRefByKey(key) {
  if (!_byKey) {
    _byKey = new Map();
    for (const [slug, rec] of index()) _byKey.set(rec.key, slug);
  }
  const slug = _byKey.get(key);
  if (!slug) return null;
  const rec = index().get(slug);
  return { slug, name: rec.base_item.display_name, iconUrl: ddsUrl(rec.icon_dds_file) };
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

  // Gem item icon (the faceted inventory gem) — distinct from icon_dds_file,
  // which is the skill's icon. Looked up in base_items via the gem's item id.
  const baseItems = loadJson(`${REPOE}/base_items.json`);
  const baseItem = baseItems[gem.base_item?.id];

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
      : (skillTypeLine(skill) ?? (TYPE_LABEL[gem.gem_type] ?? 'Skill'));

  // Tag tokens, excluding the one already shown as the type line; rendered to
  // gated keyword HTML so defined tags become hoverable.
  const tagTokens = displayTagTokens(gem.tags, [typeLine]);

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
    lines: s.lines.map((t) => renderGameText(t, hasDefinition)),
    quality: s.quality.map((t) => renderGameText(t, hasDefinition)),
  }));

  return {
    slug,
    name: gem.base_item.display_name,
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
    gemIconUrl: ddsUrl(baseItem?.visual_identity?.dds_file),
    hoverImageUrl: ddsUrl(gem.ui_image),
    description: skill?.active_skill?.description
      ? renderGameText(skill.active_skill.description, hasDefinition)
      : null,
    sections,
    footer: skill?.active_skill ? SKILL_PANEL_FOOTER : null,
    recommendedSupports: getRecommendedSupports(gem),
  };
}
