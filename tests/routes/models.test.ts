import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createModelsRoute } from '../../src/routes/models.js';

function createApp(providers: Record<string, { model_id: string }>): express.Express {
  const app = express();
  app.get('/v1/models', createModelsRoute(providers));
  return app;
}

describe('GET /v1/models', () => {
  it('returns list of configured providers in OpenAI-compatible format', async () => {
    const providers = {
      claude: { model_id: 'claude-code' },
      codex: { model_id: 'codex-cli' },
    };
    const app = createApp(providers);

    const res = await request(app).get('/v1/models');

    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(res.body.data).toHaveLength(2);

    for (const model of res.body.data) {
      expect(model).toHaveProperty('id');
      expect(model.object).toBe('model');
      expect(model.created).toEqual(expect.any(Number));
      expect(model.owned_by).toMatch(/^proxai:/);
    }

    const ids = res.body.data.map((m: { id: string }) => m.id);
    expect(ids).toContain('claude-code');
    expect(ids).toContain('codex-cli');

    const claude = res.body.data.find((m: { id: string }) => m.id === 'claude-code');
    expect(claude.owned_by).toBe('proxai:claude');

    const codex = res.body.data.find((m: { id: string }) => m.id === 'codex-cli');
    expect(codex.owned_by).toBe('proxai:codex');
  });

  it('returns empty list when no providers configured', async () => {
    const app = createApp({});

    const res = await request(app).get('/v1/models');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ object: 'list', data: [] });
  });
});
