import { describe, it, expect } from 'vitest';
import { ProviderRouter } from '../../src/providers/router.js';
import { ChildRegistry } from '../../src/lifecycle/children.js';
import type { ProxaiConfig } from '../../src/config.js';

function makeConfig(overrides: Partial<ProxaiConfig['providers']> = {}): ProxaiConfig {
  return {
    server: { port: 3077, host: '127.0.0.1' },
    auth: { ask_token: 'a', agent_token: 'b' },
    timeouts: {
      request_timeout_ms: 1000,
      idle_timeout_ms: 1000,
      probe_timeout_ms: 1000,
      process_kill_grace_ms: 100,
    },
    modes: {
      ask: { system_prompt: null, allowed_tools: null, mcp_config_file: null },
      agent: { system_prompt: null, allowed_tools: null, mcp_config_file: null },
    },
    providers: {
      claude: {
        command: 'claude',
        model_id: 'claude-code',
        default_model: 'claude-sonnet',
        models: [
          { id: 'claude-opus', cli_model: 'opus' },
          { id: 'claude-sonnet', cli_model: 'sonnet' },
          { id: 'claude-haiku', cli_model: 'haiku' },
        ],
      },
      codex: { command: 'codex', model_id: 'codex-cli' },
      ...overrides,
    },
  } as ProxaiConfig;
}

describe('ProviderRouter catalog', () => {
  it('listModels returns one entry per configured model id plus back-compat alias', () => {
    const router = new ProviderRouter(makeConfig(), new ChildRegistry());
    const ids = router.listModels().map((m) => m.id).sort();
    expect(ids).toEqual(['claude-code', 'claude-haiku', 'claude-opus', 'claude-sonnet', 'codex-cli']);
  });

  it('getModelEntry resolves explicit models to their cliModel', () => {
    const router = new ProviderRouter(makeConfig(), new ChildRegistry());
    const opus = router.getModelEntry('claude-opus');
    expect(opus?.cliModel).toBe('opus');
    expect(opus?.providerName).toBe('claude');
  });

  it('back-compat alias model_id resolves to default_model.cli_model', () => {
    const router = new ProviderRouter(makeConfig(), new ChildRegistry());
    const alias = router.getModelEntry('claude-code');
    expect(alias?.cliModel).toBe('sonnet');
  });

  it('back-compat alias resolves to null cliModel when default_model is absent', () => {
    const router = new ProviderRouter(makeConfig({
      claude: { command: 'claude', model_id: 'claude-code' },
    }), new ChildRegistry());
    const alias = router.getModelEntry('claude-code');
    expect(alias?.cliModel).toBeNull();
  });

  it('provider with no models[] yields a single entry with null cliModel', () => {
    const router = new ProviderRouter(makeConfig(), new ChildRegistry());
    const codex = router.getModelEntry('codex-cli');
    expect(codex?.cliModel).toBeNull();
    expect(codex?.providerName).toBe('codex');
  });

  it('getModelEntry returns undefined for unknown ids', () => {
    const router = new ProviderRouter(makeConfig(), new ChildRegistry());
    expect(router.getModelEntry('does-not-exist')).toBeUndefined();
  });
});
