import { createApp } from './server.js';

const port = process.env.PORT || 3000;
createApp().listen(port, () => {
  console.log(`revealpoe2 listening on http://localhost:${port}`);
});
