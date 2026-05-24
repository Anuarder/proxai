import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { runStartupSelfTest } from './lifecycle/self-test.js';

(async () => {
  const config = loadConfig();
  await runStartupSelfTest();
  const { app, children } = createServer(config);
  const { host, port } = config.server;

  const server = app.listen(port, host, () => {
    console.log(`Proxai v2 listening on http://${host}:${port}`);
    console.log(`Test UI: http://${host}:${port}/ui`);
  });

  async function shutdown() {
    console.log('Shutting down...');
    await children.killAll(config.timeouts.process_kill_grace_ms);
    server.close(() => process.exit(0));
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
