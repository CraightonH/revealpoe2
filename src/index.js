import { createApp } from './server.js';

const port = process.env.PORT || 3000;
createApp().listen(port, () => {
  console.log(`poe2wiki listening on http://localhost:${port}`);
});
