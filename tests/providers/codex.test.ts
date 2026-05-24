import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapCodexStream } from '../../src/providers/codex.js';
import type { ProxaiEvent } from '../../src/events/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function collect(gen: AsyncIterable<ProxaiEvent>): Promise<ProxaiEvent[]> {
  const out: ProxaiEvent[] = []; for await (const e of gen) out.push(e); return out;
}

function lines(fixture: string): AsyncIterable<string> {
  const text = fs.readFileSync(path.join(__dirname, '../fixtures/codex', fixture), 'utf-8');
  return (async function* () { for (const l of text.split('\n')) if (l.trim()) yield l; })();
}

describe('mapCodexStream', () => {
  it('emits start + text_delta + usage + turn_complete', async () => {
    const ev = await collect(mapCodexStream(lines('simple-text.jsonl'), { requestId: 'r', model: 'codex-cli', provider: 'codex' }));
    const types = ev.map((e) => e.type);
    expect(types[0]).toBe('start');
    expect(types).toContain('text_delta');
    expect(types).toContain('usage');
    expect(types).toContain('turn_complete');
  });

  it('emits thinking_delta + command_exec + file_edit', async () => {
    const ev = await collect(mapCodexStream(lines('with-command.jsonl'), { requestId: 'r', model: 'codex-cli', provider: 'codex' }));
    const types = ev.map((e) => e.type);
    expect(types).toContain('thinking_delta');
    expect(types).toContain('command_exec');
    expect(types).toContain('file_edit');
  });
});
