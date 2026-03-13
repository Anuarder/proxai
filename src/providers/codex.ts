import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ProviderAdapter, SendResult } from './adapter.js';

export class CodexAdapter implements ProviderAdapter {
  readonly name = 'codex';
  readonly modelId = 'codex-cli';

  send(prompt: string, _cliSessionId: string | null): SendResult {
    const args = ['exec', '--json', prompt];

    const proc = spawn('codex', args, { stdio: ['ignore', 'pipe', 'pipe'] });

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
          if (parsed.type === 'task_started' && parsed.session_id) {
            sessionIdResolved = true;
            resolveSessionId(parsed.session_id);
            return;
          }
          if (
            parsed.type === 'message' &&
            parsed.role === 'assistant' &&
            Array.isArray(parsed.content)
          ) {
            for (const block of parsed.content) {
              if (block.type === 'output_text' && block.text) {
                queue.push(block.text);
              }
            }
            if (waiting && queue.length > 0) {
              const resume = waiting;
              waiting = null;
              resume();
            }
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
    // no-op: exec processes exit on their own
  }
}
