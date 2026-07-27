// scripts/graph/manual.js — hand-crafted data overlay (builder-only).
//
// Implements the "Data Provenance & Hand-Crafted Data Policy" in CLAUDE.md.
// Relationships/data that genuinely aren't in RePoE source live as declarative
// overlay files under data/manual/*.json. This module loads them, expands each
// rule against the already-built SOURCE graph, and returns nodes/edges stamped
// source:'manual' (irreducible hand facts) or source:'derived' (builder-expanded
// from a rule), each derived element carrying a `via` basis pointer.
//
// Author RULES, not enumerations: an overlay states the irreducible fact (e.g.
// "this default-skill gem belongs to this weapon class") and the handler expands
// it (an edge per base in that class), so new source bases pick it up for free.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeNode, makeEdge, KINDS, EDGE_TYPES, SOURCES } from './schema.js';
import { resolveImplicitTexts } from './affixes.js';
import { slugify } from '../../src/data/slug.js';
import { loadJson } from './loader.js';
import { REPOE } from './source.js';
import { getFlavourLines } from './flavour.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANUAL_DIR = path.join(ROOT, 'data', 'manual');

function overlayFiles() {
  if (!fs.existsSync(MANUAL_DIR)) return [];
  return fs.readdirSync(MANUAL_DIR).filter((f) => f.endsWith('.json')).sort();
}

// Combined hash of overlay file contents, so the staleness guard can tell
// "source changed" apart from "overlay changed". Stable when data/manual is absent.
export function hashManual() {
  const h = crypto.createHash('sha256');
  for (const f of overlayFiles()) h.update(fs.readFileSync(path.join(MANUAL_DIR, f)));
  return h.digest('hex');
}

// --- Expansion handlers, keyed by an overlay file's `kind`. -----------------
// Each receives (data, ctx, via) and returns { nodes, edges, errors, warnings }.
// Referential failures (a key that no longer resolves to a live source node) are
// ERRORS — they fail the build rather than silently dropping a relationship.

// "Default attack skill per weapon class." Overlay shape:
//   { "kind": "weapon-default-skills",
//     "map": { "<default-skill gem metadata key>": "<class slug>" | ["<slug>", ...], ... } }
// A gem may serve more than one class (e.g. 2H weapons inherit the 1H default
// attack), so the value is a class slug or an array of them. Expands to a
// `default_skill` edge from every base in each class to the gem.
function expandWeaponDefaultSkills(data, ctx, via) {
  const edges = [];
  const errors = [];
  for (const [gemId, classValue] of Object.entries(data.map ?? {})) {
    const gem = ctx.node(gemId);
    if (!gem || gem.kind !== 'gem') {
      errors.push(`${via}: '${gemId}' is not a live gem node (source renamed/removed?)`);
      continue;
    }
    for (const classSlug of Array.isArray(classValue) ? classValue : [classValue]) {
      const bases = ctx.basesByClassSlug(classSlug);
      if (!bases.length) {
        errors.push(`${via}: base class slug '${classSlug}' has no bases (gem ${gemId})`);
        continue;
      }
      for (const base of bases) {
        edges.push(makeEdge({
          type: EDGE_TYPES.DEFAULT_SKILL,
          from: base.id,
          to: gemId,
          source: SOURCES.DERIVED,
          via,
        }));
      }
    }
  }
  return { nodes: [], edges, errors, warnings: [] };
}

