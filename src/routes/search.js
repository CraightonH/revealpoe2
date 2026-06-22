import { search } from '../data/search.js';

export function registerSearch(app) {
  app.get('/search', (req, res) => {
    const q = (req.query.q ?? '').trim();
    const results = search(q);
    res.render('partials/search-results.njk', { results, q });
  });
}
