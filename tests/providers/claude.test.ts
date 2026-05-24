import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapClaudeStream } from '../../src/providers/claude.js';
import type { ProxaiEvent } from '../../src/events/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function collect(gen: AsyncIterable<ProxaiEvent>): Promise<ProxaiEvent[]> {
  const out: ProxaiEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function lines(fixture: string): AsyncIterable<string> {
  const text = fs.readFileSync(path.join(__dirname, '../fixtures/claude', fixture), 'utf-8');
  return (async function* () {
    for (const l of text.split('\n')) if (l.trim()) yield l;
  })();
}

describe('mapClaudeStream', () => {
  it('emits start + text_delta(s) + usage + turn_complete for simple text', async () => {
    const events = await collect(mapClaudeStream(lines('simple-text.jsonl'), { requestId: 'r1', model: 'claude-code', provider: 'claude' }));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('start');
    expect(types.filter((t) => t === 'text_delta')).toHaveLength(2);
    expect(types).toContain('usage');
    expect(types).toContain('turn_complete');
  });

  it('emits tool_use + derived file_edit for Read tool', async () => {
    const events = await collect(mapClaudeStream(lines('with-tool-use.jsonl'), { requestId: 'r2', model: 'claude-code', provider: 'claude' }));
    const tu = events.find((e) => e.type === 'tool_use');
    const fe = events.find((e) => e.type === 'file_edit');
    expect(tu).toBeDefined();
    expect(fe).toBeDefined();
    if (fe && fe.type === 'file_edit') {
      expect(fe.action).toBe('read');
      expect(fe.path).toBe('/a.ts');
    }
    const textDeltas = events.filter((e) => e.type === 'text_delta');
    expect(textDeltas.length).toBeGreaterThan(0);
    const concatText = textDeltas.map((e) => e.type === 'text_delta' ? e.text : '').join('');
    expect(concatText).toContain('done');
  });
});
