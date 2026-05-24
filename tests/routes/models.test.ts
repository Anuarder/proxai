import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createModelsRoute } from '../../src/routes/models.js';

describe('GET /v1/models', () => {
  it('returns live probe results', async () => {
    const app = express();
    const route = createModelsRoute({
      probeAll: async () => [
        { id: 'claude-code', providerName: 'claude', result: { status: 'ready' } },
        { id: 'codex-cli', providerName: 'codex', result: { status: 'not_authenticated', hint: 'Run: codex login' } },
      ],
    });
    app.get('/v1/models', route);

    const res = await request(app).get('/v1/models');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: 'claude-code', object: 'model', owned_by: 'proxai:claude', status: 'ready' },
      { id: 'codex-cli', object: 'model', owned_by: 'proxai:codex', status: 'not_authenticated', hint: 'Run: codex login' },
    ]);
  });
});
