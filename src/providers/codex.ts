import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ProviderAdapter, ProbeResult, SendResult, Message } from './adapter.js';
import type { ModeConfig } from '../modes/resolver.js';
import type { ProxaiEvent } from '../events/schema.js';
import { assemblePrompt } from './prompt.js';
import { AUTH_PATTERNS, detectAuthPattern, checkBinary } from './probe.js';

// NOTE: Codex CLI flag surface discovery (Task 9, Step 1):
// `codex` was NOT found on PATH in this environment, so flag names are unknown.
// The following modeConfig translations are left as documented no-op comments
// with example placeholder intent. They will be activated once the installed
// Codex CLI version is verified via `codex --help`:
//   - systemPrompt  → likely `--instructions <text>` or `--system <text>`
//   - allowedTools  → likely `--sandbox` + a tools-allowlist flag (unknown name)
//   - mcpConfigFile → likely `--mcp-config <path>`

export interface CodexMapMeta { requestId: string; model: string; provider: string; }

export async function* mapCodexStream(
  lines: AsyncIterable<string>,
  meta: CodexMapMeta,
): AsyncGenerator<ProxaiEvent> {
  let started = false;
  for await (const line of lines) {
    let parsed: any;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (!started) {
      yield { type: 'start', request_id: meta.requestId, model: meta.model, provider: meta.provider };
      started = true;
    }
    if (parsed.type === 'thread.started') continue;
    if (parsed.type === 'item.completed' && parsed.item) {
      const item = parsed.item;
      if (item.type === 'agent_message' && typeof item.text === 'string') {
        yield { type: 'text_delta', text: item.text };
      } else if (item.type === 'reasoning' && typeof item.text === 'string') {
        yield { type: 'thinking_delta', text: item.text };
      } else if (item.type === 'command' && typeof item.command === 'string') {
        yield { type: 'tool_use', id: 'cx_' + Date.now(), name: 'shell', input: { command: item.command } };
        yield { type: 'command_exec', command: item.command, exit_code: item.exit_code, output_summary: typeof item.output === 'string' ? item.output.slice(0, 200) : '' };
      } else if (item.type === 'file_change') {
        const action = (item.action === 'read' || item.action === 'write' || item.action === 'edit') ? item.action : 'edit';
        yield { type: 'tool_use', id: 'cx_' + Date.now(), name: 'file_change', input: { path: item.path, action } };
        yield { type: 'file_edit', path: item.path, action, summary: `${action} ${item.path}` };
      }
      continue;
    }
    if (parsed.type === 'turn.completed') {
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

export class CodexAdapter implements ProviderAdapter {
  readonly name = 'codex';
  readonly modelId = 'codex-cli';
  constructor(private readonly registry: import('../lifecycle/children.js').ChildRegistry) {}

  send(messages: Message[], modeConfig: ModeConfig, signal: AbortSignal): SendResult {
    const prompt = assemblePrompt(messages);
    const args: string[] = ['exec', '--json'];
    // NOTE: Codex flag names for systemPrompt / allowedTools / mcpConfigFile require
    // verification against the installed Codex CLI version. Until then the
    // corresponding modeConfig fields are not translated for Codex.
    if (modeConfig.systemPrompt) {
      // Example: args.push('--instructions', modeConfig.systemPrompt);
    }
    if (modeConfig.allowedTools) {
      // Example: args.push('--sandbox', 'read-only'); + a tools allowlist if exposed.
    }
    if (modeConfig.mcpConfigFile) {
      // Example: args.push('--mcp-config', modeConfig.mcpConfigFile);
    }
    args.push(prompt);

    const env = { ...process.env };
    delete env.CLAUDECODE;
    const proc = spawn('codex', args, { stdio: ['ignore', 'pipe', 'pipe'], env });
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
      for await (const ev of mapCodexStream(stdoutLines(), {
        requestId: 'req_' + Math.random().toString(36).slice(2),
        model: self.modelId,
        provider: self.name,
      })) yield ev;

      // Wait for proc exit so exitCode is reliably set before checks
      // (same fix applied in Claude adapter — Task 8).
      if (proc.exitCode === null) {
        await new Promise<void>((resolve) => {
          proc.once('exit', () => resolve());
          proc.once('error', () => resolve());
        });
      }

      const authHit = detectAuthPattern(stderrTail, AUTH_PATTERNS.codex);
      if (authHit.matched) {
        yield { type: 'auth_required', provider: 'codex', message: stderrTail.trim() || 'Authentication required', hint: authHit.hint };
      } else if (proc.exitCode !== 0 && proc.exitCode !== null) {
        yield { type: 'error', code: 'cli_exit', message: `codex exited ${proc.exitCode}`, retriable: false, stderr_tail: stderrTail };
      }
      yield { type: 'done' };
    }

    return { events: events() };
  }

  async probe(timeoutMs: number): Promise<ProbeResult> {
    const ok = await checkBinary('codex', timeoutMs);
    if (!ok) return { status: 'missing_binary' };
    return new Promise<ProbeResult>((resolve) => {
      let resolved = false;
      const child = spawn('codex', ['exec', '--json', 'ping'], { stdio: ['ignore', 'pipe', 'pipe'] });
      this.registry.register(child);
      let stderr = '';
      let firstLine = '';
      const timer = setTimeout(() => {
        if (!resolved) { resolved = true; child.kill('SIGKILL'); resolve({ status: 'ready' }); }
      }, timeoutMs);
      const rl = createInterface({ input: child.stdout! });
      rl.once('line', (line) => {
        if (resolved) return;
        firstLine = line;
        try {
          const p = JSON.parse(line);
          if (p.type === 'thread.started') {
            resolved = true;
            clearTimeout(timer);
            child.kill('SIGKILL');
            resolve({ status: 'ready' });
          }
        } catch { /* ignore */ }
      });
      child.stderr!.on('data', (c) => { stderr += c.toString(); });
      child.on('exit', () => {
        if (resolved) return;
        clearTimeout(timer);
        const auth = detectAuthPattern(stderr + firstLine, AUTH_PATTERNS.codex);
        resolved = true;
        if (auth.matched) resolve({ status: 'not_authenticated', hint: auth.hint });
        else resolve({ status: 'error', message: stderr.trim() || 'Unknown probe failure' });
      });
    });
  }
}
