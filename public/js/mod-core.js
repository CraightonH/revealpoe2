// public/js/mod-core.js
//
// Pure resolution + legality core for the Build Planner mod picker. No DOM/
// window imports — importable by node:test (relative path) and by the browser
// at /static/js/mod-core.js. Operates on a parsed mod-pools.json object and a
// schema-v2 build; returns pool views, resolved mods, and warning lists. Never
// throws on malformed input (mirrors build-rules.js philosophy).

export const MAX_PREFIX = 3;
export const MAX_SUFFIX = 3;
export const MAX_MODS = 6;

// One family view for the picker: tiers narrowed to a base's allowed indices.
function familyView(pools, ref) {
  const fam = pools.families?.[ref.a];
  if (!fam) return null;
  const allow = ref.t ? new Set(ref.t) : null;
  const tiers = fam.tiers.filter((_, i) => !allow || allow.has(i));
  if (!tiers.length) return null;
  return { affix: ref.a, name: fam.name, generic: fam.generic, gen: fam.origin === 'corrupted' ? 'corrupted' : null, tiers };
}

/** { prefix, suffix, corrupted } family views legal on a base slug. */
export function poolsForBase(pools, baseSlug) {
  const out = { prefix: [], suffix: [], corrupted: [] };
  const refs = pools?.bases?.[baseSlug] ?? [];
  for (const ref of refs) {
    const fam = pools.families?.[ref.a];
    if (!fam) continue;
    const view = familyView(pools, ref);
    if (!view) continue;
    if (fam.origin === 'corrupted') { out.corrupted.push(view); continue; }
    // A standard family lands in prefix and/or suffix by its tiers' gen.
    for (const bucket of ['prefix', 'suffix']) {
      const tiers = view.tiers.filter((t) => t.gen === bucket);
      if (tiers.length) out[bucket].push({ ...view, gen: bucket, tiers });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  out.prefix.sort(byName); out.suffix.sort(byName); out.corrupted.sort(byName);
  return out;
}

/** Corrupted-implicit family views for a base or unique ref. */
export function corruptedForRef(pools, ref) {
  if (!ref) return [];
  const baseSlug = ref.kind === 'unique' ? pools?.uniques?.[ref.slug] : ref.slug;
  if (!baseSlug) return [];
  return poolsForBase(pools, baseSlug).corrupted;
}

/** A chosen { affix, tier } to renderable data, or null if it no longer resolves. */
export function resolveMod(pools, chosen) {
  if (!chosen) return null;
  const fam = pools?.families?.[chosen.affix];
  const tier = fam?.tiers.find((t) => t.id === chosen.tier);
  if (!fam || !tier) return null;
  return { affix: chosen.affix, name: fam.name, id: tier.id, level: tier.level, gen: tier.gen, text: tier.text };
}

// Which prefix/suffix bucket a chosen standard mod occupies (its resolved tier's gen).
function bucketOf(pools, chosen) {
  return resolveMod(pools, chosen)?.gen ?? null;
}

/** Warnings for one gear cell's chosen mods. Never throws. */
export function modViolations(cell, pools) {
  const out = [];
  const mods = Array.isArray(cell?.mods) ? cell.mods : [];
  const baseSlug = cell?.item?.slug;
  const legal = new Set((pools?.bases?.[baseSlug] ?? []).map((r) => r.a));

  let prefixes = 0, suffixes = 0;
  const seen = new Set();
  for (const m of mods) {
    if (m?.affix && legal.size && !legal.has(m.affix)) {
      out.push({ code: 'illegal-mod', message: `${m.affix} cannot roll on this base` });
    }
    if (m?.affix) {
      if (seen.has(m.affix)) out.push({ code: 'duplicate-mod', message: `${m.affix} is chosen more than once` });
      else seen.add(m.affix);
    }
    const b = bucketOf(pools, m);
    if (b === 'prefix') prefixes++;
    else if (b === 'suffix') suffixes++;
  }
  if (prefixes > MAX_PREFIX) out.push({ code: 'prefix-overflow', message: `${prefixes} prefixes exceed ${MAX_PREFIX}` });
  if (suffixes > MAX_SUFFIX) out.push({ code: 'suffix-overflow', message: `${suffixes} suffixes exceed ${MAX_SUFFIX}` });
  if (mods.length > MAX_MODS) out.push({ code: 'mods-overflow', message: `${mods.length} mods exceed ${MAX_MODS}` });
  return out;
}
