import { runQuery } from '../data/theorycraft.js';

export function registerTheorycraft(app) {
  app.get('/theorycraft', (req, res) => {
    const q = req.query.q ?? '';
    res.render('theorycraft.njk', { q, result: runQuery(q) });
  });

  app.get('/theorycraft/results', (req, res) => {
    res.render('partials/theorycraft-results.njk', { result: runQuery(req.query.q ?? '') });
  });
}
