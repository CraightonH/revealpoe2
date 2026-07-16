const EM = '—'; // em dash

const NUM = /-?\d+(?:\.\d+)?/g;
const SENTINEL = '\x00';

// Merge two stat strings that differ only in their numbers into one string
// with "(min—max)" at each differing position. If the non-numeric skeletons
// differ, fall back to the higher-level string `b`.
export function rangeMerge(a, b) {
  if (a === b) return a;
  const aNums = [];
  const bNums = [];
  const aSkel = a.replace(NUM, (m) => { aNums.push(m); return SENTINEL; });
  const bSkel = b.replace(NUM, (m) => { bNums.push(m); return SENTINEL; });
  if (aSkel !== bSkel || aNums.length !== bNums.length) return b;
  let i = 0;
  return aSkel.replace(new RegExp(SENTINEL, 'g'), () => {
    const lo = aNums[i];
    const hi = bNums[i];
    i += 1;
    return lo === hi ? lo : `(${lo}${EM}${hi})`;
  });
}

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// Gem quality is stored per-mille-per-quality-point; the value at the maximum 20%
// quality is raw × 20 / 1000 = raw / 50. This scaling applies to every quality
// stat, BEFORE any unit handler below. (Verified against poe2db: Arc chains 100 →
// 2, Herald of Ash overkill 15000 → /50 → 300 → per-second → 5.)
const QUALITY_DIVISOR = 50;

// Unit handlers embedded in quality templates as {stat/handler}: they convert the
// (already quality-scaled) internal value into its display units. Names mirror
// RePoE; the trailing "_Ndp"/"_if_required" only hints at display precision, which
// we normalise at the end, so variants of the same conversion share a divisor.
const HANDLERS = {
  per_minute_to_per_second_2dp_if_required: (v) => v / 60,
  divide_by_ten_1dp_if_required: (v) => v / 10,
  divide_by_one_hundred: (v) => v / 100,
  divide_by_one_hundred_2dp_if_required: (v) => v / 100,
  divide_by_one_hundred_0dp: (v) => v / 100,
  milliseconds_to_seconds: (v) => v / 1000,
  milliseconds_to_seconds_1dp: (v) => v / 1000,
  milliseconds_to_seconds_2dp_if_required: (v) => v / 1000,
  negate: (v) => -v,
};

function applyHandler(name, value) {
  const fn = HANDLERS[name];
  return fn ? fn(value) : value; // unknown / no handler → value unchanged
}

// Resolve a quality_stats entry {stat, stats} into a "(0—N)…" string showing the
// effect at max (20%) quality. A template may carry several {stat/handler} tokens
// but only quality-scaled stats appear in `stats`; the rest are base-skill
// references with no value here, which we blank (matching poe2db, e.g. Arctic
// Armour's "…every  seconds, up to a maximum of (0—1) Stages"). Returns null when
// no token resolves to a value, so the caller can omit the line.
export function resolveQuality(qstat) {
  const tmpl = qstat?.stat;
  if (!tmpl) return null;
  const stats = qstat.stats ?? {};
  let resolvedAny = false;
  const out = tmpl.replace(/\{([^/}]+)(?:\/([^}]+))?\}/g, (_whole, id, handler) => {
    const raw = stats[id];
    if (raw == null) return ''; // base-skill reference without a quality value → blank
    const resolved = applyHandler(handler, raw / QUALITY_DIVISOR);
    if (!Number.isFinite(resolved)) return '';
    resolvedAny = true;
    return `(0${EM}${round(resolved, 2)})`; // round trims float noise; trailing zeros drop
  });
  return resolvedAny ? out : null;
}

// Cost kinds (skills[key].per_level[L].costs) → display label for a table column.
const COST_LABELS = {
  Mana: 'Mana',
  ManaPerMinute: 'Mana / min',
  Ward: 'Ward',
  WardPerMinute: 'Ward / min',
};

// Replace every number token with an underscore, e.g.
// "Deals 8 to 12 Fire Damage" → "Deals _ to _ Fire Damage".
function blankNumbers(text) {
  return text.replace(NUM, '_');
}

// Ordered numbers in a string, e.g. "Deals 8 to 12 Fire" → ["8", "12"].
function extractNumbers(text) {
  return text.match(NUM) ?? [];
}

