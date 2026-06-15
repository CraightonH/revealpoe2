import { buildGemViewModel, listGems } from '../data/gems.js';
import { buildUniqueViewModel, listUniques } from '../data/uniques.js';

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

  // expose for warmup/debug
  app.locals.gemCount = () => listGems().length;
}
