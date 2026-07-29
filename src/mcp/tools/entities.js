// src/mcp/tools/entities.js — the layer-1 semantic tools. Group by ENTITY:
// you ask about a thing, you get its relationships (the project's thesis).
// Fan-out discipline: summarize by default, list opt-in + capped, never props.
import { err, refOf, capList, summarizeByClass, resolveRef, MAX_LIMIT, DEFAULT_LIMIT } from './util.js';

async function targets(backend, edges, key) {
  return backend.nodesByIds(edges.map((e) => e[key]));
}
function resolved(r, what, name) {
  if (r.ambiguous) return err('ambiguous', `'${name}' matches ${r.ambiguous.length} ${what}s — pass a slug`, { candidates: r.ambiguous });
  if (r.notFound) return err('not_found', `no ${what} named '${name}'`);
  return null;
}

export async function gem(backend, { name }) {
  const r = await resolveRef(backend, ['gem'], name);
  const bad = resolved(r, 'gem', name); if (bad) return bad;
  const g = r.node;
  const [grantsE, recE, grantedByE] = await Promise.all([
    backend.edgesFrom(g.id, 'grants'),
    backend.edgesFrom(g.id, 'recommends_support'),
    backend.edgesTo(g.id, 'grants'),
  ]);
  const [grants, recs, grantedBy] = await Promise.all([
    targets(backend, grantsE, 'to'), targets(backend, recE, 'to'), targets(backend, grantedByE, 'from'),
  ]);
  return {
    ...refOf(g),
    gemType: g.props.gemType ?? null,
    color: g.props.color ?? null,
    tags: g.props.tags ?? [],
    requirements: g.props.requirementWeights ?? null,
    buildable: g.buildable,
    grants: capList(grants.map(refOf)),
    recommended_supports: capList(recs.map((n) => ({ ...refOf(n), tier: n.props.craftingLevel ?? null }))),
    granted_by: capList(grantedBy.map(refOf)),
  };
}

export async function item(backend, { name, list = false }) {
  const r = await resolveRef(backend, ['unique', 'base', 'augment'], name);
  const bad = resolved(r, 'item', name); if (bad) return bad;
  const n = r.node;
  if (n.kind === 'base') return baseView(backend, n, list);
  if (n.kind === 'unique') return uniqueView(backend, n);
  return augmentView(backend, n);
}

async function baseView(backend, n, list) {
  const [slotsE, tagsE, dfltE, uniquesE, affixE] = await Promise.all([
    backend.edgesFrom(n.id, 'fits_slot'), backend.edgesFrom(n.id, 'tagged'),
    backend.edgesFrom(n.id, 'default_skill'), backend.edgesTo(n.id, 'has_base'),
    backend.edgesTo(n.id, 'rolls_on'),
  ]);
  const [slots, tags, dflt, uniques] = await Promise.all([
    targets(backend, slotsE, 'to'), targets(backend, tagsE, 'to'),
    targets(backend, dfltE, 'to'), targets(backend, uniquesE, 'from'),
  ]);
  const affixes = list
    ? capList((await targets(backend, affixE, 'from')).map(refOf), MAX_LIMIT)
    : { count: affixE.length, note: 'pass list: true to enumerate, or use affix(name)/traverse for one' };
  return {
    ...refOf(n),
    itemClass: n.props.className ?? null,
    buildable: n.buildable,
    implicits: n.props.implicitTexts ?? [],
    fits_slots: slots.map((s) => s.slug),
    tags: tags.map((t) => t.name),
    default_skill: dflt.map(refOf)[0] ?? null,
    uniques_on_base: capList(uniques.map(refOf)),
    affixes,
  };
}