// Build a per-level scaling table from a granted skill record: one column per
// field that VARIES across the skill's gem levels (a constant field belongs in
// the effect header, not here), one row per level, ordered DESCENDING (highest
// level first) with the level-20 row flagged (`cap`) as the ceiling reachable
// without external modifiers. Cost columns come from `skill.per_level[L].costs`;
// stat columns are merged across every `stat_set`. Cells hold the level's numbers
// joined by " / " (or the raw token-bearing sentence when a level has none).
// Headers keep RePoE "[Id|Display]" markup intact for render-time resolution.
// Returns null when nothing varies.
export function buildLevelTable(skill) {
  const sets = skill?.stat_sets ?? [];
  const costPerLevel = skill?.per_level ?? {};

  const levelSet = new Set();
  for (const l of Object.keys(costPerLevel)) levelSet.add(Number(l));
  for (const set of sets) for (const l of Object.keys(set.per_level ?? {})) levelSet.add(Number(l));
  const levels = [...levelSet].filter(Number.isFinite).sort((a, b) => a - b);

  const columns = [];
  const cells = new Map(); // columnKey → Map(level → cellString)

  // Cost columns (in a stable kind order).
  const costKinds = new Set();
  for (const l of levels) {
    for (const kind of Object.keys(costPerLevel[String(l)]?.costs ?? {})) costKinds.add(kind);
  }
  for (const kind of costKinds) {
    const perLevel = new Map();
    for (const l of levels) {
      const amt = costPerLevel[String(l)]?.costs?.[kind];
      if (amt != null) perLevel.set(l, String(amt));
    }
    if (new Set(perLevel.values()).size <= 1) continue; // constant → skip
    const key = `cost:${kind}`;
    columns.push({ key, header: COST_LABELS[kind] ?? kind, kind: 'cost' });
    cells.set(key, perLevel);
  }

  // Damage-multiplier columns — the skill's base-damage scaling (e.g. a triggered
  // slam that "Deals X% of Base Damage"). Lives as a bare per-level number, NOT in
  // stat_text, so it has no rendered sentence; we label it "Base Damage" and show
  // each level's value as a percentage. Many attack/triggered skills (Volcanic
  // Steps, Volcanic Eruption, …) scale ONLY here, so without this their table is
  // empty. One column per stat_set that carries a varying multiplier.
  sets.forEach((set, idx) => {
    const pl = set.per_level ?? {};
    const perLevel = new Map();
    for (const l of levels) {
      const m = pl[String(l)]?.damage_multiplier;
      if (m != null) perLevel.set(l, `${m}%`);
    }
    if (perLevel.size === 0) return;
    if (new Set(perLevel.values()).size <= 1) return; // constant → skip
    const key = `damage:${idx}`;
    columns.push({ key, header: 'Base Damage', kind: 'damage' });
    cells.set(key, perLevel);
  });

  // Stat columns, merged across sets in tooltip order (then any extra keys).
  const seen = new Set();
  for (const set of sets) {
    const pl = set.per_level ?? {};
    const order = set.static?.tooltip_order ?? [];
    const extra = new Set();
    for (const l of Object.keys(pl)) {
      for (const k of Object.keys(pl[l].stat_text ?? {})) if (!order.includes(k)) extra.add(k);
    }
    for (const statKey of [...order, ...extra]) {
      if (seen.has(statKey)) continue;
      const byLevel = new Map();
      for (const l of levels) {
        const txt = pl[String(l)]?.stat_text?.[statKey];
        if (txt != null) byLevel.set(l, txt);
      }
      if (byLevel.size === 0) continue;
      if (new Set(byLevel.values()).size <= 1) continue; // constant → skip
      seen.add(statKey);
      const headerLevel = Math.max(...byLevel.keys());
      columns.push({ key: statKey, header: blankNumbers(byLevel.get(headerLevel)), kind: 'stat' });
      const perLevel = new Map();
      for (const [l, txt] of byLevel) {
        const nums = extractNumbers(txt);
        perLevel.set(l, nums.length ? nums.join(' / ') : txt);
      }
      cells.set(statKey, perLevel);
    }
  }

  if (columns.length === 0) return null;

  const rows = [];
  for (const level of [...levels].sort((a, b) => b - a)) {
    const rowCells = {};
    for (const col of columns) {
      const v = cells.get(col.key)?.get(level);
      if (v != null) rowCells[col.key] = v;
    }
    if (Object.keys(rowCells).length === 0) continue;
    rows.push({ level, cap: level === 20, cells: rowCells });
  }
  if (rows.length === 0) return null;
  return { columns, rows };
}

