// Distilled Emotion index for the passive-tree "instill" UI.
//
// Every tree Notable carries a GGG `recipe` — the three Distilled Emotions that,
// combined into an Instilling Orb, stamp that Notable onto a jewel/amulet. The
// recipe tokens (e.g. `ConcentratedLiquidFear`) are just the emotion's display
// name with spaces removed, so we resolve them back to the `DistilledEmotion*`
// currency base items for name + icon + effect text.
//
// Pure (build-time) so it's unit-testable: callers pass the parsed base_items
// object; nothing here reads the filesystem.
import { slugify } from '../../src/data/slug.js';
import { ddsUrl } from '../../src/data/images.js';

// A recipe token is the base item name with all spaces stripped.
const tokenOf = (name) => String(name).replace(/\s+/g, '');

// Build { byToken } over every Distilled Emotion base item. Keyed by the
// space-stripped name so recipe tokens map straight in. The "Ancient …"
// (Time-Lost) variants get their own distinct tokens that never appear in any
// recipe, so including them is harmless — recipes only reference the base names.
export function buildEmotionIndex(baseItems) {
  const byToken = new Map();
  for (const [id, v] of Object.entries(baseItems)) {
    if (!/DistilledEmotion/i.test(id)) continue; // DistilledEmotion*, EndgameDistilledEmotion*, TimeLost variants
    const name = v?.name;
    if (!name) continue;
    const dds = v?.visual_identity?.dds_file || null;
    const props = v?.properties || {};
    byToken.set(tokenOf(name), {
      id,
      key: slugify(name),
      name,
      dds,
      iconUrl: ddsUrl(dds),
      description: props.description || null,   // effect text, in [tag|text] format
      directions: props.directions || null,     // how/where to instill
      dropLevel: v?.drop_level ?? null,
      stackSize: props.stack_size ?? null,
    });
  }
  return { byToken };
}

// Resolve a Notable's 3-token recipe into ordered emotion records (duplicates
// preserved — a recipe needing 2× of an emotion yields two identical entries).
// Throws on an unknown token so a GGG rename fails the build rather than
// silently dropping the relationship (referential-integrity guardrail).
export function resolveRecipe(index, tokens) {
  return (tokens || []).map((t) => {
    const e = index.byToken.get(t);
    if (!e) throw new Error(`Unknown Distilled Emotion recipe token: ${t}`);
    return e;
  });
}
