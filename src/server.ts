import express from 'express';
import path from 'node:path';
import { ProxaiConfig } from './config.js';
import { SessionStore } from './sessions/store.js';
import { SessionManager } from './sessions/manager.js';
import { ProviderRouter } from './providers/router.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createModelsRoute } from './routes/models.js';
import { createCompletionsRoute } from './routes/completions.js';
import { createSessionsRoute } from './routes/sessions.js';

export function createServer(config: ProxaiConfig) {
  const store = new SessionStore('proxai.db');
  const manager = new SessionManager(store, config.sessions);
  const router = new ProviderRouter(config);

  manager.setOnIdleCallback((sessionId) => {
    router.killSession(sessionId);
  });

  const app = express();

  app.use(express.json());

  // Health check (no auth)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Static UI (no auth)
  app.use('/ui', express.static(path.join(process.cwd(), 'public')));

  // Auth for all /v1/* routes
  const auth = createAuthMiddleware(config.auth.bearer_token);
  app.use('/v1', auth);

  // Routes
  app.get('/v1/models', createModelsRoute(config.providers));
  app.post('/v1/chat/completions', createCompletionsRoute(manager, (modelId) => router.getAdapter(modelId)));
  app.use('/v1/sessions', createSessionsRoute(manager));

  return { app, manager, store };
}
