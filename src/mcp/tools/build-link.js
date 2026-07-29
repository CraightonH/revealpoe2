// src/mcp/tools/build-link.js — the deliverable tool. The MODEL supplies
// judgment (which gems, which notables); the SERVER owns mechanics and refuses
// to emit a link that would render wrong. Resolution never guesses: ambiguous
// names refuse with the candidate list.
import { slugify } from '../../data/slug.js';
import { err, resolveRef } from './util.js';
import { shortestPath } from '../../../public/js/passive-path.js';
import { allocate } from '../../../public/js/passive-alloc.js';
// NOTE path depth: src/mcp/tools/ -> repo root is ../../.. — verify relative
// paths compile in node BEFORE writing more code (node -e "import('./src/mcp/tools/build-link.js')").

const NOTABLE_KINDS = new Set(['notable', 'keystone', 'ascNotable']);

export async function resolveSpec(backend, planner, spec) {
  const warnings = [];
  const want = (s) => String(s ?? '').toLowerCase();

  const cls = planner.classes.find((c) => c.slug === slugify(spec.class ?? '')
    || c.name.toLowerCase() === want(spec.class));
  if (!cls) {
    return err('not_found', `unknown class '${spec.class}'`, { classes: planner.classes.map((c) => c.slug) });
  }
  let asc = null;
  if (spec.ascendancy) {
    asc = cls.ascendancies.find((a) => a.slug === slugify(spec.ascendancy)
      || a.name.toLowerCase() === want(spec.ascendancy));
    if (!asc) {
      return err('not_found', `'${spec.ascendancy}' is not a ${cls.name} ascendancy`,
        { ascendancies: cls.ascendancies.map((a) => a.slug) });
    }
  }

  const skills = [];
  for (const s of spec.skills ?? []) {
    const g = await resolveRef(backend, ['gem'], s.gem);
    if (g.ambiguous) return err('ambiguous', `gem '${s.gem}' is ambiguous`, { candidates: g.ambiguous });
    if (g.notFound) return err('not_found', `no gem named '${s.gem}'`);
    const pg = planner.gems[g.node.slug];
    if (!pg) return err('unbuildable', `gem '${g.node.name}' is missing from the planner projection`);
    if (pg.source === 'item') warnings.push(`'${g.node.name}' is item-granted — equip the granting unique; the planner cannot socket it directly`);
    const supports = [];
    for (const supName of s.supports ?? []) {
      const sup = await resolveRef(backend, ['gem'], supName);
      if (sup.ambiguous) return err('ambiguous', `support '${supName}' is ambiguous`, { candidates: sup.ambiguous });
      if (sup.notFound) return err('not_found', `no gem named '${supName}'`);
      if (planner.gems[sup.node.slug]?.gemType !== 'support') {
        return err('invalid', `'${sup.node.name}' is not a support gem`);
      }
      supports.push({ slug: sup.node.slug });
    }
    if (supports.length > pg.maxSupports) {
      warnings.push(`${g.node.name}: ${supports.length} supports exceeds its ${pg.maxSupports} sockets`);
    }
    skills.push({ gem: { slug: g.node.slug }, level: s.level ?? null, supports, _name: g.node.name });
  }

  const gear = {};
  for (const [slotId, cell] of Object.entries(spec.gear ?? {})) {
    const slotDef = planner.slots.find((sl) => sl.id === slotId);
    if (!slotDef) return err('not_found', `unknown gear slot '${slotId}'`, { slots: planner.slots.map((sl) => sl.id) });
    const it = await resolveRef(backend, ['unique', 'base'], cell.item);
    if (it.ambiguous) return err('ambiguous', `item '${cell.item}' is ambiguous`, { candidates: it.ambiguous });
    if (it.notFound) return err('not_found', `no item named '${cell.item}'`);
    const pi = planner.items[it.node.slug];
    if (!pi) {
      return err('unbuildable', `'${it.node.name}' (${it.node.props.className ?? it.node.kind}) has no gear slot in the planner — jewels and talismans are not placeable in v1`);
    }
    if (!pi.slots.includes(slotId)) {
      return err('invalid', `'${it.node.name}' does not fit slot '${slotId}'`, { fits: pi.slots });
    }
    const mods = [];
    for (const modName of cell.mods ?? []) {
      const m = await resolveRef(backend, ['affix'], modName);
      if (m.ambiguous) return err('ambiguous', `mod '${modName}' is ambiguous`, { candidates: m.ambiguous });
      if (m.notFound) return err('not_found', `no affix named '${modName}'`);
      mods.push({ affix: m.node.slug });
    }
    gear[slotId] = { item: { kind: it.node.kind, slug: it.node.slug }, mods, corrupted: null };
  }

  const notables = [];
  for (const ref of spec.notables ?? []) {
    if (typeof ref === 'number') {
      const p = await backend.passiveNode(ref);
      if (!p) return err('not_found', `no passive node with hash ${ref}`);
      notables.push(p);
    } else {
      const matches = (await backend.passiveNodesByName(ref)).filter((p) => NOTABLE_KINDS.has(p.kind));
      if (!matches.length) return err('not_found', `no notable named '${ref}' — search with passives()`);
      if (matches.length > 1) {
        return err('ambiguous', `'${ref}' matches ${matches.length} tree nodes — pass a hash`,
          { candidates: matches.map((m) => ({ hash: m.h, name: m.name, ascendancy: m.asc })) });
      }
      notables.push(matches[0]);
    }
  }

  return { cls, asc, skills, gear, notables, warnings };
}

