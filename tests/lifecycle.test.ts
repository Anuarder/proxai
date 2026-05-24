import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { ChildRegistry, withIdleTimeout } from '../src/lifecycle/children.js';

describe('ChildRegistry', () => {
  it('registers and unregisters children', async () => {
    const reg = new ChildRegistry();
    const child = spawn('node', ['-e', 'setTimeout(()=>{},50)']);
    reg.register(child);
    expect(reg.size).toBe(1);
    await new Promise<void>((resolve) => child.on('exit', () => setImmediate(resolve)));
    expect(reg.size).toBe(0);
  });

  it('killAll sends SIGTERM then SIGKILL', async () => {
    const reg = new ChildRegistry();
    const child = spawn('node', ['-e', 'setInterval(()=>{},10)']);
    reg.register(child);
    await reg.killAll(50);
    expect(child.killed).toBe(true);
    expect(reg.size).toBe(0);
  });
});

describe('withIdleTimeout', () => {
  it('passes through values when active', async () => {
    async function* src() { yield 1; yield 2; }
    const got: number[] = [];
    for await (const v of withIdleTimeout(src(), 50, 'idle')) got.push(v as number);
    expect(got).toEqual([1, 2]);
  });

  it('throws an idle error when no event arrives within window', async () => {
    async function* src() {
      yield 1;
      await new Promise((r) => setTimeout(r, 100));
      yield 2;
    }
    await expect(async () => {
      const out: number[] = [];
      for await (const v of withIdleTimeout(src(), 20, 'idle_timeout')) out.push(v as number);
    }).rejects.toThrow(/idle_timeout/);
  });
});
