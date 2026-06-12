import express from 'express';
import nunjucks from 'nunjucks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerPages } from './routes/pages.js';
import { registerSearch } from './routes/search.js';
import { registerKeywords } from './routes/keywords.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

export function createApp() {
  const app = express();

  nunjucks.configure(path.join(root, 'views'), {
    autoescape: true,
    express: app,
    noCache: process.env.NODE_ENV !== 'production',
  });
  app.set('view engine', 'njk');

  app.use('/static', express.static(path.join(root, 'public')));

  app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

  registerPages(app);
  registerSearch(app);
  registerKeywords(app);

  return app;
}
