import { buildGemViewModel, listGems, listGemCards } from '../data/gems.js';
import { buildUniqueViewModel, listUniqueCards, listUniqueClassFilters } from '../data/uniques.js';
import { listBaseNav, getItemClass, buildBaseItemViewModel, affixBaseTargets } from '../data/baseItems.js';
import { listKeystones, getKeystone, listNotables, getNotable, getPassiveNode, listAscendancies, getAscendancy } from '../data/passiveTree.js';

// Register a detail page: reads the single route param, runs the builder,
// renders `template` with { [contextKey]: result }, or 404s to home.njk.
function detailRoute(app, path, builder, template, contextKey) {
  app.get(path, (req, res) => {
    const param = Object.values(req.params)[0];
    const result = builder(param);
    if (!result) return res.status(404).render('home.njk', { notFound: param });
    res.render(template, { [contextKey]: result });
  });
}

// Register an htmx card fragment: reads the single route param, runs the
// builder, renders `fragment` with { vm: result }, or 404s with empty body.
function cardRoute(app, path, builder, fragment) {
  app.get(path, (req, res) => {
    const param = Object.values(req.params)[0];
    const result = builder(param);
    if (!result) return res.status(404).send('');
    res.render(fragment, { vm: result });
  });
}

export function registerPages(app) {
  app.get('/gems', (_req, res) => {
    const gems = listGemCards().sort((a, b) => a.name.localeCompare(b.name));
    const active = gems.filter((g) => g.gemType === 'active');
    const support = gems.filter((g) => g.gemType === 'support');
    const spirit = gems.filter((g) => g.gemType === 'spirit');
    res.render('gems.njk', { active, support, spirit });
  });

  detailRoute(app, '/gem/:slug', buildGemViewModel, 'gem.njk', 'vm');
  cardRoute(app, '/gem/:slug/card', buildGemViewModel, 'partials/gem-card-fragment.njk');

  app.get('/uniques', (_req, res) => {
    const uniques = listUniqueCards().sort((a, b) => a.name.localeCompare(b.name));
    const classFilters = listUniqueClassFilters();
    res.render('uniques.njk', { uniques, classFilters });
  });

  detailRoute(app, '/unique/:slug', buildUniqueViewModel, 'unique.njk', 'vm');
  cardRoute(app, '/unique/:slug/card', buildUniqueViewModel, 'partials/unique-card-fragment.njk');

  app.get('/bases', (_req, res) => {
    res.render('bases.njk', { groups: listBaseNav() });
  });

  app.get('/bases/:classSlug', (req, res) => {
    const cls = getItemClass(req.params.classSlug);
    if (!cls) return res.status(404).render('home.njk', { notFound: req.params.classSlug });
    res.render('bases-class.njk', { cls, activeAttr: req.query.attr || null });
  });
  detailRoute(app, '/base/:slug', buildBaseItemViewModel, 'base-item.njk', 'vm');
  cardRoute(app, '/base/:slug/card', buildBaseItemViewModel, 'partials/base-card-fragment.njk');

  // Mods have no standalone page — they aren't meaningful in isolation. Instead,
  // affix search results link/flyout to the bases that can roll them. This serves
  // the flyout fragment: the list of base targets for one mod family.
  app.get('/mod/:typeSlug/card', (req, res) => {
    const targets = affixBaseTargets(req.params.typeSlug);
    if (!targets.length) return res.status(404).render('home.njk', { notFound: req.params.typeSlug });
    res.render('partials/affix-bases-fragment.njk', { targets });
  });

  detailRoute(app, '/notable/:id', getNotable, 'notable.njk', 'n');

  // Generic passive-node detail + hover card — covers ascendancy notables,
  // which getNotable/getKeystone exclude.
  detailRoute(app, '/passive/:id', getPassiveNode, 'passive-node.njk', 'node');
  cardRoute(app, '/passive/:id/card', getPassiveNode, 'partials/passive-card-fragment.njk');

  app.get('/keystones', (_req, res) => {
    res.render('keystones.njk', { keystones: listKeystones() });
  });

  detailRoute(app, '/keystone/:id', getKeystone, 'keystone.njk', 'k');
  cardRoute(app, '/keystone/:id/card', getKeystone, 'partials/passive-card-fragment.njk');

  app.get('/ascendancies', (_req, res) => {
    res.render('ascendancies.njk', { ascendancies: listAscendancies() });
  });

  detailRoute(app, '/ascendancy/:id', getAscendancy, 'ascendancy.njk', 'a');

  // expose for warmup/debug
  app.locals.gemCount = () => listGems().length;
}