// ── Quality scaling table ───────────────────────────────────────────────────
// Gem quality effects scale linearly: value(Q) = raw × Q / 1000, then the same unit
// handler resolveQuality uses, then floored to the stat's natural display precision
// (the game rounds quality effects DOWN — you can never have half a chain or half a
// percent). The table's rows depend on whether the gem is "truly steppy" — has an
// integer-count effect (chains, stages, projectiles); only ~10–20 gems are:
//   • Steppy gem  → one row per true breakpoint of a DISCRETE column (no fixed grid, no
//     bands). Discrete = breaks at most once per 5%: the count, plus a slow companion
//     effect whose off-count breakpoints are worth showing; an every-1% column is merely
//     sampled at the chosen rows rather than flooding them.
//   • Otherwise   → a fixed 5% grid (redundant rows dropped) with the off-grid
//     breakpoints tucked into an expandable band under each row (smooth magnitudes
//     would otherwise be ~100 rows).

const QUALITY_STEP = 5;   // coarse-row spacing for smooth (non-steppy) gems
const QUALITY_MAX = 100;  // realistic ceiling (quality is uncapped in principle)

// Decimal places a quality value is shown — and floored — to. No handler → an integer
// count or integer percent (0dp). A unit handler encodes its own precision: an
// explicit "_Ndp", else divide_by_ten → tenths, divide_by_one_hundred / seconds /
// per-minute → hundredths. `negate` flips sign only. This is the reverse-engineered
// rounding: the in-game value is floor(raw × Q / 1000 through handler) at this dp.
function precisionOf(handler) {
  if (!handler || handler === 'negate') return 0;
  const dp = /(\d)dp/.exec(handler);
  if (dp) return Number(dp[1]);
  if (handler.startsWith('divide_by_ten')) return 1;
  if (handler.startsWith('divide_by_one_hundred')) return 2;
  if (handler.startsWith('milliseconds_to_seconds')) return 2;
  if (handler.startsWith('per_minute')) return 2;
  return 0;
}

// Floor x DOWN to dp decimal places (round returns a clean Number so String() trims
// float noise and trailing zeros: 0.4 not 0.40, 2 not 2.00).
function floorTo(x, dp) {
  const f = 10 ** dp;
  return round(Math.floor(x * f) / f, dp);
}

// Whether a token is an integer COUNT (chains, stages, projectiles, stacks) — a thing
// you gain in whole units — versus a magnitude (%, distance, duration). A gem with a
// count effect is "truly steppy" and gets breakpoint rows; everything else uses the
// coarse grid. `trailing` is the template text right after the token, up to the next.
const UNIT_WORD = /\b(?:metres?|seconds?|minutes?)\b/;
function isCountToken(id, handler, trailing) {
  if (handler && handler !== 'negate') return false; // a dividing handler → magnitude
  if (id.includes('%')) return false;                // percentage stat → magnitude
  if (/^\s*%/.test(trailing)) return false;          // "{stat}% increased …"
  if (UNIT_WORD.test(trailing)) return false;        // "{stat} seconds / metres"
  return true;
}

// Parse one quality_stats entry into { header, tokens }, or null when nothing scales.
// header = the template with each *scaling* token blanked to "_" and each base-skill
// reference token (present in the template but absent from `stats`) blanked to "" —
// exactly resolveQuality's blanking, so the header reads like the effect line.
function parseQualityStat(qstat) {
  const tmpl = qstat?.stat;
  if (!tmpl) return null;
  const stats = qstat.stats ?? {};
  const re = /\{([^/}]+)(?:\/([^}]+))?\}/g;
  const header = tmpl.replace(re, (_w, id) => (stats[id] == null ? '' : '_'));
  const tokens = [];
  let m;
  while ((m = re.exec(tmpl)) !== null) {
    const [whole, id, handler] = m;
    const raw = stats[id];
    if (raw == null) continue; // base-skill reference → contributes no value
    const trailing = tmpl.slice(m.index + whole.length).split('{')[0];
    tokens.push({
      handler: handler ?? null,
      permille: raw,
      precision: precisionOf(handler),
      count: isCountToken(id, handler, trailing),
    });
  }
  return tokens.length ? { header, tokens } : null;
}

