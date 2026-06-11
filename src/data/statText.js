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

const HANDLERS = {
  per_minute_to_per_second_2dp_if_required: (v) => round(v / 60, 2),
  divide_by_ten_1dp_if_required: (v) => round(v / 10, 1),
  divide_by_one_hundred: (v) => round(v / 100, 2),
  milliseconds_to_seconds_2dp_if_required: (v) => round(v / 1000, 2),
};

function round(n, dp) {
  const f = 10 ** dp;
  return String(Math.round(n * f) / f);
}

function applyHandler(name, value) {
  const fn = HANDLERS[name];
  return fn ? fn(value) : String(value);
}

// Resolve a quality_stats entry {stat, stats} into a "(0—N)…" string.
// Returns null when the template can't be resolved or the value is an
// implausible percentage (> 100), so the caller can omit it.
export function resolveQuality(qstat) {
  const tmpl = qstat?.stat;
  if (!tmpl) return null;
  const m = tmpl.match(/\{([^/}]+)(?:\/([^}]+))?\}/);
  if (!m) return null;
  const id = m[1];
  const handler = m[2];
  const raw = qstat.stats?.[id];
  if (raw == null) return null;
  const resolved = Number(applyHandler(handler, raw));
  if (Number.isNaN(resolved)) return null;
  const isPercent = tmpl.includes('}%');
  if (isPercent && resolved > 100) return null; // implausible — omit
  return tmpl.replace(m[0], `(0${EM}${resolved})`);
}

// Build ordered sections from a granted skill record. maxLevel caps the
// per-level range (display cap is 20).
export function buildSections(skill, maxLevel = 20) {
  const sets = skill?.stat_sets ?? [];
  const sections = [];
  for (const set of sets) {
    const label = set.label?.[0] ?? '';
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
