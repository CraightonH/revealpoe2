import { loadJson } from './loader.js';
import { REPOE } from '../config.js';

let _flavour = null;

function flavour() {
  if (!_flavour) _flavour = loadJson(`${REPOE}/flavour.json`);
  return _flavour;
}

// Strip in-game markup like "<size:30>{…}" wrappers, leaving plain text.
function clean(text) {
  return text
    .replace(/<[^>]+>\{/g, '')
    .replace(/\}$/, '')
    .trim();
}

// Look up a unique's flavour text by its visual_identity.id. The flavour table
// keys sometimes drop a trailing underscore present on the visual id
// (e.g. "FourUniqueSpear14_" → "FourUniqueSpear14"). Returns lines, or null.
export function getFlavourLines(visualId) {
  if (!visualId) return null;
  const table = flavour();
  const raw = table[visualId] ?? table[visualId.replace(/_$/, '')];
  if (!raw) return null;
  return clean(raw)
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
