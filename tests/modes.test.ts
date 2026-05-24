import { describe, it, expect } from 'vitest';
import { resolveModeConfig } from '../src/modes/resolver.js';
import type { ProxaiConfig } from '../src/config.js';

const config: ProxaiConfig = {
  server: { port: 3077, host: '127.0.0.1' },
  auth: { ask_token: 'a', agent_token: 'b' },
  timeouts: { request_timeout_ms: 1, idle_timeout_ms: 1, probe_timeout_ms: 1, process_kill_grace_ms: 1 },
  modes: {
    ask: {
      system_prompt: 'Chat only.',
      allowed_tools: ['WebSearch'],
      mcp_config_file: './ask-mcp.json',
    },
    agent: { system_prompt: null, allowed_tools: null, mcp_config_file: null },
  },
  providers: {},
};

describe('resolveModeConfig', () => {
  it('returns ask-mode values', () => {
    expect(resolveModeConfig('ask', config)).toEqual({
      systemPrompt: 'Chat only.',
      allowedTools: ['WebSearch'],
      mcpConfigFile: './ask-mcp.json',
    });
  });

  it('returns all-null agent-mode values', () => {
    expect(resolveModeConfig('agent', config)).toEqual({
      systemPrompt: null,
      allowedTools: null,
      mcpConfigFile: null,
    });
  });
});
