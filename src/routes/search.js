export function registerSearch(app) {
  app.get('/search', (req, res) => {
    res.type('html').send('');
  });
}
