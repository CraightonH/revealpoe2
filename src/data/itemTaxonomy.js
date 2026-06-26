// Shared item-class taxonomy — the single source of truth for the browsable
// class groups and the armour defence/attribute subtype order. Consumed by both
// the app's presentation layer (src/data/baseItems.js) and the build-time graph
// resolver (scripts/graph/bases.js) so the two can never drift. Pure constants
// with no data reads, so the source-only graph builder may import it freely.

// Browsable item classes, grouped for display (the only bases that get
// pages/cards). Order is the on-page section order.
export const GROUPS = [
  {
    label: 'Weapons',
    classes: ['Bow', 'Claw', 'Crossbow', 'Dagger', 'Flail', 'FishingRod',
              'One Hand Axe', 'One Hand Mace', 'One Hand Sword', 'Sceptre',
              'Spear', 'Staff', 'TrapTool', 'Two Hand Axe', 'Two Hand Mace',
              'Two Hand Sword', 'Wand', 'Warstaff'],
  },
  {
    label: 'Armour',
    classes: ['Body Armour', 'Boots', 'Buckler', 'Focus', 'Gloves', 'Helmet', 'Shield'],
  },
  {
    label: 'Accessories',
    classes: ['Amulet', 'Belt', 'Quiver', 'Ring', 'Talisman'],
  },
  {
    label: 'Flasks & Charms',
    classes: ['LifeFlask', 'ManaFlask', 'UtilityFlask'],
  },
  {
    label: 'Jewels',
    classes: ['Jewel'],
  },
];

// Flat lookup set, derived from GROUPS so the grouped display and the membership
// test can never diverge. Iteration order follows GROUPS.
export const BROWSABLE_CLASSES = new Set(GROUPS.flatMap((g) => g.classes));

// Consumable/jewel classes — flasks, charms, jewels. Unlike equipment, these
// routinely ship as `unique_only` base types (e.g. Timeless Jewel has no generic
// drop), so the base builder admits unique_only bases for *these* classes only,
// keeping weapon/armour ingestion limited to `released` bases as before.
export const CONSUMABLE_CLASSES = new Set(['LifeFlask', 'ManaFlask', 'UtilityFlask', 'Jewel']);

// Armour defence/attribute subtypes in stable display order (pure types, then
// hybrids). The builder resolves each base's `attr` against this; the app orders
// and indexes by it.
export const ATTR_SUBTYPE_ORDER = [
  'str_armour', 'dex_armour', 'int_armour', 'str_dex_armour', 'str_int_armour', 'dex_int_armour',
];