async function uniqueView(backend, n) {
  const [baseE, grantsE, poolOutE, poolInE] = await Promise.all([
    backend.edgesFrom(n.id, 'has_base'), backend.edgesFrom(n.id, 'grants'),
    backend.edgesFrom(n.id, 'pool_source'), backend.edgesTo(n.id, 'pool_source'),
  ]);
  const [bases, grants, poolOut, poolIn] = await Promise.all([
    targets(backend, baseE, 'to'), targets(backend, grantsE, 'to'),
    targets(backend, poolOutE, 'to'), targets(backend, poolInE, 'from'),
  ]);
  const variants = n.props.variants ?? [];
  const current = variants[n.props.currentIndex] ?? variants[variants.length - 1] ?? null;
  return {
    ...refOf(n),
    itemClass: n.props.className ?? null,
    buildable: n.buildable,
    base: bases.map(refOf)[0] ?? null,
    flavour: n.props.flavour ?? null,
    stats: current ? { implicits: current.implicits ?? [], explicits: current.explicits ?? [] } : null,
    grants: capList(grants.map(refOf)),
    pool_draws_from: capList(poolOut.map(refOf)),
    feeds_pool_of: capList(poolIn.map(refOf)),
  };
}

async function augmentView(backend, n) {
  const sockE = await backend.edgesFrom(n.id, 'sockets_into');
  const classes = await targets(backend, sockE, 'to');
  return { ...refOf(n), sockets_into: capList(classes.map(refOf), MAX_LIMIT) };
}

export async function affix(backend, { name, list = false }) {
  const r = await resolveRef(backend, ['affix'], name);
  const bad = resolved(r, 'affix', name); if (bad) return bad;
  const n = r.node;
  const rollsE = await backend.edgesFrom(n.id, 'rolls_on');
  const bases = await backend.nodesByIds(rollsE.map((e) => e.to));
  return {
    ...refOf(n),
    scope: n.props.scope ?? null,
    type: n.props.type ?? null,
    tiers: capList(n.props.tiers ?? []),
    rolls_on: list
      ? capList(bases.map(refOf), MAX_LIMIT)
      : { count: bases.length, by_class: summarizeByClass(bases) },
  };
}

export async function slot(backend, { name }) {
  const r = await resolveRef(backend, ['gear-slot'], name);
  const bad = resolved(r, 'gear slot', name); if (bad) return bad;
  const n = r.node;
  const fitsE = await backend.edgesTo(n.id, 'fits_slot');
  const bases = await backend.nodesByIds(fitsE.map((e) => e.from));
  return {
    ...refOf(n),
    accepts: n.props.accepts ?? null,
    group: n.props.group ?? null,
    base_count: bases.length,
    by_class: summarizeByClass(bases),
  };
}

export async function ascendancy(backend, { name }) {
  const r = await resolveRef(backend, ['ascendancy'], name);
  const bad = resolved(r, 'ascendancy', name); if (bad) return bad;
  const n = r.node;
  const pE = await backend.edgesTo(n.id, 'in_ascendancy');
  const nodes = await backend.nodesByIds(pE.map((e) => e.from));
  return {
    ...refOf(n),
    class: n.props.charClass ?? null,
    passives: capList(nodes.map((p) => ({
      name: p.name, hash: p.props.hash ?? null, statLines: p.props.statLines ?? [],
    })), 50),
  };
}

export async function passives(backend, { query, limit = DEFAULT_LIMIT }) {
  const cap = Math.min(limit, MAX_LIMIT);
  let nodes = await backend.nodesByName(query, ['passive']);
  if (!nodes.length) {
    const hits = await backend.search(query, { kind: 'passive', limit: cap });
    nodes = await backend.nodesByIds(hits.map((h) => h.id));
  }
  if (!nodes.length) return err('not_found', `no passives match '${query}'`);
  return {
    passives: capList(nodes.map((p) => ({
      name: p.name,
      hash: p.props.hash ?? null,
      kind: p.props.kind ?? null,
      ascendancy: p.props.ascendancy ?? null,
      statLines: p.props.statLines ?? [],
    })), cap),
  };
}
