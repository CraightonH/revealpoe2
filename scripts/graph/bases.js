import { loadJson } from '../../src/data/loader.js';
import { REPOE } from '../../src/config.js';
import { slugify } from '../../src/data/slug.js';

// Browsable item classes — mirrors src/data/baseItems.js GROUPS (the only bases
// that get pages/cards). Keep in sync with the app's GROUPS taxonomy.
export const BROWSABLE_CLASSES = new Set([
  'Bow', 'Claw', 'Crossbow', 'Dagger', 'Flail', 'FishingRod', 'One Hand Axe', 'One Hand Mace',
  'One Hand Sword', 'Sceptre', 'Spear', 'Staff', 'TrapTool', 'Two Hand Axe', 'Two Hand Mace',
  'Two Hand Sword', 'Wand', 'Warstaff',
  'Body Armour', 'Boots', 'Buckler', 'Focus', 'Gloves', 'Helmet', 'Shield',
  'Amulet', 'Belt', 'Quiver', 'Ring', 'Talisman',
]);

// Runeforged/Runemastered reissues are folded onto their parent base (Task 2),
// never their own node — mirrors src/data/baseItems.js.
const RUNE_VARIANT_RE = /^Rune(forged|mastered) /;

// A name appearing in >1 distinct browsable class gets a class-suffixed slug.
function buildSlug(name, classId, nameAcrossClasses) {
  const base = slugify(name);
  return (nameAcrossClasses[name] ?? 1) > 1 ? `${base}--${slugify(classId)}` : base;
}

export function selectBaseRecords() {
  const raw = loadJson(`${REPOE}/base_items.json`);

  // Count distinct browsable classes per name (deduped by name|class) for slug
  // disambiguation — matches baseItems.js nameAcrossClassesDeduped.
  const nameClassSeen = new Set();
  const nameAcrossClasses = {};
  for (const v of Object.values(raw)) {
    if (v.domain !== 'item' || v.release_state !== 'released') continue;
    if (!BROWSABLE_CLASSES.has(v.item_class)) continue;
    const key = `${v.name}|${v.item_class}`;
    if (nameClassSeen.has(key)) continue;
    nameClassSeen.add(key);
    nameAcrossClasses[v.name] = (nameAcrossClasses[v.name] ?? 0) + 1;
  }

  const records = [];
  const byNameClass = new Map(); // `${name}|${class}` -> record (rune parent join)
  const runeRaw = [];
  const seenNameClass = new Set();
  for (const [id, v] of Object.entries(raw)) {
    if (v.domain !== 'item' || v.release_state !== 'released') continue;
    if (!BROWSABLE_CLASSES.has(v.item_class)) continue;
    if (RUNE_VARIANT_RE.test(v.name)) { runeRaw.push(v); continue; }
    const nameClassKey = `${v.name}|${v.item_class}`;
    if (seenNameClass.has(nameClassKey)) continue;
    seenNameClass.add(nameClassKey);
    const rec = { id, slug: buildSlug(v.name, v.item_class, nameAcrossClasses), itemClass: v.item_class, raw: v };
    records.push(rec);
    byNameClass.set(nameClassKey, rec);
  }
  return { records, runeRaw, byNameClass };
}

export { RUNE_VARIANT_RE };
