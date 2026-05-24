import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createStreamRoute } from '../../src/routes/stream.js';
import type { ProviderAdapter } from '../../src/providers/adapter.js';
import type { ProxaiEvent } from '../../src/events/schema.js';

class FakeAdapter implements ProviderAdapter {
  readonly name = 'claude';
  readonly modelId = 'claude-code';
  send() {
    const evs: ProxaiEvent[] = [
      { type: 'start', request_id: 'r', model: 'claude-code', provider: 'claude' },
      { type: 'text_delta', text: 'hi' },
      { type: 'turn_complete', reason: 'stop' },
      { type: 'done' },
    ];
    return { events: (async function* () { for (const e of evs) yield e; })() };
  }
  async probe() { return { status: 'ready' as const }; }
}

describe('POST /v1/chat/stream', () => {
  it('streams typed SSE events', async () => {
    const app = express();
    app.use(express.json());
    const fake = new FakeAdapter();
    const route = createStreamRoute({
      getModelEntry: () => ({ id: 'claude-code', adapter: fake, cliModel: null, providerName: 'claude' }),
      resolveModeConfig: () => ({ systemPrompt: null, allowedTools: null, mcpConfigFile: null }),
      timeouts: { request_timeout_ms: 5000, idle_timeout_ms: 5000, probe_timeout_ms: 1000, process_kill_grace_ms: 100 },
    });
    app.post('/v1/chat/stream', (req, _res, next) => { (req as any).mode = 'agent'; next(); }, route);

    const res = await request(app)
      .post('/v1/chat/stream')
      .send({ model: 'claude-code', mode: 'agent', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('event: start');
    expect(res.text).toContain('event: text_delta');
    expect(res.text).toContain('event: turn_complete');
    expect(res.text).toContain('event: done');
  });

  it('does not abort the adapter as soon as the request body is consumed', async () => {
    // Regression: in Node 18+/Express 5, `req.on('close')` fires after
    // express.json finishes consuming the body, before any streaming starts.
    // The route must hook `res.on('close')` instead, otherwise the adapter is
    // aborted before it emits any events and the response is empty.
    let abortedEarly = false;
    const adapter: ProviderAdapter = {
      name: 'claude',
      modelId: 'claude-code',
      async probe() { return { status: 'ready' as const }; },
      send(_msgs, _mode, signal, _cliModel) {
        async function* events(): AsyncGenerator<ProxaiEvent> {
          // Pause so any pre-stream abort has time to fire.
          await new Promise((r) => setTimeout(r, 50));
          if (signal.aborted) {
            abortedEarly = true;
            yield { type: 'done' };
            return;
          }
          yield { type: 'start', request_id: 'r', model: 'claude-code', provider: 'claude' };
          yield { type: 'text_delta', text: 'hi' };
          yield { type: 'done' };
        }
        return { events: events() };
      },
    };
    const app = express();
    app.use(express.json());
    const route = createStreamRoute({
      getModelEntry: () => ({ id: 'claude-code', adapter, cliModel: null, providerName: 'claude' }),
      resolveModeConfig: () => ({ systemPrompt: null, allowedTools: null, mcpConfigFile: null }),
      timeouts: { request_timeout_ms: 5000, idle_timeout_ms: 5000, probe_timeout_ms: 1000, process_kill_grace_ms: 100 },
    });
    app.post('/v1/chat/stream', (req, _res, next) => { (req as any).mode = 'agent'; next(); }, route);

    const res = await request(app)
      .post('/v1/chat/stream')
      .send({ model: 'claude-code', mode: 'agent', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).toBe(200);
    expect(abortedEarly).toBe(false);
    expect(res.text).toContain('event: start');
    expect(res.text).toContain('event: text_delta');
  });

  it('returns 400 on unknown model', async () => {
    const app = express();
    app.use(express.json());
    const route = createStreamRoute({
      getModelEntry: () => undefined,
      resolveModeConfig: () => ({ systemPrompt: null, allowedTools: null, mcpConfigFile: null }),
      timeouts: { request_timeout_ms: 5000, idle_timeout_ms: 5000, probe_timeout_ms: 1000, process_kill_grace_ms: 100 },
    });
    app.post('/v1/chat/stream', (req, _res, next) => { (req as any).mode = 'agent'; next(); }, route);

    const res = await request(app)
      .post('/v1/chat/stream')
      .send({ model: 'unknown', mode: 'agent', messages: [{ role: 'user', content: 'x' }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('unknown_model');
  });

  it('forwards entry.cliModel to adapter.send', async () => {
    let receivedCliModel: string | null | undefined;
    const adapter: ProviderAdapter = {
      name: 'claude',
      modelId: 'claude-code',
      async probe() { return { status: 'ready' as const }; },
      send(_msgs, _mode, _signal, cliModel) {
        receivedCliModel = cliModel;
        return {
          events: (async function* () {
            yield { type: 'start' as const, request_id: 'r', model: 'claude-opus', provider: 'claude' };
            yield { type: 'done' as const };
          })(),
        };
      },
    };
    const app = express();
    app.use(express.json());
    const route = createStreamRoute({
      getModelEntry: () => ({ id: 'claude-opus', adapter, cliModel: 'opus', providerName: 'claude' }),
      resolveModeConfig: () => ({ systemPrompt: null, allowedTools: null, mcpConfigFile: null }),
      timeouts: { request_timeout_ms: 5000, idle_timeout_ms: 5000, probe_timeout_ms: 1000, process_kill_grace_ms: 100 },
    });
    app.post('/v1/chat/stream', (req, _res, next) => { (req as any).mode = 'agent'; next(); }, route);

    await request(app)
      .post('/v1/chat/stream')
      .send({ model: 'claude-opus', mode: 'agent', messages: [{ role: 'user', content: 'hi' }] });

    expect(receivedCliModel).toBe('opus');
  });
});
