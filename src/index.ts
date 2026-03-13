import { loadConfig } from './config.js';
import { createServer } from './server.js';

const config = loadConfig();
const { app, manager, store } = createServer(config);

const { host, port } = config.server;

const server = app.listen(port, host, () => {
  console.log(`Proxai listening on http://${host}:${port}`);
  console.log(`Test UI: http://${host}:${port}/ui`);
});

function shutdown() {
  console.log('Shutting down...');
  manager.shutdown();
  store.close();
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
