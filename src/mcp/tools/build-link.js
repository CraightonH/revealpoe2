// src/mcp/tools/build-link.js — the deliverable tool. The MODEL supplies
// judgment (which gems, which notables); the SERVER owns mechanics and refuses
// to emit a link that would render wrong. Resolution never guesses: ambiguous
// names refuse with the candidate list.
import { slugify } from '../../data/slug.js';
import { err, resolveRef } from './util.js';

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
