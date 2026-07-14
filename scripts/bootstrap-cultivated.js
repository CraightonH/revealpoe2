// scripts/bootstrap-cultivated.js — DEV-ONLY, one-shot overlay generator.
//
// NOT part of the build (`dev`, `build:*`, `test`, CI never invoke this). It
// generates the two committed overlays consumed by scripts/graph/manual.js:
//
//   data/manual/unique-origins.json     — every origin-bearing unique -> origin
//                                          (pure ggpk UniqueOrigins; no network)
//   data/manual/cultivated-uniques.json — each Vaal unique -> its cultivated
//                                          (mutated) mod ids, scraped once from
//                                          poe2db and matched back to RePoE mods
//
// Why bootstrap-from-poe2db: the per-unique cultivated-mod ASSIGNMENT exists in
// no datamineable GGPK form (see docs/superpowers/specs/2026-07-14-cultivated-
// unique-mods-design.md). The mod DEFINITIONS are all in RePoE mods.json already;
// only the mapping is external. We scrape it once, review, and commit — so the
// build and the live site never touch poe2db.
//
// Run:  node scripts/bootstrap-cultivated.js            (writes both overlays)
//       node scripts/bootstrap-cultivated.js --origins  (origins only, offline)
// TLS: run with SSL_CERT_FILE / NODE_EXTRA_CA_CERTS unset (corporate CA stalls
// the public CDNs) — the npm script wrapper handles this; see package.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema, parseTable } from './ggpk/dat.js';
import { resolveImplicitTexts } from './graph/affixes.js';
import { loadJson, listDataDir } from './graph/loader.js';
import { REPOE } from './graph/source.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_DIR = path.join(ROOT, 'data', 'manual');
const UA = 'Mozilla/5.0 reveal-datamine';
const POE2DB = 'https://poe2db.tw/us';

// --- shared helpers ---------------------------------------------------------

// Matching normalizer. RePoE's rendered text and poe2db's HTML text describe the
// same mods but differ superficially: keyword markup, dash glyphs, a leading "+",
// whitespace (poe2db wraps numbers in tags, so tag-stripping scatters/joins
// words), and negative ranges shown (|min|-|max|) by RePoE vs ascending by poe2db.
// `base` folds the cosmetic differences (still spaced, so \b verb rules work);
// `finalize` squashes ALL whitespace and canonicalizes ranges ascending. Ranges
// are kept — they disambiguate same-text mods with different rolls.
function base(s) {
  return s
    .replace(/\[[^\]]*\|([^\]]*)\]/g, '$1') // [Fire|Fire] -> Fire
    .replace(/\[([^\]|]*)\]/g, '$1') // [Fork] -> Fork
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[‒-―−]/g, '-') // – — − … -> -
    .replace(/\+/g, '') // poe2db omits + on negatives; RePoE adds it
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
function finalize(s) {
  return s
    .replace(/\s+/g, '') // whitespace-insensitive: kills tag-strip join/split artifacts
    .replace(/\((-?\d+)-(-?\d+)\)/g, (_, a, b) => `(${Math.min(+a, +b)}-${Math.max(+a, +b)})`);
}
const keyExact = (s) => finalize(base(s));
// A negative-capable range reads "reduced/less/slower" on poe2db but
// "increased/more/faster" from RePoE (same stat, opposite polarity string) —
// neutralize the polarity verb; the range numbers keep it from over-matching.
const keyLoose = (s) => finalize(base(s).replace(/\b(increased|reduced|more|less|faster|slower)\b/g, '±'));

// name -> visual_identity.id from RePoE uniques.json (skip alternate art, first
// wins — mirrors uniques.js buildMetaByName so vids line up with graph nodes).
function vidByName() {
  const raw = loadJson(`${REPOE}/uniques.json`);
  const out = new Map();
  for (const v of Object.values(raw)) {
    if (!v?.name || v.is_alternate_art) continue;
    if (!out.has(v.name)) out.set(v.name, v.visual_identity?.id ?? null);
  }
  return out;
}

// Names that actually become unique graph NODES come from pob-uniques (uniques.js
// builds one node per pob block). uniques.json carries more uniques than PoB has
// (e.g. some jewels) — an entry for one of those would have a vid but no node and
// fail the build guard. So the overlays are filtered to this set: overlay ⊆ nodes.
function pobUniqueNames() {
  const names = new Set();
  for (const file of listDataDir('pob-uniques')) {
    if (file === '_manifest.json' || !file.endsWith('.json')) continue;
    const entries = loadJson(`pob-uniques/${file}`);
    if (!Array.isArray(entries)) continue;
    for (const block of entries) {
      if (typeof block !== 'string') continue;
      const name = block.split('\n')[0].trim();
      if (name && !name.includes(':')) names.add(name);
    }
  }
  return names;
}

