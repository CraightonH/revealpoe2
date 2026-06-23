// src/data/mods.js
//
// Presentation adapter over the graph artifact (build/graph.json) for rollable
// affixes. Affix identity, tier data, origin classification, and base eligibility
// live in the build-time graph (scripts/graph/affixes.js); this module reads
// `affix` nodes + `rolls_on` edges and owns the view layer (text -> HTML render,
// generic/sort/tag shaping). It performs NO reads of $POE2DATADIR.
//
// Every origin (standard / corrupted / desecrated) is traversed identically:
// base -> rolls_on -> affix, partitioned by the node's `origin` prop, then laid
// out per the origin registry (src/data/affixOrigins.js). Adding an origin is a
// registry entry + a build-side eligibility branch — no change here.
import { getNode, nodesByKind, edgesTo } from './graph.js';
import { slugify } from './slug.js';
import { renderGameText } from './keywords.js';
import { hasDefinition } from './keywordDefs.js';
import { AFFIX_ORIGINS } from './affixOrigins.js';
import { cleanTags, toGenericText, toSortKey, familyGenericText } from './affixText.js';

// A single renderable tier row: graph tier facts + rendered HTML. Field names
// (generation_type, level, name, html) match what the affix-table macros consume.
function renderTier(t) {
  return {
    id: t.id,
    name: t.name,
    text: t.text,
    html: renderGameText(t.text, hasDefinition),
    level: t.level,
    generation_type: t.generationType,
    stats: t.stats,
    tags: t.tags,
  };
}

// Collapse a node's selected tier indices into the family shape the affix tables
// consume. Tiers are kept ascending by level (the view reverses to show the top
// tier as T1); the highest tier drives the generic label, sort key, and tag pills.
function buildFamily(node, idxSet, origin) {
  const tiers = node.props.tiers.filter((_, i) => idxSet.has(i)).sort((a, b) => a.level - b.level);
  if (!tiers.length) return null;
  const top = tiers[tiers.length - 1];
  let tags = cleanTags(top.tags);
  // Desecrated families lead with their Well-of-Souls boss pill (the mod's
  // defining origin), dropping any residual `<...>_mod` tag cleanTags resurrected.
  if (AFFIX_ORIGINS[origin].bossPill && node.props.boss) {
    const boss = node.props.boss;
    tags = [boss, ...tags.filter((t) => t !== boss && !/_mod$/.test(t))];
  }
  return {
    type: node.props.type,
    displayName: node.name,
    typeSlug: slugify(node.props.type),
    genericHtml: renderGameText(toGenericText(top.text), hasDefinition),
    sortKey: toSortKey(top.text),
    tags,
    tiers: tiers.map(renderTier),
  };
}

function sortFamilies(families) {
  return families.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

// One side of an affix table: the families of `origin` rollable on any of
// `metaKeys`, restricted to tier `gen` (null = every tier, for flat layouts).
// Where bases allow different tier subsets of the same family, the base allowing
// the most tiers wins (mirrors the former mergeFamilies "keep the superset").
function buildSide(metaKeys, origin, gen) {
  const best = new Map(); // nodeId -> { node, idxSet }  (largest single-base allowed set)
  for (const baseId of metaKeys) {
    for (const e of edgesTo(baseId, 'rolls_on')) {
      const node = getNode(e.from);
      if (!node || node.props.origin !== origin) continue;
      const allow = e.props?.tiers ? new Set(e.props.tiers) : null; // null => all tiers
      const idxSet = new Set();
      node.props.tiers.forEach((t, i) => {
        if (gen && t.generationType !== gen) return;
        if (allow && !allow.has(i)) return;
        idxSet.add(i);
      });
      if (!idxSet.size) continue;
      const prev = best.get(node.id);
      if (!prev || idxSet.size > prev.idxSet.size) best.set(node.id, { node, idxSet });
    }
  }
  const families = [];
  for (const { node, idxSet } of best.values()) {
    const f = buildFamily(node, idxSet, origin);
    if (f) families.push(f);
  }
  return sortFamilies(families);
}

// Affix families rollable across an item class (the union over its bases),
// prefixes and suffixes each sorted alphabetically by modifier text. (RePoE-fork
// encodes only a binary can/can't-roll, so there is no rarity to sort by.)
export function getModsForClass(metadataKeys) {
  return {
    prefix: buildSide(metadataKeys, 'standard', 'prefix'),
    suffix: buildSide(metadataKeys, 'standard', 'suffix'),
  };
}

// Affix families rollable on a single base — the per-base case of the class union.
export function getModsForBase(metadataKey) {
  return getModsForClass([metadataKey]);
}

// Vaal-corruption families rollable across a class — a flat list (corruption has
// no prefix/suffix split; the mods apply directly as implicits).
export function getCorruptedForClass(metadataKeys) {
  return buildSide(metadataKeys, 'corrupted', null);
}

// Abyssal (desecrated) families rollable on a class's bases — prefix/suffix split,
// each family pill-led by its Well-of-Souls boss. Eligibility is the item-tag
// spawn-weight predicate, resolved into `rolls_on` edges at build time, so this is
// the same base->affix traversal as every other origin.
export function getDesecratedForClass(metadataKeys) {
  return {
    prefix: buildSide(metadataKeys, 'desecrated', 'prefix'),
    suffix: buildSide(metadataKeys, 'desecrated', 'suffix'),
  };
}

// Lazy tier-id -> { node, tier } index for getMod (mod ids are globally unique
// across origins in the source, so first-seen wins).
let _tierById = null;
function tierById() {
  if (_tierById) return _tierById;
  _tierById = new Map();
  for (const node of nodesByKind('affix')) {
    for (const t of node.props.tiers) if (!_tierById.has(t.id)) _tierById.set(t.id, { node, t });
  }
  return _tierById;
}

// A single mod (tier) by its source id, in the raw-shaped form consumers expect.
export function getMod(id) {
  const hit = tierById().get(id);
  if (!hit) return null;
  const { node, t } = hit;
  return {
    id,
    name: t.name,
    text: t.text,
    type: node.props.type,
    generation_type: t.generationType,
    required_level: t.level,
    stats: t.stats,
  };
}

// All standard affix families, as compact summaries for the search/theorycraft
// doc set. generation_type and text come from the lowest tier (mirrors the former
// _byType[0]); genericText collapses across-tier rolls to "#".
export function listModGroups() {
  const out = [];
  for (const node of nodesByKind('affix')) {
    if (node.props.origin !== 'standard') continue;
    const tiers = [...node.props.tiers].sort((a, b) => a.level - b.level);
    const first = tiers[0];
    out.push({
      type: node.props.type,
      displayName: node.name,
      genericText: familyGenericText(tiers),
      typeSlug: slugify(node.props.type),
      generation_type: first.generationType,
      text: first.text,
      tierCount: tiers.length,
    });
  }
  return out.sort((a, b) => a.type.localeCompare(b.type));
}
