import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../../src/providers/prompt.js';

describe('assemblePrompt', () => {
  it('handles a single user message', () => {
    const out = assemblePrompt([{ role: 'user', content: 'hi' }]);
    expect(out).toBe('User: hi');
  });

  it('prefixes system messages and labels alternation', () => {
    const out = assemblePrompt([
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);
    expect(out).toBe(
      `System: be concise\n\nUser: q1\n\nAssistant: a1\n\nUser: q2`
    );
  });

  it('joins multiple system messages at the top in order', () => {
    const out = assemblePrompt([
      { role: 'system', content: 's1' },
      { role: 'system', content: 's2' },
      { role: 'user', content: 'u' },
    ]);
    expect(out).toBe('System: s1\n\nSystem: s2\n\nUser: u');
  });

  it('throws on empty array', () => {
    expect(() => assemblePrompt([])).toThrow();
  });
});
