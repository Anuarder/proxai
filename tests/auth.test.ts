import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthMiddleware, requireMode } from '../src/middleware/auth.js';

function app(askToken: string, agentToken: string, adminToken?: string) {
  const a = express();
  a.use(express.json());
  const auth = createAuthMiddleware({ ask_token: askToken, agent_token: agentToken, admin_token: adminToken });
  a.post('/x', auth, requireMode(), (_req, res) => res.json({ ok: true }));
  return a;
}

describe('auth middleware + requireMode', () => {
  it('rejects missing Authorization', async () => {
    const r = await request(app('a', 'b')).post('/x').send({ mode: 'ask' });
    expect(r.status).toBe(401);
  });

  it('rejects unknown bearer', async () => {
    const r = await request(app('a', 'b')).post('/x').set('Authorization', 'Bearer nope').send({ mode: 'ask' });
    expect(r.status).toBe(401);
  });

  it('allows ask token with mode=ask', async () => {
    const r = await request(app('a', 'b')).post('/x').set('Authorization', 'Bearer a').send({ mode: 'ask' });
    expect(r.status).toBe(200);
  });

  it('forbids ask token with mode=agent (403 forbidden_mode)', async () => {
    const r = await request(app('a', 'b')).post('/x').set('Authorization', 'Bearer a').send({ mode: 'agent' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('forbidden_mode');
  });

  it('allows agent token with mode=agent', async () => {
    const r = await request(app('a', 'b')).post('/x').set('Authorization', 'Bearer b').send({ mode: 'agent' });
    expect(r.status).toBe(200);
  });

  it('admin token allows both modes', async () => {
    const ask = await request(app('a', 'b', 'admin')).post('/x').set('Authorization', 'Bearer admin').send({ mode: 'ask' });
    expect(ask.status).toBe(200);
    const ag = await request(app('a', 'b', 'admin')).post('/x').set('Authorization', 'Bearer admin').send({ mode: 'agent' });
    expect(ag.status).toBe(200);
  });

  it('rejects missing/invalid mode field with 400', async () => {
    const r = await request(app('a', 'b')).post('/x').set('Authorization', 'Bearer a').send({});
    expect(r.status).toBe(400);
    const r2 = await request(app('a', 'b')).post('/x').set('Authorization', 'Bearer a').send({ mode: 'plan' });
    expect(r2.status).toBe(400);
  });
});