// Display value of a parsed quality effect at quality Q (percent): each scaled token is
// floor(raw × Q / 1000 through its handler) at the token's precision; multiple scaled
// tokens join with " / " (matches buildLevelTable cells).
function qualityValueAt(parsed, Q) {
  const parts = [];
  for (const t of parsed.tokens) {
    const raw = applyHandler(t.handler, (t.permille * Q) / 1000);
    if (!Number.isFinite(raw)) continue;
    parts.push(String(floorTo(raw, t.precision)));
  }
  return parts.length ? parts.join(' / ') : null;
}

// Whether a quality effect's value actually changes across quality 1..100 (a flat
// effect — e.g. permille 0 — is not worth a column).
function qualityVaries(valueAt) {
  const distinct = new Set();
  for (let Q = 1; Q <= QUALITY_MAX; Q += 1) { const v = valueAt(Q); if (v != null) distinct.add(v); }
  return distinct.size > 1;
}

// Effect definitions for a set of quality-stat objects [{ stat, stats }], tagged with
// `kind` ('quality' or 'alt-quality'). valueAt(Q) is the floored display value at
// quality Q; the closure computes any Q, so a downstream merge can share rows across
// contributing skills (the reason the gem-level merge happens here at build time —
// runtime keeps only the finished string cells).
function qualityColumnDefs(qstats, kind = 'quality') {
  const out = [];
  for (const q of qstats ?? []) {
    const parsed = parseQualityStat(q);
    if (!parsed) continue;
    out.push({
      header: parsed.header,
      kind,
      count: parsed.tokens.every((t) => t.count),
      valueAt: (Q) => qualityValueAt(parsed, Q),
    });
  }
  return out;
}

// A skill's standard quality_stats, flattened across its stat sets.
function skillQualityStats(skill) {
  return (skill?.stat_sets ?? []).flatMap((set) => set.static?.quality_stats ?? []);
}

// A column is "discrete" (its breakpoints are worth showing as exact rows) if it changes
// at most once per 5% on average — i.e. no more breakpoints than there are 5% grid steps.
// A column that ticks every ~1% (a smooth magnitude) exceeds this and is "continuous".
const DISCRETE_MAX_BREAKPOINTS = QUALITY_MAX / QUALITY_STEP; // 20

