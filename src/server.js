import express from 'express';
import nunjucks from 'nunjucks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerPages } from './routes/pages.js';
import { registerSearch } from './routes/search.js';
import { registerKeywords } from './routes/keywords.js';
import { registerTheorycraft } from './routes/theorycraft.js';
import { installKeywordPhrases } from './data/keywordPhrases.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

export function createApp() {
  // Derive keyword hovers from the game data before any page renders.
  installKeywordPhrases();

  const app = express();

  const env = nunjucks.configure(path.join(root, 'views'), {
    autoescape: true,
    express: app,
    noCache: process.env.NODE_ENV !== 'production',
  });
  // Absolute origin for og:image/twitter:image URLs (scrapers need absolute).
  // Overridable for preview deploys; defaults to production.
  const SITE_URL = (process.env.SITE_URL || 'https://revealpoe2.com').replace(/\/$/, '');
  env.addGlobal('SITE_URL', SITE_URL);
  app.set('view engine', 'njk');

  app.use('/static', express.static(path.join(root, 'public')));

  app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

  // Per-request canonical URL (absolute, query-stripped). The same content is
  // reachable on both the custom domain and the permanent <project>.pages.dev
  // subdomain; a canonical pointing at SITE_URL tells search engines to index
  // one host, so the pages.dev copy can't split ranking. Path only — query
  // strings aren't part of a page's canonical identity.
  app.use((req, res, next) => {
    res.locals.canonicalUrl = SITE_URL + req.path;
    next();
  });

  registerPages(app);
  registerSearch(app);
  registerKeywords(app);
  registerTheorycraft(app);

  return app;
}
