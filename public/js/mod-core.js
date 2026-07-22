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

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function tierSelect(affix, fam, chosenTierId, attr = 'data-mod-tier') {
  const opts = fam.tiers.map((t) =>
    `<option value="${esc(t.id)}"${t.id === chosenTierId ? ' selected' : ''}>` +
    `T${fam.tiers.length - fam.tiers.indexOf(t)} · ${esc(t.text)}</option>`).join('');
  return `<select class="mod-picker__tier" ${attr}="${esc(affix)}">${opts}</select>`;
}

// Corrupted-implicit chooser (single choice), rendered red. Shared by base mode
// (appended after prefix/suffix) and unique mode (the whole body). Uses distinct
// data-mod-corrupt* hooks so it never collides with the mods[] prefix/suffix flow.
function corruptedCol(view, cell) {
  const cur = cell?.corrupted?.affix ?? null;
  const curFam = cur ? view.corrupted.find((f) => f.affix === cur) : null;
  const rows = view.corrupted.map((f) =>
    `<button type="button" class="mod-picker__row mod-picker__row--corrupt${f.affix === cur ? ' is-chosen' : ''}" data-mod-corrupt="${esc(f.affix)}">` +
    `<span class="mod-picker__generic mod-picker__generic--corrupt">${esc(f.generic)}</span></button>`).join('')
    || '<p class="mod-picker__none">No corrupted implicits on this base.</p>';
  const chosen = curFam
    ? `<div class="mod-picker__chosen-row mod-picker__chosen-row--corrupt">` +
      `<span class="mod-picker__generic mod-picker__generic--corrupt">${esc(curFam.name)}</span>` +
      `${tierSelect(cur, curFam, cell.corrupted.tier, 'data-mod-tier-corrupt')}` +
      `<button type="button" class="mod-picker__remove" data-mod-corrupt-remove aria-label="Remove corruption">×</button></div>`
    : '';
  return `<div class="mod-picker__col mod-picker__col--corrupt"><h4>Corrupted implicit <span>${cur ? '1' : '0'}/1</span></h4>${rows}${chosen}</div>`;
}

// Origin pill for non-standard families (desecrated = Well-of-Souls boss, or
// "Abyssal" when unbossed). Standard families get none — they are the default.
function originPill(f) {
  if (f.origin === 'desecrated') {
    return `<span class="mod-picker__origin mod-picker__origin--desecrated">${esc(f.boss || 'Abyssal')}</span>`;
  }
  return '';
}

function addRows(fams, chosenAffixes) {
  return fams.map((f) => {
    const on = chosenAffixes.has(f.affix);
    return `<button type="button" class="mod-picker__row${on ? ' is-chosen' : ''}" data-mod-add="${esc(f.affix)}">` +
      `<span class="mod-picker__generic">${esc(f.generic)}</span>${originPill(f)}</button>`;
  }).join('');
}

/** Popover inner HTML. `view` = { prefix, suffix, corrupted, mode }. */
export function modPickerHtml(view, cell) {
  const mods = Array.isArray(cell?.mods) ? cell.mods : [];
  const chosen = new Set(mods.map((m) => m.affix));
  const famByAffix = new Map([...view.prefix, ...view.suffix].map((f) => [f.affix, f]));

  const head = (title, withSearch) =>
    `<header class="mod-picker__head"><h3>${esc(title)}</h3>` +
    (withSearch ? '<input class="mod-picker__search" type="search" placeholder="Filter modifiers…" autocomplete="off">' : '') +
    `<button type="button" class="mod-picker__close" data-mod-close aria-label="Close">×</button></header>`;

  // Uniques: only the corrupted implicit.
  if (view.mode === 'unique') {
    return `<div class="mod-picker" data-mod-picker>${head('Corrupted implicit', false)}${corruptedCol(view, cell)}</div>`;
  }

  const chosenList = mods.map((m) => {
    const fam = famByAffix.get(m.affix);
    if (!fam) return '';
    return `<li class="mod-picker__chosen-row">` +
      `<span class="mod-picker__generic">${esc(fam.name)}</span>` +
      `${tierSelect(m.affix, fam, m.tier)}` +
      `<button type="button" class="mod-picker__remove" data-mod-remove="${esc(m.affix)}" aria-label="Remove">×</button></li>`;
  }).join('');

  // Bases: prefix/suffix explicits + (if any) a corrupted implicit chooser.
  return `<div class="mod-picker" data-mod-picker>` +
    head('Modifiers', true) +
    `<div class="mod-picker__cols">` +
      `<div class="mod-picker__col"><h4>Prefixes <span>${view.prefix.filter((f) => chosen.has(f.affix)).length}/${MAX_PREFIX}</span></h4>${addRows(view.prefix, chosen)}</div>` +
      `<div class="mod-picker__col"><h4>Suffixes <span>${view.suffix.filter((f) => chosen.has(f.affix)).length}/${MAX_SUFFIX}</span></h4>${addRows(view.suffix, chosen)}</div>` +
    `</div>` +
    (view.corrupted.length ? corruptedCol(view, cell) : '') +
    `<ul class="mod-picker__chosen">${chosenList}</ul>` +
    `</div>`;
}

// One family view for the picker: tiers narrowed to a base's allowed indices.
function familyView(pools, ref) {
  const fam = pools.families?.[ref.a];
  if (!fam) return null;
  const allow = ref.t ? new Set(ref.t) : null;
  const tiers = fam.tiers.filter((_, i) => !allow || allow.has(i));
  if (!tiers.length) return null;
  return {
    affix: ref.a, name: fam.name, generic: fam.generic,
    origin: fam.origin, boss: fam.boss ?? null,
    gen: fam.origin === 'corrupted' ? 'corrupted' : null, tiers,
  };
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
  // Standard families first, then desecrated (Abyssal); alphabetical within each.
  const rank = (o) => (o === 'standard' ? 0 : o === 'desecrated' ? 1 : 2);
  const cmp = (a, b) => rank(a.origin) - rank(b.origin) || a.name.localeCompare(b.name);
  out.prefix.sort(cmp); out.suffix.sort(cmp); out.corrupted.sort(cmp);
  return out;
}

/** Corrupted-implicit family views for a base or unique ref. */
export function corruptedForRef(pools, ref) {
  if (!ref) return [];
  const baseSlug = ref.kind === 'unique' ? pools?.uniques?.[ref.slug] : ref.slug;
  if (!baseSlug) return [];
  return poolsForBase(pools, baseSlug).corrupted;
}

/**
 * A chosen { affix, tier } to renderable data, or null if it no longer resolves.
 * `tierNum` is the in-game tier rank (T1 = top/highest, matching the picker's
 * `tierSelect` labelling); `tierCount` is the family's tier total.
 */
export function resolveMod(pools, chosen) {
  if (!chosen) return null;
  const fam = pools?.families?.[chosen.affix];
  const idx = fam ? fam.tiers.findIndex((t) => t.id === chosen.tier) : -1;
  if (!fam || idx < 0) return null;
  const tier = fam.tiers[idx];
  return {
    affix: chosen.affix, name: fam.name, origin: fam.origin, id: tier.id, level: tier.level,
    gen: tier.gen, text: tier.text, tierNum: fam.tiers.length - idx, tierCount: fam.tiers.length,
  };
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
