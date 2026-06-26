// scripts/graph/affixes.js
//
// Build-time resolver for rollable affix families and the `rolls_on` edges that
// connect them to the bases they can land on. One node per (origin, type); the
// app (src/data/mods.js) reads these nodes + edges and owns all rendering.
//
// Eligibility is resolved here, once, and frozen into edges so the app traverses
// every origin the same way (base -> rolls_on -> affixes, partitioned by origin):
//   - standard / corrupted : the explicit mods_by_base base-id join. The edge
//     carries the allowed tier indices for that (family, base) pair (a pairing
//     fact — graph rule #5).
//   - desecrated : the spawn_weights item-tag predicate, evaluated against each
//     browsable base's tags. No tier restriction (all tiers eligible).
//
// Also exports resolveImplicitTexts(ids): base/rune implicit mods (generation_type
// "unique") resolved to display *text* (keyword markup preserved, no HTML) so the
// base resolver can store them on base nodes and retire mods.js's source reads.
import { loadJson } from './loader.js';
import { REPOE } from './source.js';
import { slugify } from '../../src/data/slug.js';
import { makeNode, makeEdge, KINDS, EDGE_TYPES } from './schema.js';
import { abyssBoss, humanizeType, toGenericDisplay } from '../../src/data/affixText.js';
import { originSlug } from '../../src/data/affixOrigins.js';

const ROLLABLE = new Set(['prefix', 'suffix']);

// Domains whose rollable mods are "standard" craftable affixes (applied via basic
// currency). Equipment is `item`; flasks/charms live in `flask`; jewels in `misc`.
// flask/misc eligibility is spawn-weight (item-tag) gated rather than the
// mods_by_base join, and is resolved in affixEdges scoped to the matching base
// domain (so a `default`-tagged flask charge mod can't leak onto weapons).
const STANDARD_DOMAINS = new Set(['item', 'flask', 'misc']);
// mod domain -> the base `domain` its tag-gated edges may attach to.
const TAG_GATED_DOMAINS = { flask: 'flask', misc: 'misc' };

// Map a mod's (domain, generation_type) to its affix origin, or null if the mod
// isn't a rollable affix (true implicits, enchants, internal mechanics, …).
function originOf(domain, gen) {
  if (STANDARD_DOMAINS.has(domain) && ROLLABLE.has(gen)) return 'standard';
  if (domain === 'item' && gen === 'corrupted') return 'corrupted';
  if (domain === 'desecrated' && ROLLABLE.has(gen)) return 'desecrated';
  return null;
}

// A single tier row — raw facts only; the app renders text -> HTML.
function tierRecord(id, v) {
  return {
    id,
    name: v.name,
    text: v.text ?? '',
    level: v.required_level ?? 0,
    generationType: v.generation_type,
    stats: v.stats ?? [],
    tags: v.implicit_tags ?? [],
  };
}

// Collapse mods.json into per-(origin,type) family records, tiers sorted by level.
export function selectAffixRecords() {
  const raw = loadJson(`${REPOE}/mods.json`);
  const byKey = new Map(); // nodeId -> record
  for (const [id, v] of Object.entries(raw)) {
    const origin = originOf(v.domain, v.generation_type);
    if (!origin) continue;
    const nodeId = `Affix/${origin}/${v.type}`;
    let rec = byKey.get(nodeId);
    if (!rec) {
      rec = {
        id: nodeId, origin, type: v.type, modDomain: v.domain,
        slug: originSlug(origin, slugify(v.type)),
        boss: null, spawnTags: new Set(), tiers: [],
      };
      byKey.set(nodeId, rec);
    }
    rec.tiers.push(tierRecord(id, v));
    // Spawn-weight (item-tag) eligibility, collected for the two origins that use
    // it: desecrated, and the flask/jewel standard mods (gated by base domain in
    // affixEdges). The mods_by_base join handles item-domain standard mods instead.
    if (origin === 'desecrated' || TAG_GATED_DOMAINS[v.domain]) {
      if (origin === 'desecrated' && !rec.boss) rec.boss = abyssBoss(v.implicit_tags ?? []);
      for (const sw of v.spawn_weights ?? []) if (sw.weight > 0) rec.spawnTags.add(sw.tag);
    }
  }
  for (const rec of byKey.values()) {
    rec.tiers.sort((a, b) => a.level - b.level);
    rec.tierIndexById = new Map(rec.tiers.map((t, i) => [t.id, i]));
  }
  // Drop flask/jewel standard families with no positive spawn weight anywhere —
  // they can't roll on any base, so they'd be dead entries in search/affix tables.
  return [...byKey.values()].filter((r) => !(TAG_GATED_DOMAINS[r.modDomain]) || r.spawnTags.size);
}

