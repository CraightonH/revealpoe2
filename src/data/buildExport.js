// src/data/buildExport.js
//
// Presentation adapter projecting the id spaces GGG's in-game `.build` file
// needs out of the graph. Reads ONLY the graph (no source files).
//
//   gemIds        gem slug -> BaseItemTypes metadata id (`skills[].id`)
//   ascendancyIds ascendancy slug -> GGG ascendancy id (`ascendancy`)
//
// The gem metadata id is the graph node KEY, used verbatim: PoE2 stores gems
// under BOTH `Metadata/Items/Gem/` and `Metadata/Items/Gems/`, and the two sets
// are disjoint (593 each), so normalizing either way would emit ids the game
// does not know. Real .build files exported by the game mix both prefixes too.
//
// The third map the exporter needs — tree hash -> PassiveSkills string id —
// covers all ~5150 passives, but the graph only holds notables/keystones, so it
// is projected from source by scripts/build-passive-tree.js instead.
import { nodesByKind } from './graph.js';
import { slugify } from './slug.js';

export function buildExportIds() {
  // Keyed by the CURRENT graph slug, which is the only gem key a stored build
  // can hold (the picker writes slugs straight from search-index.json). Note the
  // slug and the metadata id often disagree — PoE2 renames a gem's display name
  // while its metadata id keeps the original (SupportGemTwofold is now
  // "Heightened Charges"). Never alias a slug off the metadata id to bridge that.
  const gemIds = {};
  for (const g of nodesByKind('gem')) gemIds[g.slug] = g.id;

  const ascendancyIds = {};
  for (const a of nodesByKind('ascendancy')) ascendancyIds[slugify(a.name)] = a.slug;

  return { gemIds, ascendancyIds };
}
