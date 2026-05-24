import { spawn } from 'node:child_process';

export interface AuthPatternSet {
  patterns: RegExp[];
  hint: string;
}

export const AUTH_PATTERNS: Record<string, AuthPatternSet> = {
  claude: {
    patterns: [
      /please run \/?login/i,
      /not authenticated/i,
      /authentication required/i,
      /please log in/i,
    ],
    hint: 'Run: claude login',
  },
  codex: {
    patterns: [
      /run:\s*codex login/i,
      /not authenticated/i,
      /authentication required/i,
      /please log in/i,
    ],
    hint: 'Run: codex login',
  },
};

export function detectAuthPattern(
  text: string,
  set: AuthPatternSet,
): { matched: true; hint: string } | { matched: false } {
  for (const p of set.patterns) {
    if (p.test(text)) return { matched: true, hint: set.hint };
  }
  return { matched: false };
}

export async function checkBinary(command: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    const child = spawn(command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; child.kill('SIGKILL'); resolve(false); }
    }, timeoutMs);
    child.on('error', () => {
      if (!resolved) { resolved = true; clearTimeout(timer); resolve(false); }
    });
    child.on('exit', (code) => {
      if (!resolved) { resolved = true; clearTimeout(timer); resolve(code === 0); }
    });
  });
}
