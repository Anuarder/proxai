import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { ChildProcess } from 'node:child_process';
import { ClaudeCodeAdapter } from '../../src/providers/claude.js';

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

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClaudeCodeAdapter();
  });

  it('has correct name and modelId', () => {
    expect(adapter.name).toBe('claude');
    expect(adapter.modelId).toBe('claude-code');
  });

  it('streams text chunks from stream-json events', async () => {
    const { spawn } = await import('node:child_process');
    const mockSpawn = vi.mocked(spawn);

    const lines = [
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}}',
      '{"type":"result","session_id":"ses-abc-123","result":"Hello world"}',
    ];
    mockSpawn.mockReturnValue(createMockProcess(lines));

    const result = adapter.send('Say hello', null);
    const chunks: string[] = [];
    for await (const chunk of result.chunks) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hello ', 'world']);

    const cliSessionId = await result.cliSessionId;
    expect(cliSessionId).toBe('ses-abc-123');

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', 'Say hello'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );
  });

  it('adds --resume flag when cliSessionId is provided', async () => {
    const { spawn } = await import('node:child_process');
    const mockSpawn = vi.mocked(spawn);

    const lines = [
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}',
      '{"type":"result","session_id":"ses-abc-123","result":"Hi"}',
    ];
    mockSpawn.mockReturnValue(createMockProcess(lines));

    const result = adapter.send('Follow up', 'ses-abc-123');
    const chunks: string[] = [];
    for await (const chunk of result.chunks) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hi']);

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--resume', 'ses-abc-123', 'Follow up'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );
  });

  it('resolves cliSessionId to null when no result event', async () => {
    const { spawn } = await import('node:child_process');
    const mockSpawn = vi.mocked(spawn);

    const lines = [
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"data"}}}',
      'not a json line',
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
