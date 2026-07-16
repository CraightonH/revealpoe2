// scripts/graph/gems.js
import { loadJson } from './loader.js';
import { REPOE } from './source.js';
import { slugify } from '../../src/data/slug.js';
import { grantedSkillNames } from './uniques.js';
import { makeNode, makeEdge, KINDS, EDGE_TYPES } from './schema.js';
import { buildSections, buildLevelTable, buildGemQualityTable, buildScalingSections, costByLevel } from '../../src/data/statText.js';
import { altQualityLines, altQualityStats } from './gemQuality.js';
import { weaponReqLabel } from './weaponReqs.js';

// Mirrors src/data/gems.js — placeholder/unreleased gem-table entries to drop.
const GARBAGE_RE = /Coming Soon|Removed Skill|Playtest|\{0\}/;

// gem_tags.json maps a tag id to "[Display]", "[Id|Display]", or null. Resolve a
// gem's tag ids to displayable {token, display} entries (null-valued tags dropped).
function resolveTagTokens(tagIds, tagMap) {
  const out = [];
  for (const id of tagIds ?? []) {
    const raw = tagMap[id];
    if (!raw) continue;
    const inner = raw.replace(/^\[/, '').replace(/\]$/, '');
    const pipe = inner.indexOf('|');
    out.push({ token: raw, display: pipe === -1 ? inner : inner.slice(pipe + 1) });
  }
  return out;
}
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

// A skill's activation cost across gem levels 1..cap, as [{kind, min, max}] (one
// entry per cost kind — usually just Mana). min/max are the cost at the lowest and
// highest levels present in range, matching the "Level: (1—cap)" display. Constant
// cost → min === max. Returns [] when the skill has no per-level cost (e.g. a pure
// reservation skill). Kind → display label is applied by the app.
function skillCosts(skill, cap = GEM_LEVEL_CAP) {
  const perLevel = skill?.per_level ?? {};
  const levels = Object.keys(perLevel)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= cap)
    .sort((a, b) => a - b);
  const kinds = new Set();
  for (const l of levels) for (const k of Object.keys(perLevel[String(l)]?.costs ?? {})) kinds.add(k);
  const out = [];
  for (const kind of kinds) {
    const withKind = levels.filter((l) => perLevel[String(l)]?.costs?.[kind] != null);
    if (!withKind.length) continue;
    const min = perLevel[String(withKind[0])].costs[kind];
    const max = perLevel[String(withKind[withKind.length - 1])].costs[kind];
    out.push({ kind, min, max });
  }
  return out;
}

// Effect sections for a gem: the union of ALL its granted skills' sections. A gem
// can grant several skills whose effects/quality live on different ones — e.g.
// Artillery Ballista's deploy skill carries the "Ballista" section while its
// "Bolts" projectile sub-skill carries the Pins quality — and poe2db shows every
// section. We concatenate in grants order and de-duplicate identical sections so a
// gem that grants the same section twice doesn't render it twice.
//
// When a gem grants MULTIPLE skills, the secondary skills are distinct effects the
// user needs to tell apart (Ancestral Cry → Warcry / Volcanic Steps / Volcanic
// Eruption). Their stat_sets often carry no label, which would render as a headless
// block indistinguishable from the primary. So for multi-skill gems we fall back to
// the granted skill's own display name as the section label. We skip the fallback
// when the skill's name matches the gem's (case-insensitively) — that's the
// reservation-pattern (Blink, War Banner: a Reservation variant + the active skill,
// both sharing the gem name), where a name header would just duplicate the card title.
function effectSections(skillKeys, skills, gemName) {
  const keys = skillKeys ?? [];
  const multi = keys.length > 1;
  const gemNameLc = (gemName ?? '').toLowerCase();
  const seen = new Set();
  const out = [];
  for (const key of keys) {
    const skill = skills[key];
    if (!skill) continue;
    const skillName = skill.active_skill?.display_name ?? '';
    const nameFallback =
      multi && skillName && skillName.toLowerCase() !== gemNameLc ? skillName : null;
    for (const s of buildSections(skill, GEM_LEVEL_CAP)) {
      const label = s.label || nameFallback || '';
      // Gemling Legionnaire alternate quality for this exact (skill, stat set),
      // rendered through the same stat-translation path as the standard quality.
      const tf = skill.stat_sets?.[s.setIndex]?.translation_file ?? null;
      const altQuality = altQualityLines(key, s.setIndex, tf);
      const sec = { label, lines: s.lines, quality: s.quality };
      if (altQuality.length) sec.altQuality = altQuality;
      // altQuality participates in the signature so two sets with identical standard
      // content but different alt effects aren't collapsed into one section.
      const sig = JSON.stringify([sec.label, sec.lines, sec.quality, sec.altQuality ?? []]);
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(sec);
    }
  }
  return out;
}

