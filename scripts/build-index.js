// Build the static client-side artifacts that back search, Theory Crafting,
// and card-key consumers:
//
//   public/generated/search-index.json   allDocs() — the full-text doc set the
//                                         browser ranks/filters in place of the
//                                         /search and /theorycraft/results routes.
//   public/generated/browse-cards.json   the real macro-rendered browse cards,
//                                         keyed by category -> slug/id for clients
//                                         that embed cards by reference.
//
// Written under public/ so the dev server serves them at /static/generated/* and
// the prerenderer copies them into dist/. Gitignored — regenerable from source.

import nunjucks from 'nunjucks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allDocs } from '../src/data/theorycraft.js';
import { listGemCards } from '../src/data/gems.js';
import { listUniqueCards } from '../src/data/uniques.js';
import { listItemClasses, getItemClass } from '../src/data/baseItems.js';
import { listKeystones, listNotables } from '../src/data/passiveTree.js';
import { listAugments } from '../src/data/augments.js';
import { plannerData } from '../src/data/planner.js';
import { modPools } from '../src/data/modPools.js';
import { itemMath } from '../src/data/itemMath.js';
import { buildExportIds } from '../src/data/buildExport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const OUT = path.join(root, 'public', 'generated');

const env = nunjucks.configure(path.join(root, 'views'), { autoescape: true });

// Precompile each browse-card macro once into a render(card) function, rather
// than compiling a template string per card (~3.5k cards).
const compileCard = (macroFile, macroName, extraArg = '') => {
  const tmpl = nunjucks.compile(
    `{% from "${macroFile}" import ${macroName} %}{{ ${macroName}(c${extraArg}) }}`,
    env,
  );
  return (c) => tmpl.render({ c });
};

function browseCards() {
  const renderGem = compileCard('macros/gem-card.njk', 'gemBrowseCard');
  const renderUnique = compileCard('macros/unique-card.njk', 'uniqueListCard');
  const renderBase = compileCard('macros/base-card.njk', 'baseListCard');
  const renderKeystone = compileCard('macros/passive.njk', 'passiveResultCard', ', "keystone"');
  const renderNotable = compileCard('macros/passive.njk', 'passiveResultCard', ', "notable"');
  const renderAugment = compileCard('macros/augment-cards.njk', 'augmentCard');

  const bases = listItemClasses().flatMap((g) =>
    g.classes.flatMap((cl) => getItemClass(cl.classSlug)?.bases ?? []),
  );

  const gem = {}, unique = {}, base = {}, keystone = {}, notable = {}, augment = {};
  for (const c of listGemCards()) gem[c.slug] = renderGem(c);
  for (const c of listUniqueCards()) unique[c.slug] = renderUnique(c);
  for (const c of bases) base[c.slug] = renderBase(c);
  for (const c of listKeystones()) keystone[c.id] = renderKeystone(c);
  for (const c of listNotables()) notable[c.id] = renderNotable(c);
  for (const c of listAugments()) augment[c.slug] = renderAugment(c);

  // gem/support/spirit results all map to the gem card set, matching the
  // server's cardMapFor(); the client mirrors that lookup.
  return { gem, unique, base, keystone, notable, augment };
}

fs.mkdirSync(OUT, { recursive: true });

const docs = allDocs();
fs.writeFileSync(path.join(OUT, 'search-index.json'), JSON.stringify(docs));

const cards = browseCards();
fs.writeFileSync(path.join(OUT, 'browse-cards.json'), JSON.stringify(cards));

const planner = plannerData();
fs.writeFileSync(path.join(OUT, 'planner-data.json'), JSON.stringify(planner));

const modpools = modPools();
fs.writeFileSync(path.join(OUT, 'mod-pools.json'), JSON.stringify(modpools));

fs.writeFileSync(path.join(OUT, 'item-math.json'), JSON.stringify(itemMath()));

// Affix → official trade stat ids, for the planner's mod-filtered trade links.
// Committed under src/data (trade-service state refreshed by
// `npm run fetch:trade-stats`), copied out for the client. Optional: a checkout
// without it just gets the plain name/type trade links.
const TRADE_IDS_SRC = path.join(root, 'src', 'data', 'trade-stat-ids.json');
let tradeStatCount = 0;
if (fs.existsSync(TRADE_IDS_SRC)) {
  const tradeIds = JSON.parse(fs.readFileSync(TRADE_IDS_SRC, 'utf8'));
  tradeStatCount = Object.keys(tradeIds.map ?? {}).length;
  fs.writeFileSync(path.join(OUT, 'trade-stat-ids.json'), JSON.stringify({ map: tradeIds.map ?? {} }));
}

const exportIds = buildExportIds();
fs.writeFileSync(path.join(OUT, 'build-export.json'), JSON.stringify(exportIds));

const count = Object.values(cards).reduce((n, m) => n + Object.keys(m).length, 0);
console.log(
  `build-index: ${docs.length} docs, ${count} browse cards, ` +
  `${planner.slots.length} slots / ${Object.keys(planner.items).length} items / ${Object.keys(planner.gems).length} gems ` +
  `/ ${Object.keys(modpools.families).length} affix families ` +
  `/ ${Object.keys(exportIds.gemIds).length} gem export ids ` +
  `/ ${tradeStatCount} trade stat ids ` +
  `-> public/generated/`,
);
