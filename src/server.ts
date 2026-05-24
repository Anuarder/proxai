import express from 'express';
import path from 'node:path';
import { ProxaiConfig } from './config.js';
import { ProviderRouter } from './providers/router.js';
import { ChildRegistry } from './lifecycle/children.js';
import { resolveModeConfig } from './modes/resolver.js';
import { createAuthMiddleware, requireMode } from './middleware/auth.js';
import { createModelsRoute } from './routes/models.js';
import { createCompletionsRoute } from './routes/completions.js';
import { createStreamRoute } from './routes/stream.js';
import { createOpenApiRoute } from './routes/openapi.js';

export function createServer(config: ProxaiConfig) {
  const children = new ChildRegistry();
  const router = new ProviderRouter(config, children);
  // Note: the spec mentions a 30s "reaper" as a safety net. v2 omits it because every
  // child is now owned by an AbortController that fires on res.on('close'), request
  // timeout, idle timeout, and process shutdown. If a leak is observed in practice,
  // add timestamps to ChildRegistry and a setInterval sweep here.

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });

  // Static UI (no auth)
  app.use('/ui', express.static(path.join(process.cwd(), 'public')));

  // OpenAPI spec + docs UI (unauthenticated — schema contains no secrets)
  app.get('/openapi.json', createOpenApiRoute());
  app.get('/docs', (_req, res) => res.sendFile(path.join(process.cwd(), 'public/docs.html')));

  const auth = createAuthMiddleware(config.auth);

  const deps = {
    getModelEntry: (id: string) => router.getModelEntry(id),
    resolveModeConfig: (m: 'ask' | 'agent') => resolveModeConfig(m, config),
    timeouts: config.timeouts,
  };

  app.get('/v1/models', auth, createModelsRoute({
    listModels: () => router.listModels(),
    probeProviders: () => router.probeProviders(config.timeouts.probe_timeout_ms),
  }));

  app.post('/v1/chat/stream', auth, requireMode(), createStreamRoute(deps));
  app.post('/v1/chat/completions', auth, requireMode(), createCompletionsRoute(deps));

  return { app, router, children };
}