// "Gear slot taxonomy + class→slot rules." Overlay shape:
//   { "kind": "gear-slots",
//     "slots": [ { id, name, group?, accepts?, order? }, ... ],
//     "classRules": [ { class: "<item class id>", slots: [slotId,...], requiresMainhand?: [classSlug,...] }, ... ] }
// Emits a gear-slot node per slot (source:manual) and a derived fits_slot edge
// from every base in each rule's class to each listed slot. Two-hand occupancy
// is NOT authored here — it is derived from the source `twohand` tag downstream.
function expandGearSlots(data, ctx, via) {
  const nodes = [];
  const edges = [];
  const errors = [];
  const warnings = [];

  const slotIds = new Set();
  for (const s of data.slots ?? []) {
    if (!s.id || !s.name) { errors.push(`${via}: slot entry missing id/name (${JSON.stringify(s)})`); continue; }
    slotIds.add(s.id);
    nodes.push(makeNode({
      id: `Slot/${s.id}`,
      kind: KINDS.GEAR_SLOT,
      name: s.name,
      slug: s.id,
      source: SOURCES.MANUAL,
      props: {
        group: s.group ?? null,
        accepts: s.accepts ?? null,
        order: s.order ?? null,
      },
    }));
  }

  const mapped = new Set();
  for (const rule of data.classRules ?? []) {
    const bases = ctx.basesByClassId(rule.class);
    if (!bases.length) {
      errors.push(`${via}: item class '${rule.class}' has no bases (renamed/removed in source?)`);
      continue;
    }
    if (!Array.isArray(rule.slots) || rule.slots.length === 0) {
      errors.push(`${via}: class '${rule.class}' has no slots`);
      continue;
    }
    mapped.add(rule.class);
    if (Array.isArray(rule.requiresMainhand)) {
      const knownSlugs = ctx.classSlugs();
      for (const slug of rule.requiresMainhand) {
        if (!knownSlugs.includes(slug)) {
          errors.push(`${via}: class '${rule.class}' requiresMainhand references unknown class slug '${slug}'`);
        }
      }
    }
    for (const slotId of rule.slots ?? []) {
      if (!slotIds.has(slotId)) {
        errors.push(`${via}: class '${rule.class}' references unknown slot '${slotId}'`);
        continue;
      }
      const props = rule.requiresMainhand ? { requiresMainhand: rule.requiresMainhand } : undefined;
      for (const base of bases) {
        edges.push(makeEdge({
          type: EDGE_TYPES.FITS_SLOT,
          from: base.id,
          to: `Slot/${slotId}`,
          source: SOURCES.DERIVED,
          via,
          props,
        }));
      }
    }
  }

  // Coverage audit: any source item class not mapped to a slot is surfaced (not silent).
  for (const classId of ctx.classIds()) {
    if (!mapped.has(classId)) warnings.push(`${via}: unmapped item class '${classId}' — no gear slot assigned`);
  }

  return { nodes, edges, errors, warnings };
}

// The three cultural origins GGG assigns (ggpk Origin table). A unique either has
// one of these or none — the overlay only lists those that do.
const ORIGINS = new Set(['Kalguuran', 'Ezomyte', 'Vaal']);

// "Cultural origin per unique." Overlay shape:
//   { "kind": "unique-origins",
//     "entries": [ { unique, vid, origin }, ... ] }
// vid = RePoE visual_identity.id (durable, ASCII-safe join key). Attaches
// props.origin to the one unique node with that vid. `unique` (human name) is a
// readability + drift cross-check only, not the join key.
function expandUniqueOrigins(data, ctx, via) {
  const patches = [];
  const errors = [];
  const warnings = [];
  for (const e of data.entries ?? []) {
    if (!e || !e.vid) { errors.push(`${via}: entry missing vid (${JSON.stringify(e)})`); continue; }
    if (!ORIGINS.has(e.origin)) { errors.push(`${via}: '${e.vid}' (${e.unique}) has unknown origin '${e.origin}'`); continue; }
    const node = resolveVid(ctx, e, via, errors, warnings);
    if (!node) continue;
    patches.push({ id: node.id, props: { origin: e.origin } });
  }
  return { nodes: [], edges: [], patches, errors, warnings };
}

