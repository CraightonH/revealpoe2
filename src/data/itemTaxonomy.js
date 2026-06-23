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
];

// Flat lookup set, derived from GROUPS so the grouped display and the membership
// test can never diverge. Iteration order follows GROUPS.
export const BROWSABLE_CLASSES = new Set(GROUPS.flatMap((g) => g.classes));

// Armour defence/attribute subtypes in stable display order (pure types, then
// hybrids). The builder resolves each base's `attr` against this; the app orders
// and indexes by it.
export const ATTR_SUBTYPE_ORDER = [
  'str_armour', 'dex_armour', 'int_armour', 'str_dex_armour', 'str_int_armour', 'dex_int_armour',
];
