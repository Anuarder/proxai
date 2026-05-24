import type { ChildProcess } from 'node:child_process';

export class ChildRegistry {
  private children = new Set<ChildProcess>();

  get size(): number { return this.children.size; }

  register(child: ChildProcess): void {
    this.children.add(child);
    child.once('exit', () => this.children.delete(child));
  }

  async killAll(graceMs: number): Promise<void> {
    const live = Array.from(this.children);
    for (const c of live) {
      if (!c.killed && c.exitCode === null) c.kill('SIGTERM');
    }
    await Promise.all(
      live.map(
        (c) =>
          new Promise<void>((resolve) => {
            const t = setTimeout(() => {
              if (c.exitCode === null) c.kill('SIGKILL');
            }, graceMs);
            c.once('exit', () => { clearTimeout(t); resolve(); });
            if (c.exitCode !== null) { clearTimeout(t); resolve(); }
          }),
      ),
    );
    this.children.clear();
  }
}

export async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  idleMs: number,
  errorCode: string,
): AsyncGenerator<T> {
  const it = source[Symbol.asyncIterator]();
  while (true) {
    const next = it.next();
    let handle: ReturnType<typeof setTimeout>;
    const timer = new Promise<never>((_, reject) => {
      handle = setTimeout(() => reject(new Error(`${errorCode}: no event for ${idleMs}ms`)), idleMs);
    });
    try {
      const result = (await Promise.race([next, timer])) as IteratorResult<T>;
      if (result.done) return;
      yield result.value;
    } finally {
      clearTimeout(handle!);
    }
  }
}
