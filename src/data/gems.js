import { renderGameText, linkifyRequirement } from './keywords.js';
import { interleave } from './statText.js';
import { ddsUrl } from './images.js';
import { tradeUrl, gemExchangeUrl } from './trade.js';
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
// Cost kind (skills[key].per_level[L].costs) → display label for the gem-card cost line.
const COST_LABEL = {
  Mana: 'Mana',
  ManaPerMinute: 'Mana / min',
  Ward: 'Ward',
  WardPerMinute: 'Ward / min',
  Life: 'Life',
  LifePerMinute: 'Life / min',
};
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
    weapon_req: p.weaponReq ?? null,
    tagTokens: p.tagTokens ?? [],
    // Required character level per gem level (1..20), from the GGPK-derived
    // gem-levels overlay. Null for gems with no leveling curve (item-granted skills).
    reqLevels: p.reqLevels ?? null,
    // Per-level card data for the level selector (cost + effect scaling), or null.
    levelScaling: p.levelScaling ?? null,
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

// Lineage supports (tagged "lineage") ship no skill/buff art — their
// icon_dds_file is a blank placeholder — so the faceted gem inventory icon is
// the only real icon. They're also fungible items traded via the bulk exchange,
// not the item search, and get a "lineage" Origin facet for filtering.
function isLineage(gem) {
  return (gem.tags ?? []).includes('lineage');
}

// Trade link for a gem. Lineage supports are fungible items traded on the bulk
// EXCHANGE (want-only deep link; null when we have no exchange id for them).
// Everything else is a Listed Item, searchable ONLY for actually-tradeable skill
// gems (origin === 'gem'): skills granted by a unique or by equipping a weapon
// (origin 'item'/'other') aren't listed, so a type search returns nothing — omit
// the affordance for those.
function gemTradeUrl(gem) {
  if (isLineage(gem)) return gemExchangeUrl(gem.id);
  return gem.origin === 'gem' ? tradeUrl({ kind: 'gem', type: gem.name }) : null;
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
    tradeUrl: gemTradeUrl(gem),
    cardColor: cardColor(req, gem.color),
    gemType: gem.gem_type,
    origin: isLineage(gem) ? `${gem.origin} lineage` : gem.origin,
    req,
    iconUrl: ddsUrl(isLineage(gem) ? gem.gem_icon_dds : gem.icon_dds_file),
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

// Roman numerals for support gem tiers (crafting_level 1–5).
const TIER_ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };

