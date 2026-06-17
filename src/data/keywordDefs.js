import { loadJson } from './loader.js';
import { REPOE } from '../config.js';

function entry(key) {
  const map = loadJson(`${REPOE}/keywords.json`);
  return map[key] ?? null;
}

// True only when the keyword exists and has a non-empty definition. Gates out
// the ~257 entries whose definition is "" so they never become dead hovers.
export function hasDefinition(key) {
  const e = entry(key);
  return !!(e && typeof e.definition === 'string' && e.definition.trim());
}

// { term, definition } for a defined keyword, or null for empty/missing.
// term falls back to the key when the data has no display term.
export function getDefinition(key) {
  if (!hasDefinition(key)) return null;
  const e = entry(key);
  return { term: e.term || key, definition: e.definition };
}
