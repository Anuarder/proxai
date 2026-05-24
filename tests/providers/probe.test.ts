import { describe, it, expect } from 'vitest';
import { detectAuthPattern, AUTH_PATTERNS } from '../../src/providers/probe.js';

describe('detectAuthPattern', () => {
  it('matches Claude login prompt', () => {
    const r = detectAuthPattern('Please run /login to authenticate', AUTH_PATTERNS.claude);
    expect(r).toEqual({ matched: true, hint: 'Run: claude login' });
  });

  it('matches Codex auth prompt', () => {
    const r = detectAuthPattern('Not authenticated. Run: codex login', AUTH_PATTERNS.codex);
    expect(r).toEqual({ matched: true, hint: 'Run: codex login' });
  });

  it('returns matched:false for unrelated text', () => {
    expect(detectAuthPattern('hello world', AUTH_PATTERNS.claude)).toEqual({ matched: false });
  });
});
