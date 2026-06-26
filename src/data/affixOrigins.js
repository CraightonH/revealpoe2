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

// Affix scope: which base-domain bucket a family rolls on. RePoE reuses `type`
// names across source domains with *different* stat scales — a jewel
// "FireResistance" (+5–10%) is not a ring "FireResistance" (+6–45%), and the two
// never co-occur on a base — so family identity must include the scope, not just
// (origin, type). Equipment (source domains `item` + `desecrated`) is the default,
// un-namespaced scope; flasks/charms (`flask`) and jewels (`misc`) are partitioned.
export const SCOPE_ITEM = 'item';
export function scopeOfModDomain(domain) {
  if (domain === 'flask') return 'flask';
  if (domain === 'misc') return 'jewel';
  return SCOPE_ITEM; // item, desecrated, anything else → equipment bucket
}

// Affix family node id. Equipment scope keeps the legacy `Affix/${origin}/${type}`
// id so existing graph ids stay stable; flask/jewel scopes are namespaced.
export function affixNodeId(origin, type, scope = SCOPE_ITEM) {
  return scope === SCOPE_ITEM ? `Affix/${origin}/${type}` : `Affix/${origin}/${scope}/${type}`;
}

// Node slug / `/mod/:typeSlug` key for an affix family. Standard equipment keeps
// the bare type slug so existing /mod URLs stay stable (verified collision-free
// across standard types); other origins and non-equipment scopes are namespaced so
// distinct families (a standard vs corrupted "FireResistance", an equipment vs
// jewel "FireResistance") yield distinct, unique slugs.
export function originSlug(origin, typeSlug, scope = SCOPE_ITEM) {
  const withOrigin = origin === 'standard' ? typeSlug : `${origin}-${typeSlug}`;
  return scope === SCOPE_ITEM ? withOrigin : `${scope}-${withOrigin}`;
}
