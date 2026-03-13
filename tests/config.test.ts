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
  bearer_token: "secret-key"

sessions:
  idle_timeout_ms: 300000
  max_concurrent: 10

providers:
  claude:
    command: "claude"
    args: ["--print"]
    model_id: "claude-code"
  codex:
    command: "codex"
    args: []
    model_id: "codex-cli"
`;

describe('parseConfig', () => {
  it('parses valid YAML and returns typed ProxaiConfig', () => {
    const config = parseConfig(validYaml);

    expect(config.server.port).toBe(3077);
    expect(config.server.host).toBe('127.0.0.1');
    expect(config.auth.bearer_token).toBe('secret-key');
    expect(config.sessions.idle_timeout_ms).toBe(300000);
    expect(config.sessions.max_concurrent).toBe(10);
    expect(config.providers['claude'].command).toBe('claude');
    expect(config.providers['claude'].args).toEqual(['--print']);
    expect(config.providers['claude'].model_id).toBe('claude-code');
    expect(config.providers['codex'].command).toBe('codex');
  });

  it('throws on missing required field auth.bearer_token', () => {
    const yaml = `
providers:
  claude:
    command: "claude"
    args: []
    model_id: "claude-code"
`;
    expect(() => parseConfig(yaml)).toThrow();
  });

  it('throws on missing required field providers', () => {
    const yaml = `
auth:
  bearer_token: "secret"
`;
    expect(() => parseConfig(yaml)).toThrow();
  });

  it('applies defaults for optional fields when omitted', () => {
    const yaml = `
auth:
  bearer_token: "secret"

providers:
  claude:
    command: "claude"
    args: []
    model_id: "claude-code"
`;
    const config = parseConfig(yaml);

    expect(config.server.port).toBe(3077);
    expect(config.server.host).toBe('127.0.0.1');
    expect(config.sessions.idle_timeout_ms).toBe(300000);
    expect(config.sessions.max_concurrent).toBe(10);
  });
});

describe('loadConfig', () => {
  it('reads config from a file path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxai-test-'));
    const configPath = path.join(tmpDir, 'proxai.config.yaml');
    fs.writeFileSync(configPath, validYaml);

    const config = loadConfig(configPath);

    expect(config.auth.bearer_token).toBe('secret-key');
    expect(config.providers['claude'].command).toBe('claude');

    fs.rmSync(tmpDir, { recursive: true });
  });
});
