import { runQuery } from '../data/theorycraft.js';

export function registerTheorycraft(app) {
  // Theory Crafting is the landing page; /theorycraft is kept as an alias.
  const renderPage = (req, res) => {
    const q = req.query.q ?? '';
    res.render('theorycraft.njk', { q, result: runQuery(q) });
  };
  app.get('/', renderPage);
  app.get('/theorycraft', renderPage);

  app.get('/theorycraft/results', (req, res) => {
    res.render('partials/theorycraft-results.njk', { result: runQuery(req.query.q ?? '') });
  });
}
