// scripts/graph/keywords.js
//
// Build-time assembly of KEYWORD glossary nodes. Reads keywords.json (term +
// definition) and scans the game's own [Id|Display] markup across the glossary
// and stat-translation files to derive surface phrases for each keyword. The
// app reads these nodes (definitions + phrases) and never touches source.
import { loadJson } from './loader.js';
import { REPOE } from './source.js';
import { slugify } from '../../src/data/slug.js';
import { makeNode, KINDS } from './schema.js';

// Files whose "string" templates carry tokenized keyword references.
const TRANSLATION_FILES = [
  'stat_translations/stat_descriptions.json',
  'stat_translations/gem_stat_descriptions.json',
  'stat_translations/active_skill_gem_stat_descriptions.json',
  'stat_translations/skill_stat_descriptions.json',
];

const TOKEN_WITH_DISPLAY = /\[([A-Za-z0-9]+)\|([^\]]+)\]/g;
const TOKEN_BARE = /\[([A-Za-z0-9]+)\]/g;

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Equal up to a trailing plural "s" (so "minion" matches the term "Minions").
function eqLoose(a, b) {
  a = norm(a);
  b = norm(b);
  return a === b || a === `${b}s` || `${a}s` === b;
}

// A keyword surface phrase, not a sentence: short, word-like, no embedded numbers.
function isPhraseLike(phrase) {
  if (/\d/.test(phrase)) return false;
  if (phrase.length > 34) return false;
  if (phrase.trim().split(/\s+/).length > 4) return false;
  return true;
}

// Collect every "string" value found anywhere in a parsed translation file.
function collectStrings(node, out) {
  if (Array.isArray(node)) {
    for (const v of node) collectStrings(v, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'string' && typeof v === 'string') out.push(v);
      else collectStrings(v, out);
    }
  }
}

// Build [phrase, id] pairs from the game data. (Moved verbatim from the app's
// former src/data/keywordPhrases.js deriveKeywordPhrases.)
export function derivePhrasePairs() {
  const keywords = loadJson(`${REPOE}/keywords.json`);
  const hasDef = (id) => {
    const e = keywords[id];
    return !!(e && typeof e.definition === 'string' && e.definition.trim());
  };
  const term = (id) => {
    const e = keywords[id];
    return e && typeof e.term === 'string' ? e.term.trim() : '';
  };

  const texts = [];
  for (const e of Object.values(keywords)) {
    if (e && typeof e.definition === 'string' && e.definition) texts.push(e.definition);
  }
  for (const rel of TRANSLATION_FILES) {
    try {
      collectStrings(loadJson(`${REPOE}/${rel}`), texts);
    } catch {
      // optional file absent in this data snapshot — skip
    }
  }

  const byPhrase = new Map();
  const counts = new Map();
  const add = (rawPhrase, id) => {
    const display = rawPhrase.trim();
    if (!display) return;
    const key = display.toLowerCase();
    let rec = byPhrase.get(key);
    if (!rec) byPhrase.set(key, (rec = { display, ids: new Set() }));
    rec.ids.add(id);
    const ck = `${key}|${id}`;
    counts.set(ck, (counts.get(ck) || 0) + 1);
  };
  const count = (phraseLower, id) => counts.get(`${phraseLower}|${id}`) || 0;

  for (const t of texts) {
    let m;
    TOKEN_WITH_DISPLAY.lastIndex = 0;
    while ((m = TOKEN_WITH_DISPLAY.exec(t)) !== null) add(m[2], m[1]);
    const bare = t.replace(TOKEN_WITH_DISPLAY, ' ');
    TOKEN_BARE.lastIndex = 0;
    while ((m = TOKEN_BARE.exec(bare)) !== null) {
      const display = term(m[1]);
      if (display) add(display, m[1]);
    }
  }

  const isRareElision = (displayLower, id) => {
    const n = count(displayLower, id);
    for (const { display: other } of byPhrase.values()) {
      const ol = other.toLowerCase();
      if (ol === displayLower) continue;
      if (ol.startsWith(`${displayLower} `) && count(ol, id) > n) return true;
    }
    return false;
  };

  const pairs = [];
  for (const { display, ids } of byPhrase.values()) {
    if (!isPhraseLike(display)) continue;
    let candidates = [...ids].filter(hasDef);
    if (candidates.length === 0) continue;
    if (candidates.length > 1) {
      const exact = candidates.filter((id) => eqLoose(term(id), display));
      if (exact.length !== 1) continue;
      candidates = exact;
    }
    if (isRareElision(display.toLowerCase(), candidates[0])) continue;
    pairs.push([display, candidates[0]]);
  }
  return pairs;
}

// One KEYWORD node per keyword that has a non-empty definition. Derived surface
// phrases are grouped onto the owning keyword as props.phrases (possibly empty).
export function keywordNodes() {
  const keywords = loadJson(`${REPOE}/keywords.json`);

  const phrasesById = new Map();
  for (const [phrase, id] of derivePhrasePairs()) {
    if (!phrasesById.has(id)) phrasesById.set(id, []);
    phrasesById.get(id).push(phrase);
  }

  const nodes = [];
  for (const [id, e] of Object.entries(keywords)) {
    const definition = e && typeof e.definition === 'string' ? e.definition : '';
    if (!definition.trim()) continue; // empty-definition keywords get no node
    const name = (e.term && e.term.trim()) || id;
    nodes.push(
      makeNode({
        id,
        kind: KINDS.KEYWORD,
        name,
        slug: slugify(id),
        props: { definition, phrases: phrasesById.get(id) ?? [] },
        search: name.toLowerCase(),
      }),
    );
  }
  return { nodes };
}
