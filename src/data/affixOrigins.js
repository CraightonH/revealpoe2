// src/data/affixOrigins.js
//
// The affix-origin registry: the single data-driven description of how each kind
// of affix enters an item. Shared by the build resolver (scripts/graph/affixes.js)
// and the app adapter (src/data/mods.js). Adding a new origin (essences, fractured,
// league mechanics…) is a registry entry here + one eligibility branch in the
// resolver — the app's traversal and grouping stay origin-agnostic.
//
// Fields:
//   label    — display name for the origin's affix-table section.
//   order    — stable display/sort order across origins.
//   layout   — 'prefix-suffix' splits a family's tiers into two columns by each
//              tier's generationType; 'flat' lists every family in one column
//              (corruption mods apply directly, with no prefix/suffix split).
//   bossPill — when true, the family's defining boss tag leads its tag list
//              (desecrated Well-of-Souls mods).

export const AFFIX_ORIGINS = {
  standard: { label: 'Standard', order: 0, layout: 'prefix-suffix' },
  corrupted: { label: 'Corrupted', order: 1, layout: 'flat' },
  desecrated: { label: 'Desecrated', order: 2, layout: 'prefix-suffix', bossPill: true },
};

// Origin ids in display order. Iterate this to render groups generically.
export const ORIGIN_IDS = Object.keys(AFFIX_ORIGINS)
  .sort((a, b) => AFFIX_ORIGINS[a].order - AFFIX_ORIGINS[b].order);

export function isOrigin(id) {
  return Object.prototype.hasOwnProperty.call(AFFIX_ORIGINS, id);
}

// Node slug for an affix family. Standard keeps the bare type slug so existing
// /mod/:typeSlug URLs stay stable (verified collision-free across standard types);
// other origins are namespaced so the same family type across origins (e.g. a
// "FireResistance" standard mod vs a corrupted one) yields distinct, unique slugs.
export function originSlug(origin, typeSlug) {
  return origin === 'standard' ? typeSlug : `${origin}-${typeSlug}`;
}