// "Cultivated (mutated Vaal) mods per unique." Overlay shape:
//   { "kind": "cultivated-uniques",
//     "entries": [ { unique, vid, mods: [<repoe mod id>, ...] }, ... ] }
// Resolves each RePoE mod id -> display-text line(s) via the injected resolver and
// attaches props.cultivatedMods = [ { modId, texts:[...] }, ... ]. An unresolvable
// mod id (renamed/removed in a RePoE re-scrape) fails the build.
function expandCultivatedUniques(data, ctx, via) {
  const patches = [];
  const errors = [];
  const warnings = [];
  for (const e of data.entries ?? []) {
    if (!e || !e.vid) { errors.push(`${via}: entry missing vid (${JSON.stringify(e)})`); continue; }
    const node = resolveVid(ctx, e, via, errors, warnings);
    if (!node) continue;
    const cultivatedMods = [];
    for (const modId of e.mods ?? []) {
      const texts = ctx.resolveModTexts(modId);
      if (!texts || !texts.length) {
        errors.push(`${via}: mod '${modId}' (${e.unique}) not resolvable in RePoE mods.json`);
        continue;
      }
      cultivatedMods.push({ modId, texts });
    }
    if (cultivatedMods.length) patches.push({ id: node.id, props: { cultivatedMods } });
  }
  return { nodes: [], edges: [], patches, errors, warnings };
}

// Resolve an overlay entry's `vid` to exactly one live unique node. Missing or
// ambiguous vid is a build ERROR (a rename/removal can't silently drop data); a
// name that disagrees with the resolved node is a soft WARNING (stale vid).
function resolveVid(ctx, entry, via, errors, warnings) {
  const matches = ctx.nodesByVid(entry.vid);
  if (!matches.length) { errors.push(`${via}: no unique node for vid '${entry.vid}' (${entry.unique})`); return null; }
  if (matches.length > 1) { errors.push(`${via}: vid '${entry.vid}' is ambiguous — ${matches.map((n) => n.name).join(', ')}`); return null; }
  const node = matches[0];
  if (entry.unique && entry.unique !== node.name) {
    warnings.push(`${via}: name mismatch for vid '${entry.vid}' — overlay '${entry.unique}' vs node '${node.name}' (stale vid?)`);
  }
  return node;
}

// "Required character level per gem level." Overlay shape (GENERATED, not hand-authored —
// see scripts/ggpk/extract-gem-levels.js):
//   { "kind": "gem-levels", "reqLevelByGem": { "<gem base-item metadata id>": [reqLvl@1..20] } }
// This data lives only in the GGPK game tables (RePoE has no per-gem-level requirement),
// so it's extracted through a canaried build step and patched onto the gem node as a
// `reqLevels` prop; the gem page derives the Requires-Level + attribute columns from it.
// Bulk generated data: gem ids absent from the graph (excluded/unreleased) are skipped,
// NOT errors — unlike the hand-authored overlays whose every reference must resolve.
function expandGemLevels(data, ctx, via) {
  const patches = [];
  let skipped = 0;
  for (const [gemId, reqLevels] of Object.entries(data.reqLevelByGem ?? {})) {
    const node = ctx.node(gemId);
    if (!node || node.kind !== 'gem') { skipped += 1; continue; }
    patches.push({ id: gemId, props: { reqLevels } });
  }
  const warnings = skipped
    ? [`${via}: ${skipped} generated gem-level entries had no matching gem node (excluded/unreleased) — skipped`]
    : [];
  return { nodes: [], edges: [], errors: [], warnings, patches };
}