// Per-level card data for the gem detail page's level selector. The union of ALL granted
// skills' scaling sections (same union/dedup as effectSections, so the two stay in sync),
// plus the first granted skill's per-level cost (matching where the card's Cost line is
// sourced). Compact: prose skeletons stored once, numbers per level (see buildScalingSections).
// `varies` records whether any stat or cost actually changes across levels — the runtime uses
// it (together with the gem's reqLevels curve, added later by the manual overlay) to decide
// whether a selector is worth showing. Returns null when the gem has no per-level data at all.
function levelScaling(skillKeys, skills, gemName) {
  const keys = skillKeys ?? [];
  const multi = keys.length > 1;
  const gemNameLc = (gemName ?? '').toLowerCase();
  const seen = new Set();
  const sections = [];
  const levelSet = new Set();
  let varies = false;

  const addLevels = (skill) => {
    for (const set of skill.stat_sets ?? []) {
      for (const l of Object.keys(set.per_level ?? {})) {
        const L = Number(l);
        if (Number.isFinite(L) && L >= 1 && L <= 40) levelSet.add(L);
      }
    }
  };

  for (const key of keys) {
    const skill = skills[key];
    if (!skill) continue;
    addLevels(skill);
    const skillName = skill.active_skill?.display_name ?? '';
    const nameFallback =
      multi && skillName && skillName.toLowerCase() !== gemNameLc ? skillName : null;
    for (const s of buildScalingSections(skill, 40)) {
      const label = s.label || nameFallback || '';
      const tf = skill.stat_sets?.[s.setIndex]?.translation_file ?? null;
      const altQuality = altQualityLines(key, s.setIndex, tf);
      const sec = { label, lines: s.lines, quality: s.quality };
      if (altQuality.length) sec.altQuality = altQuality;
      const sig = JSON.stringify([sec.label, sec.lines, sec.quality, sec.altQuality ?? []]);
      if (seen.has(sig)) continue;
      seen.add(sig);
      if (s.lines.some((l) => l.segs)) varies = true;
      sections.push(sec);
    }
  }

  // Cost comes from the FIRST granted skill (matches the card's Cost line source).
  const cost = costByLevel(skills[keys[0]], 40);
  if (cost) {
    for (const L of Object.keys(cost)) levelSet.add(Number(L));
    const byKind = {};
    for (const entries of Object.values(cost)) {
      for (const e of entries) (byKind[e.kind] ??= new Set()).add(e.amount);
    }
    for (const k of Object.keys(byKind)) if (byKind[k].size > 1) varies = true;
  }

  const levels = [...levelSet].filter(Number.isFinite).sort((a, b) => a - b);
  if (!levels.length || (!sections.length && !cost)) return null;
  return { levels, cap: GEM_LEVEL_CAP, maxLevel: Math.max(...levels), varies, cost, sections };
}

export function gemNodes() {
  const records = selectGemRecords();
  const skills = loadJson(`${REPOE}/skills.json`);
  const baseItems = loadJson(`${REPOE}/base_items.json`);
  const gemTags = loadJson(`${REPOE}/gem_tags.json`);
  const nodes = records.map((r) => {
    const sections = effectSections(r.raw.grants_skills, skills, r.raw.base_item?.display_name);
    // The faceted inventory-gem icon (distinct from icon_dds_file, the skill icon),
    // looked up in base_items via the gem's item id.
    const baseItem = baseItems[r.raw.base_item?.id];
    // Weapon-type requirement (GGPK-derived) — the first granted skill that carries
    // one. Keyed by each skill's active_skill.id (== ActiveSkills.Id upstream).
    let weaponReq = null;
    for (const key of r.raw.grants_skills ?? []) {
      const aid = skills[key]?.active_skill?.id;
      const label = aid ? weaponReqLabel(aid) : null;
      if (label) { weaponReq = label; break; }
    }
    const props = {
      color: r.raw.color,
      gemType: r.raw.gem_type,
      origin: r.origin,
      tags: r.raw.tags ?? [],
      tagTokens: resolveTagTokens(r.raw.tags ?? [], gemTags),
      requirementWeights: r.raw.requirement_weights ?? null,
      craftingLevel: r.raw.crafting_level ?? null,
      iconDds: r.raw.icon_dds_file ?? null,
      gemIconDds: baseItem?.visual_identity?.dds_file ?? null,
      hoverDds: r.raw.ui_image ?? null,
      grantsSkills: r.raw.grants_skills ?? [],
      effectSections: sections,
      // Per-level card data for the level selector (null when the gem has no scaling).
      levelScaling: levelScaling(r.raw.grants_skills, skills, r.raw.base_item?.display_name),
      // Merged per-quality scaling table (null when no quality effect varies) — the
      // Quality mode of the gem detail page's "Scaling" table. Merged across granted
      // skills here at build time so band rows resolve for every column (see
      // buildGemQualityTable), and each skill's Gemling second-quality effects are
      // folded in as alt-quality columns. Support gems have no quality → stays null.
      qualityTable: buildGemQualityTable(
        (r.raw.grants_skills ?? [])
          .map((key) => {
            const skill = skills[key];
            if (!skill) return null;
            const altStats = (skill.stat_sets ?? [])
              .flatMap((set, i) => altQualityStats(key, i, set.translation_file));
            return { skill, name: skill.active_skill?.display_name || key, altStats };
          })
          .filter(Boolean),
      ),
      weaponReq,
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
      // Reservation is a fact of the granted skill (graph rule #5: per-node facts).
      // Stored as resolved data {kind, amount}; the app maps kind -> display label.
      const res = skill.static?.reservations;
      const [resKind, resAmount] = res ? (Object.entries(res)[0] ?? []) : [];
      const reservation = resKind != null ? { kind: resKind, amount: resAmount } : null;
      out.push(makeNode({
        id: key, kind: KINDS.SKILL, name, slug,
        props: {
          // Whether this skill appears in the Skills Panel (drives the gem footer).
          // A granted skill can exist without an active_skill (e.g. support skills).
          isActiveSkill: !!skill.active_skill,
          types: skill.active_skill?.types ?? [],
          description: skill.active_skill?.description ?? null,
          reservation,
          // Activation cost per gem level (1..20), summarised as [{kind,min,max}].
          costs: skillCosts(skill),
          // Per-level scaling table (null when nothing varies). Heavy-ish but
          // small (~0.7MB across all skills); inlined as a prop, no side-artifact.
          levelTable: buildLevelTable(skill),
        },
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
