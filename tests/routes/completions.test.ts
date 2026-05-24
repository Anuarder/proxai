import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCompletionsRoute } from '../../src/routes/completions.js';
import type { ProviderAdapter } from '../../src/providers/adapter.js';
import type { ProxaiEvent } from '../../src/events/schema.js';

class FakeAdapter implements ProviderAdapter {
  readonly name = 'claude';
  readonly modelId = 'claude-code';
  send() {
    const evs: ProxaiEvent[] = [
      { type: 'start', request_id: 'r', model: 'claude-code', provider: 'claude' },
      { type: 'thinking_delta', text: 'planning' },
      { type: 'text_delta', text: 'hello ' },
      { type: 'text_delta', text: 'world' },
      { type: 'turn_complete', reason: 'stop' },
      { type: 'done' },
    ];
    return { events: (async function* () { for (const e of evs) yield e; })() };
  }
  async probe() { return { status: 'ready' as const }; }
}

describe('POST /v1/chat/completions (OpenAI-compat)', () => {
  it('non-streaming returns concatenated text', async () => {
    const app = express();
    app.use(express.json());
    const route = createCompletionsRoute({
      getAdapter: () => new FakeAdapter(),
      resolveModeConfig: () => ({ systemPrompt: null, allowedTools: null, mcpConfigFile: null }),
      timeouts: { request_timeout_ms: 5000, idle_timeout_ms: 5000, probe_timeout_ms: 1000, process_kill_grace_ms: 100 },
    });
    app.post('/v1/chat/completions', (req, _res, next) => { (req as any).mode = 'agent'; next(); }, route);

    const res = await request(app).post('/v1/chat/completions').send({
      model: 'claude-code', mode: 'agent', messages: [{ role: 'user', content: 'hi' }], stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.choices[0].message.content).toBe('hello world');
  });

  it('streaming emits OpenAI-style delta chunks', async () => {
    const app = express();
    app.use(express.json());
    const route = createCompletionsRoute({
      getAdapter: () => new FakeAdapter(),
      resolveModeConfig: () => ({ systemPrompt: null, allowedTools: null, mcpConfigFile: null }),
      timeouts: { request_timeout_ms: 5000, idle_timeout_ms: 5000, probe_timeout_ms: 1000, process_kill_grace_ms: 100 },
    });
    app.post('/v1/chat/completions', (req, _res, next) => { (req as any).mode = 'agent'; next(); }, route);

    const res = await request(app).post('/v1/chat/completions').send({
      model: 'claude-code', mode: 'agent', messages: [{ role: 'user', content: 'hi' }], stream: true,
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('"content":"hello "');
    expect(res.text).toContain('"content":"world"');
    expect(res.text).toContain('[DONE]');
  });
});
