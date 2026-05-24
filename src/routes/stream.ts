import type { Response } from 'express';
import type { AuthedRequest } from '../middleware/auth.js';
import type { ModelEntry } from '../providers/router.js';
import type { ModeConfig } from '../modes/resolver.js';
import type { ProxaiEvent } from '../events/schema.js';
import type { ModeName } from '../config.js';
import { withIdleTimeout } from '../lifecycle/children.js';

export interface StreamRouteDeps {
  getModelEntry: (modelId: string) => ModelEntry | undefined;
  resolveModeConfig: (mode: ModeName) => ModeConfig;
  timeouts: {
    request_timeout_ms: number;
    idle_timeout_ms: number;
    probe_timeout_ms: number;
    process_kill_grace_ms: number;
  };
}

export function createStreamRoute(deps: StreamRouteDeps) {
  return async (req: AuthedRequest, res: Response): Promise<void> => {
    const { model, messages } = req.body ?? {};
    const mode = req.mode!;

    if (!model || typeof model !== 'string') {
      res.status(400).json({ error: { code: 'invalid_model', message: 'Missing or invalid `model`' } });
      return;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: { code: 'invalid_messages', message: 'Missing or empty `messages`' } });
      return;
    }
    const entry = deps.getModelEntry(model);
    if (!entry) {
      res.status(400).json({ error: { code: 'unknown_model', message: `Unknown model: ${model}` } });
      return;
    }

    const abort = new AbortController();
    const requestTimeout = setTimeout(() => abort.abort(), deps.timeouts.request_timeout_ms);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Detect client disconnect via the response, not the request. In Node 18+/
    // Express 5, `req` emits 'close' as soon as the request body is fully
    // consumed (via express.json), which would abort the child immediately.
    // `res.on('close')` fires only when the response is finished or the client
    // socket actually closes mid-stream.
    res.on('close', () => abort.abort());

    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);

    const modeConfig = deps.resolveModeConfig(mode);
    const result = entry.adapter.send(messages, modeConfig, abort.signal, entry.cliModel);

    try {
      for await (const ev of withIdleTimeout<ProxaiEvent>(result.events, deps.timeouts.idle_timeout_ms, 'idle_timeout')) {
        res.write(`event: ${ev.type}\n`);
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
        if (ev.type === 'done') break;
      }
    } catch (err: any) {
      const code = /idle_timeout/.test(err?.message || '') ? 'idle_timeout' : 'stream_error';
      const errEv: ProxaiEvent = { type: 'error', code, message: err?.message || 'Stream error', retriable: false };
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify(errEv)}\n\n`);
      res.write(`event: done\n`);
      res.write(`data: {}\n\n`);
      abort.abort();
    } finally {
      clearTimeout(requestTimeout);
      clearInterval(heartbeat);
      res.end();
    }
  };
}
