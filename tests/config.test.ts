import { describe, it, expect } from 'vitest';
import { parseConfig, loadConfig } from '../src/config.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const validYaml = `
server:
  port: 3077
  host: "127.0.0.1"

auth:
  ask_token: "ask-secret"
  agent_token: "agent-secret"
  admin_token: "admin-secret"

timeouts:
  request_timeout_ms: 300000
  idle_timeout_ms: 60000
  probe_timeout_ms: 5000
  process_kill_grace_ms: 2000

modes:
  ask:
    system_prompt: "Chat only."
    allowed_tools: ["WebSearch", "WebFetch", "mcp__context7__*"]
    mcp_config_file: "./ask-mcp.json"
  agent:
    system_prompt: null
    allowed_tools: null
    mcp_config_file: null

providers:
  claude:
    command: "claude"
    model_id: "claude-code"
  codex:
    command: "codex"
    model_id: "codex-cli"
`;

describe('parseConfig (v2)', () => {
  it('parses valid v2 YAML', () => {
    const c = parseConfig(validYaml);
    expect(c.server.port).toBe(3077);
    expect(c.auth.ask_token).toBe('ask-secret');
    expect(c.auth.agent_token).toBe('agent-secret');
    expect(c.auth.admin_token).toBe('admin-secret');
    expect(c.timeouts.request_timeout_ms).toBe(300000);
    expect(c.modes.ask.allowed_tools).toEqual(['WebSearch', 'WebFetch', 'mcp__context7__*']);
    expect(c.modes.agent.allowed_tools).toBeNull();
    expect(c.providers['claude'].model_id).toBe('claude-code');
  });

  it('admin_token is optional', () => {
    const yaml = validYaml.replace('  admin_token: "admin-secret"\n', '');
    const c = parseConfig(yaml);
    expect(c.auth.admin_token).toBeUndefined();
  });

  it('applies timeout defaults when timeouts block omitted', () => {
    const yaml = validYaml.replace(/timeouts:[\s\S]*?process_kill_grace_ms: 2000\n/, '');
    const c = parseConfig(yaml);
    expect(c.timeouts.request_timeout_ms).toBe(300000);
    expect(c.timeouts.idle_timeout_ms).toBe(60000);
    expect(c.timeouts.probe_timeout_ms).toBe(5000);
    expect(c.timeouts.process_kill_grace_ms).toBe(2000);
  });

  it('throws when ask_token is missing', () => {
    const yaml = validYaml.replace('  ask_token: "ask-secret"\n', '');
    expect(() => parseConfig(yaml)).toThrow();
  });

  it('throws when modes.ask block missing', () => {
    const yaml = validYaml.replace(/  ask:[\s\S]*?mcp_config_file: ".\/ask-mcp.json"\n/, '');
    expect(() => parseConfig(yaml)).toThrow();
  });
});

describe('loadConfig', () => {
  it('reads config from a file path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proxai-test-'));
    const p = path.join(tmp, 'proxai.config.yaml');
    fs.writeFileSync(p, validYaml);
    const c = loadConfig(p);
    expect(c.auth.ask_token).toBe('ask-secret');
    fs.rmSync(tmp, { recursive: true });
  });
});

const validYamlWithModels = `
server:
  port: 3077
  host: "127.0.0.1"
auth:
  ask_token: "ask-secret"
  agent_token: "agent-secret"
modes:
  ask:
    system_prompt: "x"
    allowed_tools: ["WebSearch"]
    mcp_config_file: null
  agent:
    system_prompt: null
    allowed_tools: null
    mcp_config_file: null
providers:
  claude:
    command: "claude"
    model_id: "claude-code"
    default_model: "claude-sonnet"
    models:
      - id: "claude-opus"
        cli_model: "opus"
      - id: "claude-sonnet"
        cli_model: "sonnet"
      - id: "claude-haiku"
        cli_model: "haiku"
  codex:
    command: "codex"
    model_id: "codex-cli"
`;

describe('parseConfig (model selection)', () => {
  it('parses providers.models[] with id + cli_model', () => {
    const c = parseConfig(validYamlWithModels);
    expect(c.providers['claude'].models).toEqual([
      { id: 'claude-opus', cli_model: 'opus' },
      { id: 'claude-sonnet', cli_model: 'sonnet' },
      { id: 'claude-haiku', cli_model: 'haiku' },
    ]);
    expect(c.providers['claude'].default_model).toBe('claude-sonnet');
  });

  it('absent models[] is still valid (back-compat)', () => {
    const c = parseConfig(validYaml);
    expect(c.providers['claude'].models).toBeUndefined();
    expect(c.providers['claude'].default_model).toBeUndefined();
  });

  it('rejects duplicate id across providers', () => {
    const dup = validYamlWithModels.replace('id: "claude-opus"', 'id: "codex-cli"');
    expect(() => parseConfig(dup)).toThrow(/duplicate model id/i);
  });

  it('rejects default_model that does not match any models[i].id', () => {
    const bad = validYamlWithModels.replace('default_model: "claude-sonnet"', 'default_model: "claude-bogus"');
    expect(() => parseConfig(bad)).toThrow(/default_model/i);
  });

  it('rejects default_model when models[] is absent', () => {
    // Start from validYamlWithModels and strip the models: block, leaving default_model in place.
    const noModels = validYamlWithModels.replace(/    models:[\s\S]*?cli_model: "haiku"\n/, '');
    expect(() => parseConfig(noModels)).toThrow(/default_model/i);
  });
});
