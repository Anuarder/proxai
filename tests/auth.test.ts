import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthMiddleware } from '../src/middleware/auth.js';

function createApp(token: string): express.Express {
  const app = express();
  app.use(createAuthMiddleware(token));
  app.get('/test', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('auth middleware', () => {
  const token = 'test-secret-key';

  it('allows requests with valid Bearer token', async () => {
    const app = createApp(token);

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects requests without Authorization header', async () => {
    const app = createApp(token);

    const res = await request(app).get('/test');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        message: 'Missing Authorization header',
        type: 'auth_error',
      },
    });
  });

  it('rejects requests with wrong token', async () => {
    const app = createApp(token);

    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer wrong-token');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        message: 'Invalid API key',
        type: 'auth_error',
      },
    });
  });
});
