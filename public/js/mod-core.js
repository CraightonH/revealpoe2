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
  const rows = view.corrupted.map((f) =>
    `<button type="button" class="mod-picker__row mod-picker__row--corrupt${f.affix === cur ? ' is-chosen' : ''}" data-mod-corrupt="${esc(f.affix)}">` +
    `<span class="mod-picker__generic mod-picker__generic--corrupt">${esc(f.generic)}</span></button>`).join('')
    || '<p class="mod-picker__none">No corrupted implicits on this base.</p>';
  return `<div class="mod-picker__col mod-picker__col--corrupt"><h4>Corrupted implicit <span>${cur ? '1' : '0'}/1</span></h4>${rows}</div>`;
}

// The chosen corrupted implicit, as a row for the sticky chosen list. It rides
// with the explicit picks rather than sitting at the foot of its own column, so
// every current choice (and its tier select) stays on screen while you scroll
// the pools underneath.
function corruptedChosenRow(view, cell) {
  const cur = cell?.corrupted?.affix ?? null;
  const fam = cur ? view.corrupted.find((f) => f.affix === cur) : null;
  if (!fam) return '';
  return `<li class="mod-picker__chosen-row mod-picker__chosen-row--corrupt">` +
    `<span class="mod-picker__kind mod-picker__kind--corrupt">I</span>` +
    `<span class="mod-picker__generic mod-picker__generic--corrupt" title="${esc(fam.name)}">${esc(fam.name)}</span>` +
    `${tierSelect(cur, fam, cell.corrupted.tier, 'data-mod-tier-corrupt')}` +
    `<button type="button" class="mod-picker__remove" data-mod-corrupt-remove aria-label="Remove corruption">×</button></li>`;
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

/**
 * Prefix before suffix, and within each of those, standard before desecrated
 * (the same standard-then-Abyssal ranking poolsForBase gives the pool columns).
 * Unknowns sort last; ties keep insertion order.
 */
const GEN_RANK = { prefix: 0, suffix: 1 };
const originRank = (o) => (o === 'standard' ? 0 : o === 'desecrated' ? 1 : 2);
const bySection = (infoOf) => (list) => list
  .map((m, i) => ({ m, i, ...infoOf(m) }))
  .sort((a, b) => (GEN_RANK[a.gen] ?? 2) - (GEN_RANK[b.gen] ?? 2)
    || originRank(a.origin) - originRank(b.origin) || a.i - b.i)
  .map((x) => x.m);

/**
 * A cell's chosen mods in display order — every prefix, then every suffix, as a
 * real item lists them, with desecrated mods last inside each. Pure reordering:
 * the stored array is untouched, so a build made before this ordering existed
 * still reads correctly.
 */
export function orderMods(pools, mods, baseSlug = null) {
  const list = Array.isArray(mods) ? mods : [];
  return bySection((m) => {
    const r = resolveMod(pools, m, baseSlug);
    return { gen: r?.gen ?? null, origin: r?.origin ?? null };
  })(list);
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

  // Selection pins to the top of the popover: it is what you came here to check,
  // and at the foot of a long pool list it was unreachable without scrolling past
  // everything. It is a flex header OUTSIDE the scroller (not position:sticky
  // inside it) so the popover has exactly one scrollbar — the pool body below.
  const stickyBlock = (title, withSearch, rows) =>
    `<div class="mod-picker__sticky">${head(title, withSearch)}` +
    (rows ? `<ul class="mod-picker__chosen">${rows}</ul>` : '') + `</div>`;

  // Uniques: only the corrupted implicit.
  if (view.mode === 'unique') {
    return `<div class="mod-picker" data-mod-picker>` +
      stickyBlock('Corrupted implicit', false, corruptedChosenRow(view, cell)) +
      `<div class="mod-picker__body">${corruptedCol(view, cell)}</div></div>`;
  }

  // The chosen tier decides the bucket: a family that lives in both pools is a
  // prefix or a suffix depending on which tier was picked, not on map order.
  const genOfChosen = (m) => {
    for (const f of [...view.prefix, ...view.suffix]) {
      if (f.affix === m.affix && f.tiers.some((t) => t.id === m.tier)) return f.gen;
    }
    return famByAffix.get(m.affix)?.gen ?? null;
  };
  const chosenList = bySection((m) => ({
    gen: genOfChosen(m), origin: famByAffix.get(m.affix)?.origin ?? null,
  }))(mods).map((m) => {
    const fam = famByAffix.get(m.affix);
    if (!fam) return '';
    const gen = genOfChosen(m);
    return `<li class="mod-picker__chosen-row">` +
      `<span class="mod-picker__kind">${gen === 'suffix' ? 'S' : 'P'}</span>` +
      `<span class="mod-picker__generic" title="${esc(fam.name)}">${esc(fam.name)}</span>` +
      `${tierSelect(m.affix, fam, m.tier)}` +
      `<button type="button" class="mod-picker__remove" data-mod-remove="${esc(m.affix)}" aria-label="Remove">×</button></li>`;
  }).join('');

  // Bases: prefix/suffix explicits + (if any) a corrupted implicit chooser.
  return `<div class="mod-picker" data-mod-picker>` +
    stickyBlock('Modifiers', true, corruptedChosenRow(view, cell) + chosenList) +
    `<div class="mod-picker__body">` +
      `<div class="mod-picker__cols">` +
        `<div class="mod-picker__col"><h4>Prefixes <span>${view.prefix.filter((f) => chosen.has(f.affix)).length}/${MAX_PREFIX}</span></h4>${addRows(view.prefix, chosen)}</div>` +
        `<div class="mod-picker__col"><h4>Suffixes <span>${view.suffix.filter((f) => chosen.has(f.affix)).length}/${MAX_SUFFIX}</span></h4>${addRows(view.suffix, chosen)}</div>` +
      `</div>` +
      (view.corrupted.length ? corruptedCol(view, cell) : '') +
    `</div></div>`;
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

/** The base a gear ref rolls its mods on — itself, or a unique's base item. */
export function baseSlugOf(pools, ref) {
  if (!ref) return null;
  if (ref.kind === 'unique') return pools?.uniques?.[ref.slug] ?? null;
  return ref.slug ?? null;
}

/** Corrupted-implicit family views for a base or unique ref. */
export function corruptedForRef(pools, ref) {
  const baseSlug = baseSlugOf(pools, ref);
  if (!baseSlug) return [];
  return poolsForBase(pools, baseSlug).corrupted;
}

/**
 * The tier ladder a mod is ranked against on a given base. Tiers are per-base in
 * game: a base that cannot roll the top two tiers of a family has its own T1.
 * That narrowing is exactly what the picker's `tierSelect` labels, so ranking
 * anywhere else has to use the same ladder or the card contradicts the picker.
 */
function tierLadder(pools, affix, baseSlug) {
  const fam = pools?.families?.[affix];
  if (!fam) return null;
  if (!baseSlug) return fam.tiers;
  const ref = (pools?.bases?.[baseSlug] ?? []).find((r) => r.a === affix);
  if (!ref || !Array.isArray(ref.t)) return fam.tiers;
  const allow = new Set(ref.t);
  const narrowed = fam.tiers.filter((_, i) => allow.has(i));
  return narrowed.length ? narrowed : fam.tiers;
}

/**
 * A chosen { affix, tier } to renderable data, or null if it no longer resolves.
 * `tierNum` is the in-game tier rank (T1 = top/highest, matching the picker's
 * `tierSelect` labelling) and `tierCount` the ladder total — both relative to
 * `baseSlug` when one is given, so tooltip and picker always agree.
 */
export function resolveMod(pools, chosen, baseSlug = null) {
  if (!chosen) return null;
  const fam = pools?.families?.[chosen.affix];
  if (!fam) return null;
  let ladder = tierLadder(pools, chosen.affix, baseSlug);
  let idx = ladder.findIndex((t) => t.id === chosen.tier);
  // A tier this base cannot roll is still worth rendering (modViolations flags
  // it separately) — rank it on the family's full ladder rather than dropping it.
  if (idx < 0 && ladder !== fam.tiers) {
    ladder = fam.tiers;
    idx = ladder.findIndex((t) => t.id === chosen.tier);
  }
  if (idx < 0) return null;
  const tier = ladder[idx];
  return {
    affix: chosen.affix, name: fam.name, origin: fam.origin, id: tier.id, level: tier.level,
    gen: tier.gen, text: tier.text, tierNum: ladder.length - idx, tierCount: ladder.length,
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
