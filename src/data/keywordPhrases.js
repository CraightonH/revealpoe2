import { loadJson } from './loader.js';
import { REPOE } from '../config.js';
import { registerDerivedPhrases } from './keywords.js';

// Derives the surface-phrase → keyword-id map from the game's OWN markup rather
// than a hand-maintained list, so it stays in sync on every data re-scrape.
//
// Source of truth: every "[Id|Display]" / "[Id]" token the game authors, both in
// the glossary definitions (keywords.json cross-links each term) and in the stat
// translation strings (mod/gem/skill text). A token is the game explicitly saying
// "this phrase links to this keyword", so the resulting pairs are clean by
// construction — unlike the loose `term` field, which collides across unrelated
// monster/atlas ids. We then re-detect those same phrases in the plain
// (untokenized) text that the data leaves unlinked (penetration mods, dual
// resistances, etc.) — the gap that motivated this whole module.

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

// Build [phrase, id] pairs from the data. Exported for tests; install() registers them.
export function deriveKeywordPhrases() {
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

  // phrase(lowercased) → { display, ids:Set }; plus per-(phrase,id) occurrence
  // counts so we can tell a dominant display from a rare elision (see below).
  const byPhrase = new Map();
  const counts = new Map(); // `${phraseLower}|${id}` → occurrences
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
    // Strip display tokens before scanning bare ones so "[A|x] [B]" doesn't double-count.
    const bare = t.replace(TOKEN_WITH_DISPLAY, ' ');
    TOKEN_BARE.lastIndex = 0;
    while ((m = TOKEN_BARE.exec(bare)) !== null) {
      const display = term(m[1]); // bare [Id] renders the keyword's term
      if (display) add(display, m[1]);
    }
  }

  // For an id, is `display` a rare elision — i.e. a leading word-prefix of another
  // display of the SAME id that occurs more often? The game sometimes truncates a
  // term when a trailing word is shared with the next phrase, e.g.
  // "increased [SkillSpeed|Skill] and Movement Speed" yields display "Skill" for
  // SkillSpeed, which would mislabel a bare "Skill". The dominant display
  // ("Skill Speed", x50) outvotes that elision ("Skill", x2), so we drop it.
  // Frequency (not length) is what distinguishes the elision from a legit short
  // form like "Elemental Damage" vs the rarer "Elemental Damage Types".
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
      // Tie-break: keep the candidate whose own glossary TERM is the display
      // (e.g. "Frozen" → Frozen [term "Frozen"], not Freeze; "minion(s)" → Minion
      // [term "Minions"], not MonsterMinion). Matching the canonical term — not
      // the internal id — is what filters generic verbs the game loosely tokenizes:
      // "Gain" tokenizes to both Gain (term "Damage Gained as extra X") and
      // StatGain (term "Gaining Stats…"), and since NEITHER term is "Gain", it
      // drops as ambiguous instead of hijacking "Gain Life on Kill". Genuinely
      // ambiguous displays (power, stun threshold) likewise drop. Otherwise drop.
      const exact = candidates.filter((id) => eqLoose(term(id), display));
      if (exact.length !== 1) continue;
      candidates = exact;
    }
    if (isRareElision(display.toLowerCase(), candidates[0])) continue;
    pairs.push([display, candidates[0]]);
  }
  return pairs;
}

let installed = false;

// Derive and merge into the renderer once. Safe to call repeatedly.
export function installKeywordPhrases() {
  if (installed) return;
  installed = true;
  registerDerivedPhrases(deriveKeywordPhrases());
}