function writeOverlay(file, data) {
  fs.writeFileSync(path.join(MANUAL_DIR, file), JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote data/manual/${file} (${data.entries.length} entries)`);
}

// --- origins (pure ggpk, no network) ----------------------------------------

async function buildOrigins(nameToVid, pobNames) {
  const schema = await loadSchema();
  const uo = (await parseTable('UniqueOrigins', { schema })).rows;
  const origin = (await parseTable('Origin', { schema })).rows;
  const words = (await parseTable('Words', { schema })).rows;
  const nameOf = (i) => (i == null ? null : words[i]?.Text ?? null);
  const originOf = (i) => (i == null ? null : origin[i]?.Id ?? null);

  const entries = [];
  const skipped = [];
  const byOrigin = {};
  const vaalNames = [];
  for (const r of uo) {
    const name = nameOf(r.Unique);
    const org = originOf(r.Origin);
    if (!name || !org) continue;
    byOrigin[org] = (byOrigin[org] ?? 0) + 1;
    if (org === 'Vaal' && pobNames.has(name)) vaalNames.push(name);
    const vid = nameToVid.get(name);
    if (!vid || !pobNames.has(name)) { skipped.push(name); continue; }
    entries.push({ unique: name, vid, origin: org });
  }
  entries.sort((a, b) => a.unique.localeCompare(b.unique));
  console.log('origins by tier:', byOrigin);
  if (skipped.length) console.warn(`  ${skipped.length} origin uniques skipped (not a graph node / no RePoE vid):`, skipped.join(', '));
  return { overlay: { kind: 'unique-origins', entries }, vaalNames };
}

// --- cultivated (poe2db, matched back to RePoE mods) ------------------------

// normalized display line -> RePoE mod id, over every UniqueMutatedVaal* mod.
// Two indexes: `exact` (verb-sensitive) and `loose` (verb-neutralized fallback).
// Several interchangeable mods can render identical text (e.g. three
// maximum_life_+% 5/10 rows) — keep the first by sorted id rather than dropping
// the key: any of them yields identical display, and the choice is deterministic.
function mutatedModIndex() {
  const raw = loadJson(`${REPOE}/mods.json`);
  const exact = new Map();
  const loose = new Map();
  const dupes = new Set();
  for (const id of Object.keys(raw).filter((k) => /UniqueMutatedVaal/i.test(k)).sort()) {
    for (const { text } of resolveImplicitTexts([id])) {
      const ek = keyExact(text);
      if (exact.has(ek)) dupes.add(ek); else exact.set(ek, id);
      const lk = keyLoose(text);
      if (!loose.has(lk)) loose.set(lk, id);
    }
  }
  return { exact, loose, dupes };
}

// Known phrasing gaps where poe2db's display wording diverges from RePoE's stat
// template enough that text matching can't bridge them (distinct, stable mods).
// Matched against the raw poe2db line as a last resort; kept tiny and explicit.
const ALIASES = [
  { re: /arrows pierce .* additional target/i, id: 'UniqueMutatedVaalAdditionalArrowPierce' },
  { re: /keystone passive skill/i, id: 'UniqueMutatedVaalRandomKeystoneFromTable' },
];

function poe2dbSlug(name) {
  return name.replace(/[’'`]/g, '').replace(/\s+/g, '_');
}

async function fetchCultivatedLines(name) {
  const res = await fetch(`${POE2DB}/${poe2dbSlug(name)}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) return { status: res.status, lines: null };
  const html = await res.text();
  const lines = [...html.matchAll(/<div class="[^"]*mutatedMod[^"]*">\s*<div>(.*?)<\/div>/gs)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) // tags -> space, keep word boundaries
    .filter(Boolean);
  return { status: 200, lines };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function buildCultivated(vaalNames, nameToVid) {
  const { exact, loose, dupes } = mutatedModIndex();
  const aliasOf = (line) => ALIASES.find((a) => a.re.test(line))?.id ?? null;
  const matchLine = (line) => exact.get(keyExact(line)) ?? loose.get(keyLoose(line)) ?? aliasOf(line);
  console.log(`mutated-mod match index: ${exact.size} exact + ${loose.size} loose keys (${dupes.size} shared-text groups)`);
  const entries = [];
  const report = { withMods: 0, noSection: [], fetchFail: [], unmatched: [] };

  for (const name of vaalNames) {
    const vid = nameToVid.get(name);
    if (!vid) { report.fetchFail.push(`${name} (no RePoE vid)`); continue; }
    let r;
    try { r = await fetchCultivatedLines(name); } catch (e) { report.fetchFail.push(`${name} (${e.message})`); await sleep(400); continue; }
    if (r.status !== 200) { report.fetchFail.push(`${name} (HTTP ${r.status})`); await sleep(400); continue; }
    if (!r.lines.length) { report.noSection.push(name); await sleep(400); continue; }

    const mods = [];
    for (const line of r.lines) {
      const id = matchLine(line);
      if (id) mods.push(id);
      else report.unmatched.push(`${name}: "${line}"`);
    }
    if (mods.length) { entries.push({ unique: name, vid, mods }); report.withMods++; }
    await sleep(400); // politeness
  }
  entries.sort((a, b) => a.unique.localeCompare(b.unique));

  console.log(`\ncultivated: ${report.withMods} uniques with mods, ${report.noSection.length} Vaal-origin with no cultivated section`);
  if (report.noSection.length) console.log('  no section:', report.noSection.join(', '));
  if (report.fetchFail.length) console.warn('  fetch failures:', report.fetchFail.join('; '));
  if (report.unmatched.length) console.warn(`  UNMATCHED lines (${report.unmatched.length}) — need attention:\n    ${report.unmatched.join('\n    ')}`);
  return { kind: 'cultivated-uniques', entries };
}

// --- main -------------------------------------------------------------------

async function main() {
  const originsOnly = process.argv.includes('--origins');
  const nameToVid = vidByName();
  const pobNames = pobUniqueNames();
  const { overlay: origins, vaalNames } = await buildOrigins(nameToVid, pobNames);
  writeOverlay('unique-origins.json', origins);
  if (originsOnly) return;
  console.log(`\nscraping poe2db for ${vaalNames.length} Vaal-origin uniques…`);
  const cultivated = await buildCultivated(vaalNames, nameToVid);
  writeOverlay('cultivated-uniques.json', cultivated);
}

main().catch((e) => { console.error(e); process.exit(1); });