export function affixNodes() {
  const records = selectAffixRecords();
  const nodes = records.map((r) => {
    const top = r.tiers[r.tiers.length - 1];
    const props = {
      origin: r.origin,
      type: r.type,
      boss: r.boss,
      tiers: r.tiers.map((t) => ({
        id: t.id, name: t.name, text: t.text, level: t.level,
        generationType: t.generationType, stats: t.stats, tags: t.tags,
      })),
    };
    const search = [humanizeType(r.type), toGenericDisplay(top.text)].join(' ').toLowerCase();
    return makeNode({
      id: r.id, kind: KINDS.AFFIX, name: humanizeType(r.type), slug: r.slug, props, search,
    });
  });
  return { nodes, records };
}

// mods_by_base genType -> affix origin (the only genTypes that join through it).
const GEN_TO_ORIGIN = { prefix: 'standard', suffix: 'standard', corrupted: 'corrupted' };

export function affixEdges(records, baseRecords, nodeIds) {
  const edges = [];
  const byOriginType = new Map(); // `${origin}|${type}` -> record
  for (const r of records) byOriginType.set(`${r.origin}|${r.type}`, r);

  // Standard + corrupted: explicit mods_by_base join. A base can appear under
  // multiple tag-combos, so accumulate the allowed mod-id union per (family, base)
  // before emitting one edge carrying the allowed tier indices.
  const mbb = loadJson(`${REPOE}/mods_by_base.json`);
  const allowed = new Map(); // `${nodeId}|${baseId}` -> { rec, baseId, ids:Set }
  for (const combos of Object.values(mbb)) {
    for (const entry of Object.values(combos)) {
      const bases = (entry.bases ?? []).filter((b) => nodeIds.has(b));
      if (!bases.length) continue;
      for (const [genType, typeGroups] of Object.entries(entry.mods ?? {})) {
        const origin = GEN_TO_ORIGIN[genType];
        if (!origin) continue;
        for (const [typeName, modMap] of Object.entries(typeGroups)) {
          const rec = byOriginType.get(`${origin}|${typeName}`);
          if (!rec) continue;
          const modIds = Object.keys(modMap).filter((mid) => rec.tierIndexById.has(mid));
          if (!modIds.length) continue;
          for (const baseId of bases) {
            const key = `${rec.id}|${baseId}`;
            let acc = allowed.get(key);
            if (!acc) { acc = { rec, baseId, ids: new Set() }; allowed.set(key, acc); }
            for (const mid of modIds) acc.ids.add(mid);
          }
        }
      }
    }
  }
  for (const { rec, baseId, ids } of allowed.values()) {
    const tiers = [...ids].map((mid) => rec.tierIndexById.get(mid)).sort((a, b) => a - b);
    edges.push(makeEdge({ type: EDGE_TYPES.ROLLS_ON, from: rec.id, to: baseId, props: { tiers } }));
  }

  // Desecrated: spawn_weights item-tag predicate, frozen into edges. Eligibility
  // is class/item-tag gated (not per-base tier restricted), so all tiers apply.
  const desecrated = records.filter((r) => r.origin === 'desecrated' && r.spawnTags.size);
  for (const b of baseRecords) {
    const tagSet = new Set(b.raw.tags ?? []);
    if (!tagSet.size) continue;
    for (const rec of desecrated) {
      let match = false;
      for (const t of rec.spawnTags) if (tagSet.has(t)) { match = true; break; }
      if (match) edges.push(makeEdge({ type: EDGE_TYPES.ROLLS_ON, from: rec.id, to: b.id }));
    }
  }

  // Flask/jewel standard mods: same spawn_weights tag predicate, but scoped to the
  // mod-domain's matching base domain. Flask charge mods gate on the universal
  // `default` tag, so without this scoping they'd attach to every base; gating by
  // base domain keeps flask mods on flasks/charms and jewel mods on jewels. All
  // tiers eligible (no per-base tier restriction in the source).
  const tagGated = records.filter((r) => r.origin === 'standard' && TAG_GATED_DOMAINS[r.modDomain] && r.spawnTags.size);
  for (const b of baseRecords) {
    const baseDomain = b.raw.domain;
    const tagSet = new Set(b.raw.tags ?? []);
    if (!tagSet.size) continue;
    for (const rec of tagGated) {
      if (TAG_GATED_DOMAINS[rec.modDomain] !== baseDomain) continue;
      let match = false;
      for (const t of rec.spawnTags) if (tagSet.has(t)) { match = true; break; }
      if (match) edges.push(makeEdge({ type: EDGE_TYPES.ROLLS_ON, from: rec.id, to: b.id }));
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Implicit-mod text resolution (base item implicits + rune-variant options).
// Ported from the former src/data/mods.js resolveImplicits/renderStatLines, with
// rendering removed: returns display *text* (with [keyword] markup) — the app
// applies renderGameText. Implicits are generation_type "unique" in mods.json, so
// they sit outside the rollable index above and are looked up in the raw table.
// ---------------------------------------------------------------------------

let _modsRaw = null;
function modsRaw() {
  if (!_modsRaw) _modsRaw = loadJson(`${REPOE}/mods.json`);
  return _modsRaw;
}

// Stat-id -> its stat_descriptions entry, so an implicit with no mod `text` can
// still be rendered from its stats. Lazily built.
let _statDescById = null;
function statDescById() {
  if (_statDescById) return _statDescById;
  _statDescById = new Map();
  for (const entry of loadJson(`${REPOE}/stat_translations/stat_descriptions.json`)) {
    if (!entry.English?.[0]) continue;
    for (const id of entry.ids ?? []) if (!_statDescById.has(id)) _statDescById.set(id, entry);
  }
  return _statDescById;
}

// Weapon "Adds X to Y <Element> Damage" implicits carry their effect on hidden
// stat ids with no visible translation; they map 1:1 onto the ordinary
// added-damage stats, so unhide the id to reuse the canonical string.
function unhideStatId(id) {
  return id.replace(/^local_weapon_implicit_hidden_added_(min|max)imum_(.+)_damage$/, 'local_$1imum_added_$2_damage');
}

// Elemental-weapon bases convert physical damage to an element via a hidden
// "%_base_damage_is_<element>" flag with no stat_descriptions string, so
// synthesize the canonical conversion line (element/physical wrapped as keywords).
const CONVERT_RE = /^local_weapon_implicit_hidden_%_base_damage_is_(fire|cold|lightning|chaos)$/;

// Render a mod's stats to display-text lines (no HTML). Damage-conversion flags
// are synthesized; everything else goes through stat_descriptions, emitting only
// entries whose values need no numeric transform (empty index_handlers). Returns
// [] when no stat resolves (true internal mechanics, zero-roll placeholders).
function statLineTexts(stats) {
  const map = statDescById();
  const values = new Map();
  for (const s of stats) values.set(unhideStatId(s.id), s);
  const out = [];
  const used = new Set();
  for (const s of stats) {
    const conv = s.id.match(CONVERT_RE);
    if (conv) {
      if (s.min === 0 && s.max === 0) continue;
      const pct = s.min === s.max ? String(s.min) : `(${s.min}–${s.max})`;
      const el = conv[1][0].toUpperCase() + conv[1].slice(1);
      out.push(`${pct}% of [Physical|Physical] Damage Converted to [${el}|${el}] Damage`);
      continue;
    }
    const entry = map.get(unhideStatId(s.id));
    if (!entry || used.has(entry)) continue;
    if (!entry.ids.every((eid) => values.has(eid))) continue;
    const eng = entry.English[0];
    if ((eng.index_handlers ?? []).some((h) => h.length)) continue;
    if (entry.ids.every((eid) => values.get(eid).min === 0 && values.get(eid).max === 0)) continue;
    used.add(entry);
    if (eng.format?.[0] === 'ignore') { out.push(eng.string); continue; }
    let str = eng.string;
    entry.ids.forEach((eid, i) => {
      const v = values.get(eid);
      const num = v.min === v.max ? String(v.min) : `(${v.min}–${v.max})`;
      const sign = eng.format?.[i]?.startsWith('+') && v.min >= 0 ? '+' : '';
      str = str.replace(`{${i}}`, sign + num);
    });
    out.push(str);
  }
  return out;
}

export function resolveImplicitTexts(ids) {
  if (!ids || !ids.length) return [];
  const raw = modsRaw();
  const out = [];
  for (const id of ids) {
    const mod = raw[id];
    if (!mod) continue;
    if (mod.text && mod.text.trim()) {
      out.push({ id, text: mod.text });
    } else if (mod.stats?.length) {
      for (const text of statLineTexts(mod.stats)) out.push({ id, text });
    }
  }
  return out;
}
