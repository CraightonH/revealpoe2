import { KINDS, EDGE_TYPES } from './schema.js';

const KIND_SET = new Set(Object.values(KINDS));
const EDGE_SET = new Set(Object.values(EDGE_TYPES));

export function validateGraph({ nodes, edges }) {
  const errors = [];
  const ids = new Set();
  const slugByKind = new Map(); // `${kind}|${slug}` -> first id seen

  for (const n of nodes) {
    if (ids.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    ids.add(n.id);
    if (!KIND_SET.has(n.kind)) errors.push(`unknown kind '${n.kind}' on node ${n.id}`);
    if (!n.name) errors.push(`missing name on node ${n.id}`);
    if (!n.slug) errors.push(`missing slug on node ${n.id}`);
    const key = `${n.kind}|${n.slug}`;
    if (slugByKind.has(key)) {
      errors.push(`duplicate slug '${n.slug}' for kind ${n.kind} (${n.id} & ${slugByKind.get(key)})`);
    } else {
      slugByKind.set(key, n.id);
    }
  }

  for (const e of edges) {
    if (!EDGE_SET.has(e.type)) errors.push(`unknown edge type '${e.type}'`);
    if (!ids.has(e.from)) errors.push(`dangling edge ${e.type}: from '${e.from}' not a node`);
    if (!ids.has(e.to)) errors.push(`dangling edge ${e.type}: to '${e.to}' not a node`);
  }

  return errors;
}
