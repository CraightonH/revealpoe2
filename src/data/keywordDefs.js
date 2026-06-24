import { getNode } from './graph.js';

// KEYWORD nodes exist ONLY for keywords with a non-empty definition (built by
// scripts/graph/keywords.js), so node presence IS "has a definition". The app
// reads glossary text from the graph artifact and never touches $POE2DATADIR.

// True only when a KEYWORD node exists for this key (i.e. it has a non-empty
// definition). Gates out the empty-definition keywords so they never become
// dead hovers.
export function hasDefinition(key) {
  const n = getNode(key);
  return !!(n && n.kind === 'keyword');
}

// { term, definition } for a defined keyword, or null for empty/missing.
// term comes from the node name (which already falls back to the key at build time).
export function getDefinition(key) {
  const n = getNode(key);
  if (!n || n.kind !== 'keyword') return null;
  return { term: n.name, definition: n.props.definition };
}
