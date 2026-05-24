import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createModelsRoute } from '../../src/routes/models.js';
import type { ModelEntry } from '../../src/providers/router.js';
import type { ProviderAdapter, ProbeResult } from '../../src/providers/adapter.js';

const dummyAdapter = (name: string, modelId: string): ProviderAdapter => ({
  name,
  modelId,
  async probe() { return { status: 'ready' }; },
  send() { return { events: (async function* () {})() }; },
});

describe('GET /v1/models', () => {
  it('returns one entry per ModelEntry with cli_model and fanned-out provider probe', async () => {
    const claude = dummyAdapter('claude', 'claude-code');
    const codex = dummyAdapter('codex', 'codex-cli');
    const models: ModelEntry[] = [
      { id: 'claude-opus', adapter: claude, cliModel: 'opus', providerName: 'claude' },
      { id: 'claude-sonnet', adapter: claude, cliModel: 'sonnet', providerName: 'claude' },
      { id: 'claude-code', adapter: claude, cliModel: 'sonnet', providerName: 'claude' },
      { id: 'codex-cli', adapter: codex, cliModel: null, providerName: 'codex' },
    ];
    const probes = new Map<string, ProbeResult>([
      ['claude', { status: 'ready' }],
      ['codex', { status: 'not_authenticated', hint: 'Run: codex login' }],
    ]);

    const app = express();
    app.get('/v1/models', createModelsRoute({
      listModels: () => models,
      probeProviders: async () => probes,
    }));

    const res = await request(app).get('/v1/models');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: 'claude-opus', object: 'model', owned_by: 'proxai:claude', cli_model: 'opus', status: 'ready' },
      { id: 'claude-sonnet', object: 'model', owned_by: 'proxai:claude', cli_model: 'sonnet', status: 'ready' },
      { id: 'claude-code', object: 'model', owned_by: 'proxai:claude', cli_model: 'sonnet', status: 'ready' },
      { id: 'codex-cli', object: 'model', owned_by: 'proxai:codex', cli_model: null, status: 'not_authenticated', hint: 'Run: codex login' },
    ]);
  });

  it('probes each provider exactly once even with multiple model entries', async () => {
    const claude = dummyAdapter('claude', 'claude-code');
    let probeCalls = 0;
    const probeProviders = async () => {
      probeCalls += 1;
      return new Map<string, ProbeResult>([['claude', { status: 'ready' }]]);
    };
    const models: ModelEntry[] = [
      { id: 'claude-opus', adapter: claude, cliModel: 'opus', providerName: 'claude' },
      { id: 'claude-sonnet', adapter: claude, cliModel: 'sonnet', providerName: 'claude' },
      { id: 'claude-haiku', adapter: claude, cliModel: 'haiku', providerName: 'claude' },
    ];

    const app = express();
    app.get('/v1/models', createModelsRoute({
      listModels: () => models,
      probeProviders,
    }));

    const res = await request(app).get('/v1/models');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(probeCalls).toBe(1);
  });
});