// "Gemling Legionnaire alternate quality." Overlay shape (GENERATED, not hand-authored —
// see scripts/ggpk/extract-gem-quality.js):
//   { "kind": "gem-quality", "altQualityBySkill": { "<skillKey>": [ { set, stats:[{id,permille}] } ] } }
// The RENDERING + attachment onto gem effect sections is owned by scripts/graph/gems.js
// (it needs the per-section stat_set context, lost by the time overlays run). This handler
// exists so the generated file is a first-class overlay — it participates in manualHash
// (staleness) and enforces the referential-integrity/retirement guard: every alt-quality
// skill key must still resolve to a live skill node. A stale key (RePoE renamed/removed the
// skill) is warned, not errored — this is bulk generated data, like gem-levels.
function expandGemQuality(data, ctx, via) {
  let stale = 0;
  for (const key of Object.keys(data.altQualityBySkill ?? {})) {
    const node = ctx.node(key);
    if (!node || node.kind !== 'skill') stale += 1;
  }
  const warnings = stale
    ? [`${via}: ${stale} alt-quality skill keys no longer resolve to a skill node (renamed/removed upstream) — regenerate: npm run build:gem-quality`]
    : [];
  return { nodes: [], edges: [], errors: [], warnings, patches: [] };
}

// "Skill weapon requirements." Overlay shape (GENERATED — see
// scripts/ggpk/extract-weapon-reqs.js):
//   { "kind": "weapon-reqs", "weaponReqByActiveSkill": { "<activeSkillId>": { reqId, classIds } } }
// Rendering (raw fact → "Requires: Crossbows" label) and attachment onto gem nodes is
// owned by scripts/graph/weaponReqs.js + gems.js — they hold the gem→skill→active_skill.id
// mapping that the overlay pass lacks. This handler exists so the generated file is a
// first-class overlay (participates in manualHash) and guards against a botched
// extraction: an empty payload means the GGPK join produced nothing.
function expandWeaponReqs(data, ctx, via) {
  const count = Object.keys(data.weaponReqByActiveSkill ?? {}).length;
  const warnings = count === 0
    ? [`${via}: no weapon requirements in the overlay — extraction may have failed; regenerate: npm run build:weapon-reqs`]
    : [];
  return { nodes: [], edges: [], errors: [], warnings, patches: [] };
}

// Strip a pool mod id down to the stem that identifies its SOURCE unique:
// 'UniqueLoreweaveSnakepit2' + prefix 'UniqueLoreweave' -> 'Snakepit'. Drops the
// 'BigRange' marker, any 'CombinedWithBase…' qualifier, and the trailing ordinal.
function poolModStem(modId, prefix) {
  return modId
    .slice(prefix.length)
    .replace('BigRange', '')
    .replace(/CombinedWithBase.*$/, '')
    .replace(/\d+$/, '');
}

