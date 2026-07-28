// public/js/build-file.js
// Pure ES module — our build -> GGG's official in-game Build Planner file
// (`.build`, JSON, v1 Experimental; pathofexile.com/developer/docs/game).
//
// Every id space here was confirmed against REAL .build files exported by the
// game, committed at test/fixtures/build-files/ (see its README):
//   passives[].id  PassiveSkills string id ("spells18") — NOT the node hash
//   skills[].id    BaseItemTypes metadata id, verbatim from the graph node key
//   ascendancy     GGG ascendancy id ("Witch1")
//   weapon_set     1 | 2, from the tree code's trailing-record subType
//
// Unmappable pieces are SKIPPED, never emitted with a guessed id: a file the
// game rejects is worse than one that omits a slot.
import { decode as decodePassiveCode } from './passive-code.js';
import { resolveMod, orderMods, baseSlugOf } from './mod-core.js';

/**
 * Our gear slot id -> GGG Inventories table id. Hand-authored export-format
 * glue (not game data, so not a data/manual overlay — same class of thing as
 * tradeUrl's mappings). The 13 slots the real fixtures exercised are observed;
 * `Offhand2`/`Flask2` follow the established `*1`/`*2` pattern and are pending
 * an in-game import check.
 */
export const SLOT_TO_INVENTORY = {
  weapon1a: 'Weapon1',
  weapon1b: 'Offhand1',
  weapon2a: 'Weapon2',
  weapon2b: 'Offhand2',
  helmet: 'Helm1',
  body: 'BodyArmour1',
  gloves: 'Gloves1',
  boots: 'Boots1',
  belt: 'Belt1',
  amulet: 'Amulet1',
  ring1: 'Ring1',
  ring2: 'Ring2',
  flask1: 'Flask1',
  flask2: 'Flask2',
  charm1: 'Charm1',
};

// Weapon-set trailing records: subType 0x02 = set I, 0x03 = set II. The docs
// call weapon_set a 0-2 index; the real fixtures only ever use 1 and 2.
const WS_FOR_SUBTYPE = { 2: 1, 3: 2 };

/** A filesystem-safe `<name>.build`. */
export function buildFileName(name) {
  const safe = String(name ?? '')
    .replace(/[\\/:*?"<>|\n\r\t](?:\s*[\\/:*?"<>|\n\r\t])*\s*/g, '_')
    .trim().slice(0, 60);
  return `${safe || 'build'}.build`;
}

// Allocated hashes in a stable order, plus which weapon set (if any) each
// belongs to. A garbage/legacy code degrades to "nothing allocated" rather than
// exploding the whole export.
function allocations(code) {
  if (!code) return [];
  let state;
  try { state = decodePassiveCode(code); } catch { return []; }
  const out = [];
  for (const h of state.nodes ?? []) out.push({ h, ws: null });
  for (const h of state.ascNodes ?? []) out.push({ h, ws: null });
  for (const r of state.records?.trailing ?? []) {
    const ws = WS_FOR_SUBTYPE[r.subType];
    if (ws) out.push({ h: r.hash, ws });
  }
  return out;
}

function modLines(cell, pools) {
  if (!pools) return [];
  const baseSlug = baseSlugOf(pools, cell.item);
  return orderMods(pools, cell.mods, baseSlug)
    .map((m) => resolveMod(pools, m, baseSlug)).filter(Boolean).map((m) => m.text);
}

function inventorySlot(slotId, cell, { pools, resolveRef }) {
  const inventory_id = SLOT_TO_INVENTORY[slotId];
  if (!inventory_id || !cell?.item) return null;
  const slot = { inventory_id, slot_x: 0, slot_y: 0 };
  const name = resolveRef(cell.item)?.name ?? cell.item.slug;
  const corrupted = cell.corrupted && pools
    ? resolveMod(pools, cell.corrupted, baseSlugOf(pools, cell.item)) : null;

  if (cell.item.kind === 'unique') {
    slot.unique_name = name;
    if (corrupted) slot.additional_text = `Corrupted\n${corrupted.text}`;
    return slot;
  }
  // Planned (non-unique) items travel as a hint in the fixtures' own
  // convention: base name, then 1.-numbered target modifiers.
  const lines = modLines(cell, pools);
  const parts = [name, ...lines.map((t, i) => `${i + 1}. ${t}`)];
  if (corrupted) parts.push(`Corrupted: ${corrupted.text}`);
  slot.additional_text = parts.join('\n');
  return slot;
}

function skillEntry(gemSlug, supports, gemIds) {
  const id = gemIds[gemSlug];
  if (!id) return null;                       // never emit an id the game can't resolve
  const support_skills = (supports ?? [])
    .map((s) => gemIds[s.slug]).filter(Boolean).map((sid) => ({ id: sid }));
  return support_skills.length ? { id, support_skills } : { id };
}

/**
 * Our build -> a `Build` object ready to `JSON.stringify` into a `.build` file.
 * @param {object} build
 * @param {{ids: {gemIds: object, ascendancyIds: object, passiveIds: object},
 *          pools: object, resolveRef: (ref: object) => ({name?: string}|null),
 *          grantedRows?: (build: object) => {key: string, skill: string, supports: object[]}[]}} ctx
 * @returns {object}
 */
export function buildToBuildFile(build, ctx) {
  const { ids, pools, resolveRef, grantedRows } = ctx;
  const { gemIds = {}, ascendancyIds = {}, passiveIds = {} } = ids ?? {};

  const out = { name: String(build.name ?? 'Untitled Build') };
  if (build.description) out.description = build.description;
  const asc = build.ascendancy ? ascendancyIds[build.ascendancy] : null;
  if (asc) out.ascendancy = asc;

  // ---- passives: notablePriority first (this drives the in-game
  //      "allocate next" line), then everything else still allocated.
  const alloc = allocations(build.tree?.code);
  const wsByHash = new Map(alloc.map((a) => [a.h, a.ws]));
  const allocated = new Set(alloc.map((a) => a.h));
  const prioritized = (build.tree?.notablePriority ?? []).filter((h) => allocated.has(h));
  const seen = new Set(prioritized);
  const ordered = [...prioritized];
  for (const a of alloc) if (!seen.has(a.h)) { seen.add(a.h); ordered.push(a.h); }
  out.passives = ordered.flatMap((h) => {
    const id = passiveIds[String(h)];
    if (!id) return [];                       // e.g. unnamed filler nodes
    const ws = wsByHash.get(h);
    return [ws ? { id, weapon_set: ws } : { id }];
  });

  // ---- skills: authored setups, then item-granted ones.
  const granted = grantedRows ? grantedRows(build) : [];
  out.skills = [
    ...(build.skills ?? []).map((s) => skillEntry(s.gem?.slug, s.supports, gemIds)),
    ...granted.map((r) => skillEntry(r.skill, r.supports, gemIds)),
  ].filter(Boolean);

  // ---- inventory
  out.inventory_slots = Object.entries(build.gear ?? {})
    .map(([slotId, cell]) => inventorySlot(slotId, cell, { pools, resolveRef }))
    .filter(Boolean);

  return out;
}
