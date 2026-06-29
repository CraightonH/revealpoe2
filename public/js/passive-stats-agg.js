// public/js/passive-stats-agg.js
//
// Pure, node-testable aggregation of passive-tree stat lines. Given the raw GGG
// stat strings of every allocated node (in our [tag|text] keyword format), it:
//   1. strips keyword markup to plain display text,
//   2. templatizes each line by replacing its numbers with {i} slots,
//   3. sums the slot values across every line sharing a template,
//   4. buckets each summed line into Offense / Defense / Attributes / Other via
//      approximate keyword heuristics, and
//   5. collects number-less lines (keystones, flags) verbatim as "unique effects".
//
// "8% increased" and "4% reduced" differ in text, so they get distinct templates
// and are never netted against each other — by design. Attribute resolution for
// the generic "+5 to any Attribute" nodes is the caller's job (it owns the
// per-node Str/Int/Dex choice); this module only sees already-resolved lines.

// Fixed display order of the summed-stat categories.
export const CATEGORY_ORDER = ['Offense', 'Defense', 'Attributes', 'Other'];

// Strip GGG keyword markup: [HitDamage|Hit] -> "Hit", [Shock] -> "Shock".
export function stripMarkup(line) {
  return String(line)
    .replace(/\[([^\]]+)\]/g, (_, body) => {
      const parts = body.split('|');
      return parts[parts.length - 1];
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// Match a signed, optionally-decimal number (e.g. "+5", "12", "0.4", "-100").
const NUM_RE = /[+-]?\d+(?:\.\d+)?/g;

// Parse one stripped line into { text, template, slots }. `template` has each
// number replaced by {i}; `slots` records each number's value, whether it
// carried an explicit sign, and its decimal count (for faithful re-rendering).
export function parseLine(raw) {
  const text = stripMarkup(raw);
  const slots = [];
  let i = 0;
  const template = text.replace(NUM_RE, (m) => {
    const hadSign = m[0] === '+' || m[0] === '-';
    const dot = m.indexOf('.');
    const decimals = dot === -1 ? 0 : m.length - dot - 1;
    slots.push({ value: parseFloat(m), hadSign, decimals });
    return `{${i++}}`;
  });
  return { text, template, slots };
}

// Format a summed slot value back into display text.
function fmt(total, hadSign, decimals) {
  const d = Math.min(decimals, 2);
  let s = d > 0 ? total.toFixed(d) : String(Math.round(total));
  if (hadSign && total >= 0) s = '+' + s;
  return s;
}

// Approximate keyword buckets, checked in this order (first match wins).
// Attributes first (most specific), then Defense, then Offense, else Other.
const ATTR_RE = /\b(strength|dexterity|intelligence|attribute|attributes)\b/i;
const DEF_RE = /\b(life|energy shield|\bmana\b|armour|evasion|resistance|resistances|block|regeneration|recovery|stun|ailment|flask|spirit|thorns|barrier|maximum|slow|taken)\b/i;
const OFF_RE = /\b(damage|critical|crit|attack speed|cast speed|accuracy|penetrat|shock|freeze|ignite|chill|bleed|poison|projectile|area|skill|duration|impale|exposure|culling|leech|herald)\b/i;

export function categorize(text) {
  if (ATTR_RE.test(text)) return 'Attributes';
  if (DEF_RE.test(text)) return 'Defense';
  if (OFF_RE.test(text)) return 'Offense';
  return 'Other';
}

// The resolved attribute templates ("{0} to Strength", …) that the generic
// "+5 to any Attribute" nodes are highlighted under (see the renderer).
const ATTR_TEMPLATES = new Set(
  ['Strength', 'Dexterity', 'Intelligence'].map((a) => parseLine(`+5 to ${a}`).template),
);

// Turn a stat template into a plain-text search query that the search bar's
// substring matcher will resolve to (roughly) the same nodes — used when a
// clicked stat line is pinned into the search box so the highlight persists.
// We pick the longest number-free segment, the most distinctive phrase present
// verbatim in the matching nodes' indexed text. Attribute lines map to the only
// phrase the generic nodes actually carry: "any attribute".
export function templateToQuery(template) {
  if (ATTR_TEMPLATES.has(template)) return 'any attribute';
  const segs = template.split(/\{\d+\}%?/).map((s) => s.trim()).filter(Boolean);
  segs.sort((a, b) => b.length - a.length);
  return (segs[0] || template).toLowerCase();
}

// Aggregate a flat array of raw stat lines (markup preserved) into categorized,
// summed display lines plus a list of unique (number-less) effects.
//
// Returns:
//   {
//     categories: [{ name, lines: [{ text, sortKey }] }],   // non-empty, ordered
//     uniqueEffects: [{ text, count }],                       // dedup'd, count>1 => xN
//   }
export function aggregate(lines) {
  const sums = new Map();    // template -> { slots:[{total,hadSign,decimals}], text }
  const uniques = new Map(); // stripped text -> count

  for (const raw of lines || []) {
    const parsed = parseLine(raw);
    if (!parsed.text) continue;
    if (parsed.slots.length === 0) {
      uniques.set(parsed.text, (uniques.get(parsed.text) || 0) + 1);
      continue;
    }
    const existing = sums.get(parsed.template);
    if (!existing) {
      sums.set(parsed.template, {
        text: parsed.text,
        slots: parsed.slots.map((s) => ({ total: s.value, hadSign: s.hadSign, decimals: s.decimals })),
      });
    } else {
      parsed.slots.forEach((s, idx) => {
        const slot = existing.slots[idx];
        if (!slot) return;
        slot.total += s.value;
        slot.decimals = Math.max(slot.decimals, s.decimals);
        slot.hadSign = slot.hadSign || s.hadSign;
      });
    }
  }

  // Render each summed template and bucket it.
  const buckets = new Map(CATEGORY_ORDER.map((c) => [c, []]));
  for (const { template, ...rest } of [...sums.entries()].map(([template, v]) => ({ template, ...v }))) {
    let idx = 0;
    const text = template.replace(/\{(\d+)\}/g, () => {
      const slot = rest.slots[idx++];
      return fmt(slot.total, slot.hadSign, slot.decimals);
    });
    const sortKey = Math.abs(rest.slots[0]?.total ?? 0);
    // `template` lets the caller map this summed line back to the nodes that
    // produced it (number-less shape → node highlight, like the search bar).
    buckets.get(categorize(rest.text)).push({ text, sortKey, template });
  }

  const categories = [];
  for (const name of CATEGORY_ORDER) {
    const lines = buckets.get(name);
    if (!lines.length) continue;
    lines.sort((a, b) => b.sortKey - a.sortKey || a.text.localeCompare(b.text));
    categories.push({ name, lines });
  }

  const uniqueEffects = [...uniques.entries()]
    // A number-less line's template is its own text, so `template` doubles as the
    // node-highlight key here too (parity with the summed lines above).
    .map(([text, count]) => ({ text, count, template: text }))
    .sort((a, b) => a.text.localeCompare(b.text));

  return { categories, uniqueEffects };
}