// "Pool-driven uniques" — items whose mods are a craftable POOL, not a fixed stat
// block, so Path of Building's (name, base, fixed mods) format cannot express them
// and they are absent from pob-uniques entirely. Overlay shape:
//   { "kind": "pool-uniques",
//     "entries": [ { unique, vid, modPrefix, poolLabel, note[], baseLabel? }, … ],
//     "sourceUniques": { "<mod stem>": "<source unique display name>" | null } }
//
// This is the ONLY handler that CREATES unique nodes — every other overlay patches
// nodes the source builder already produced. The hand-authored surface is just the
// vid, the mod-id prefix and the honesty note; the builder derives the metadata
// (from RePoE uniques.json via vid), the mod display text (mods.json) and the
// flavour. `BigRange` twins are counted but NOT listed: they are wider-range
// duplicates of an effect already in the pool, so rendering both would imply more
// distinct mods than exist. Emits one `pool_source` edge per source unique so a
// ring page can reverse-traverse to "weaves into Loreweave".
function expandPoolUniques(data, ctx, via) {
  const nodes = [];
  const edges = [];
  const errors = [];
  const warnings = [];
  const sourceUniques = data.sourceUniques ?? {};
  const created = new Map(); // display name -> node id, so entries can reference each other
  const pending = []; // { fromId, fromName, sourceNames:Set }

  for (const e of data.entries ?? []) {
    if (!e || !e.vid || !e.unique || !e.modPrefix) {
      errors.push(`${via}: entry needs unique+vid+modPrefix (${JSON.stringify(e)})`);
      continue;
    }
    // A pool unique must NOT already exist: if PoB (or RePoE) starts shipping it,
    // the source copy wins and this entry has to go — otherwise we'd emit a
    // duplicate node under the same id.
    if (ctx.nodesByVid(e.vid).length) {
      warnings.push(`retire ${via}: '${e.unique}' (vid ${e.vid}) now has a source-built node — remove the overlay entry`);
      continue;
    }
    const meta = ctx.uniqueMetaByVid(e.vid);
    if (!meta) {
      errors.push(`${via}: no RePoE uniques.json entry for vid '${e.vid}' (${e.unique}) — renamed or removed?`);
      continue;
    }
    if (meta.name !== e.unique) {
      warnings.push(`${via}: name mismatch for vid '${e.vid}' — overlay '${e.unique}' vs RePoE '${meta.name}' (stale vid?)`);
    }

    const modIds = ctx.modIdsByPrefix(e.modPrefix);
    if (!modIds.length) {
      errors.push(`${via}: mod prefix '${e.modPrefix}' (${e.unique}) matches no mods in RePoE mods.json`);
      continue;
    }
    const poolMods = [];
    let wideRangeCount = 0;
    const sourceNames = new Set();
    for (const modId of modIds) {
      if (modId.includes('BigRange')) { wideRangeCount += 1; continue; }
      const texts = ctx.resolveModTexts(modId);
      if (!texts || !texts.length) {
        errors.push(`${via}: mod '${modId}' (${e.unique}) not resolvable in RePoE mods.json`);
        continue;
      }
      const stem = poolModStem(modId, e.modPrefix);
      // Attribution is opt-in: a stem absent from sourceUniques simply has no
      // origin (the item's own mods), and an explicit null means "deliberately
      // unattributed" — see the _sourceUniquesDoc note about Emerald/Sapphire.
      const sourceUnique = Object.hasOwn(sourceUniques, stem) ? sourceUniques[stem] : null;
      if (sourceUnique) sourceNames.add(sourceUnique);
      poolMods.push({ modId, texts, sourceUnique });
    }
    if (!poolMods.length) {
      errors.push(`${via}: '${e.unique}' resolved no pool mods from prefix '${e.modPrefix}'`);
      continue;
    }

    const { className, classSlug } = ctx.canonicalClass(meta.item_class);
    const slug = slugify(e.unique);
    const id = `Unique/${meta.id}`;
    const note = Array.isArray(e.note) ? e.note : [];
    const props = {
      // Pool uniques have no fixed base. `base` stays null so nothing downstream
      // mistakes a label for a real base name (tradeUrl, getBaseByName); the
      // human-facing string rides along as baseLabel.
      base: null,
      // Falls back to the raw item class ("Ring", "Jewel") so the card's type line
      // is never blank; entries override it where the item is genuinely unbound to
      // one base (Loreweave -> "Any Body Armour").
      baseLabel: e.baseLabel ?? meta.item_class ?? null,
      itemClass: meta.item_class,
      className,
      classSlug,
      vid: e.vid,
      iconDds: meta.visual_identity?.dds_file ?? null,
      flavour: ctx.flavourForVid(e.vid),
      inventorySize: { w: meta.inventory_width, h: meta.inventory_height },
      // toUnique() in src/data/uniques.js indexes props.variants[currentIndex] for
      // implicits/explicits. A pool unique has no guaranteed mods, so it presents
      // as a single empty variant and renders from poolMods instead.
      currentIndex: 0,
      variants: [{ name: null, implicits: [], explicits: [] }],
      isPool: true,
      poolLabel: e.poolLabel ?? 'Possible Mods',
      poolNote: note,
      poolMods,
      wideRangeCount,
    };
    const search = [e.unique, className, e.baseLabel ?? '', ...poolMods.flatMap((m) => m.texts), ...(props.flavour ?? [])]
      .join(' ')
      .toLowerCase();

    nodes.push(makeNode({
      id, kind: KINDS.UNIQUE, name: e.unique, slug, props, search,
      source: SOURCES.DERIVED, via,
    }));
    created.set(e.unique, id);
    pending.push({ fromId: id, fromName: e.unique, sourceNames });
  }

  // Resolve origin edges only after every entry exists, so pool uniques can point
  // at each other (Loreweave weaves Grip of Kulemak, which this same pass creates).
  for (const { fromId, fromName, sourceNames } of pending) {
    for (const name of sourceNames) {
      const toId = created.get(name) ?? ctx.uniqueIdByName(name);
      if (!toId) {
        errors.push(`${via}: source unique '${name}' (in ${fromName}'s pool) resolves to no unique node — renamed in RePoE/PoB?`);
        continue;
      }
      if (toId === fromId) continue; // an item is not its own origin
      edges.push(makeEdge({
        type: EDGE_TYPES.POOL_SOURCE, from: fromId, to: toId,
        source: SOURCES.DERIVED, via,
      }));
    }
  }
  return { nodes, edges, errors, warnings };
}

