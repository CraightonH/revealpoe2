// scripts/graph/flavour.js — build-time unique flavour-text resolver. Builder-only.
import { loadJson } from './loader.js';
import { POBDATA } from './source.js';

let _byName = null;
let _byNorm = null;

// PoB FlavourText.json is a list of {id, name, origin, text[]} — index by the
// unique's display name (the same name key uniques.js resolves).
function indexes() {
  if (!_byName) {
    _byName = new Map();
    _byNorm = new Map();
    for (const e of loadJson(`${POBDATA}/FlavourText.json`)) {
      if (e?.name && Array.isArray(e.text)) {
        _byName.set(e.name, e.text);
        _byNorm.set(norm(e.name), e.text);
      }
    }
  }
  return [_byName, _byNorm];
}

// Diacritic/case-insensitive fallback key ("Mjölner" -> "mjolner").
function norm(name) {
  return String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Strip in-game markup like "<size:30>{…}" wrappers, leaving plain text.
function clean(text) {
  return text
    .replace(/<[^>]+>\{/g, '')
    .replace(/\}$/, '')
    .trim();
}

// Look up a unique's flavour text by its display name. Returns lines, or null.
export function getFlavourLines(name) {
  if (!name) return null;
  const [byName, byNorm] = indexes();
  const lines = byName.get(name) ?? byNorm.get(norm(name));
  if (!lines) return null;
  return lines.map((l) => clean(l)).filter(Boolean);
}
