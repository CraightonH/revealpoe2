import { loadJson } from './loader.js';
import { REPOE } from '../config.js';

// Parse a raw gem-tag token ("[Display]" or "[Id|Display]") into its bracket
// key (`token`) and human-readable `display` name. Returns null for falsy raw.
function parseTagToken(raw) {
  if (!raw) return null;
  const inner = raw.replace(/^\[/, '').replace(/\]$/, '');
  const pipe = inner.indexOf('|');
  return { token: raw, display: pipe === -1 ? inner : inner.slice(pipe + 1) };
}

// gem_tags.json maps a tag id to "[Display]", "[Id|Display]", or null.
// Returns the human display name, or null if the tag has no display form.
export function tagDisplay(id) {
  const map = loadJson(`${REPOE}/gem_tags.json`);
  const parsed = parseTagToken(map[id]);
  return parsed ? parsed.display : null;
}

// Map a list of tag ids to display names, dropping non-display tags and any
// display name present in `exclude` (e.g. the one already shown as the type line).
export function displayTags(tags, exclude = []) {
  const skip = new Set(exclude);
  const out = [];
  for (const id of tags ?? []) {
    const d = tagDisplay(id);
    if (d && !skip.has(d)) out.push(d);
  }
  return out;
}

// Raw "[Key|Display]" / "[Display]" token for a tag id, or null if the tag has
// no display form. The keyword id is the bracket key (e.g. "[AoESkill|AoE]"),
// which differs from the tag id ("area").
export function tagToken(id) {
  const map = loadJson(`${REPOE}/gem_tags.json`);
  return map[id] || null;
}

// Tokens for displayable tags, dropping non-display tags and any whose display
// name is in `exclude`. Preserves the keyword id so tooltips can resolve.
export function displayTagTokens(tags, exclude = []) {
  const map = loadJson(`${REPOE}/gem_tags.json`);
  const skip = new Set(exclude);
  const out = [];
  for (const id of tags ?? []) {
    const parsed = parseTagToken(map[id]);
    if (!parsed) continue;
    if (parsed.display && !skip.has(parsed.display)) out.push(parsed.token);
  }
  return out;
}
