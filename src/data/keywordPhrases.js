import { nodesByKind } from './graph.js';
import { registerDerivedPhrases } from './keywords.js';

// Surface-phrase → keyword-id pairs are derived at BUILD time (see
// scripts/graph/keywords.js) and stored as props.phrases on each KEYWORD node.
// This module just flattens them back into the [phrase, id] pairs the renderer
// expects. No reads of $POE2DATADIR.

// Exported for tests: the merged [phrase, id] pairs from all keyword nodes.
export function keywordPhrasePairs() {
  const pairs = [];
  for (const n of nodesByKind('keyword')) {
    for (const phrase of n.props.phrases ?? []) pairs.push([phrase, n.id]);
  }
  return pairs;
}

let installed = false;

// Derive and merge into the renderer once. Safe to call repeatedly.
export function installKeywordPhrases() {
  if (installed) return;
  installed = true;
  registerDerivedPhrases(keywordPhrasePairs());
}
