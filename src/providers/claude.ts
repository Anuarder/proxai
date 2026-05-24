import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ProviderAdapter, ProbeResult, SendResult, Message } from './adapter.js';
import type { ModeConfig } from '../modes/resolver.js';
import type { ProxaiEvent } from '../events/schema.js';
import { assemblePrompt } from './prompt.js';
import { AUTH_PATTERNS, detectAuthPattern, checkBinary } from './probe.js';

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit']);
const COMMAND_TOOLS = new Set(['Bash']);

function actionForTool(name: string): 'read' | 'write' | 'edit' {
  if (name === 'Read') return 'read';
  if (name === 'Write') return 'write';
  return 'edit';
}

export interface ClaudeMapMeta {
  requestId: string;
  model: string;
  provider: string;
}

export async function* mapClaudeStream(
  lines: AsyncIterable<string>,
  meta: ClaudeMapMeta,
): AsyncGenerator<ProxaiEvent> {
  let started = false;
  for await (const line of lines) {
    let parsed: any;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (!started) {
      yield { type: 'start', request_id: meta.requestId, model: meta.model, provider: meta.provider };
      started = true;
    }
    if (parsed.type === 'stream_event' && parsed.event?.type === 'content_block_delta') {
      const d = parsed.event.delta;
      if (d?.type === 'text_delta') yield { type: 'text_delta', text: d.text };
      else if (d?.type === 'thinking_delta') yield { type: 'thinking_delta', text: d.text };
      continue;
    }
    if (parsed.type === 'assistant' && Array.isArray(parsed.message?.content)) {
      for (const block of parsed.message.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          yield { type: 'text_delta', text: block.text };
        } else if (block.type === 'tool_use') {
          yield { type: 'tool_use', id: block.id, name: block.name, input: block.input };
          if (FILE_TOOLS.has(block.name)) {
            const p = block.input?.file_path ?? block.input?.path ?? '';
            yield { type: 'file_edit', path: p, action: actionForTool(block.name), summary: `${block.name} ${p}` };
          } else if (COMMAND_TOOLS.has(block.name)) {
            const cmd = block.input?.command ?? '';
            yield { type: 'command_exec', command: cmd, output_summary: '' };
          }
        }
      }
      continue;
    }
    if (parsed.type === 'user' && Array.isArray(parsed.message?.content)) {
      for (const block of parsed.message.content) {
        if (block.type === 'tool_result') {
          const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
          yield { type: 'tool_result', tool_use_id: block.tool_use_id, content, is_error: Boolean(block.is_error) };
        }
      }
      continue;
    }
    if (parsed.type === 'result') {
      if (parsed.usage) {
        const u = parsed.usage;
        yield {
          type: 'usage',
          input_tokens: u.input_tokens ?? 0,
          output_tokens: u.output_tokens ?? 0,
          total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
        };
      }
      yield { type: 'turn_complete', reason: 'stop' };
    }
  }
}

function randomId(): string {
  return 'req_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function buildClaudeArgs(
  prompt: string,
  modeConfig: ModeConfig,
  cliModel: string | null,
): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  if (modeConfig.allowedTools) args.push('--allowedTools', modeConfig.allowedTools.join(','));
  if (modeConfig.mcpConfigFile) args.push('--mcp-config', modeConfig.mcpConfigFile);
  if (modeConfig.systemPrompt) args.push('--append-system-prompt', modeConfig.systemPrompt);
  if (cliModel) args.push('--model', cliModel);
  args.push(prompt);
  return args;
}

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly name = 'claude';
  readonly modelId = 'claude-code';
  constructor(private readonly registry: import('../lifecycle/children.js').ChildRegistry) {}

  send(messages: Message[], modeConfig: ModeConfig, signal: AbortSignal, cliModel: string | null = null): SendResult {
    const prompt = assemblePrompt(messages);
    const args = buildClaudeArgs(prompt, modeConfig, cliModel);

    const env = { ...process.env };
    delete env.CLAUDECODE;
    const proc = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    this.registry.register(proc);

    let stderrTail = '';
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4096);
    });

    signal.addEventListener('abort', () => {
      if (proc.exitCode === null) proc.kill('SIGTERM');
    });

    const rl = createInterface({ input: proc.stdout! });
    async function* stdoutLines(): AsyncGenerator<string> {
      for await (const line of rl) yield line;
    }

    const self = this;
    async function* events(): AsyncGenerator<ProxaiEvent> {
      for await (const ev of mapClaudeStream(stdoutLines(), {
        requestId: randomId(),
        model: self.modelId,
        provider: self.name,
      })) yield ev;

      // Wait for process exit so exitCode is set before we check it.
      if (proc.exitCode === null) {
        await new Promise<void>((resolve) => {
          proc.once('exit', () => resolve());
          proc.once('error', () => resolve());
        });
      }

      const authHit = detectAuthPattern(stderrTail, AUTH_PATTERNS.claude);
      if (authHit.matched) {
        yield { type: 'auth_required', provider: 'claude', message: stderrTail.trim() || 'Authentication required', hint: authHit.hint };
      } else if (proc.exitCode !== 0 && proc.exitCode !== null) {
        yield { type: 'error', code: 'cli_exit', message: `claude exited ${proc.exitCode}`, retriable: false, stderr_tail: stderrTail };
      }
      yield { type: 'done' };
    }

    return { events: events() };
  }

  async probe(timeoutMs: number): Promise<ProbeResult> {
    const ok = await checkBinary('claude', timeoutMs);
    if (!ok) return { status: 'missing_binary' };
    return new Promise<ProbeResult>((resolve) => {
      let resolved = false;
      const child = spawn('claude', ['-p', '--output-format', 'stream-json', '--verbose', 'ping'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.registry.register(child);
      let firstLine = '';
      let stderr = '';
      const timer = setTimeout(() => {
        if (!resolved) { resolved = true; child.kill('SIGKILL'); resolve({ status: 'ready' }); }
      }, timeoutMs);
      const rl = createInterface({ input: child.stdout! });
      rl.once('line', (line) => {
        if (!resolved) {
          firstLine = line;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'system') {
              resolved = true; clearTimeout(timer); child.kill('SIGKILL'); resolve({ status: 'ready' });
              return;
            }
          } catch { /* ignore */ }
        }
      });
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('exit', () => {
        if (resolved) return;
        clearTimeout(timer);
        const authHit = detectAuthPattern(stderr + firstLine, AUTH_PATTERNS.claude);
        if (authHit.matched) { resolved = true; resolve({ status: 'not_authenticated', hint: authHit.hint }); return; }
        resolved = true; resolve({ status: 'error', message: stderr.trim() || 'Unknown probe failure' });
      });
    });
  }
}