// "Known-gaps allowlist" — data only; the reconciliation that consumes it runs
// after every handler in applyOverlays (it has to see nodes this pass created).
function expandUniqueGaps(data, ctx, via) {
  const errors = [];
  for (const e of data.accepted ?? []) {
    if (!e || !e.unique) { errors.push(`${via}: accepted entry missing 'unique' (${JSON.stringify(e)})`); continue; }
    if (!e.why) errors.push(`${via}: '${e.unique}' needs a 'why' documenting what was checked`);
  }
  return { nodes: [], edges: [], errors, warnings: [] };
}

const HANDLERS = {
  'weapon-default-skills': expandWeaponDefaultSkills,
  'gear-slots': expandGearSlots,
  'unique-origins': expandUniqueOrigins,
  'cultivated-uniques': expandCultivatedUniques,
  'pool-uniques': expandPoolUniques,
  'unique-gaps': expandUniqueGaps,
  'gem-levels': expandGemLevels,
  'gem-quality': expandGemQuality,
  'weapon-reqs': expandWeaponReqs,
};

// Read overlay files from disk as [{ name, data }] (sorted, deterministic). A
// file that fails to parse becomes { name, parseError } so applyOverlays can
// turn it into a build error rather than throwing here.
function loadOverlays() {
  return overlayFiles().map((file) => {
    const name = file.replace(/\.json$/, '');
    try {
      return { name, data: JSON.parse(fs.readFileSync(path.join(MANUAL_DIR, file), 'utf8')) };
    } catch (err) {
      return { name, parseError: err.message };
    }
  });
}