export function greedyAllocate(adj, starts, targetHashes, isPathable) {
  let allocated = new Set();
  const order = [];
  const pending = new Set();
  for (const t of targetHashes) {
    if (starts.includes(t)) order.push(t); // a class start is "free"
    else pending.add(t);
  }
  while (pending.size) {
    let best = null;
    for (const t of pending) {
      if (allocated.has(t)) { best = { t, path: [] }; break; } // picked up en route
      const p = shortestPath(adj, new Set([...allocated, ...starts]), t, { isPathable });
      if (p && (!best || p.length < best.path.length)) best = { t, path: p };
    }
    if (!best) return { unreachable: [...pending] };
    for (const h of best.path) allocated = allocate(adj, allocated, starts, h); // starts is an ARRAY — see traps
    order.push(best.t);
    pending.delete(best.t);
  }
  return { allocated, order };
}

export function isConnected(adj, start, allocated) {
  if (!allocated.size) return true;
  const seen = new Set();
  const q = [start];
  while (q.length) {
    const h = q.pop();
    for (const nb of adj.get(h) ?? []) {
      if (allocated.has(nb) && !seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
  }
  return seen.size === allocated.size;
}

export async function allocateSpecTree(backend, { cls, asc, notables }) {
  const [tm, adj, all] = await Promise.all([backend.treeMeta(), backend.passiveAdj(), backend.passiveNodes()]);
  const info = new Map(all.map((p) => [p.h, p]));
  const startHash = tm.classStarts[cls.name];
  if (startHash == null) return err('invalid', `no tree start for class ${cls.name}`);

  const mainTargets = [];
  const ascTargets = [];
  for (const p of notables) {
    if (p.asc == null) mainTargets.push(p);
    else if (asc && p.asc === asc.gggId) ascTargets.push(p);
    else {
      return err('invalid', `'${p.name}' belongs to ascendancy ${p.asc}, not ${asc ? asc.gggId : '(no ascendancy chosen)'}`);
    }
  }

  // TRAP: isPathable must exclude ascendancy nodes or main paths route through them.
  const isMainPathable = (h) => { const p = info.get(h); return !!p && p.asc == null; };
  const main = greedyAllocate(adj, [startHash], mainTargets.map((p) => p.h), isMainPathable);
  if (main.unreachable) {
    return err('unreachable', `cannot connect to the ${cls.name} start: ${main.unreachable.map((h) => info.get(h)?.name ?? h).join(', ')}`);
  }

  let ascResult = { allocated: new Set(), order: [] };
  if (ascTargets.length) {
    const ascStart = tm.ascStarts[asc.gggId];
    if (ascStart == null) return err('invalid', `no ascendancy start recorded for ${asc.gggId}`);
    const inThisAsc = (h) => info.get(h)?.asc === asc.gggId;
    ascResult = greedyAllocate(adj, [ascStart], ascTargets.map((p) => p.h), inThisAsc);
    if (ascResult.unreachable) {
      return err('unreachable', `ascendancy nodes unreachable from the ${asc.name} start: ${ascResult.unreachable.map((h) => info.get(h)?.name ?? h).join(', ')}`);
    }
  }

  // TRAP: a disconnected tree code decodes fine and renders wrong. Re-verify
  // from scratch — never trust the allocator's own bookkeeping.
  if (!isConnected(adj, startHash, main.allocated)) {
    return err('invalid', 'internal error: emitted main tree is not connected to the class start');
  }

  return {
    mainAllocated: main.allocated, mainOrder: main.order,
    ascAllocated: ascResult.allocated, ascOrder: ascResult.order,
    info, tm,
  };
}
