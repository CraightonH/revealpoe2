import { search } from '../data/search.js';

export function registerSearch(app) {
  app.get('/search', (req, res) => {
    const results = search(req.query.q);
    res.render('partials/search-results.njk', { results });
  });
}
