import { buildGemViewModel, listGems } from '../data/gems.js';
import { buildUniqueViewModel, listUniques } from '../data/uniques.js';
import { listItemClasses, getItemClass, buildBaseItemViewModel } from '../data/baseItems.js';
import { listModGroups, getModGroup } from '../data/mods.js';
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
  app.get('/', (_req, res) => {
    res.render('home.njk');
  });

  app.get('/gems', (_req, res) => {
    const gems = listGems().sort((a, b) => a.name.localeCompare(b.name));
    const active = gems.filter((g) => g.gemType === 'active');
    const support = gems.filter((g) => g.gemType === 'support');
    const spirit = gems.filter((g) => g.gemType === 'spirit');
    res.render('gems.njk', { active, support, spirit });
  });

  detailRoute(app, '/gem/:slug', buildGemViewModel, 'gem.njk', 'vm');
  cardRoute(app, '/gem/:slug/card', buildGemViewModel, 'partials/gem-card-fragment.njk');

  app.get('/uniques', (_req, res) => {
    const uniques = listUniques().sort((a, b) => a.name.localeCompare(b.name));
    res.render('uniques.njk', { uniques });
  });

  detailRoute(app, '/unique/:slug', buildUniqueViewModel, 'unique.njk', 'vm');
  cardRoute(app, '/unique/:slug/card', buildUniqueViewModel, 'partials/unique-card-fragment.njk');

  app.get('/bases', (_req, res) => {
    const groups = listItemClasses();
    res.render('bases.njk', { groups });
  });

  detailRoute(app, '/bases/:classSlug', getItemClass, 'bases-class.njk', 'cls');
  detailRoute(app, '/base/:slug', buildBaseItemViewModel, 'base-item.njk', 'vm');
  cardRoute(app, '/base/:slug/card', buildBaseItemViewModel, 'partials/base-card-fragment.njk');

  app.get('/mods', (_req, res) => {
    const groups = listModGroups();
    const prefix = groups.filter((g) => g.generation_type === 'prefix');
    const suffix = groups.filter((g) => g.generation_type === 'suffix');
    res.render('mods.njk', { prefix, suffix });
  });

  app.get('/mod/:typeSlug', (req, res) => {
    const groups = listModGroups();
    const entry = groups.find((g) => g.typeSlug === req.params.typeSlug);
    if (!entry) return res.status(404).render('home.njk', { notFound: req.params.typeSlug });
    const group = getModGroup(entry.type);
    res.render('mod-group.njk', { group });
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