// Recommended supports for a gem, resolved via recommends_support edges and
// grouped into tiers by the support's crafting_level (the uncut-support level
// needed to create it), mirroring the in-game I–V layout. Card VMs are the same
// full browse cards used on /gems, so hover tooltips/links render identically.
// Returns ordered tier groups: [{ tier, roman, supports: [cardVM, …] }, …].
// Levels 1–5 sort ascending; anything outside that range (crafting_level 0 or
// null — rare uncut/lineage placeholders) collects into a trailing tier:0
// "Other" group, emitted only when non-empty.
export function getRecommendedSupports(gem) {
  const byTier = new Map();
  for (const edge of edgesFrom(gem.id, 'recommends_support')) {
    const node = getNode(edge.to);
    if (!node) continue;
    const lvl = node.props?.craftingLevel;
    const tier = lvl >= 1 && lvl <= 5 ? lvl : 0;
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier).push(gemBrowseCardVM(node));
  }
  const groups = [];
  for (const tier of [1, 2, 3, 4, 5, 0]) {
    const supports = byTier.get(tier);
    if (!supports || !supports.length) continue;
    groups.push({ tier, roman: TIER_ROMAN[tier] ?? '—', supports });
  }
  return groups;
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
//
// Uniques grant the shared *skill* node (gem -> skill <- unique), so we walk the
// gem's forward grants edges to each skill, then the inbound grants on that
// skill. Each grants edge carries the variant index that grants THIS skill, so a
// variant-gated unique (The Unborn Lich) renders the variant that won the reverse
// lookup rather than its default variant (which may grant a different skill).
export function getGrantingUniques(gem) {
  const bySlug = new Map(); // slug -> { node, variantIndex } (first edge wins)
  for (const e of edgesFrom(gem.id, 'grants')) {
    for (const ge of edgesTo(e.to, 'grants')) {
      const node = getNode(ge.from);
      if (!node || node.kind !== 'unique' || bySlug.has(node.slug)) continue;
      bySlug.set(node.slug, { node, variantIndex: ge.props?.variantIndex });
    }
  }
  const out = [];
  for (const { node, variantIndex } of bySlug.values()) {
    const card = getUniqueCard(node.slug, variantIndex);
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

// Per-gem-level attribute requirement — computed, since it is stored nowhere (not in
// RePoE, not in the GGPK tables). poe2db derives it the same way. The formula, reverse-
// engineered and verified exactly against poe2db across every gem level for the five
// attribute-percent values that occur in-game (see test/gems.test.js):
//
//   reqAttr = round(ATTR_REQ_BASE + ATTR_REQ_SLOPE × requiredLevel × FACTOR[percent])
//
// where `requiredLevel` is that gem level's Requires Level (from the GGPK reqLevels
// curve) and `percent` is the gem's weight for that attribute. Every participating
// attribute gets the full +4 base (a 50/50 gem shows 4/4 at level 1, not 2/2) — so the
// factor is emphatically NOT percent/100; it is an empirically-fixed value per percent.
// Only 25/50/75/100 occur on gems that carry a Requires-Level curve; an unseen percent
// throws (loud canary) rather than fabricating a number.
const ATTR_REQ_BASE = 4;
const ATTR_REQ_SLOPE = 1.7;
const ATTR_REQ_FACTOR = { 25: 0.2868, 50: 0.5354, 75: 0.7715, 100: 1.0 };

function attrRequirementAt(reqLevel, percent) {
  if (!percent) return null;
  const f = ATTR_REQ_FACTOR[percent];
  if (f == null) {
    throw new Error(
      `gem attribute requirement: no verified factor for attribute percent ${percent}. `
      + 'Derive it from poe2db across all gem levels and add it to ATTR_REQ_FACTOR before shipping.',
    );
  }
  return Math.round(ATTR_REQ_BASE + ATTR_REQ_SLOPE * reqLevel * f);
}

// Merge into one per-level table (one row per level, one column per varying field):
//   1. Gem-wide columns — Requires Level and Str/Dex/Int requirements — from the gem's
//      reqLevels curve (levels 1..20). Attribute columns appear only for attributes the
//      gem actually requires (requirement_weights > 0). A gem past level 20 (corruption /
//      +level modifiers) needs no MORE than its level-20 requirement, so the level-20
//      value is HELD across the over-leveled rows (21..40) the skill scaling already
//      produced — never inventing rows a gem doesn't otherwise have.
//   2. Per-skill columns — the scaling of EVERY granted skill, not just the first. A gem
//      like Ancestral Cry grants three skills (Warcry Mana, Volcanic Steps / Volcanic
//      Eruption Base Damage on separate skill nodes); keys are namespaced by skill so two
//      "Base Damage" columns don't collide, and each carries a `skill` caption (its
//      granting skill's display name) when more than one skill contributes.
// Rows span the union of levels present in either source. Returns null when nothing —
// no reqLevels curve and no granted skill scales by level.
function mergeLevelTables(gem) {
  const columns = [];
  const levels = new Set();
  const cells = new Map(); // column key → Map(level → value)

  // 1. Per-skill scaling columns first, so we know which over-leveled rows (>20) exist —
  //    those are the rows the gem-wide requirement columns hold their level-20 value across.
  const contributors = (gem.grants_skills ?? [])
    .map((key) => getNode(key))
    .filter((node) => node?.props?.levelTable)
    .map((node) => ({ name: node.name, table: node.props.levelTable }));
  const captioned = contributors.length > 1;
  const skillColumns = [];
  contributors.forEach(({ name, table }, i) => {
    for (const col of table.columns) {
      const key = `${i}:${col.key}`;
      const perLevel = new Map();
      for (const row of table.rows) {
        const v = row.cells[col.key];
        if (v != null) { perLevel.set(row.level, v); levels.add(row.level); }
      }
      skillColumns.push({ key, header: col.header, kind: col.kind, skill: captioned ? name : null, perLevel });
    }
  });
  const overLevels = [...levels].filter((l) => l > GEM_LEVEL_CAP);

  // 2. Gem-wide Requires Level + attribute-requirement columns (prepended). Levels 1..20
  //    take their own value; over-leveled rows hold the level-20 value.
  const reqLevels = gem.reqLevels;
  if (Array.isArray(reqLevels)) {
    const fill = (valueAt) => {
      const m = new Map();
      for (let lvl = 1; lvl <= GEM_LEVEL_CAP; lvl += 1) {
        const v = valueAt(lvl);
        if (v != null) { m.set(lvl, v); levels.add(lvl); }
      }
      const hold = valueAt(GEM_LEVEL_CAP); // level-20 value, held across over-leveled rows
      if (hold != null) for (const lvl of overLevels) m.set(lvl, hold);
      return m;
    };
    columns.push({ key: 'req:level', header: 'Requires Level', kind: 'req', skill: null });
    cells.set('req:level', fill((lvl) => {
      const rl = reqLevels[lvl - 1];
      return rl == null ? null : String(rl);
    }));
    const weights = gem.requirement_weights ?? {};
    for (const attr of ATTR_ORDER) {
      const pct = weights[attr];
      if (!pct) continue;
      const key = `attr:${attr}`;
      columns.push({ key, header: ATTR_ABBR[attr], kind: 'attr', skill: null });
      cells.set(key, fill((lvl) => {
        const rl = reqLevels[lvl - 1];
        return rl == null ? null : String(attrRequirementAt(rl, pct));
      }));
    }
  }

  // 3. Append the per-skill columns after the gem-wide ones.
  for (const { perLevel, ...col } of skillColumns) {
    columns.push(col);
    cells.set(col.key, perLevel);
  }

  if (columns.length === 0) return null;

  const rows = [...levels]
    .sort((a, b) => b - a)
    .map((level) => {
      const rowCells = {};
      for (const col of columns) {
        const v = cells.get(col.key)?.get(level);
        if (v != null) rowCells[col.key] = v;
      }
      return { level, cap: level === GEM_LEVEL_CAP, cells: rowCells };
    });
  return { columns, rows };
}

// Render a merged level table (see mergeLevelTables) to view HTML: headers and any
// token-bearing cells go through renderGameText (same path as effect lines), and
// cells are flattened to a per-column array so the template needn't key by the raw
// stat-id (which can contain newlines). The per-column `skill` caption is passed
// through as plain text. Returns null when there is no table.
function renderLevelTable(table) {
  if (!table) return null;
  const columns = table.columns.map((c) => ({
    kind: c.kind,
    skill: c.skill ?? null,
    headerHtml: renderGameText(c.header, hasDefinition),
  }));
  const rows = table.rows.map((r) => ({
    level: r.level,
    cap: r.cap,
    cells: table.columns.map((c) => {
      const v = r.cells[c.key];
      return v == null ? '' : renderGameText(v, hasDefinition);
    }),
  }));
  return { columns, rows };
}

// Value from a { [level]: value } map at level L, holding the nearest lower level's
// value when L itself is absent (a skill that stops scaling at 20 freezes across 21..40,
// mirroring mergeLevelTables' requirement hold). Falls back to the lowest level present.
function valueAtLevel(byLevel, L) {
  if (byLevel[L] != null) return byLevel[L];
  const keys = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
  let pick = keys[0];
  for (const k of keys) if (k <= L) pick = k;
  return byLevel[pick];
}

// A single effect line at level L: constant lines pass through; varying lines weave the
// level's numbers back into the stored prose skeleton (see statText.buildScalingSections).
function lineTextAt(line, L) {
  if (line.text != null) return line.text;
  return interleave(line.segs, valueAtLevel(line.byLevel, L) ?? []);
}

// The activation-cost display string at level L (e.g. "44 Mana"), or null.
function costStringAt(scaling, L) {
  if (!scaling?.cost) return null;
  const entries = valueAtLevel(scaling.cost, L);
  if (!entries) return null;
  return entries
    .map(({ kind, amount }) => `${amount} ${COST_LABEL[kind] ?? kind}`)
    .join(', ') || null;
}

// Requirement lines (Level + attributes) at a specific gem level, using the true per-level
// magnitudes from the reqLevels curve. Requirements freeze at their level-20 value past the
// cap (a corrupted / +level gem needs no more than its level-20 requirement), matching
// mergeLevelTables. Falls back to the fixed display ranges when the gem has no reqLevels curve.
function requirementsAt(gem, L) {
  const reqLevels = gem.reqLevels;
  if (!Array.isArray(reqLevels)) {
    return [
      `Level (${CHAR_LEVEL_RANGE.min}—${CHAR_LEVEL_RANGE.max})`,
      ...attributeRequirements(gem.requirement_weights),
    ];
  }
  const rl = reqLevels[Math.min(L, GEM_LEVEL_CAP) - 1];
  const out = [`Level ${rl}`];
  const weights = gem.requirement_weights ?? {};
  for (const attr of ATTR_ORDER) {
    const pct = weights[attr];
    if (!pct) continue;
    out.push(`${attrRequirementAt(rl, pct)} ${ATTR_ABBR[attr]}`);
  }
  return out;
}

// Render a level's effect sections (scaling data → view HTML), same shape the template's
// section loop consumes. Quality/altQuality are level-independent but re-rendered per level
// for a uniform structure.
function renderScalingSectionsAt(scaling, L) {
  return (scaling?.sections ?? []).map((s) => ({
    label: s.label,
    lines: s.lines.map((line) => renderGameText(lineTextAt(line, L), hasDefinition)),
    quality: (s.quality ?? []).map((t) => renderGameText(t, hasDefinition)),
    altQuality: (s.altQuality ?? []).map((t) => renderGameText(t, hasDefinition)),
  }));
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

  // Activation cost, e.g. [{kind:'Mana',min:10,max:104}] -> "(10—104) Mana".
  // Constant cost renders the single value; multiple kinds join with ", ".
  const cost = (sp?.costs ?? [])
    .map(({ kind, min, max }) => {
      const amount = min === max ? `${min}` : `(${min}—${max})`;
      return `${amount} ${COST_LABEL[kind] ?? kind}`;
    })
    .join(', ') || null;

  // Sections (resolved plain strings from the graph), each line/quality string
  // rendered to safe token HTML here.
  const sections = gem.effect_sections.map((s) => ({
    label: s.label,
    lines: s.lines.map((t) => renderGameText(t, hasDefinition)),
    quality: s.quality.map((t) => renderGameText(t, hasDefinition)),
    // Gemling Legionnaire "second" quality — rendered like standard quality but shown
    // in the in-game #b4b4ff colour (see gem-card.njk). Absent on most sections.
    altQuality: (s.altQuality ?? []).map((t) => renderGameText(t, hasDefinition)),
  }));

  // Range-based requirement display (fixed approximation) — the default when there is no
  // level selector. The selector path replaces it with true per-level requirements.
  const rangeRequirements = [
    `Level (${CHAR_LEVEL_RANGE.min}—${CHAR_LEVEL_RANGE.max})`,
    ...attributeRequirements(gem.requirement_weights),
  ].map((r) => linkifyRequirement(r, hasDefinition));

  // Level selector: show it when the gem meaningfully scales — either a stat/cost varies
  // (levelScaling.varies) or it carries a per-level requirement curve (reqLevels). The
  // selectable levels are the union the scaling data spans (1..40 for most active skills),
  // falling back to the 1..20 reqLevels range for gems that only scale their requirements.
  const scaling = gem.levelScaling;
  const hasReq = Array.isArray(gem.reqLevels);
  const selectorLevels = scaling?.levels?.length
    ? scaling.levels
    : (hasReq ? gem.reqLevels.map((_, i) => i + 1) : null);
  const levelSelect =
    !!selectorLevels && selectorLevels.length >= 2 && (scaling?.varies || hasReq);
  const defaultLevel = levelSelect ? Math.min(GEM_LEVEL_CAP, Math.max(...selectorLevels)) : null;

  // Per-level snapshot: cost / requirements / effect sections rendered at each level, so the
  // template can emit every level as a toggleable variant (no client-side data resolution).
  // Effect sections come from levelScaling when present; otherwise the (constant) range
  // sections are reused for every level.
  let levelData = null;
  if (levelSelect) {
    levelData = {};
    for (const L of selectorLevels) {
      levelData[L] = {
        cost: costStringAt(scaling, L) ?? cost,
        requirements: requirementsAt(gem, L).map((r) => linkifyRequirement(r, hasDefinition)),
        sections: scaling?.sections?.length ? renderScalingSectionsAt(scaling, L) : sections,
      };
    }
  }

  const active = levelSelect ? levelData[defaultLevel] : null;

  return {
    slug,
    name: gem.name,
    tradeUrl: gemTradeUrl(gem),
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
    // Level selector: `levels` drives the dropdown, `level` is the initial selection, and
    // `levelData` holds every level's rendered cost/requirements/sections for the template to
    // emit as toggleable variants. When there's no selector, fall back to the fixed range line.
    levelSelect,
    levels: levelSelect ? selectorLevels : null,
    level: defaultLevel,
    levelCap: GEM_LEVEL_CAP,
    levelData,
    // Fixed display range (not derived per-gem) — shown only when there's no selector.
    levelRange: levelSelect ? null : { min: 1, max: GEM_LEVEL_CAP },
    reservation,
    cost: levelSelect ? active.cost : cost,
    // Weapon-type requirement, e.g. "Crossbows" — carries glossary "[Id|Display]"
    // markup so each weapon term renders as a hoverable keyword.
    weaponReq: gem.weapon_req ? renderGameText(gem.weapon_req, hasDefinition) : null,
    // Every gem shows a character-level requirement; attribute lines follow when present.
    // With a selector active these are the true per-level requirements; otherwise a range.
    requirements: levelSelect ? active.requirements : rangeRequirements,
    skillIconUrl: ddsUrl(gem.icon_dds_file),
    gemIconUrl: ddsUrl(gem.gem_icon_dds),
    hoverImageUrl: ddsUrl(gem.ui_image),
    description: sp?.description
      ? renderGameText(sp.description, hasDefinition)
      : null,
    sections: levelSelect ? active.sections : sections,
    // Per-level scaling table (level → stat/cost/damage values), merged across ALL
    // the gem's granted skills so every skill's scaling shows. Null when nothing
    // scales by level.
    levelTable: renderLevelTable(mergeLevelTables(gem)),
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
