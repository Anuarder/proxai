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
      getAdapter: () => fake,
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

  it('returns 400 on unknown model', async () => {
    const app = express();
    app.use(express.json());
    const route = createStreamRoute({
      getAdapter: () => undefined,
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
});
