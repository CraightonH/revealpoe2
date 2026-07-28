// scripts/fetch-trade-stats.js — refresh the affix → trade stat id map.
//
// The Build Planner's trade link filters a search by the mods you actually
// crafted onto an item. That needs each affix family's official trade stat id
// (e.g. explicit.stat_3299347043), which lives in the trade service's stat
// index — NOT in RePoE source. Like TRADE_LEAGUE and the Lineage exchange ids,
// that's volatile trade-service state, so we resolve it once here and cache the
// result in a committed file (src/data/trade-stat-ids.json).
//
//   node scripts/fetch-trade-stats.js   (alias: npm run fetch:trade-stats)
//
// Matching is by display text, because that's the only join the two sides
// share: our families carry `generic` ("+# to Strength") and trade carries
// `text` ("# to Strength"). Four normalisations close the gap:
//
//   1. Sign — trade folds the leading +/- into the value, so "+# to Strength"
//      and "# to Strength" are the same stat.
//   2. Hybrids — our `generic` is the whole mod ("#% increased Armour\n+# to
//      Stun Threshold"); trade indexes each stat LINE separately. So a family
//      that doesn't match whole is matched line by line and maps to several ids.
//   3. Fixed values — a mod with a hardcoded roll ("Leech 3% of Physical Attack
//      Damage as Life") is retried with its literals blanked to #.
//   4. Polarity — trade indexes a downside under its upside wording with a
//      negative magnitude ("reduced" → "increased"). See `polarity` below.
//
// Spot-checked against ground truth: the hashes real listings publish in
// `item.extended.mods.explicit[].hash` agreed with this map on 10 of 10 mods
// sampled from live Attuned Wand listings.
//
// Families with no match are left out of the map entirely; the planner then
// says so on the link rather than silently under-filtering. Run it like a
// re-scrape — after a game patch, or when a league changes the mod pool — and
// check the printed coverage report before committing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modPools } from '../src/data/modPools.js';
import { nodesByKind } from '../src/data/graph.js';

const STATS_URL = 'https://www.pathofexile.com/api/trade2/data/stats';
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/data/trade-stat-ids.json',
);

// The one trade stat group each affix origin may resolve against.
//
// NEVER fall back across groups. Trade stat ids are type-scoped — the same stat
// appears in several groups under the same hash (explicit.stat_227523295 /
// enchant.stat_227523295 / desecrated.stat_…) and each only matches that stat in
// that position. Filtering a Vaal corrupted implicit by its explicit id searches
// for items carrying the mod as a rolled affix instead, which is a different
// item. A family absent from its own group is left unmapped and the planner says
// so — better than a confidently wrong search.
//
// Corrupted implicits map to Enchant, NOT Implicit, which is counter-intuitive
// enough to be worth stating: trade's "Implicit" group is base-item implicits
// (ring/amulet/belt lines, map-device mods) and does not carry corruption
// outcomes at all. Verified against the live search API — a corrupted search for
// "+1 to Maximum Power Charges" returns listings under enchant.stat_227523295
// and zero under implicit.stat_227523295.
const GROUP = {
  standard: 'Explicit',
  corrupted: 'Enchant',
  desecrated: 'Desecrated',
};

const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[+-]\s*#/g, '#')   // trade folds the sign into the value
  .replace(/\s+/g, ' ')
  .trim();

// Same, with literal numbers blanked — for mods whose roll is fixed on our side
// but still a filterable range on trade's.
const loose = (s) => norm(s).replace(/[+-]?\d+(?:\.\d+)?/g, '#');

// Trade canonicalises a downside stat to its upside wording and carries a
// negative magnitude: an item reading "30% reduced Attribute Requirements"
// indexes under "#% increased Attribute Requirements" (confirmed from a live
// listing's own stat hash, explicit.stat_3639275092). Same for less/more. Tried
// LAST, so a stat that genuinely publishes both wordings still matches its own.
const polarity = (s) => loose(s).replace(/\breduced\b/g, 'increased').replace(/\bless\b/g, 'more');

// ⚠️ Local vs global. Eight stats share their display text with a different
// stat and are told apart only by a "(Local)" suffix on the trade side —
// "# to Accuracy Rating" is the global one (rings, helmets), "# to Accuracy
// Rating (Local)" is the weapon's own. They match DISJOINT sets of items
// (verified against live listings), so binding a weapon affix to the global id
// searches for an item that cannot exist and returns nothing.
//
// Locality is read off the RePoE stat id's `local_` prefix, PER STAT LINE — a
// family-level flag would be wrong, because hybrids genuinely mix the two
// (`accuracyattackspeedhybrid` is global accuracy + local attack speed).
const LOCAL_SUFFIX = / \(local\)$/;
const isLocalStat = (statId) => String(statId ?? '').startsWith('local_');

/**
 * Per-line locality for a family, or null when we can't attribute a stat to a
 * line. Pairing is positional against the same top tier `generic` came from, so
 * it only holds when the tier's stat count matches its line count — true for
 * every family that touches an ambiguous text, and the fallback (treat as
 * global) is right for the ~1000 families that are wholly global anyway.
 */
function localityFor(node, lineCount) {
  const tiers = [...(node?.props?.tiers ?? [])].sort((a, b) => a.level - b.level);
  const stats = tiers[tiers.length - 1]?.stats ?? [];
  if (stats.length !== lineCount) return null;
  return stats.map((s) => isLocalStat(s.id));
}

