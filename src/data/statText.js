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

// Build ordered sections from a granted skill record. maxLevel caps the
// per-level range (display cap is 20).
export function buildSections(skill, maxLevel = 20) {
  const sets = skill?.stat_sets ?? [];
  const sections = [];
  for (const set of sets) {
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

    if (lines.length || quality.length) sections.push({ label, lines, quality });
  }
  return sections;
}
