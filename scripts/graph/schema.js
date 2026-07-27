export const KINDS = {
  GEM: 'gem', SKILL: 'skill', BASE: 'base', UNIQUE: 'unique', AFFIX: 'affix',
  TAG: 'tag', KEYWORD: 'keyword', CLASS: 'class', PASSIVE: 'passive',
  ASCENDANCY: 'ascendancy', GEAR_SLOT: 'gear-slot', AUGMENT: 'augment',
};

export const EDGE_TYPES = {
  GRANTS: 'grants', RECOMMENDS_SUPPORT: 'recommends_support', ROLLS_ON: 'rolls_on',
  HAS_BASE: 'has_base', TAGGED: 'tagged', REFERENCES_KEYWORD: 'references_keyword',
  IN_CLASS: 'in_class', IN_ASCENDANCY: 'in_ascendancy',
  DEFAULT_SKILL: 'default_skill', FITS_SLOT: 'fits_slot', SOCKETS_INTO: 'sockets_into',
  // A mod in a pool-driven unique's craftable pool originates from another
  // unique (Loreweave weaves ring mods). from = the pool item, to = the source
  // unique; reverse-traverse for "feeds into Loreweave". See manual.js
  // expandPoolUniques and data/manual/pool-uniques.json.
  POOL_SOURCE: 'pool_source',
};

// Provenance tier stamped on every node and edge (see CLAUDE.md "Data Provenance
// & Hand-Crafted Data Policy"). `repoe` = straight from scraped source; `manual`
// = an irreducible hand-authored fact; `derived` = computed by the builder (from
// source OR from a manual rule — derived elements also carry a `via` basis).
export const SOURCES = { REPOE: 'repoe', MANUAL: 'manual', DERIVED: 'derived' };

const KIND_SET = new Set(Object.values(KINDS));
const EDGE_SET = new Set(Object.values(EDGE_TYPES));
const SOURCE_SET = new Set(Object.values(SOURCES));

// `source` defaults to 'repoe' so every existing source-derived builder is
// backfilled with no change; only the manual overlay passes 'manual'/'derived'.
// `via` is the basis pointer for derived nodes (e.g. 'manual:pool-uniques'), the
// same contract makeEdge uses — a node the builder expanded from a manual rule is
// auditable back to that rule. Omitted for plain source/manual nodes.
export function makeNode({ id, kind, name, slug, props = {}, search = '', source = SOURCES.REPOE, via }) {
  if (!id) throw new Error('makeNode: id required');
  if (!KIND_SET.has(kind)) throw new Error(`makeNode: invalid kind '${kind}'`);
  if (!name) throw new Error(`makeNode: name required (${id})`);
  if (!slug) throw new Error(`makeNode: slug required (${id})`);
  if (!SOURCE_SET.has(source)) throw new Error(`makeNode: invalid source '${source}' (${id})`);
  const node = { id, kind, name, slug, props, search, source };
  if (via) node.via = via;
  return node;
}

// `via` is the basis pointer for derived elements (e.g. 'manual:weapon-default-skills').
export function makeEdge({ type, from, to, props, source = SOURCES.REPOE, via }) {
  if (!EDGE_SET.has(type)) throw new Error(`makeEdge: invalid type '${type}'`);
  if (!from || !to) throw new Error('makeEdge: from and to required');
  if (!SOURCE_SET.has(source)) throw new Error(`makeEdge: invalid source '${source}' (${type} ${from}->${to})`);
  const edge = { type, from, to };
  if (props) edge.props = props;
  edge.source = source;
  if (via) edge.via = via;
  return edge;
}