// Assemble effect defs into the scaling table, or null when none vary. Shape mirrors
// buildLevelTable:
//   { columns: [{ key, header, kind, skill? }],
//     rows:    [{ quality, cells:{key:value}, band?:[{quality, cells}] }] }
// Row model depends on whether the gem is "truly steppy" — has an integer-COUNT effect
// (chains, stages). Only ~10 gems are:
//   • Steppy gem → a row at each quality where a DISCRETE column ticks up (its true
//     breakpoints, no grid, no bands). "Discrete" = the count plus any other column
//     that also breaks sparsely (≤ once per 5%), so a slow Gemling % adds its own
//     breakpoints (the 27% row) while an every-1% column is merely sampled at the rows.
//   • Otherwise → the coarse 5% grid: keep a row only where a value changed since the
//     previous grid mark, off-grid breakpoints in an expandable `band` (a smooth
//     magnitude would otherwise be ~100 rows). Descending, like the level table.
function assembleQualityTable(defs) {
  const varying = [];
  const seen = new Set();
  defs.forEach((d) => {
    if (!qualityVaries(d.valueAt)) return;
    const series = [];
    for (let Q = 1; Q <= QUALITY_MAX; Q += 1) series.push(d.valueAt(Q));
    const sig = `${d.kind}|${d.header}|${series.join(',')}`;
    if (seen.has(sig)) return; // dedupe an effect repeated across stat sets / skills
    seen.add(sig);
    varying.push(d);
  });
  if (!varying.length) return null;

  const columns = [];
  const valueFns = new Map();
  const countKeys = new Set();
  varying.forEach((d, idx) => {
    const key = `q${idx}`;
    const col = { key, header: d.header, kind: d.kind };
    if (d.skill) col.skill = d.skill;
    columns.push(col);
    valueFns.set(key, d.valueAt);
    if (d.count) countKeys.add(key);
  });

  const cellsAt = (Q) => {
    const cells = {};
    for (const col of columns) { const v = valueFns.get(col.key)(Q); if (v != null) cells[col.key] = v; }
    return cells;
  };
  const changedOn = (keys) => (a, b) => keys.some((k) => (a[k] ?? '') !== (b[k] ?? ''));
  const changed = changedOn(columns.map((c) => c.key));

  // Which columns are sparse enough to drive breakpoint rows (changes over 1..100 vs
  // the 0% baseline, so a leading run of zeros before the first tick doesn't count).
  const breakpointCount = (key) => {
    let n = 0; let prev = valueFns.get(key)(0);
    for (let Q = 1; Q <= QUALITY_MAX; Q += 1) { const v = valueFns.get(key)(Q); if (v !== prev) { n += 1; prev = v; } }
    return n;
  };
  const discreteKeys = columns.map((c) => c.key).filter((k) => breakpointCount(k) <= DISCRETE_MAX_BREAKPOINTS);

  const rows = [];
  // Breakpoint mode only for a truly-steppy gem (has a count) that has sparse columns to
  // drive the rows; everything else falls to the coarse grid.
  if (countKeys.size && discreteKeys.length) {
    // A row wherever a discrete column ticks up; dense columns sampled there.
    const discreteChanged = changedOn(discreteKeys);
    let prev = cellsAt(0);
    for (let Q = 1; Q <= QUALITY_MAX; Q += 1) {
      const cells = cellsAt(Q);
      if (discreteChanged(cells, prev)) rows.push({ quality: Q, cells });
      prev = cells;
    }
  } else {
    // Purely smooth: coarse 5% grid + expandable bands for off-grid breakpoints.
    for (let C = QUALITY_STEP; C <= QUALITY_MAX; C += QUALITY_STEP) {
      const cells = cellsAt(C);
      const prevGrid = cellsAt(C - QUALITY_STEP); // Q=0 at the low end → all nil
      if (!changed(cells, prevGrid)) continue;    // no new value over this 5% span → drop
      const band = [];
      let prev = prevGrid;
      for (let q = C - QUALITY_STEP + 1; q < C; q += 1) {
        if (q < 1) continue;
        const c = cellsAt(q);
        if (changed(c, prev)) band.push({ quality: q, cells: c }); // off-grid breakpoint
        prev = c;
      }
      band.reverse(); // descending, so the band matches the surrounding table order
      const row = { quality: C, cells };
      if (band.length) row.band = band;
      rows.push(row);
    }
  }
  if (!rows.length) return null;
  rows.reverse(); // highest quality first, matching the level table

  // Per-column COMPLETE step function over Q=1..100 (change-points only): the client's
  // quality input reads this to show a card line's value at any typed quality. Sampled
  // from the same valueAt the table is built from (single source of truth for the
  // formula), but complete — the display `rows` under-sample a dense column on a steppy
  // gem (it's only sampled where a discrete column ticks), so the input can't use them.
  // Ascending by quality; the first entry is the first Q whose floored value leaves the
  // 0% baseline. Column keys match `columns`, so a card line's mapped key indexes both.
  const series = {};
  for (const col of columns) {
    const fn = valueFns.get(col.key);
    const pts = [];
    let prev = fn(0);
    for (let Q = 1; Q <= QUALITY_MAX; Q += 1) {
      const v = fn(Q);
      if (v !== prev) { pts.push([Q, v]); prev = v; }
    }
    series[col.key] = pts;
  }
  return { columns, rows, series };
}

// Match a resolved quality range token, e.g. "(0—2)", "(0—0.4)", "(0—-0.4)" (negate).
// Global; recreate per use since it carries lastIndex.
const QUALITY_RANGE = new RegExp(`\\(0${EM}-?\\d+(?:\\.\\d+)?\\)`, 'g');

// A resolved quality line with every range token blanked to "_", so it equals the
// matching quality-table column header (parseQualityStat blanks the same way). The join
// key that maps a card quality line to its table column / series entry.
export function qualitySkeleton(line) {
  return line.replace(QUALITY_RANGE, '_');
}