// Pure expansion: apply the given overlays against the source graph. Separated
// from disk I/O so the guardrails (referential integrity, retirement) are
// unit-testable. `overlays` is [{ name, data } | { name, parseError }].
// Returns the overlay's own nodes/edges plus build-blocking `errors` and
// non-blocking `warnings` (e.g. retirement notices).
// `resolveModTexts(modId) -> string[]` resolves a RePoE mod id to its display-text
// line(s); injected so applyOverlays stays pure/testable (build wires the real
// affixes-backed resolver; tests pass a stub). Defaults to "unknown" (empty).
export function applyOverlays({
  nodes,
  edges,
  overlays,
  resolveModTexts = () => [],
  // Injected RePoE readers for the pool-uniques handler + the reconciliation
  // guardrail (kept as injections so applyOverlays stays pure/testable).
  uniqueMetaByVid = () => null,
  modIdsByPrefix = () => [],
  flavourForVid = () => null,
  repoeUniqueNames = () => [],
}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const basesByClass = new Map();
  const basesByClassId = new Map();
  const classIdSet = new Set();
  const nodesByVid = new Map();
  for (const n of nodes) {
    if (n.kind === 'unique' && n.props?.vid) {
      if (!nodesByVid.has(n.props.vid)) nodesByVid.set(n.props.vid, []);
      nodesByVid.get(n.props.vid).push(n);
    }
    if (n.kind !== 'base') continue;
    const cs = n.props?.classSlug;
    if (cs) {
      if (!basesByClass.has(cs)) basesByClass.set(cs, []);
      basesByClass.get(cs).push(n);
    }
    const ci = n.props?.itemClass;
    if (ci) {
      classIdSet.add(ci);
      if (!basesByClassId.has(ci)) basesByClassId.set(ci, []);
      basesByClassId.get(ci).push(n);
    }
  }
  // Unique display name -> node id, for pool-mod origin resolution. First write
  // wins, mirroring the name indexes elsewhere in the builder.
  const uniqueIdByName = new Map();
  for (const n of nodes) {
    if (n.kind === 'unique' && !uniqueIdByName.has(n.name)) uniqueIdByName.set(n.name, n.id);
  }

  const ctx = {
    node: (id) => byId.get(id) ?? null,
    basesByClassSlug: (slug) => basesByClass.get(slug) ?? [],
    basesByClassId: (id) => basesByClassId.get(id) ?? [],
    classIds: () => [...classIdSet],
    classSlugs: () => [...basesByClass.keys()],
    nodesByVid: (vid) => nodesByVid.get(vid) ?? [],
    uniqueIdByName: (name) => uniqueIdByName.get(name) ?? null,
    // Normalize a raw RePoE item_class to the canonical class the base nodes use
    // ("Body Armour" -> {className:'Body Armours', classSlug:'body-armour'}), the
    // same rule scripts/graph/uniques.js classify() applies. Classes with no
    // browsable bases (jewels, flasks, charms) keep the raw name.
    canonicalClass: (rawItemClass) => {
      const slug = slugify(rawItemClass);
      const bases = basesByClass.get(slug);
      return { className: bases?.[0]?.props?.className ?? rawItemClass, classSlug: slug };
    },
    resolveModTexts,
    uniqueMetaByVid,
    modIdsByPrefix,
    flavourForVid,
  };

  const outNodes = [];
  const outEdges = [];
  const errors = [];
  const warnings = [];

  for (const ov of overlays) {
    const via = `manual:${ov.name}`;
    if (ov.parseError) {
      errors.push(`${via}: invalid JSON — ${ov.parseError}`);
      continue;
    }
    const handler = HANDLERS[ov.data.kind];
    if (!handler) {
      errors.push(`${via}: unknown overlay kind '${ov.data.kind}'`);
      continue;
    }
    const res = handler(ov.data, ctx, via);
    outNodes.push(...res.nodes);
    outEdges.push(...res.edges);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
    // Prop patches mutate an existing (source-built) node in place. build.js
    // spreads the same node objects into the artifact, so the merged prop ships.
    // Retirement guard: if source ever populates the same prop, warn to remove
    // the overlay entry (source wins) rather than silently overwriting.
    for (const p of res.patches ?? []) {
      const node = byId.get(p.id);
      if (!node) { errors.push(`${via}: patch target '${p.id}' not found`); continue; }
      for (const [k, v] of Object.entries(p.props)) {
        if (node.props[k] !== undefined && node.props[k] !== null) {
          warnings.push(`retire ${via}: node ${p.id} already has prop '${k}' from source — remove the overlay entry`);
          continue;
        }
        node.props[k] = v;
      }
    }
  }

  // --- Unique reconciliation guardrail -------------------------------------
  // The source builder enumerates unique NODES from pob-uniques/*.json and uses
  // RePoE's uniques.json only as a name-keyed metadata join, which makes Path of
  // Building — not RePoE — the existence oracle for uniques. Anything PoB has no
  // text block for silently got no node: that is how Loreweave went missing for a
  // whole league without the build ever going red. So diff the two every build and
  // require every hole to be explicitly accepted.
  const gapsOverlay = overlays.find((o) => !o.parseError && o.data?.kind === 'unique-gaps');
  const accepted = new Map((gapsOverlay?.data?.accepted ?? []).map((e) => [e.unique, e]));
  const builtNames = new Set(
    [...nodes, ...outNodes].filter((n) => n.kind === 'unique').map((n) => n.name),
  );
  const repoeNames = repoeUniqueNames();
  const unexpected = repoeNames.filter((n) => !builtNames.has(n) && !accepted.has(n));
  for (const name of unexpected) {
    warnings.push(
      `unique gap: RePoE ships '${name}' but no node was built (PoB has no block for it). `
      + 'Curate it in data/manual/pool-uniques.json, or accept the hole explicitly in data/manual/unique-gaps.json.',
    );
  }
  for (const name of accepted.keys()) {
    if (builtNames.has(name)) {
      warnings.push(`retire manual:unique-gaps: '${name}' now has a node — remove the accepted-gap entry.`);
    } else if (!repoeNames.includes(name)) {
      warnings.push(`stale manual:unique-gaps: '${name}' is gone from RePoE uniques.json — remove the accepted-gap entry.`);
    }
  }
  const reconciliation = {
    built: builtNames.size,
    repoe: repoeNames.length,
    acceptedGaps: accepted.size,
    unexpected,
  };

  // Retirement detection: if source already expresses an identical relationship
  // (same type/from/to), the hand-authored copy is redundant — drop it and warn
  // so it can be deleted. Source always wins.
  const sourceEdgeKeys = new Set(edges.map((e) => `${e.type}|${e.from}|${e.to}`));
  const kept = [];
  for (const e of outEdges) {
    const key = `${e.type}|${e.from}|${e.to}`;
    if (sourceEdgeKeys.has(key)) {
      warnings.push(`retire ${e.via ?? 'manual'}: source now provides ${key} — remove the overlay entry`);
      continue;
    }
    kept.push(e);
  }

  return { nodes: outNodes, edges: kept, errors, warnings, reconciliation };
}

