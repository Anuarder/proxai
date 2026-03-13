import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ProviderAdapter, SendResult } from './adapter.js';

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly name = 'claude';
  readonly modelId = 'claude-code';

  send(prompt: string, cliSessionId: string | null): SendResult {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];

    if (cliSessionId) {
      args.push('--resume', cliSessionId);
    }

    args.push(prompt);

    const env = { ...process.env };
    delete env.CLAUDECODE;

    const proc = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'], env });

    let resolveSessionId: (id: string | null) => void;
    const sessionIdPromise = new Promise<string | null>((resolve) => {
      resolveSessionId = resolve;
    });

    let sessionIdResolved = false;
    const rl = createInterface({ input: proc.stdout! });

    async function* streamChunks(): AsyncGenerator<string> {
      const queue: string[] = [];
      let done = false;
      let waiting: (() => void) | null = null;

      rl.on('line', (line) => {
        try {
          const parsed = JSON.parse(line);
          if (
            parsed.type === 'stream_event' &&
            parsed.event?.type === 'content_block_delta' &&
            parsed.event?.delta?.type === 'text_delta'
          ) {
            queue.push(parsed.event.delta.text);
            if (waiting) {
              const resume = waiting;
              waiting = null;
              resume();
            }
            return;
          }
          if (parsed.type === 'result' && parsed.session_id) {
            sessionIdResolved = true;
            resolveSessionId(parsed.session_id);
          }
        } catch {
          // non-JSON line, skip
        }
      });

      rl.on('close', () => {
        done = true;
        if (!sessionIdResolved) {
          sessionIdResolved = true;
          resolveSessionId(null);
        }
        if (waiting) {
          const resume = waiting;
          waiting = null;
          resume();
        }
      });

      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        if (done) {
          return;
        }
        await new Promise<void>((resolve) => {
          waiting = resolve;
        });
      }
    }

    return { chunks: streamChunks(), cliSessionId: sessionIdPromise };
  }

  async kill(_sessionId: string): Promise<void> {
    // no-op: print-mode processes exit on their own
  }
}