async function fetchStats() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const r = await fetch(STATS_URL, {
        headers: { 'User-Agent': 'revealpoe2/fetch-trade-stats (+https://revealpoe2.com)' },
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      if (attempt === 3) throw err;
      console.warn(`[trade-stats] fetch attempt ${attempt} failed (${err.message}); retrying…`);
      await new Promise((res) => setTimeout(res, 1000 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
}

function buildIndex(result) {
  const idx = {};
  for (const group of result ?? []) {
    const exact = new Map();
    const fuzzy = new Map();
    const polar = new Map();
    // The "(Local)" entries again, keyed WITHOUT the suffix, so a local stat
    // line can find its own variant using the plain text our data carries.
    const local = new Map();
    for (const e of group.entries ?? []) {
      if (!e?.id || !e?.text) continue;
      for (const [m, k] of [[exact, norm(e.text)], [fuzzy, loose(e.text)], [polar, polarity(e.text)]]) {
        if (!m.has(k)) m.set(k, e.id);
      }
      const bare = norm(e.text).replace(LOCAL_SUFFIX, '');
      if (bare !== norm(e.text) && !local.has(bare)) local.set(bare, e.id);
    }
    idx[group.label] = { exact, fuzzy, polar, local };
  }
  return idx;
}

function lookup(idx, origin, text, isLocal = false) {
  const g = idx[GROUP[origin]];
  const k = norm(text);
  if (!g || !k) return null;
  // A local stat claims its "(Local)" variant before anything else; when the
  // stat has no local variant this falls through to the ordinary chain, which
  // is correct (e.g. plain "#% increased Physical Damage" IS the weapon-local
  // one — trade spells the global out as "increased Global Physical Damage").
  if (isLocal) {
    const hit = g.local.get(k);
    if (hit) return hit;
  }
  return g.exact.get(k) ?? g.fuzzy.get(loose(text)) ?? g.polar.get(polarity(text)) ?? null;
}

// Resolve one family to zero or more trade stat ids: whole text first (some
// trade entries are genuinely multi-line), then line by line.
function resolve(idx, fam, node) {
  if (!GROUP[fam.origin]) return { ids: [], lines: 0, hit: 0 };
  const lines = String(fam.generic ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const locality = localityFor(node, lines.length);

  // A whole-text hit only makes sense under one locality, so require unanimity.
  const whole = lookup(idx, fam.origin, fam.generic, Boolean(locality?.every(Boolean)));
  if (whole) return { ids: [whole], lines: 1, hit: 1 };

  const ids = [];
  lines.forEach((line, i) => {
    const id = lookup(idx, fam.origin, line, locality?.[i] ?? false);
    if (id && !ids.includes(id)) ids.push(id);
  });
  return { ids, lines: lines.length, hit: ids.length };
}

async function main() {
  const data = await fetchStats();
  const idx = buildIndex(data.result);
  const pools = modPools();
  // The graph node behind each family — modPools projects away the RePoE stat
  // ids, and those are what carry local-vs-global (see localityFor).
  const affixBySlug = new Map();
  for (const node of nodesByKind('affix')) affixBySlug.set(node.slug, node);

  const map = {};
  const stats = { full: 0, partial: 0, none: 0, skipped: 0 };
  const unmappedItemScope = new Set();

  for (const [slug, fam] of Object.entries(pools.families)) {
    if (!GROUP[fam.origin]) { stats.skipped++; continue; }
    if (!String(fam.generic ?? '').trim()) { stats.skipped++; continue; }
    const { ids, lines, hit } = resolve(idx, fam, affixBySlug.get(slug));
    if (!ids.length) {
      stats.none++;
      // Report the TEXT, not the family name — names repeat across families
      // (a weapon prefix and its jewellery twin share one), so a name list
      // shows mods as unmapped while another family of the same name mapped
      // fine. The text is what actually failed to match, and dedupes cleanly.
      if (fam.scope === 'item') unmappedItemScope.add(String(fam.generic).replace(/\n/g, ' / '));
      continue;
    }
    map[slug] = ids;
    if (hit === lines) stats.full++; else stats.partial++;
  }

  // Deterministic key order so the committed file diffs cleanly between runs.
  const sortedMap = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  const payload = {
    _comment: 'Generated by scripts/fetch-trade-stats.js — do not hand-edit. '
      + 'Maps our affix family slug → official trade-site stat ids, matched by display text.',
    generated_from: STATS_URL,
    count: Object.keys(sortedMap).length,
    map: sortedMap,
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');

  const considered = stats.full + stats.partial + stats.none;
  const pct = considered ? ((100 * (stats.full + stats.partial)) / considered).toFixed(1) : '0.0';
  console.log(`[trade-stats] wrote ${payload.count} mappings → ${path.relative(process.cwd(), OUT)}`);
  console.log(`[trade-stats] ${stats.full} exact, ${stats.partial} partial (hybrid, some lines), `
    + `${stats.none} unmapped of ${considered} rollable families (${pct}% filterable); `
    + `${stats.skipped} skipped (no text / non-rollable origin)`);
  if (unmappedItemScope.size) {
    console.warn(`[trade-stats] ${unmappedItemScope.size} distinct item-scope mods have NO trade filter `
      + '(the planner link says so rather than under-filtering silently):\n  '
      + [...unmappedItemScope].sort().join('\n  '));
  }
}

main().catch((err) => {
  console.error(`[trade-stats] failed: ${err.message}`);
  process.exit(1);
});
