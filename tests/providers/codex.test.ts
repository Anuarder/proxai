import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { ChildProcess } from 'node:child_process';
import { CodexAdapter } from '../../src/providers/codex.js';

function createMockProcess(lines: string[]): ChildProcess {
  const stdout = new Readable({
    read() {
      for (const line of lines) {
        this.push(line + '\n');
      }
      this.push(null);
    },
  });
  return {
    stdout,
    stderr: new Readable({ read() { this.push(null); } }),
    stdin: null,
    pid: 123,
    kill: vi.fn(),
    on: vi.fn(),
  } as unknown as ChildProcess;
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new CodexAdapter();
  });

  it('has correct name and modelId', () => {
    expect(adapter.name).toBe('codex');
    expect(adapter.modelId).toBe('codex-cli');
  });

  it('streams text from item.completed events and captures thread id', async () => {
    const { spawn } = await import('node:child_process');
    const mockSpawn = vi.mocked(spawn);

    const lines = [
      '{"type":"thread.started","thread_id":"codex-thread-456"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Hello from Codex"}}',
    ];
    mockSpawn.mockReturnValue(createMockProcess(lines));

    const result = adapter.send('Say hello', null);
    const chunks: string[] = [];
    for await (const chunk of result.chunks) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hello from Codex']);
    expect(await result.cliSessionId).toBe('codex-thread-456');

    expect(mockSpawn).toHaveBeenCalledWith(
      'codex',
      ['exec', '--json', 'Say hello'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );
  });

  it('ignores cliSessionId param (no --resume support)', async () => {
    const { spawn } = await import('node:child_process');
    const mockSpawn = vi.mocked(spawn);

    const lines = [
      '{"type":"thread.started","thread_id":"codex-thread-789"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"response"}}',
    ];
    mockSpawn.mockReturnValue(createMockProcess(lines));

    const result = adapter.send('Follow up', 'old-session-id');
    const chunks: string[] = [];
    for await (const chunk of result.chunks) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['response']);

    // Should NOT include --resume or old session id
    expect(mockSpawn).toHaveBeenCalledWith(
      'codex',
      ['exec', '--json', 'Follow up'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );
  });

  it('resolves cliSessionId to null when no thread.started event', async () => {
    const { spawn } = await import('node:child_process');
    const mockSpawn = vi.mocked(spawn);

    const lines = [
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"data"}}',
      'not json',
    ];
    mockSpawn.mockReturnValue(createMockProcess(lines));

    const result = adapter.send('Test', null);
    const chunks: string[] = [];
    for await (const chunk of result.chunks) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['data']);
    expect(await result.cliSessionId).toBeNull();
  });

  it('kill is a no-op', async () => {
    await expect(adapter.kill('any-id')).resolves.toBeUndefined();
  });
});
