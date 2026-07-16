// Pure quality-lookup engine, shared by the browser (gem-quality-input.js) and node tests
// so the two can't diverge. `series` is the gem's per-column breakpoint data emitted by the
// build (statText.js assembleQualityTable): { [col]: [[quality, value], …] }, ascending by
// quality, holding only the points where the floored value changes.
//
// The card treats quality as a STEP function: the value at a typed quality Q is the value at
// the largest breakpoint ≤ Q ("holds until the next breakpoint"). Below the first breakpoint
// the effect is 0, returned as null so the caller can decide how to show it.

export function lookupQuality(series, col, Q) {
  const pts = series && series[col];
  if (!pts || !pts.length) return null;
  let val = null;
  for (let i = 0; i < pts.length; i += 1) {
    const [q, v] = pts[i];
    if (q <= Q) val = v; else break; // ascending: once past Q, done
  }
  return val; // null when Q is below the first breakpoint
}
