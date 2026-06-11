import { loadJson } from './loader.js';

const REPOE = 'repoe-poe2';

// gem_tags.json maps a tag id to "[Display]", "[Id|Display]", or null.
// Returns the human display name, or null if the tag has no display form.
export function tagDisplay(id) {
  const map = loadJson(`${REPOE}/gem_tags.json`);
  const raw = map[id];
  if (!raw) return null;
  const inner = raw.replace(/^\[/, '').replace(/\]$/, '');
  const pipe = inner.indexOf('|');
  return pipe === -1 ? inner : inner.slice(pipe + 1);
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
