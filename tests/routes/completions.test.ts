import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SessionManager } from '../../src/sessions/manager.js';
import { SessionStore } from '../../src/sessions/store.js';
import { createCompletionsRoute } from '../../src/routes/completions.js';
import type { ProviderAdapter, SendResult } from '../../src/providers/adapter.js';

class MockAdapter implements ProviderAdapter {
  readonly name = 'mock';
  readonly modelId = 'mock-model';
  lastPrompt: string | null = null;
  lastCliSessionId: string | null = null;
  response = 'Hello from mock';
  cliSessionIdValue: string | null = 'cli-sess-123';

  send(prompt: string, cliSessionId: string | null): SendResult {
    this.lastPrompt = prompt;
    this.lastCliSessionId = cliSessionId;
    const response = this.response;
    const cliSessionIdValue = this.cliSessionIdValue;
    return {
      chunks: (async function* () {
        yield response;
      })(),
      cliSessionId: Promise.resolve(cliSessionIdValue),
    };
  }

  async kill(): Promise<void> {}
}

function createApp(
  sessions: SessionManager,
  getAdapter: (modelId: string) => ProviderAdapter | undefined,
): express.Express {
  const app = express();
  app.use(express.json());
  app.post('/v1/chat/completions', createCompletionsRoute(sessions, getAdapter));
  return app;
}

describe('POST /v1/chat/completions', () => {
  let store: SessionStore;
  let sessions: SessionManager;
  let adapter: MockAdapter;
  let app: express.Express;

  beforeEach(() => {
    store = new SessionStore(':memory:');
    sessions = new SessionManager(store, {
      idle_timeout_ms: 300000,
      max_concurrent: 10,
    });
    adapter = new MockAdapter();
    app = createApp(sessions, (modelId) =>
      modelId === 'mock-model' ? adapter : undefined,
    );
  });

  afterEach(() => {
    sessions.shutdown();
    store.close();
  });

  it('returns non-streaming chat.completion with assistant message', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'mock-model',
        messages: [{ role: 'user', content: 'Hi' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.object).toBe('chat.completion');
    expect(res.body.choices).toHaveLength(1);
    expect(res.body.choices[0].index).toBe(0);
    expect(res.body.choices[0].message.role).toBe('assistant');
    expect(res.body.choices[0].message.content).toBe('Hello from mock');
    expect(res.body.choices[0].finish_reason).toBe('stop');
    expect(res.body.session_id).toEqual(expect.any(String));
  });

  it('returns streaming SSE with chat.completion.chunk events', async () => {
    adapter.response = 'Streamed';

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'mock-model',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);

    const lines = res.text.split('\n').filter((l: string) => l.startsWith('data: '));
    const chunks = lines.map((l: string) => l.slice(6));

    // Should have at least one chunk + [DONE]
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[chunks.length - 1]).toBe('[DONE]');

    const firstChunk = JSON.parse(chunks[0]);
    expect(firstChunk.object).toBe('chat.completion.chunk');
    expect(firstChunk.choices[0].delta.content).toBe('Streamed');
    expect(firstChunk.session_id).toEqual(expect.any(String));
  });

  it('reuses existing session when session_id is provided', async () => {
    // First request creates a session
    const res1 = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'mock-model',
        messages: [{ role: 'user', content: 'First' }],
      });

    const sessionId = res1.body.session_id;

    // Second request reuses the session
    const res2 = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'mock-model',
        messages: [{ role: 'user', content: 'Second' }],
        session_id: sessionId,
      });

    expect(res2.status).toBe(200);
    expect(res2.body.session_id).toBe(sessionId);

    // Session should have all messages stored
    const messages = sessions.getMessages(sessionId);
    expect(messages).toHaveLength(4); // user + assistant + user + assistant
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('First');
    expect(messages[1].role).toBe('assistant');
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toBe('Second');
    expect(messages[3].role).toBe('assistant');
  });

  it('returns 400 for unknown model', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'unknown-model',
        messages: [{ role: 'user', content: 'Hi' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.message).toMatch(/unknown-model/i);
  });

  it('returns 400 for missing model or messages', async () => {
    const res1 = await request(app)
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'Hi' }] });

    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'mock-model' });

    expect(res2.status).toBe(400);
  });

  it('captures cli_session_id from adapter', async () => {
    adapter.cliSessionIdValue = 'cli-native-456';

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'mock-model',
        messages: [{ role: 'user', content: 'Hi' }],
      });

    const sessionId = res.body.session_id;
    const session = sessions.getSession(sessionId);
    expect(session?.cli_session_id).toBe('cli-native-456');
  });

  it('passes stored cli_session_id to adapter on subsequent calls', async () => {
    adapter.cliSessionIdValue = 'cli-native-789';

    const res1 = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'mock-model',
        messages: [{ role: 'user', content: 'First' }],
      });

    const sessionId = res1.body.session_id;

    // Second call should pass the stored CLI session ID
    await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'mock-model',
        messages: [{ role: 'user', content: 'Second' }],
        session_id: sessionId,
      });

    expect(adapter.lastCliSessionId).toBe('cli-native-789');
  });
});
