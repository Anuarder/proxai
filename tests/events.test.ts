import { describe, it, expect } from 'vitest';
import { ProxaiEventSchema, type ProxaiEvent } from '../src/events/schema.js';

describe('ProxaiEventSchema', () => {
  it('parses a text_delta event', () => {
    const ev = { type: 'text_delta', text: 'hello' };
    expect(ProxaiEventSchema.parse(ev)).toEqual(ev);
  });

  it('parses a tool_use event with arbitrary input', () => {
    const ev = { type: 'tool_use', id: 'tu_1', name: 'Read', input: { path: '/x' } };
    expect(ProxaiEventSchema.parse(ev)).toEqual(ev);
  });

  it('parses a file_edit event', () => {
    const ev = { type: 'file_edit', path: '/a.ts', action: 'edit', summary: 'rename foo->bar' };
    expect(ProxaiEventSchema.parse(ev)).toEqual(ev);
  });

  it('parses a command_exec event with optional exit_code', () => {
    const ev = { type: 'command_exec', command: 'ls', exit_code: 0, output_summary: '3 files' };
    expect(ProxaiEventSchema.parse(ev)).toEqual(ev);
  });

  it('parses an auth_required event', () => {
    const ev = { type: 'auth_required', provider: 'claude', message: 'login', hint: 'claude login' };
    expect(ProxaiEventSchema.parse(ev)).toEqual(ev);
  });

  it('parses an error event', () => {
    const ev = { type: 'error', code: 'idle_timeout', message: '...', retriable: false };
    expect(ProxaiEventSchema.parse(ev)).toEqual(ev);
  });

  it('parses turn_complete and done', () => {
    expect(ProxaiEventSchema.parse({ type: 'turn_complete', reason: 'stop' })).toBeDefined();
    expect(ProxaiEventSchema.parse({ type: 'done' })).toEqual({ type: 'done' });
  });

  it('rejects events with unknown type', () => {
    expect(() => ProxaiEventSchema.parse({ type: 'frobnicate' })).toThrow();
  });
});
