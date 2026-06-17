import { loadJson, listDataDir } from './loader.js';

const POB_DIR = 'pob-uniques';
const GRANTS_SKILL_RE = /^Grants Skill:\s*(?:Level \([^)]+\)\s*)?(.+)$/;

let _names = null;

// Set of skill display-names granted by unique items, parsed from the
// "Grants Skill: <name>" lines in the PoB unique text blocks. Used to tag a
// gem's origin as item-granted (see gems.js classifyOrigin).
//
// Mirrors uniques.js iteration: top-level *.json only (the Special/ subdir is
// alternate-art / non-standard and intentionally skipped there too).
export function grantedSkillNames() {
  if (_names) return _names;
  _names = new Set();
  for (const file of listDataDir(POB_DIR)) {
    if (file === '_manifest.json' || !file.endsWith('.json')) continue;
    const entries = loadJson(`${POB_DIR}/${file}`);
    if (!Array.isArray(entries)) continue;
    for (const text of entries) {
      if (typeof text !== 'string') continue;
      for (const raw of text.split('\n')) {
        const line = raw.replace(/\{[^}]*\}/g, '').trim(); // strip {variant}/{tags}
        const m = line.match(GRANTS_SKILL_RE);
        if (m) _names.add(m[1].trim());
      }
    }
  }
  return _names;
}
