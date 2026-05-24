import { spawn } from 'node:child_process';

const REQUIRED_FLAGS: Record<string, string[]> = {
  claude: ['--allowedTools', '--mcp-config', '--append-system-prompt'],
  // Codex flag set is populated once the Codex CLI surface is verified (Task 9).
  codex: [],
};

export async function runStartupSelfTest(): Promise<void> {
  for (const [cmd, flags] of Object.entries(REQUIRED_FLAGS)) {
    if (flags.length === 0) continue;
    const help = await captureHelp(cmd);
    if (help === null) {
      console.warn(`[self-test] could not run \`${cmd} --help\`; skipping flag verification`);
      continue;
    }
    for (const flag of flags) {
      if (!help.includes(flag)) {
        console.warn(`[self-test] WARNING: \`${cmd} --help\` does not mention \`${flag}\`. ask-mode tool restrictions may not apply correctly.`);
      }
    }
  }
}

function captureHelp(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(cmd, ['--help'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let resolved = false;
    const t = setTimeout(() => { if (!resolved) { resolved = true; child.kill('SIGKILL'); resolve(out || null); } }, 3000);
    child.stdout.on('data', (c) => { out += c.toString(); });
    child.stderr.on('data', (c) => { out += c.toString(); });
    child.on('error', () => { if (!resolved) { resolved = true; clearTimeout(t); resolve(null); } });
    child.on('exit', () => { if (!resolved) { resolved = true; clearTimeout(t); resolve(out); } });
  });
}
