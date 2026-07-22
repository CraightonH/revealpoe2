import { buildGemViewModel, listGems, listGemCards, getDefaultSkillGemsForClass } from '../data/gems.js';
import { buildUniqueViewModel, listUniqueCards, listUniqueClassFilters } from '../data/uniques.js';
import { listBaseIndex, getItemClass, buildBaseItemViewModel, affixBaseTargets } from '../data/baseItems.js';
import { getAugmentVM } from '../data/augments.js';
import { getKeystone, getNotable, getPassiveNode } from '../data/passiveTree.js';
import { getEmotion } from '../data/emotions.js';

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
    const initialGem = buildGemViewModel(gems[0]?.slug);
    res.render('gems.njk', { gems, initialGem });
  });

  detailRoute(app, '/gem/:slug', buildGemViewModel, 'gem.njk', 'vm');
  cardRoute(app, '/gem/:slug/card', buildGemViewModel, 'partials/gem-card-fragment.njk');

  app.get('/uniques', (_req, res) => {
    const uniques = listUniqueCards().sort((a, b) => a.name.localeCompare(b.name));
    const classFilters = listUniqueClassFilters();
    const initialUnique = buildUniqueViewModel(uniques[0]?.slug);
    res.render('uniques.njk', { uniques, classFilters, initialUnique });
  });

  detailRoute(app, '/unique/:slug', buildUniqueViewModel, 'unique.njk', 'vm');
  cardRoute(app, '/unique/:slug/card', buildUniqueViewModel, 'partials/unique-card-fragment.njk');

  app.get('/bases', (req, res) => {
    const classes = listBaseIndex().sort((a, b) => a.name.localeCompare(b.name));
    const initialClass = getItemClass(classes[0]?.classSlug);
    initialClass.defaultSkillGems = getDefaultSkillGemsForClass(initialClass.classSlug);
    res.render('bases.njk', { classes, initialClass, activeAttr: req.query.attr || initialClass.attrSubtypes[0]?.value || null });
  });

  app.get('/bases/:classSlug', (req, res) => {
    const cls = getItemClass(req.params.classSlug);
    if (!cls) {
      return res.status(404).render('home.njk', { notFound: req.params.classSlug });
    }
    // Reverse of the gem page's "Granted by Equipping": the default-attack gem(s)
    // this weapon class grants. Empty for classes with no default-skill mapping.
    cls.defaultSkillGems = getDefaultSkillGemsForClass(req.params.classSlug);
    // Composition-filtered classes (armours) are noise unfiltered — default to
    // the first subtype; ?attr= still overrides.
    res.render('bases-class.njk', { cls, activeAttr: req.query.attr || cls.attrSubtypes[0]?.value || null });
  });
  detailRoute(app, '/base/:slug', buildBaseItemViewModel, 'base-item.njk', 'vm');
  cardRoute(app, '/base/:slug/card', buildBaseItemViewModel, 'partials/base-card-fragment.njk');

  // Augments have no standalone page (they're only meaningful relative to an item),
  // but the condensed grid card hovers to this full fragment (all tiers).
  cardRoute(app, '/augment/:slug/card', getAugmentVM, 'partials/augment-card-fragment.njk');

  // Mods have no standalone page — they aren't meaningful in isolation. Instead,
  // affix search results link/flyout to the bases that can roll them. This serves
  // the flyout fragment: the list of base targets for one mod family.
  app.get('/mod/:typeSlug/card', (req, res) => {
    const targets = affixBaseTargets(req.params.typeSlug);
    if (!targets.length) return res.status(404).render('home.njk', { notFound: req.params.typeSlug });
    res.render('partials/affix-bases-fragment.njk', { targets });
  });

  detailRoute(app, '/notable/:id', getNotable, 'notable.njk', 'n');
  cardRoute(app, '/notable/:id/card', getNotable, 'partials/passive-card-fragment.njk');

  // Generic passive-node detail + hover card — covers ascendancy notables,
  // which getNotable/getKeystone exclude.
  detailRoute(app, '/passive/:id', getPassiveNode, 'passive-node.njk', 'node');
  cardRoute(app, '/passive/:id/card', getPassiveNode, 'partials/passive-card-fragment.njk');

  detailRoute(app, '/keystone/:id', getKeystone, 'keystone.njk', 'k');
  cardRoute(app, '/keystone/:id/card', getKeystone, 'partials/passive-card-fragment.njk');

  // Distilled Emotion detail card, nested inside a notable's instill recipe.
  cardRoute(app, '/api/emotion/:key/card', getEmotion, 'partials/emotion-card-fragment.njk');

  app.get('/passives', (_req, res) => {
    res.render('passives.njk', { title: 'Passive Tree' });
  });

  app.get('/builds', (_req, res) => {
    res.render('builds.njk');
  });

  app.get('/credits', (_req, res) => {
    res.render('credits.njk');
  });

  // expose for warmup/debug
  app.locals.gemCount = () => listGems().length;
  app.locals.uniqueCount = () => listUniqueCards().length;
  app.locals.baseCount = () => listBaseIndex().length;
}
