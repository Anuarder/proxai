import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { AuthedRequest } from '../middleware/auth.js';
import type { ModelEntry } from '../providers/router.js';
import type { ModeConfig } from '../modes/resolver.js';
import type { ProxaiEvent } from '../events/schema.js';
import type { ModeName } from '../config.js';
import { withIdleTimeout } from '../lifecycle/children.js';

export interface CompletionsRouteDeps {
  getModelEntry: (modelId: string) => ModelEntry | undefined;
  resolveModeConfig: (mode: ModeName) => ModeConfig;
  timeouts: {
    request_timeout_ms: number;
    idle_timeout_ms: number;
    probe_timeout_ms: number;
    process_kill_grace_ms: number;
  };
}

export function createCompletionsRoute(deps: CompletionsRouteDeps) {
  return async (req: AuthedRequest, res: Response): Promise<void> => {
    const { model, messages, stream } = req.body ?? {};
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
    // Detect client disconnect via the response, not the request. In Node 18+/
    // Express 5, `req` emits 'close' as soon as the request body is fully
    // consumed (via express.json), which would abort the child immediately.
    res.on('close', () => abort.abort());
    const result = entry.adapter.send(messages, deps.resolveModeConfig(mode), abort.signal, entry.cliModel);

    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      try {
        for await (const ev of withIdleTimeout<ProxaiEvent>(result.events, deps.timeouts.idle_timeout_ms, 'idle_timeout')) {
          if (ev.type === 'text_delta') {
            const chunk = {
              id, object: 'chat.completion.chunk', created, model,
              choices: [{ index: 0, delta: { content: ev.text }, finish_reason: null }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          } else if (ev.type === 'auth_required' || ev.type === 'error') {
            const errChunk = { error: { message: ev.type === 'auth_required' ? `${ev.message} (${ev.hint})` : ev.message } };
            res.write(`data: ${JSON.stringify(errChunk)}\n\n`);
            break;
          } else if (ev.type === 'turn_complete') {
            const final = {
              id, object: 'chat.completion.chunk', created, model,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            };
            res.write(`data: ${JSON.stringify(final)}\n\n`);
          }
          if (ev.type === 'done') break;
        }
        res.write('data: [DONE]\n\n');
      } finally {
        clearTimeout(requestTimeout);
        res.end();
      }
      return;
    }

    let text = '';
    try {
      for await (const ev of withIdleTimeout<ProxaiEvent>(result.events, deps.timeouts.idle_timeout_ms, 'idle_timeout')) {
        if (ev.type === 'text_delta') text += ev.text;
        if (ev.type === 'auth_required' || ev.type === 'error') {
          res.status(502).json({ error: { message: ev.type === 'auth_required' ? `${ev.message} (${ev.hint})` : ev.message } });
          return;
        }
      }
    } finally {
      clearTimeout(requestTimeout);
    }

    res.json({
      id, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    });
  };
}