// How many range tokens a resolved quality line carries (one per scaling stat). A
// multi-token line's table cell joins the values with " / " at the same order.
export function qualityTokenCount(line) {
  return (line.match(QUALITY_RANGE) || []).length;
}

// Quality scaling table for a single granted skill (null when nothing varies).
export function buildQualityTable(skill) {
  return assembleQualityTable(qualityColumnDefs(skillQualityStats(skill)));
}

// Merged quality table for a gem across its granted skills. `contributors` is
// [{ skill, name, altStats }] where altStats is that skill's Gemling second-quality
// effects as { stat, stats } objects (see gemQuality.altQualityStats). Standard and alt
// effects both become columns (alt ones tagged kind:'alt-quality'); the steppy-vs-grid
// row model is decided across all of them. A per-column `skill` caption is added only
// when more than one skill contributes (mirrors mergeLevelTables).
export function buildGemQualityTable(contributors) {
  const withDefs = (contributors ?? [])
    .map(({ skill, name, altStats }) => ({
      name,
      defs: [
        ...qualityColumnDefs(skillQualityStats(skill), 'quality'),
        ...qualityColumnDefs(altStats, 'alt-quality'),
      ].filter((d) => qualityVaries(d.valueAt)),
    }))
    .filter((c) => c.defs.length);
  const captioned = withDefs.length > 1;
  const defs = withDefs.flatMap((c) => c.defs.map((d) => (captioned ? { ...d, skill: c.name } : d)));
  return assembleQualityTable(defs);
}

// Split a stat string into its non-number segments and its numbers, such that
// interleaving them reconstructs the original: "Deals 12 to 18 Fire" ->
// { segs: ['Deals ', ' to ', ' Fire'], nums: ['12', '18'] }. Collision-proof
// (no sentinel char): reconstruction is segs[0]+nums[0]+segs[1]+…
export function splitNumbers(text) {
  const nums = text.match(NUM) ?? [];
  const segs = text.split(NUM);
  return { segs, nums };
}

// Inverse of splitNumbers: weave per-level numbers back into a template's segments.
export function interleave(segs, nums) {
  let out = segs[0] ?? '';
  for (let i = 1; i < segs.length; i += 1) out += (nums[i - 1] ?? '') + segs[i];
  return out;
}

// A skill's activation cost per gem level (1..maxLevel), as { [level]: [{kind, amount}] }.
// Unlike skillCosts (which summarises to a min/max range), this keeps every level so the
// gem card's level selector can show the exact cost at the chosen level. Returns null when
// the skill has no per-level cost at all. Kind → display label is applied by the app.
export function costByLevel(skill, maxLevel = 40) {
  const perLevel = skill?.per_level ?? {};
  const out = {};
  for (const l of Object.keys(perLevel)) {
    const L = Number(l);
    if (!Number.isFinite(L) || L < 1 || L > maxLevel) continue;
    const costs = perLevel[l]?.costs;
    if (!costs) continue;
    const entries = Object.entries(costs).map(([kind, amount]) => ({ kind, amount }));
    if (entries.length) out[L] = entries;
  }
  return Object.keys(out).length ? out : null;
}

