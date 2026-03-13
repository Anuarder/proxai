import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SessionManager } from '../../src/sessions/manager.js';
import { SessionStore } from '../../src/sessions/store.js';
import { createSessionsRoute } from '../../src/routes/sessions.js';

function createApp(sessions: SessionManager): express.Express {
  const app = express();
  app.use(express.json());

  const router = createSessionsRoute(sessions);
  app.use('/v1/sessions', router);

  return app;
}

describe('Sessions CRUD', () => {
  let store: SessionStore;
  let sessions: SessionManager;
  let app: express.Express;

  beforeEach(() => {
    store = new SessionStore(':memory:');
    sessions = new SessionManager(store, {
      idle_timeout_ms: 300000,
      max_concurrent: 2,
    });
    app = createApp(sessions);
  });

  afterEach(() => {
    sessions.shutdown();
    store.close();
  });

  describe('POST /v1/sessions', () => {
    it('creates a session and returns 201', async () => {
      const res = await request(app)
        .post('/v1/sessions')
        .send({ model: 'claude-code', provider: 'claude' });

      expect(res.status).toBe(201);
      expect(res.body.id).toEqual(expect.any(String));
      expect(res.body.model_id).toBe('claude-code');
      expect(res.body.provider).toBe('claude');
      expect(res.body.status).toBe('active');
    });

    it('returns 400 if model or provider missing', async () => {
      const res1 = await request(app)
        .post('/v1/sessions')
        .send({ model: 'claude-code' });

      expect(res1.status).toBe(400);
      expect(res1.body.error.message).toMatch(/provider/i);

      const res2 = await request(app)
        .post('/v1/sessions')
        .send({ provider: 'claude' });

      expect(res2.status).toBe(400);
      expect(res2.body.error.message).toMatch(/model/i);
    });

    it('returns 429 if max concurrent sessions reached', async () => {
      // max_concurrent is set to 2
      await request(app)
        .post('/v1/sessions')
        .send({ model: 'claude-code', provider: 'claude' });
      await request(app)
        .post('/v1/sessions')
        .send({ model: 'claude-code', provider: 'claude' });

      const res = await request(app)
        .post('/v1/sessions')
        .send({ model: 'claude-code', provider: 'claude' });

      expect(res.status).toBe(429);
      expect(res.body.error.message).toMatch(/max concurrent/i);
    });
  });

  describe('GET /v1/sessions', () => {
    it('lists all sessions', async () => {
      await request(app)
        .post('/v1/sessions')
        .send({ model: 'claude-code', provider: 'claude' });
      await request(app)
        .post('/v1/sessions')
        .send({ model: 'codex-cli', provider: 'codex' });

      const res = await request(app).get('/v1/sessions');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].id).toEqual(expect.any(String));
      expect(res.body[1].id).toEqual(expect.any(String));
    });
  });

  describe('GET /v1/sessions/:id', () => {
    it('returns session with messages', async () => {
      const createRes = await request(app)
        .post('/v1/sessions')
        .send({ model: 'claude-code', provider: 'claude' });

      const sessionId = createRes.body.id;
      sessions.addMessage(sessionId, 'user', 'Hello');
      sessions.addMessage(sessionId, 'assistant', 'Hi there');

      const res = await request(app).get(`/v1/sessions/${sessionId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(sessionId);
      expect(res.body.messages).toHaveLength(2);
      expect(res.body.messages[0].role).toBe('user');
      expect(res.body.messages[0].content).toBe('Hello');
      expect(res.body.messages[1].role).toBe('assistant');
    });

    it('returns 404 for missing session', async () => {
      const res = await request(app).get('/v1/sessions/nonexistent-id');

      expect(res.status).toBe(404);
      expect(res.body.error.message).toMatch(/not found/i);
    });
  });

  describe('DELETE /v1/sessions/:id', () => {
    it('deletes session and returns 204', async () => {
      const createRes = await request(app)
        .post('/v1/sessions')
        .send({ model: 'claude-code', provider: 'claude' });

      const sessionId = createRes.body.id;

      const res = await request(app).delete(`/v1/sessions/${sessionId}`);
      expect(res.status).toBe(204);

      // Verify it's gone
      const getRes = await request(app).get(`/v1/sessions/${sessionId}`);
      expect(getRes.status).toBe(404);
    });

    it('returns 404 for missing session', async () => {
      const res = await request(app).delete('/v1/sessions/nonexistent-id');

      expect(res.status).toBe(404);
      expect(res.body.error.message).toMatch(/not found/i);
    });
  });
});
