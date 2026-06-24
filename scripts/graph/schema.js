export const KINDS = {
  GEM: 'gem', SKILL: 'skill', BASE: 'base', UNIQUE: 'unique', AFFIX: 'affix',
  TAG: 'tag', KEYWORD: 'keyword', CLASS: 'class', PASSIVE: 'passive',
  ASCENDANCY: 'ascendancy',
};

export const EDGE_TYPES = {
  GRANTS: 'grants', RECOMMENDS_SUPPORT: 'recommends_support', ROLLS_ON: 'rolls_on',
  HAS_BASE: 'has_base', TAGGED: 'tagged', REFERENCES_KEYWORD: 'references_keyword',
  IN_CLASS: 'in_class', IN_ASCENDANCY: 'in_ascendancy',
};

const KIND_SET = new Set(Object.values(KINDS));
const EDGE_SET = new Set(Object.values(EDGE_TYPES));

export function makeNode({ id, kind, name, slug, props = {}, search = '' }) {
  if (!id) throw new Error('makeNode: id required');
  if (!KIND_SET.has(kind)) throw new Error(`makeNode: invalid kind '${kind}'`);
  if (!name) throw new Error(`makeNode: name required (${id})`);
  if (!slug) throw new Error(`makeNode: slug required (${id})`);
  return { id, kind, name, slug, props, search };
}

export function makeEdge({ type, from, to, props }) {
  if (!EDGE_SET.has(type)) throw new Error(`makeEdge: invalid type '${type}'`);
  if (!from || !to) throw new Error('makeEdge: from and to required');
  return props ? { type, from, to, props } : { type, from, to };
}