// Build ordered sections for the gem card's LEVEL SELECTOR — the per-level analogue of
// buildSections. Same section/line structure and order, but each line is either constant
// ({ text }) or varying ({ segs, byLevel }): the prose skeleton is stored once and only the
// numbers vary per level, so the payload stays compact (mirrors buildLevelTable). Quality is
// level-independent (shown at max 20% quality), so it carries a single resolved list, same as
// buildSections. A line whose numeric skeleton drifts across levels (rare) degrades to the
// highest-level text as a constant line. maxLevel defaults to 40 (skills scale past the 20 cap).
export function buildScalingSections(skill, maxLevel = 40) {
  const sets = skill?.stat_sets ?? [];
  const sections = [];
  for (let setIndex = 0; setIndex < sets.length; setIndex += 1) {
    const set = sets[setIndex];
    const label = set.label?.[1] ?? set.label?.[0] ?? '';
    const order = set.static?.tooltip_order ?? Object.keys(set.static?.stat_text ?? {});
    const constText = set.static?.stat_text ?? {};
    const perLevel = set.per_level ?? {};
    const levels = Object.keys(perLevel)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n <= maxLevel)
      .sort((x, y) => x - y);

    const lines = [];
    for (const key of order) {
      const c = constText[key];
      if (typeof c === 'string' && c.trim()) { lines.push({ text: c }); continue; }
      const texts = new Map(); // level → stat_text at that level
      for (const l of levels) {
        const t = perLevel[l]?.stat_text?.[key];
        if (t != null) texts.set(l, t);
      }
      if (texts.size === 0) continue;
      const distinct = new Set(texts.values());
      if (distinct.size === 1) { lines.push({ text: [...distinct][0] }); continue; }
      // Varying: use the highest level's skeleton as the reference template.
      const hi = Math.max(...texts.keys());
      const ref = splitNumbers(texts.get(hi));
      const refSkel = ref.segs.join('\x00');
      const byLevel = {};
      let ok = true;
      for (const [l, t] of texts) {
        const s = splitNumbers(t);
        if (s.segs.join('\x00') !== refSkel) { ok = false; break; }
        byLevel[l] = s.nums;
      }
      if (!ok) { lines.push({ text: texts.get(hi) }); continue; } // skeleton drift → constant
      lines.push({ segs: ref.segs, byLevel });
    }

    // Bare per-level damage_multiplier — the skill's base-damage scaling — has no
    // stat_text sentence (see buildLevelTable's "Base Damage" column). Emit it as a
    // varying line so the card body actually changes with level for skills that scale
    // ONLY here (e.g. Ancestral Cry's Volcanic Steps / Volcanic Eruption). Prepended
    // so the damage line reads first, as in-game tooltips do.
    const dmg = new Map();
    for (const l of levels) {
      const m = perLevel[String(l)]?.damage_multiplier;
      if (m != null) dmg.set(l, String(m));
    }
    if (dmg.size && new Set(dmg.values()).size > 1) {
      const byLevel = {};
      for (const [l, v] of dmg) byLevel[l] = [v];
      lines.unshift({ segs: ['Deals ', '% of Base Damage'], byLevel });
    }

    const quality = [];
    for (const q of set.static?.quality_stats ?? []) {
      const r = resolveQuality(q);
      if (r) quality.push(r);
    }

    if (lines.length || quality.length) sections.push({ label, lines, quality, setIndex });
  }
  return sections;
}

// Build ordered sections from a granted skill record. maxLevel caps the
// per-level range (display cap is 20).
export function buildSections(skill, maxLevel = 20) {
  const sets = skill?.stat_sets ?? [];
  const sections = [];
  for (let setIndex = 0; setIndex < sets.length; setIndex += 1) {
    const set = sets[setIndex];
    // label = [id, displayName, …]; prefer the display name (e.g. the id
    // "BoltsNoDescription" displays as "Bolts").
    const label = set.label?.[1] ?? set.label?.[0] ?? '';
    const order = set.static?.tooltip_order ?? Object.keys(set.static?.stat_text ?? {});
    const constText = set.static?.stat_text ?? {};
    const perLevel = set.per_level ?? {};
    const levels = Object.keys(perLevel)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n <= maxLevel)
      .sort((x, y) => x - y);
    const lo = levels[0];
    const hi = levels[levels.length - 1];

    const lines = [];
    for (const key of order) {
      const c = constText[key];
      if (typeof c === 'string' && c.trim()) {
        lines.push(c);
        continue;
      }
      const loText = perLevel[lo]?.stat_text?.[key];
      const hiText = perLevel[hi]?.stat_text?.[key];
      if (loText && hiText) {
        lines.push(rangeMerge(loText, hiText));
      } else if (hiText) {
        lines.push(hiText);
      }
    }

    const quality = [];
    for (const q of set.static?.quality_stats ?? []) {
      const r = resolveQuality(q);
      if (r) quality.push(r);
    }

    // setIndex is the source stat_set position (NOT the emitted section position —
    // sets with no lines/quality are skipped). Kept so the builder can attach the
    // Gemling alt quality, which targets a specific stat set. See scripts/graph/gems.js.
    if (lines.length || quality.length) sections.push({ label, lines, quality, setIndex });
  }
  return sections;
}
