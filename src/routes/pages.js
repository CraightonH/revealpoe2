import { buildGemViewModel, listGems } from '../data/gems.js';
import { buildUniqueViewModel, listUniques } from '../data/uniques.js';
import { listItemClasses, getItemClass, buildBaseItemViewModel } from '../data/baseItems.js';
import { listModGroups, getModGroup } from '../data/mods.js';
import { listKeystones, getKeystone, listNotables, getNotable, listAscendancies, getAscendancy } from '../data/passiveTree.js';

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

  app.get('/gem/:slug', (req, res) => {
    const vm = buildGemViewModel(req.params.slug);
    if (!vm) return res.status(404).render('home.njk', { notFound: req.params.slug });
    res.render('gem.njk', { vm });
  });

  app.get('/gem/:slug/card', (req, res) => {
    const vm = buildGemViewModel(req.params.slug);
    if (!vm) return res.status(404).send('');
    res.render('partials/gem-card-fragment.njk', { vm });
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

  app.get('/unique/:slug/card', (req, res) => {
    const vm = buildUniqueViewModel(req.params.slug);
    if (!vm) return res.status(404).send('');
    res.render('partials/unique-card-fragment.njk', { vm });
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

  app.get('/base/:slug/card', (req, res) => {
    const vm = buildBaseItemViewModel(req.params.slug);
    if (!vm) return res.status(404).send('');
    res.render('partials/base-card-fragment.njk', { vm });
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

  app.get('/notable/:id', (req, res) => {
    const n = getNotable(req.params.id);
    if (!n) return res.status(404).render('home.njk', { notFound: req.params.id });
    res.render('notable.njk', { n });
  });

  app.get('/keystones', (_req, res) => {
    res.render('keystones.njk', { keystones: listKeystones() });
  });

  app.get('/keystone/:id', (req, res) => {
    const k = getKeystone(req.params.id);
    if (!k) return res.status(404).render('home.njk', { notFound: req.params.id });
    res.render('keystone.njk', { k });
  });

  app.get('/ascendancies', (_req, res) => {
    res.render('ascendancies.njk', { ascendancies: listAscendancies() });
  });

  app.get('/ascendancy/:id', (req, res) => {
    const a = getAscendancy(req.params.id);
    if (!a) return res.status(404).render('home.njk', { notFound: req.params.id });
    res.render('ascendancy.njk', { a });
  });

  // expose for warmup/debug
  app.locals.gemCount = () => listGems().length;
}
