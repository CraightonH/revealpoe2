// scripts/graph/gemQuality.js — build-time resolver for the Gemling Legionnaire
// alternate ("second") quality effects. Builder-only.
//
// The raw {statId, permille} pairs are extracted from the GGPK mirror into the
// committed artifact data/manual/gem-quality.generated.json (see
// scripts/ggpk/extract-gem-quality.js). This module renders those pairs to display
// text through the SAME stat-translation + quality-scaling path RePoE uses for the
// standard quality, so the alt lines read identically to the standard ones — only
// their colour differs in the view (#b4b4ff, the in-game "second quality" colour).
//
// RePoE ships the standard quality already-templated in skills.json; it does NOT
// ship the alt templates. So we re-derive the template from the stat-description
// tables (the same tables RePoE templated the standard quality from) and feed it to
// resolveQuality. Validated against RePoE's OWN standard templates: 76.6% render
// byte-identical, the remainder are equivalent phrasings (e.g. "X to Y duration" vs
// "Y is X"); a handful of stats have no renderable generic description and are
// skipped rather than shown garbled.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from './loader.js';
import { REPOE } from './source.js';
import { resolveQuality } from '../../src/data/statText.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GENERATED = path.join(ROOT, 'data', 'manual', 'gem-quality.generated.json');

// Generic stat-description tables, in resolution precedence. Active-skill phrasing
// wins (e.g. "Chains N times", not the support-gem "Supported Skills Chain N times").
const GENERIC_FILES = [
  'stat_translations/active_skill_gem_stat_descriptions.json',
  'stat_translations/skill_stat_descriptions.json',
  'stat_translations/gem_stat_descriptions.json',
  'stat_translations/stat_descriptions.json',
];

// stat id -> its first stat-description entry, per file (lazily built, cached).
let _genericIdx = null;
function genericIdx() {
  if (_genericIdx) return _genericIdx;
  _genericIdx = GENERIC_FILES.map((f) => {
    const m = new Map();
    let arr;
    try { arr = loadJson(`${REPOE}/${f}`); } catch { return m; }
    for (const e of arr) {
      if (!e.English?.length) continue;
      for (const id of e.ids ?? []) if (!m.has(id)) m.set(id, e);
    }
    return m;
  });
  return _genericIdx;
}

// A skill's per-set translation_file (specific_skill_stat_descriptions/*.json)
// carries skill-specific phrasing and takes precedence over the generic tables.
// Keyed by the `.csd`/`.json` path from skills.json stat_sets[i].translation_file.
// The path keeps its subdirectory — the specific tables live under
// stat_translations/specific_skill_stat_descriptions/, so basename() would look in
// the wrong place and silently fall back to the generic tables (skipping skill-only
// stats like archmage_*, base_skill_effect_duration).
const _specificCache = new Map();
function specificIdx(translationFile) {
  if (!translationFile) return null;
  if (_specificCache.has(translationFile)) return _specificCache.get(translationFile);
  const rel = `${REPOE}/stat_translations/${translationFile.replace(/\.csd$/, '.json')}`;
  const m = new Map();
  try {
    for (const e of loadJson(rel)) {
      if (!e.English?.length) continue;
      for (const id of e.ids ?? []) if (!m.has(id)) m.set(id, e);
    }
  } catch { /* no specific file → generic-only */ }
  _specificCache.set(translationFile, m);
  return m;
}

function findEntry(statId, translationFile) {
  const spec = specificIdx(translationFile);
  if (spec && spec.has(statId)) return spec.get(statId);
  for (const idx of genericIdx()) if (idx.has(statId)) return idx.get(statId);
  return null;
}

function condMatch(condition, value) {
  return (condition ?? []).every((c) => {
    const ok = (c.min == null || value >= c.min) && (c.max == null || value <= c.max);
    return c.negated ? !ok : ok;
  });
}

// Choose the English block for a value: match the condition against the (positive)
// permille — this picks the "increased"/"more" variant over "reduced"/"less" — then
// prefer keyword-markup phrasings and avoid trade-filter "@" forms.
function pickBlock(entry, value) {
  const blocks = entry.English.filter((b) => b.string);
  let pool = blocks.filter((b) => condMatch(b.condition, value));
  if (!pool.length) pool = blocks;
  if (!pool.length) return null;
  const noAt = pool.filter((b) => !b.string.includes('@'));
  if (noAt.length) pool = noAt;
  const markup = pool.filter((b) => b.string.includes('['));
  if (markup.length) pool = markup;
  return pool[0];
}

// Resolve one alt stat {id, permille} for a skill's stat set into a standard
// quality-stat object { stat, stats } — the SAME shape as source quality_stats — or
// null if no template resolves. Shared by the card (rendered at 20% via
// resolveQuality) and the quality scaling table (scaled per quality). A `format:
// ['ignore']` block is a constant string with no scaling token → stats is empty.
function altQualityStat(statId, permille, translationFile) {
  const entry = findEntry(statId, translationFile);
  if (!entry) return null;
  const block = pickBlock(entry, permille);
  if (!block) return null;
  if (block.format?.[0] === 'ignore') return { stat: block.string, stats: {} };
  const handler = block.index_handlers?.[0] ?? [];
  const token = handler.length ? `{${statId}/${handler[0]}}` : `{${statId}}`;
  return { stat: block.string.replace('{0}', token), stats: { [statId]: permille } };
}

// Render one alt stat to a display string (effect at max 20% quality, as "(0—N)…"),
// or null if no template resolves.
function renderAltStat(statId, permille, translationFile) {
  const q = altQualityStat(statId, permille, translationFile);
  if (!q) return null;
  // A constant ('ignore') block has no quality token → pass it through as-is.
  if (!Object.keys(q.stats).length) return q.stat;
  return resolveQuality(q); // /50 scaling + unit handler + range
}

// Load the committed generated overlay: skillKey -> [{ set, stats:[{id,permille}] }].
let _data = null;
export function loadAltQuality() {
  if (_data) return _data;
  try {
    _data = JSON.parse(fs.readFileSync(GENERATED, 'utf8')).altQualityBySkill ?? {};
  } catch {
    _data = {};
  }
  return _data;
}

// Rendered alt-quality lines for (skillKey, statSetIndex). `translationFile` is that
// stat set's skills.json translation_file. Returns [] when the skill has no alt
// quality for that set (or nothing renders).
export function altQualityLines(skillKey, statSetIndex, translationFile) {
  const entries = loadAltQuality()[skillKey];
  if (!entries) return [];
  const out = [];
  for (const e of entries) {
    if (e.set !== statSetIndex) continue;
    for (const s of e.stats ?? []) {
      const line = renderAltStat(s.id, s.permille, translationFile);
      if (line) out.push(line);
    }
  }
  return out;
}

// Alt-quality effects for (skillKey, statSetIndex) as standard quality-stat objects
// { stat, stats } — the shape buildGemQualityTable consumes so Gemling second-quality
// effects scale in the Quality table the same way standard quality does. Skips
// constant ('ignore') blocks, which carry no per-quality scaling. Returns [].
export function altQualityStats(skillKey, statSetIndex, translationFile) {
  const entries = loadAltQuality()[skillKey];
  if (!entries) return [];
  const out = [];
  for (const e of entries) {
    if (e.set !== statSetIndex) continue;
    for (const s of e.stats ?? []) {
      const q = altQualityStat(s.id, s.permille, translationFile);
      if (q && Object.keys(q.stats).length) out.push(q);
    }
  }
  return out;
}
