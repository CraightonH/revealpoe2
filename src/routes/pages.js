import { buildGemViewModel, listGems } from '../data/gems.js';
import { buildUniqueViewModel, listUniques } from '../data/uniques.js';
import { listItemClasses, getItemClass, buildBaseItemViewModel } from '../data/baseItems.js';
import { listModGroups, getModGroup } from '../data/mods.js';

export function registerPages(app) {
  app.get('/', (_req, res) => {
    res.render('home.njk');
  });

  app.get('/gem/:slug', (req, res) => {
    const vm = buildGemViewModel(req.params.slug);
    if (!vm) return res.status(404).render('home.njk', { notFound: req.params.slug });
    res.render('gem.njk', { vm });
  });

  app.get('/uniques', (_req, res) => {
    const uniques = listUniques().sort((a, b) => a.name.localeCompare(b.name));
    res.render('uniques.njk', { uniques });
  });

  app.get('/unique/:slug', (req, res) => {
    const vm = buildUniqueViewModel(req.params.slug);
    if (!vm) return res.status(404).render('home.njk', { notFound: req.params.slug });
    res.render('unique.njk', { vm });
  });

  app.get('/bases', (_req, res) => {
    const groups = listItemClasses();
    res.render('bases.njk', { groups });
  });

  app.get('/bases/:classSlug', (req, res) => {
    const cls = getItemClass(req.params.classSlug);
    if (!cls) return res.status(404).render('home.njk', { notFound: req.params.classSlug });
    res.render('bases-class.njk', { cls });
  });

  app.get('/base/:slug', (req, res) => {
    const vm = buildBaseItemViewModel(req.params.slug);
    if (!vm) return res.status(404).render('home.njk', { notFound: req.params.slug });
    res.render('base-item.njk', { vm });
  });

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

  // expose for warmup/debug
  app.locals.gemCount = () => listGems().length;
}