// Build-facing entry: load overlays from data/manual and apply them. `nodes`/
// `edges` are the source-derived graph built so far. Injects the real mod-text
// resolver (RePoE mods.json via the shared affix renderer) for overlays that
// resolve mod ids to display text (cultivated-uniques).
// --- RePoE readers for the pool-uniques handler + reconciliation ------------
// Lazily built and cached: uniques.json / mods.json are large, and only these two
// overlays need them.
let _uniqueMeta = null;
function uniqueMetaIndex() {
  if (_uniqueMeta) return _uniqueMeta;
  const raw = loadJson(`${REPOE}/uniques.json`);
  const byVid = new Map();
  const names = [];
  const seenName = new Set();
  for (const v of Object.values(raw)) {
    if (!v.name || v.is_alternate_art) continue;
    const vid = v.visual_identity?.id;
    // First write wins per vid, mirroring buildMetaByName's name-keyed dedup. A
    // name can legitimately carry several vids (Grip of Kulemak ships five art
    // variants), so the vid index is the finer-grained one.
    if (vid && !byVid.has(vid)) byVid.set(vid, v);
    if (!seenName.has(v.name)) { seenName.add(v.name); names.push(v.name); }
  }
  _uniqueMeta = { byVid, names };
  return _uniqueMeta;
}

let _modIds = null;
function modIdList() {
  if (!_modIds) _modIds = Object.keys(loadJson(`${REPOE}/mods.json`));
  return _modIds;
}

export function manualOverlay({ nodes, edges }) {
  const resolveModTexts = (modId) => resolveImplicitTexts([modId]).map((x) => x.text);
  return applyOverlays({
    nodes,
    edges,
    overlays: loadOverlays(),
    resolveModTexts,
    uniqueMetaByVid: (vid) => uniqueMetaIndex().byVid.get(vid) ?? null,
    modIdsByPrefix: (prefix) => modIdList().filter((id) => id.startsWith(prefix)),
    flavourForVid: (vid) => getFlavourLines(vid),
    repoeUniqueNames: () => uniqueMetaIndex().names,
  });
}
