// Build the static client-side artifacts that back search + Theory Crafting:
//
//   public/generated/search-index.json   allDocs() — the full-text doc set the
//                                         browser ranks/filters in place of the
//                                         /search and /theorycraft/results routes.
//   public/generated/browse-cards.json   the real macro-rendered browse cards,
//                                         keyed by category -> slug/id, so client
//                                         results reuse the exact server card HTML
//                                         (no card macros ported to JS).
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
import { plannerData } from '../src/data/planner.js';

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
  const renderKeystone = compileCard('macros/passive.njk', 'passiveBrowseCard', ', "keystone"');
  const renderNotable = compileCard('macros/passive.njk', 'passiveBrowseCard', ', "notable"');

  const bases = listItemClasses().flatMap((g) =>
    g.classes.flatMap((cl) => getItemClass(cl.classSlug)?.bases ?? []),
  );

  const gem = {}, unique = {}, base = {}, keystone = {}, notable = {};
  for (const c of listGemCards()) gem[c.slug] = renderGem(c);
  for (const c of listUniqueCards()) unique[c.slug] = renderUnique(c);
  for (const c of bases) base[c.slug] = renderBase(c);
  for (const c of listKeystones()) keystone[c.id] = renderKeystone(c);
  for (const c of listNotables()) notable[c.id] = renderNotable(c);

  // gem/support/spirit results all map to the gem card set, matching the
  // server's cardMapFor(); the client mirrors that lookup.
  return { gem, unique, base, keystone, notable };
}

fs.mkdirSync(OUT, { recursive: true });

const docs = allDocs();
fs.writeFileSync(path.join(OUT, 'search-index.json'), JSON.stringify(docs));

const cards = browseCards();
fs.writeFileSync(path.join(OUT, 'browse-cards.json'), JSON.stringify(cards));

const planner = plannerData();
fs.writeFileSync(path.join(OUT, 'planner-data.json'), JSON.stringify(planner));

const count = Object.values(cards).reduce((n, m) => n + Object.keys(m).length, 0);
console.log(
  `build-index: ${docs.length} docs, ${count} browse cards, ` +
  `${planner.slots.length} slots / ${Object.keys(planner.items).length} items / ${Object.keys(planner.gems).length} gems ` +
  `-> public/generated/`,
);
