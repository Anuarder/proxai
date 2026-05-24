# Proxai v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the v2 redesign of proxai — stateless wire, normalized typed-event SSE protocol, ask/agent modes with per-mode auth, OpenAPI schema, daily-driver UI, and stability hardening — per the design at `docs/superpowers/specs/2026-05-24-proxai-v2-ui-api-hardening-design.md`.

**Architecture:** The server becomes stateless (UI owns conversation history). A `ProxaiEvent` discriminated union flows from CLI subprocess parsers (Claude `stream-json`, Codex `--json`) through a typed-event SSE endpoint to the UI. A mode resolver injects per-mode CLI flags (`--allowedTools`, `--mcp-config`, `--append-system-prompt`), gated by per-mode bearer tokens. SQLite and session management are removed.

**Tech Stack:** Node.js + TypeScript (ESM), Express 5, Zod 4, Vitest, `@asteasolutions/zod-to-openapi`, vanilla JS UI with `marked` + `highlight.js` + `DOMPurify` from CDN.

**UI XSS posture:** All dynamic content reaches the DOM via `textContent` or `DOMPurify.sanitize(...)`. The UI code in this plan never assigns untrusted strings to `innerHTML`.

---

## File Structure (overview)

**Delete:**
- `src/sessions/` (whole directory)
- `src/routes/sessions.ts`
- `tests/manager.test.ts`, `tests/store.test.ts`
- `proxai.db`, `proxai.db-shm`, `proxai.db-wal`

**Add:**
- `src/events/schema.ts` — Zod `ProxaiEvent` discriminated union
- `src/providers/prompt.ts` — `assemblePrompt(messages)`
- `src/providers/probe.ts` — shared probe utilities + auth pattern detection
- `src/lifecycle/children.ts` — child-process registry + timeouts
- `src/lifecycle/self-test.ts` — startup CLI flag verification
- `src/modes/resolver.ts` — `resolveModeConfig(mode, config)`
- `src/routes/stream.ts` — `POST /v1/chat/stream`
- `src/routes/openapi.ts` — generates + serves OpenAPI 3.1
- `public/docs.html` — Swagger UI page
- `ask-mcp.json` — example MCP config for ask mode
- Tests: `tests/events.test.ts`, `tests/modes.test.ts`, `tests/lifecycle.test.ts`, `tests/providers/prompt.test.ts`, `tests/providers/probe.test.ts`, `tests/fixtures/claude/*.jsonl`, `tests/fixtures/codex/*.jsonl`

**Modify:**
- `src/config.ts` — new `auth`/`modes`/`timeouts`, drop `sessions`, drop provider `args`
- `src/middleware/auth.ts` — token → mode scopes + 403 `forbidden_mode`
- `src/providers/adapter.ts` — new interface with `ModeConfig` + `events: AsyncIterable<ProxaiEvent>` + `probe()`
- `src/providers/claude.ts` — full rewrite
- `src/providers/codex.ts` — full rewrite
- `src/providers/router.ts` — wire mode resolver, drop `killSession`
- `src/routes/completions.ts` — downconvert from typed event stream
- `src/routes/models.ts` — call live probes
- `src/server.ts` — register new routes, drop sessions, hook lifecycle
- `src/index.ts` — drop manager/store from shutdown
- `proxai.config.yaml` — new shape (see Task 2)
- `public/index.html` — full UI overhaul (DOM-safe construction throughout)
- `package.json` — drop `better-sqlite3`, add `@asteasolutions/zod-to-openapi`
- `CLAUDE.md` — remove any session/SQLite references
- `docs/tech-task-for-the-future.md` — mark Test UI section as superseded

---

# Phase 1 — Foundation: schemas, config, modes, auth

## Task 1: Event Schema (`ProxaiEvent` Zod union)

**Files:**
- Create: `src/events/schema.ts`
- Test: `tests/events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/events.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/events.test.ts`
Expected: FAIL with `Cannot find module '../src/events/schema.js'`

- [ ] **Step 3: Implement `src/events/schema.ts`**

```ts
import { z } from 'zod';

export const StartEvent = z.object({
  type: z.literal('start'),
  request_id: z.string(),
  model: z.string(),
  provider: z.string(),
});

export const TextDeltaEvent = z.object({
  type: z.literal('text_delta'),
  text: z.string(),
});

export const ThinkingDeltaEvent = z.object({
  type: z.literal('thinking_delta'),
  text: z.string(),
});

export const ToolUseEvent = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

export const ToolResultEvent = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.string(),
  is_error: z.boolean(),
});

export const FileEditEvent = z.object({
  type: z.literal('file_edit'),
  path: z.string(),
  action: z.enum(['read', 'write', 'edit']),
  summary: z.string(),
});

export const CommandExecEvent = z.object({
  type: z.literal('command_exec'),
  command: z.string(),
  exit_code: z.number().int().optional(),
  output_summary: z.string(),
});

export const AuthRequiredEvent = z.object({
  type: z.literal('auth_required'),
  provider: z.string(),
  message: z.string(),
  hint: z.string(),
});

export const ErrorEvent = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  retriable: z.boolean(),
  stderr_tail: z.string().optional(),
});

export const UsageEvent = z.object({
  type: z.literal('usage'),
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  total_tokens: z.number().int(),
  cost_usd: z.number().optional(),
});

export const TurnCompleteEvent = z.object({
  type: z.literal('turn_complete'),
  reason: z.enum(['stop', 'max_tokens', 'aborted', 'error']),
});

export const DoneEvent = z.object({ type: z.literal('done') });

export const ProxaiEventSchema = z.discriminatedUnion('type', [
  StartEvent,
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ToolUseEvent,
  ToolResultEvent,
  FileEditEvent,
  CommandExecEvent,
  AuthRequiredEvent,
  ErrorEvent,
  UsageEvent,
  TurnCompleteEvent,
  DoneEvent,
]);

export type ProxaiEvent = z.infer<typeof ProxaiEventSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/events.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/events/schema.ts tests/events.test.ts
git commit -m "feat(events): add ProxaiEvent zod discriminated union"
```

---

## Task 2: Config Schema v2

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`
- Modify: `proxai.config.yaml`

- [ ] **Step 1: Replace `tests/config.test.ts`**

Overwrite the file with the v2 expected shape:
```ts
import { describe, it, expect } from 'vitest';
import { parseConfig, loadConfig } from '../src/config.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const validYaml = `
server:
  port: 3077
  host: "127.0.0.1"

auth:
  ask_token: "ask-secret"
  agent_token: "agent-secret"
  admin_token: "admin-secret"

timeouts:
  request_timeout_ms: 300000
  idle_timeout_ms: 60000
  probe_timeout_ms: 5000
  process_kill_grace_ms: 2000

modes:
  ask:
    system_prompt: "Chat only."
    allowed_tools: ["WebSearch", "WebFetch", "mcp__context7__*"]
    mcp_config_file: "./ask-mcp.json"
  agent:
    system_prompt: null
    allowed_tools: null
    mcp_config_file: null

providers:
  claude:
    command: "claude"
    model_id: "claude-code"
  codex:
    command: "codex"
    model_id: "codex-cli"
`;

describe('parseConfig (v2)', () => {
  it('parses valid v2 YAML', () => {
    const c = parseConfig(validYaml);
    expect(c.server.port).toBe(3077);
    expect(c.auth.ask_token).toBe('ask-secret');
    expect(c.auth.agent_token).toBe('agent-secret');
    expect(c.auth.admin_token).toBe('admin-secret');
    expect(c.timeouts.request_timeout_ms).toBe(300000);
    expect(c.modes.ask.allowed_tools).toEqual(['WebSearch', 'WebFetch', 'mcp__context7__*']);
    expect(c.modes.agent.allowed_tools).toBeNull();
    expect(c.providers['claude'].model_id).toBe('claude-code');
  });

  it('admin_token is optional', () => {
    const yaml = validYaml.replace('  admin_token: "admin-secret"\n', '');
    const c = parseConfig(yaml);
    expect(c.auth.admin_token).toBeUndefined();
  });

  it('applies timeout defaults when timeouts block omitted', () => {
    const yaml = validYaml.replace(/timeouts:[\s\S]*?process_kill_grace_ms: 2000\n/, '');
    const c = parseConfig(yaml);
    expect(c.timeouts.request_timeout_ms).toBe(300000);
    expect(c.timeouts.idle_timeout_ms).toBe(60000);
    expect(c.timeouts.probe_timeout_ms).toBe(5000);
    expect(c.timeouts.process_kill_grace_ms).toBe(2000);
  });

  it('throws when ask_token is missing', () => {
    const yaml = validYaml.replace('  ask_token: "ask-secret"\n', '');
    expect(() => parseConfig(yaml)).toThrow();
  });

  it('throws when modes.ask block missing', () => {
    const yaml = validYaml.replace(/  ask:[\s\S]*?mcp_config_file: ".\/ask-mcp.json"\n/, '');
    expect(() => parseConfig(yaml)).toThrow();
  });
});

describe('loadConfig', () => {
  it('reads config from a file path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proxai-test-'));
    const p = path.join(tmp, 'proxai.config.yaml');
    fs.writeFileSync(p, validYaml);
    const c = loadConfig(p);
    expect(c.auth.ask_token).toBe('ask-secret');
    fs.rmSync(tmp, { recursive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL (Zod rejects old shape; new fields missing).

- [ ] **Step 3: Rewrite `src/config.ts`**

```ts
import { z } from 'zod';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';

const ProviderSchema = z.object({
  command: z.string(),
  model_id: z.string(),
});

const ModeSchema = z.object({
  system_prompt: z.string().nullable(),
  allowed_tools: z.array(z.string()).nullable(),
  mcp_config_file: z.string().nullable(),
});

const ConfigSchema = z.object({
  server: z
    .object({ port: z.number(), host: z.string() })
    .default({ port: 3077, host: '127.0.0.1' }),
  auth: z.object({
    ask_token: z.string(),
    agent_token: z.string(),
    admin_token: z.string().optional(),
  }),
  timeouts: z
    .object({
      request_timeout_ms: z.number().int().default(300000),
      idle_timeout_ms: z.number().int().default(60000),
      probe_timeout_ms: z.number().int().default(5000),
      process_kill_grace_ms: z.number().int().default(2000),
    })
    .default({
      request_timeout_ms: 300000,
      idle_timeout_ms: 60000,
      probe_timeout_ms: 5000,
      process_kill_grace_ms: 2000,
    }),
  modes: z.object({
    ask: ModeSchema,
    agent: ModeSchema,
  }),
  providers: z.record(z.string(), ProviderSchema),
});

export type ProxaiConfig = z.infer<typeof ConfigSchema>;
export type ModeName = 'ask' | 'agent';

export function parseConfig(yamlString: string): ProxaiConfig {
  const raw = yaml.load(yamlString);
  return ConfigSchema.parse(raw);
}

export function loadConfig(filePath?: string): ProxaiConfig {
  const configPath = filePath ?? path.join(process.cwd(), 'proxai.config.yaml');
  const content = fs.readFileSync(configPath, 'utf-8');
  return parseConfig(content);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `proxai.config.yaml` to match the v2 shape**

```yaml
server:
  port: 3077
  host: "127.0.0.1"

auth:
  ask_token: "change-me-ask"
  agent_token: "change-me-agent"

timeouts:
  request_timeout_ms: 300000
  idle_timeout_ms: 60000
  probe_timeout_ms: 5000
  process_kill_grace_ms: 2000

modes:
  ask:
    system_prompt: "You are a chat assistant. You can use web search and documentation tools but cannot access the user's files or run shell commands."
    allowed_tools:
      - "WebSearch"
      - "WebFetch"
      - "mcp__context7__*"
    mcp_config_file: "./ask-mcp.json"
  agent:
    system_prompt: null
    allowed_tools: null
    mcp_config_file: null

providers:
  claude:
    command: "claude"
    model_id: "claude-code"
  codex:
    command: "codex"
    model_id: "codex-cli"
```

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config.test.ts proxai.config.yaml
git commit -m "feat(config): v2 schema with auth modes, timeouts, modes block"
```

---

## Task 3: Mode resolver

**Files:**
- Create: `src/modes/resolver.ts`
- Test: `tests/modes.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/modes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveModeConfig } from '../src/modes/resolver.js';
import type { ProxaiConfig } from '../src/config.js';

const config: ProxaiConfig = {
  server: { port: 3077, host: '127.0.0.1' },
  auth: { ask_token: 'a', agent_token: 'b' },
  timeouts: { request_timeout_ms: 1, idle_timeout_ms: 1, probe_timeout_ms: 1, process_kill_grace_ms: 1 },
  modes: {
    ask: {
      system_prompt: 'Chat only.',
      allowed_tools: ['WebSearch'],
      mcp_config_file: './ask-mcp.json',
    },
    agent: { system_prompt: null, allowed_tools: null, mcp_config_file: null },
  },
  providers: {},
};

describe('resolveModeConfig', () => {
  it('returns ask-mode values', () => {
    expect(resolveModeConfig('ask', config)).toEqual({
      systemPrompt: 'Chat only.',
      allowedTools: ['WebSearch'],
      mcpConfigFile: './ask-mcp.json',
    });
  });

  it('returns all-null agent-mode values', () => {
    expect(resolveModeConfig('agent', config)).toEqual({
      systemPrompt: null,
      allowedTools: null,
      mcpConfigFile: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/modes/resolver.ts`**

```ts
import type { ModeName, ProxaiConfig } from '../config.js';

export interface ModeConfig {
  systemPrompt: string | null;
  allowedTools: string[] | null;
  mcpConfigFile: string | null;
}

export function resolveModeConfig(mode: ModeName, config: ProxaiConfig): ModeConfig {
  const m = config.modes[mode];
  return {
    systemPrompt: m.system_prompt,
    allowedTools: m.allowed_tools,
    mcpConfigFile: m.mcp_config_file,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modes/resolver.ts tests/modes.test.ts
git commit -m "feat(modes): add resolveModeConfig"
```

---

## Task 4: Auth middleware with mode scopes

**Files:**
- Modify: `src/middleware/auth.ts`
- Modify: `tests/auth.test.ts`

- [ ] **Step 1: Replace `tests/auth.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthMiddleware, requireMode } from '../src/middleware/auth.js';

function app(askToken: string, agentToken: string, adminToken?: string) {
  const a = express();
  a.use(express.json());
  const auth = createAuthMiddleware({ ask_token: askToken, agent_token: agentToken, admin_token: adminToken });
  a.post('/x', auth, requireMode(), (_req, res) => res.json({ ok: true }));
  return a;
}

describe('auth middleware + requireMode', () => {
  it('rejects missing Authorization', async () => {
    const r = await request(app('a', 'b')).post('/x').send({ mode: 'ask' });
    expect(r.status).toBe(401);
  });

  it('rejects unknown bearer', async () => {
    const r = await request(app('a', 'b')).post('/x').set('Authorization', 'Bearer nope').send({ mode: 'ask' });
    expect(r.status).toBe(401);
  });

  it('allows ask token with mode=ask', async () => {
    const r = await request(app('a', 'b')).post('/x').set('Authorization', 'Bearer a').send({ mode: 'ask' });
    expect(r.status).toBe(200);
  });

  it('forbids ask token with mode=agent (403 forbidden_mode)', async () => {
    const r = await request(app('a', 'b')).post('/x').set('Authorization', 'Bearer a').send({ mode: 'agent' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('forbidden_mode');
  });

  it('allows agent token with mode=agent', async () => {
    const r = await request(app('a', 'b')).post('/x').set('Authorization', 'Bearer b').send({ mode: 'agent' });
    expect(r.status).toBe(200);
  });

  it('admin token allows both modes', async () => {
    const ask = await request(app('a', 'b', 'admin')).post('/x').set('Authorization', 'Bearer admin').send({ mode: 'ask' });
    expect(ask.status).toBe(200);
    const ag = await request(app('a', 'b', 'admin')).post('/x').set('Authorization', 'Bearer admin').send({ mode: 'agent' });
    expect(ag.status).toBe(200);
  });

  it('rejects missing/invalid mode field with 400', async () => {
    const r = await request(app('a', 'b')).post('/x').set('Authorization', 'Bearer a').send({});
    expect(r.status).toBe(400);
    const r2 = await request(app('a', 'b')).post('/x').set('Authorization', 'Bearer a').send({ mode: 'plan' });
    expect(r2.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/auth.test.ts`
Expected: FAIL — `requireMode` not exported; signature mismatch.

- [ ] **Step 3: Rewrite `src/middleware/auth.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import type { ModeName } from '../config.js';

export interface AuthConfig {
  ask_token: string;
  agent_token: string;
  admin_token?: string;
}

export interface AuthedRequest extends Request {
  mode?: ModeName;
  allowedModes?: Set<ModeName>;
}

export function createAuthMiddleware(authCfg: AuthConfig) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header) {
      res.status(401).json({ error: { message: 'Missing Authorization header', code: 'unauthenticated' } });
      return;
    }
    const bearer = header.replace(/^Bearer\s+/, '');
    const scopes = new Set<ModeName>();
    if (bearer === authCfg.ask_token) scopes.add('ask');
    if (bearer === authCfg.agent_token) scopes.add('agent');
    if (authCfg.admin_token && bearer === authCfg.admin_token) {
      scopes.add('ask');
      scopes.add('agent');
    }
    if (scopes.size === 0) {
      res.status(401).json({ error: { message: 'Invalid API key', code: 'unauthenticated' } });
      return;
    }
    req.allowedModes = scopes;
    next();
  };
}

export function requireMode() {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const requested = req.body?.mode;
    if (requested !== 'ask' && requested !== 'agent') {
      res.status(400).json({ error: { message: 'Missing or invalid `mode` field; must be "ask" or "agent"', code: 'invalid_mode' } });
      return;
    }
    if (!req.allowedModes?.has(requested)) {
      res.status(403).json({ error: { message: `Token does not permit mode "${requested}"`, code: 'forbidden_mode' } });
      return;
    }
    req.mode = requested;
    next();
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/auth.ts tests/auth.test.ts
git commit -m "feat(auth): per-mode bearer tokens + requireMode middleware"
```

---

# Phase 2 — Stateless adapters

## Task 5: Adapter interface + shared prompt assembly

**Files:**
- Modify: `src/providers/adapter.ts`
- Create: `src/providers/prompt.ts`
- Test: `tests/providers/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/providers/prompt.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/providers/prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/providers/prompt.ts`**

```ts
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function assemblePrompt(messages: Message[]): string {
  if (messages.length === 0) throw new Error('assemblePrompt: empty messages');
  const labels: Record<Message['role'], string> = {
    system: 'System',
    user: 'User',
    assistant: 'Assistant',
  };
  return messages.map((m) => `${labels[m.role]}: ${m.content}`).join('\n\n');
}
```

- [ ] **Step 4: Rewrite `src/providers/adapter.ts`**

```ts
import type { ProxaiEvent } from '../events/schema.js';
import type { ModeConfig } from '../modes/resolver.js';

export type { Message } from './prompt.js';

export interface SendResult {
  events: AsyncIterable<ProxaiEvent>;
}

export type ProbeResult =
  | { status: 'ready' }
  | { status: 'missing_binary' }
  | { status: 'not_authenticated'; hint: string }
  | { status: 'error'; message: string };

export interface ProviderAdapter {
  readonly name: string;
  readonly modelId: string;
  send(messages: import('./prompt.js').Message[], modeConfig: ModeConfig, signal: AbortSignal): SendResult;
  probe(timeoutMs: number): Promise<ProbeResult>;
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/providers/prompt.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/adapter.ts src/providers/prompt.ts tests/providers/prompt.test.ts
git commit -m "feat(providers): new adapter interface with ModeConfig + prompt assembler"
```

---

## Task 6: Child-process registry + timeouts

**Files:**
- Create: `src/lifecycle/children.ts`
- Test: `tests/lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lifecycle.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/lifecycle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lifecycle/children.ts`**

```ts
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
    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${errorCode}: no event for ${idleMs}ms`)), idleMs),
    );
    const result = (await Promise.race([next, timer])) as IteratorResult<T>;
    if (result.done) return;
    yield result.value;
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lifecycle/children.ts tests/lifecycle.test.ts
git commit -m "feat(lifecycle): child-process registry + idle-timeout iterator"
```

---

## Task 7: Shared probe + auth-pattern detection

**Files:**
- Create: `src/providers/probe.ts`
- Test: `tests/providers/probe.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/providers/probe.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/providers/probe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/providers/probe.ts`**

```ts
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
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/providers/probe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/probe.ts tests/providers/probe.test.ts
git commit -m "feat(providers): shared auth-pattern detection + checkBinary"
```

---

## Task 8: Claude adapter — fixture + parser + event mapping

**Files:**
- Modify: `src/providers/claude.ts`
- Create: `tests/fixtures/claude/simple-text.jsonl`
- Create: `tests/fixtures/claude/with-tool-use.jsonl`
- Create: `tests/providers/claude.test.ts`

- [ ] **Step 1: Record fixtures**

Create `tests/fixtures/claude/simple-text.jsonl`:
```
{"type":"system","subtype":"init","session_id":"abc"}
{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}}
{"type":"stream_event","event":{"type":"content_block_stop","index":0}}
{"type":"result","session_id":"abc","usage":{"input_tokens":10,"output_tokens":2}}
```

Create `tests/fixtures/claude/with-tool-use.jsonl`:
```
{"type":"system","subtype":"init","session_id":"def"}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_1","name":"Read","input":{"file_path":"/a.ts"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_1","content":"file contents","is_error":false}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"done"}]}}
{"type":"result","session_id":"def","usage":{"input_tokens":20,"output_tokens":5}}
```

- [ ] **Step 2: Write the failing test**

Create `tests/providers/claude.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mapClaudeStream } from '../../src/providers/claude.js';
import type { ProxaiEvent } from '../../src/events/schema.js';

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
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/providers/claude.test.ts`
Expected: FAIL — `mapClaudeStream` not exported.

- [ ] **Step 4: Rewrite `src/providers/claude.ts`**

```ts
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ProviderAdapter, ProbeResult, SendResult, Message } from './adapter.js';
import type { ModeConfig } from '../modes/resolver.js';
import type { ProxaiEvent } from '../events/schema.js';
import { assemblePrompt } from './prompt.js';
import { AUTH_PATTERNS, detectAuthPattern, checkBinary } from './probe.js';

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit']);
const COMMAND_TOOLS = new Set(['Bash']);

function actionForTool(name: string): 'read' | 'write' | 'edit' {
  if (name === 'Read') return 'read';
  if (name === 'Write') return 'write';
  return 'edit';
}

export interface ClaudeMapMeta {
  requestId: string;
  model: string;
  provider: string;
}

export async function* mapClaudeStream(
  lines: AsyncIterable<string>,
  meta: ClaudeMapMeta,
): AsyncGenerator<ProxaiEvent> {
  let started = false;
  for await (const line of lines) {
    let parsed: any;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (!started) {
      yield { type: 'start', request_id: meta.requestId, model: meta.model, provider: meta.provider };
      started = true;
    }
    if (parsed.type === 'stream_event' && parsed.event?.type === 'content_block_delta') {
      const d = parsed.event.delta;
      if (d?.type === 'text_delta') yield { type: 'text_delta', text: d.text };
      else if (d?.type === 'thinking_delta') yield { type: 'thinking_delta', text: d.text };
      continue;
    }
    if (parsed.type === 'assistant' && Array.isArray(parsed.message?.content)) {
      for (const block of parsed.message.content) {
        if (block.type === 'tool_use') {
          yield { type: 'tool_use', id: block.id, name: block.name, input: block.input };
          if (FILE_TOOLS.has(block.name)) {
            const p = block.input?.file_path ?? block.input?.path ?? '';
            yield { type: 'file_edit', path: p, action: actionForTool(block.name), summary: `${block.name} ${p}` };
          } else if (COMMAND_TOOLS.has(block.name)) {
            const cmd = block.input?.command ?? '';
            yield { type: 'command_exec', command: cmd, output_summary: '' };
          }
        }
      }
      continue;
    }
    if (parsed.type === 'user' && Array.isArray(parsed.message?.content)) {
      for (const block of parsed.message.content) {
        if (block.type === 'tool_result') {
          const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
          yield { type: 'tool_result', tool_use_id: block.tool_use_id, content, is_error: Boolean(block.is_error) };
        }
      }
      continue;
    }
    if (parsed.type === 'result') {
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

function randomId(): string {
  return 'req_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly name = 'claude';
  readonly modelId = 'claude-code';
  constructor(private readonly registry: import('../lifecycle/children.js').ChildRegistry) {}

  send(messages: Message[], modeConfig: ModeConfig, signal: AbortSignal): SendResult {
    const prompt = assemblePrompt(messages);
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
    if (modeConfig.allowedTools) args.push('--allowedTools', modeConfig.allowedTools.join(','));
    if (modeConfig.mcpConfigFile) args.push('--mcp-config', modeConfig.mcpConfigFile);
    if (modeConfig.systemPrompt) args.push('--append-system-prompt', modeConfig.systemPrompt);
    args.push(prompt);

    const env = { ...process.env };
    delete env.CLAUDECODE;
    const proc = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'], env });
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
      for await (const ev of mapClaudeStream(stdoutLines(), {
        requestId: randomId(),
        model: self.modelId,
        provider: self.name,
      })) yield ev;
      const authHit = detectAuthPattern(stderrTail, AUTH_PATTERNS.claude);
      if (authHit.matched) {
        yield { type: 'auth_required', provider: 'claude', message: stderrTail.trim() || 'Authentication required', hint: authHit.hint };
      } else if (proc.exitCode !== 0 && proc.exitCode !== null) {
        yield { type: 'error', code: 'cli_exit', message: `claude exited ${proc.exitCode}`, retriable: false, stderr_tail: stderrTail };
      }
      yield { type: 'done' };
    }

    return { events: events() };
  }

  async probe(timeoutMs: number): Promise<ProbeResult> {
    const ok = await checkBinary('claude', timeoutMs);
    if (!ok) return { status: 'missing_binary' };
    return new Promise<ProbeResult>((resolve) => {
      let resolved = false;
      const child = spawn('claude', ['-p', '--output-format', 'stream-json', '--verbose', 'ping'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.registry.register(child);
      let firstLine = '';
      let stderr = '';
      const timer = setTimeout(() => {
        if (!resolved) { resolved = true; child.kill('SIGKILL'); resolve({ status: 'ready' }); }
      }, timeoutMs);
      const rl = createInterface({ input: child.stdout! });
      rl.once('line', (line) => {
        if (!resolved) {
          firstLine = line;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'system') {
              resolved = true; clearTimeout(timer); child.kill('SIGKILL'); resolve({ status: 'ready' });
              return;
            }
          } catch { /* ignore */ }
        }
      });
      child.stderr!.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('exit', () => {
        if (resolved) return;
        clearTimeout(timer);
        const authHit = detectAuthPattern(stderr + firstLine, AUTH_PATTERNS.claude);
        if (authHit.matched) { resolved = true; resolve({ status: 'not_authenticated', hint: authHit.hint }); return; }
        resolved = true; resolve({ status: 'error', message: stderr.trim() || 'Unknown probe failure' });
      });
    });
  }
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/providers/claude.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/claude.ts tests/providers/claude.test.ts tests/fixtures/claude/
git commit -m "feat(providers): Claude adapter v2 with event mapping + probe + mode flags"
```

---

## Task 9: Codex adapter — fixture + parser + event mapping + flag discovery

**Files:**
- Modify: `src/providers/codex.ts`
- Create: `tests/fixtures/codex/simple-text.jsonl`
- Create: `tests/fixtures/codex/with-command.jsonl`
- Create: `tests/providers/codex.test.ts`

- [ ] **Step 1: Verify Codex CLI flag surface**

Run: `codex --help 2>&1 | head -80`

Inspect for the actual flag names that correspond to:
- allowed tools whitelist (likely `--sandbox` + an allowlist mechanism)
- MCP config file (e.g. `--mcp-config`)
- system prompt (e.g. `--instructions` or `--system`)

Record the chosen flags in a comment at the top of `src/providers/codex.ts`. If a flag isn't supported, leave the corresponding `modeConfig` field unused for Codex and document the gap (the spec already calls this out).

- [ ] **Step 2: Record fixtures**

`tests/fixtures/codex/simple-text.jsonl`:
```
{"type":"thread.started","thread_id":"thr_1"}
{"type":"item.completed","item":{"type":"agent_message","text":"hello world"}}
{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}
```

`tests/fixtures/codex/with-command.jsonl`:
```
{"type":"thread.started","thread_id":"thr_2"}
{"type":"item.completed","item":{"type":"reasoning","text":"I should list files"}}
{"type":"item.completed","item":{"type":"command","command":"ls","output":"a.ts\nb.ts","exit_code":0}}
{"type":"item.completed","item":{"type":"file_change","path":"/a.ts","action":"edit"}}
{"type":"item.completed","item":{"type":"agent_message","text":"done"}}
{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":3}}
```

- [ ] **Step 3: Write the failing test**

Create `tests/providers/codex.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mapCodexStream } from '../../src/providers/codex.js';
import type { ProxaiEvent } from '../../src/events/schema.js';

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
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/providers/codex.test.ts`
Expected: FAIL — `mapCodexStream` not exported.

- [ ] **Step 5: Rewrite `src/providers/codex.ts`**

```ts
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ProviderAdapter, ProbeResult, SendResult, Message } from './adapter.js';
import type { ModeConfig } from '../modes/resolver.js';
import type { ProxaiEvent } from '../events/schema.js';
import { assemblePrompt } from './prompt.js';
import { AUTH_PATTERNS, detectAuthPattern, checkBinary } from './probe.js';

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
    // NOTE: Codex flag names for allowed tools / mcp config / system prompt are verified at
    // implementation time per Task 9 Step 1. Wire the discovered flags below.
    if (modeConfig.systemPrompt) {
      // Example: args.push('--instructions', modeConfig.systemPrompt);
    }
    if (modeConfig.allowedTools) {
      // Example: args.push('--sandbox', 'read-only'); plus tool whitelist if exposed.
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
      const timer = setTimeout(() => { if (!resolved) { resolved = true; child.kill('SIGKILL'); resolve({ status: 'ready' }); } }, timeoutMs);
      const rl = createInterface({ input: child.stdout! });
      rl.once('line', (line) => {
        if (resolved) return;
        firstLine = line;
        try {
          const p = JSON.parse(line);
          if (p.type === 'thread.started') { resolved = true; clearTimeout(timer); child.kill('SIGKILL'); resolve({ status: 'ready' }); }
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
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run tests/providers/codex.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/providers/codex.ts tests/providers/codex.test.ts tests/fixtures/codex/
git commit -m "feat(providers): Codex adapter v2 with event mapping + probe"
```

---

## Task 10: Provider router — drop killSession, expose probe

**Files:**
- Modify: `src/providers/router.ts`

- [ ] **Step 1: Rewrite `src/providers/router.ts`**

```ts
import type { ProxaiConfig } from '../config.js';
import type { ProviderAdapter, ProbeResult } from './adapter.js';
import { ClaudeCodeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';

import type { ChildRegistry } from '../lifecycle/children.js';

type AdapterFactory = new (registry: ChildRegistry) => ProviderAdapter;

const adapterFactories: Record<string, AdapterFactory> = {
  claude: ClaudeCodeAdapter,
  codex: CodexAdapter,
};

export interface ProbedModel {
  id: string;
  providerName: string;
  result: ProbeResult;
}

export class ProviderRouter {
  private adapters = new Map<string, ProviderAdapter>();

  constructor(config: ProxaiConfig, registry: ChildRegistry) {
    for (const [name, provider] of Object.entries(config.providers)) {
      const Factory = adapterFactories[name];
      if (!Factory) {
        console.warn(`Unknown provider "${name}", skipping`);
        continue;
      }
      this.adapters.set(provider.model_id, new Factory(registry));
    }
  }

  getAdapter(modelId: string): ProviderAdapter | undefined {
    return this.adapters.get(modelId);
  }

  listAdapters(): { id: string; adapter: ProviderAdapter }[] {
    return Array.from(this.adapters.entries()).map(([id, adapter]) => ({ id, adapter }));
  }

  async probeAll(timeoutMs: number): Promise<ProbedModel[]> {
    const entries = Array.from(this.adapters.entries());
    const results = await Promise.all(
      entries.map(async ([id, adapter]) => ({
        id,
        providerName: adapter.name,
        result: await adapter.probe(timeoutMs),
      })),
    );
    return results;
  }
}
```

- [ ] **Step 2: Type-check the project**

Run: `npx tsc --noEmit`
Expected: errors only in files we haven't touched yet (`completions.ts`, `models.ts`, `sessions.ts`, `server.ts`). Note them for the upcoming tasks.

- [ ] **Step 3: Commit**

```bash
git add src/providers/router.ts
git commit -m "feat(router): expose probeAll, drop killSession"
```

---

# Phase 3 — Routes

## Task 11: `/v1/chat/stream` route

**Files:**
- Create: `src/routes/stream.ts`
- Create: `tests/routes/stream.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/routes/stream.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createStreamRoute } from '../../src/routes/stream.js';
import type { ProviderAdapter } from '../../src/providers/adapter.js';
import type { ProxaiEvent } from '../../src/events/schema.js';

class FakeAdapter implements ProviderAdapter {
  readonly name = 'claude';
  readonly modelId = 'claude-code';
  send() {
    const evs: ProxaiEvent[] = [
      { type: 'start', request_id: 'r', model: 'claude-code', provider: 'claude' },
      { type: 'text_delta', text: 'hi' },
      { type: 'turn_complete', reason: 'stop' },
      { type: 'done' },
    ];
    return { events: (async function* () { for (const e of evs) yield e; })() };
  }
  async probe() { return { status: 'ready' as const }; }
}

describe('POST /v1/chat/stream', () => {
  it('streams typed SSE events', async () => {
    const app = express();
    app.use(express.json());
    const fake = new FakeAdapter();
    const route = createStreamRoute({
      getAdapter: () => fake,
      resolveModeConfig: () => ({ systemPrompt: null, allowedTools: null, mcpConfigFile: null }),
      timeouts: { request_timeout_ms: 5000, idle_timeout_ms: 5000, probe_timeout_ms: 1000, process_kill_grace_ms: 100 },
    });
    app.post('/v1/chat/stream', (req, _res, next) => { (req as any).mode = 'agent'; next(); }, route);

    const res = await request(app)
      .post('/v1/chat/stream')
      .send({ model: 'claude-code', mode: 'agent', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('event: start');
    expect(res.text).toContain('event: text_delta');
    expect(res.text).toContain('event: turn_complete');
    expect(res.text).toContain('event: done');
  });

  it('returns 400 on unknown model', async () => {
    const app = express();
    app.use(express.json());
    const route = createStreamRoute({
      getAdapter: () => undefined,
      resolveModeConfig: () => ({ systemPrompt: null, allowedTools: null, mcpConfigFile: null }),
      timeouts: { request_timeout_ms: 5000, idle_timeout_ms: 5000, probe_timeout_ms: 1000, process_kill_grace_ms: 100 },
    });
    app.post('/v1/chat/stream', (req, _res, next) => { (req as any).mode = 'agent'; next(); }, route);

    const res = await request(app)
      .post('/v1/chat/stream')
      .send({ model: 'unknown', mode: 'agent', messages: [{ role: 'user', content: 'x' }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('unknown_model');
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/routes/stream.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/routes/stream.ts`**

```ts
import type { Response } from 'express';
import type { AuthedRequest } from '../middleware/auth.js';
import type { ProviderAdapter } from '../providers/adapter.js';
import type { ModeConfig } from '../modes/resolver.js';
import type { ProxaiEvent } from '../events/schema.js';
import type { ModeName } from '../config.js';
import { withIdleTimeout } from '../lifecycle/children.js';

export interface StreamRouteDeps {
  getAdapter: (modelId: string) => ProviderAdapter | undefined;
  resolveModeConfig: (mode: ModeName) => ModeConfig;
  timeouts: {
    request_timeout_ms: number;
    idle_timeout_ms: number;
    probe_timeout_ms: number;
    process_kill_grace_ms: number;
  };
}

export function createStreamRoute(deps: StreamRouteDeps) {
  return async (req: AuthedRequest, res: Response): Promise<void> => {
    const { model, messages } = req.body ?? {};
    const mode = req.mode!;

    if (!model || typeof model !== 'string') {
      res.status(400).json({ error: { code: 'invalid_model', message: 'Missing or invalid `model`' } });
      return;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: { code: 'invalid_messages', message: 'Missing or empty `messages`' } });
      return;
    }
    const adapter = deps.getAdapter(model);
    if (!adapter) {
      res.status(400).json({ error: { code: 'unknown_model', message: `Unknown model: ${model}` } });
      return;
    }

    const abort = new AbortController();
    const requestTimeout = setTimeout(() => abort.abort(), deps.timeouts.request_timeout_ms);
    req.on('close', () => abort.abort());

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);

    const modeConfig = deps.resolveModeConfig(mode);
    const result = adapter.send(messages, modeConfig, abort.signal);

    try {
      for await (const ev of withIdleTimeout<ProxaiEvent>(result.events, deps.timeouts.idle_timeout_ms, 'idle_timeout')) {
        res.write(`event: ${ev.type}\n`);
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
        if (ev.type === 'done') break;
      }
    } catch (err: any) {
      const code = /idle_timeout/.test(err?.message || '') ? 'idle_timeout' : 'stream_error';
      const errEv: ProxaiEvent = { type: 'error', code, message: err?.message || 'Stream error', retriable: false };
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify(errEv)}\n\n`);
      res.write(`event: done\n`);
      res.write(`data: {}\n\n`);
      abort.abort();
    } finally {
      clearTimeout(requestTimeout);
      clearInterval(heartbeat);
      res.end();
    }
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/routes/stream.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/stream.ts tests/routes/stream.test.ts
git commit -m "feat(routes): /v1/chat/stream with typed SSE + timeouts"
```

---

## Task 12: `/v1/chat/completions` — downconvert from typed events

**Files:**
- Modify: `src/routes/completions.ts`
- Modify: `tests/routes/completions.test.ts` (overwrite or create)

- [ ] **Step 1: Replace `tests/routes/completions.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCompletionsRoute } from '../../src/routes/completions.js';
import type { ProviderAdapter } from '../../src/providers/adapter.js';
import type { ProxaiEvent } from '../../src/events/schema.js';

class FakeAdapter implements ProviderAdapter {
  readonly name = 'claude';
  readonly modelId = 'claude-code';
  send() {
    const evs: ProxaiEvent[] = [
      { type: 'start', request_id: 'r', model: 'claude-code', provider: 'claude' },
      { type: 'thinking_delta', text: 'planning' },
      { type: 'text_delta', text: 'hello ' },
      { type: 'text_delta', text: 'world' },
      { type: 'turn_complete', reason: 'stop' },
      { type: 'done' },
    ];
    return { events: (async function* () { for (const e of evs) yield e; })() };
  }
  async probe() { return { status: 'ready' as const }; }
}

describe('POST /v1/chat/completions (OpenAI-compat)', () => {
  it('non-streaming returns concatenated text', async () => {
    const app = express();
    app.use(express.json());
    const route = createCompletionsRoute({
      getAdapter: () => new FakeAdapter(),
      resolveModeConfig: () => ({ systemPrompt: null, allowedTools: null, mcpConfigFile: null }),
      timeouts: { request_timeout_ms: 5000, idle_timeout_ms: 5000, probe_timeout_ms: 1000, process_kill_grace_ms: 100 },
    });
    app.post('/v1/chat/completions', (req, _res, next) => { (req as any).mode = 'agent'; next(); }, route);

    const res = await request(app).post('/v1/chat/completions').send({
      model: 'claude-code', mode: 'agent', messages: [{ role: 'user', content: 'hi' }], stream: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.choices[0].message.content).toBe('hello world');
  });

  it('streaming emits OpenAI-style delta chunks', async () => {
    const app = express();
    app.use(express.json());
    const route = createCompletionsRoute({
      getAdapter: () => new FakeAdapter(),
      resolveModeConfig: () => ({ systemPrompt: null, allowedTools: null, mcpConfigFile: null }),
      timeouts: { request_timeout_ms: 5000, idle_timeout_ms: 5000, probe_timeout_ms: 1000, process_kill_grace_ms: 100 },
    });
    app.post('/v1/chat/completions', (req, _res, next) => { (req as any).mode = 'agent'; next(); }, route);

    const res = await request(app).post('/v1/chat/completions').send({
      model: 'claude-code', mode: 'agent', messages: [{ role: 'user', content: 'hi' }], stream: true,
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('"content":"hello "');
    expect(res.text).toContain('"content":"world"');
    expect(res.text).toContain('[DONE]');
  });
});
```

- [ ] **Step 2: Rewrite `src/routes/completions.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { AuthedRequest } from '../middleware/auth.js';
import type { ProviderAdapter } from '../providers/adapter.js';
import type { ModeConfig } from '../modes/resolver.js';
import type { ProxaiEvent } from '../events/schema.js';
import type { ModeName } from '../config.js';
import { withIdleTimeout } from '../lifecycle/children.js';

export interface CompletionsRouteDeps {
  getAdapter: (modelId: string) => ProviderAdapter | undefined;
  resolveModeConfig: (mode: ModeName) => ModeConfig;
  timeouts: {
    request_timeout_ms: number;
    idle_timeout_ms: number;
    probe_timeout_ms: number;
    process_kill_grace_ms: number;
  };
}

export function createCompletionsRoute(deps: CompletionsRouteDeps) {
  return async (req: AuthedRequest, res: Response): Promise<void> => {
    const { model, messages, stream } = req.body ?? {};
    const mode = req.mode!;

    if (!model || typeof model !== 'string') {
      res.status(400).json({ error: { code: 'invalid_model', message: 'Missing or invalid `model`' } });
      return;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: { code: 'invalid_messages', message: 'Missing or empty `messages`' } });
      return;
    }
    const adapter = deps.getAdapter(model);
    if (!adapter) {
      res.status(400).json({ error: { code: 'unknown_model', message: `Unknown model: ${model}` } });
      return;
    }

    const abort = new AbortController();
    const requestTimeout = setTimeout(() => abort.abort(), deps.timeouts.request_timeout_ms);
    req.on('close', () => abort.abort());
    const result = adapter.send(messages, deps.resolveModeConfig(mode), abort.signal);

    const id = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      try {
        for await (const ev of withIdleTimeout<ProxaiEvent>(result.events, deps.timeouts.idle_timeout_ms, 'idle_timeout')) {
          if (ev.type === 'text_delta') {
            const chunk = {
              id, object: 'chat.completion.chunk', created, model,
              choices: [{ index: 0, delta: { content: ev.text }, finish_reason: null }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          } else if (ev.type === 'auth_required' || ev.type === 'error') {
            const errChunk = { error: { message: ev.type === 'auth_required' ? `${ev.message} (${ev.hint})` : ev.message } };
            res.write(`data: ${JSON.stringify(errChunk)}\n\n`);
            break;
          } else if (ev.type === 'turn_complete') {
            const final = {
              id, object: 'chat.completion.chunk', created, model,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            };
            res.write(`data: ${JSON.stringify(final)}\n\n`);
          }
          if (ev.type === 'done') break;
        }
        res.write('data: [DONE]\n\n');
      } finally {
        clearTimeout(requestTimeout);
        res.end();
      }
      return;
    }

    let text = '';
    try {
      for await (const ev of withIdleTimeout<ProxaiEvent>(result.events, deps.timeouts.idle_timeout_ms, 'idle_timeout')) {
        if (ev.type === 'text_delta') text += ev.text;
        if (ev.type === 'auth_required' || ev.type === 'error') {
          res.status(502).json({ error: { message: ev.type === 'auth_required' ? `${ev.message} (${ev.hint})` : ev.message } });
          return;
        }
      }
    } finally {
      clearTimeout(requestTimeout);
    }

    res.json({
      id, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    });
  };
}
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/routes/completions.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/completions.ts tests/routes/completions.test.ts
git commit -m "feat(routes): /v1/chat/completions downconverts from typed events"
```

---

## Task 13: `/v1/models` with live probes

**Files:**
- Modify: `src/routes/models.ts`
- Create or modify: `tests/routes/models.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/routes/models.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createModelsRoute } from '../../src/routes/models.js';

describe('GET /v1/models', () => {
  it('returns live probe results', async () => {
    const app = express();
    const route = createModelsRoute({
      probeAll: async () => [
        { id: 'claude-code', providerName: 'claude', result: { status: 'ready' } },
        { id: 'codex-cli', providerName: 'codex', result: { status: 'not_authenticated', hint: 'Run: codex login' } },
      ],
    });
    app.get('/v1/models', route);

    const res = await request(app).get('/v1/models');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: 'claude-code', object: 'model', owned_by: 'proxai:claude', status: 'ready' },
      { id: 'codex-cli', object: 'model', owned_by: 'proxai:codex', status: 'not_authenticated', hint: 'Run: codex login' },
    ]);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/routes/models.test.ts`
Expected: FAIL — signature mismatch.

- [ ] **Step 3: Rewrite `src/routes/models.ts`**

```ts
import type { Request, Response } from 'express';
import type { ProbedModel } from '../providers/router.js';

export interface ModelsRouteDeps {
  probeAll: () => Promise<ProbedModel[]>;
}

export function createModelsRoute(deps: ModelsRouteDeps) {
  return async (_req: Request, res: Response): Promise<void> => {
    const probed = await deps.probeAll();
    const data = probed.map(({ id, providerName, result }) => {
      const base = { id, object: 'model' as const, owned_by: `proxai:${providerName}` };
      if (result.status === 'ready') return { ...base, status: 'ready' };
      if (result.status === 'not_authenticated') return { ...base, status: 'not_authenticated', hint: result.hint };
      if (result.status === 'missing_binary') return { ...base, status: 'missing_binary' };
      return { ...base, status: 'error', message: result.message };
    });
    res.json({ object: 'list', data });
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/routes/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/models.ts tests/routes/models.test.ts
git commit -m "feat(routes): /v1/models calls live probes"
```

---

# Phase 4 — Cleanup + server wire-up

## Task 14: Delete sessions module, drop better-sqlite3, ship ask-mcp.json

**Files:**
- Delete: `src/sessions/manager.ts`, `src/sessions/store.ts`, `src/routes/sessions.ts`, `tests/manager.test.ts`, `tests/store.test.ts`, `proxai.db`, `proxai.db-shm`, `proxai.db-wal`
- Modify: `package.json`
- Create: `ask-mcp.json`

- [ ] **Step 1: Delete the sessions code and DB artefacts**

```bash
git rm -r src/sessions src/routes/sessions.ts tests/manager.test.ts tests/store.test.ts
rm -f proxai.db proxai.db-shm proxai.db-wal
```

- [ ] **Step 2: Remove `better-sqlite3` from `package.json`**

Edit `package.json`:
```diff
   "dependencies": {
-    "better-sqlite3": "12.6.2",
     "express": "5.2.1",
     "js-yaml": "4.1.1",
     "uuid": "13.0.0",
     "zod": "4.3.6"
   },
   "devDependencies": {
-    "@types/better-sqlite3": "7.6.13",
     "@types/express": "5.0.6",
```

Then run: `npm install`.

- [ ] **Step 3: Create `ask-mcp.json`**

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

(If you want additional safe MCPs later, edit this file; the system prompt lets the model know the tool space.)

- [ ] **Step 4: Commit**

```bash
git add -A package.json package-lock.json ask-mcp.json
git commit -m "chore: remove sessions/SQLite, ship ask-mcp.json example"
```

---

## Task 15: Server wire-up

**Files:**
- Modify: `src/server.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Rewrite `src/server.ts`**

```ts
import express from 'express';
import path from 'node:path';
import { ProxaiConfig } from './config.js';
import { ProviderRouter } from './providers/router.js';
import { ChildRegistry } from './lifecycle/children.js';
import { resolveModeConfig } from './modes/resolver.js';
import { createAuthMiddleware, requireMode } from './middleware/auth.js';
import { createModelsRoute } from './routes/models.js';
import { createCompletionsRoute } from './routes/completions.js';
import { createStreamRoute } from './routes/stream.js';

export function createServer(config: ProxaiConfig) {
  const children = new ChildRegistry();
  const router = new ProviderRouter(config, children);
  // Note: the spec mentions a 30s "reaper" as a safety net. v2 omits it because every
  // child is now owned by an AbortController that fires on req.on('close'), request
  // timeout, idle timeout, and process shutdown. If a leak is observed in practice,
  // add timestamps to ChildRegistry and a setInterval sweep here.

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });

  // Static UI (no auth)
  app.use('/ui', express.static(path.join(process.cwd(), 'public')));

  const auth = createAuthMiddleware(config.auth);

  const deps = {
    getAdapter: (id: string) => router.getAdapter(id),
    resolveModeConfig: (m: 'ask' | 'agent') => resolveModeConfig(m, config),
    timeouts: config.timeouts,
  };

  app.get('/v1/models', auth, createModelsRoute({
    probeAll: () => router.probeAll(config.timeouts.probe_timeout_ms),
  }));

  app.post('/v1/chat/stream', auth, requireMode(), createStreamRoute(deps));
  app.post('/v1/chat/completions', auth, requireMode(), createCompletionsRoute(deps));

  return { app, router, children };
}
```

- [ ] **Step 2: Rewrite `src/index.ts`**

```ts
import { loadConfig } from './config.js';
import { createServer } from './server.js';

const config = loadConfig();
const { app, children } = createServer(config);
const { host, port } = config.server;

const server = app.listen(port, host, () => {
  console.log(`Proxai v2 listening on http://${host}:${port}`);
  console.log(`Test UI: http://${host}:${port}/ui`);
});

async function shutdown() {
  console.log('Shutting down...');
  await children.killAll(config.timeouts.process_kill_grace_ms);
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

- [ ] **Step 3: Type-check and run the test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean type-check; all tests pass.

- [ ] **Step 4: Smoke the server**

Run: `npm run dev` in one terminal. In another:
```bash
curl -sS http://127.0.0.1:3077/health
# expect: {"status":"ok"}
curl -sS -H 'Authorization: Bearer change-me-ask' http://127.0.0.1:3077/v1/models
# expect: JSON list with live probe statuses
```

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/index.ts
git commit -m "feat(server): v2 wire-up with stream + completions routes, no SQLite"
```

---

# Phase 5 — OpenAPI

## Task 16: OpenAPI generation + `/openapi.json` + `/docs`

**Files:**
- Create: `src/routes/openapi.ts`
- Create: `public/docs.html`
- Modify: `src/server.ts` (register routes)
- Modify: `package.json` (add dep)

- [ ] **Step 1: Add the dependency**

Run: `npm install @asteasolutions/zod-to-openapi@^7`

- [ ] **Step 2: Implement `src/routes/openapi.ts`**

```ts
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';
import { ProxaiEventSchema } from '../events/schema.js';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
registry.register('ProxaiEvent', ProxaiEventSchema);

const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

const ChatRequestSchema = z.object({
  model: z.string(),
  mode: z.enum(['ask', 'agent']),
  messages: z.array(MessageSchema).min(1),
});
registry.register('ChatRequest', ChatRequestSchema);

const ModelEntrySchema = z.object({
  id: z.string(),
  object: z.literal('model'),
  owned_by: z.string(),
  status: z.enum(['ready', 'not_authenticated', 'missing_binary', 'error']),
  hint: z.string().optional(),
  message: z.string().optional(),
});
const ModelsListSchema = z.object({
  object: z.literal('list'),
  data: z.array(ModelEntrySchema),
});
registry.register('ModelsList', ModelsListSchema);

registry.registerPath({
  method: 'get', path: '/v1/models',
  description: 'List models with live probe results',
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: ModelsListSchema } } } },
});

registry.registerPath({
  method: 'post', path: '/v1/chat/stream',
  description: 'Stream typed proxai events for a chat turn',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: ChatRequestSchema } } } },
  responses: {
    200: { description: 'SSE stream of ProxaiEvent', content: { 'text/event-stream': { schema: ProxaiEventSchema } } },
    400: { description: 'Invalid request' },
    403: { description: 'Token does not permit this mode' },
  },
});

registry.registerPath({
  method: 'post', path: '/v1/chat/completions',
  description: 'OpenAI-compatible completions, downconverted from typed events',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: ChatRequestSchema.extend({ stream: z.boolean().optional() }) } } } },
  responses: {
    200: { description: 'OpenAI completion (streaming or non-streaming)' },
    400: { description: 'Invalid request' },
    403: { description: 'Token does not permit this mode' },
  },
});

registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer' });

const generator = new OpenApiGeneratorV31(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.1.0',
  info: { title: 'Proxai', version: '2.0.0', description: 'Local CLI proxy for Claude Code and Codex' },
  servers: [{ url: 'http://127.0.0.1:3077' }],
});

export function createOpenApiRoute() {
  return (_req: Request, res: Response): void => { res.json(document); };
}
```

- [ ] **Step 3: Create `public/docs.html` (static, no JS-injected DOM)**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Proxai API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger' });
  </script>
</body>
</html>
```

This file contains only static markup plus a Swagger UI initialiser; no untrusted strings touch the DOM.

- [ ] **Step 4: Register routes in `src/server.ts`**

Add inside `createServer`:
```ts
import { createOpenApiRoute } from './routes/openapi.js';
// ...
  app.get('/openapi.json', createOpenApiRoute());
  app.get('/docs', (_req, res) => res.sendFile(path.join(process.cwd(), 'public/docs.html')));
```

- [ ] **Step 5: Manual verification**

Run `npm run dev`, then:
```bash
curl -sS http://127.0.0.1:3077/openapi.json | head -c 300
# expect JSON starting with {"openapi":"3.1.0",...
open http://127.0.0.1:3077/docs   # macOS — verify Swagger UI renders with the three routes
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/openapi.ts public/docs.html src/server.ts package.json package-lock.json
git commit -m "feat(openapi): generate /openapi.json + serve /docs"
```

---

# Phase 6 — UI overhaul (DOM-safe)

The UI is a single vanilla JS file. There's no automated test infra for it, so each task ends with a manual verification checklist. Run `npm run dev` between steps and reload the UI in a browser. All UI tasks construct DOM nodes via `document.createElement`/`textContent` (or sanitise with `DOMPurify`) — no untrusted strings ever flow into `innerHTML`.

## Task 17: UI scaffold — load DOMPurify+marked+highlight.js early, add mode toggle, two tokens, full-context-from-UI

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add CDN script tags inside `<head>`**

Insert immediately after the existing Google Fonts `@import` link or at the top of `<head>`:
```html
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.0/dist/purify.min.js" crossorigin="anonymous"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/atom-one-dark.min.css">
<script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/highlight.min.js"></script>
```

These ship the libraries we need for Task 19 (timeline) and Task 20 (markdown). Loading them in Task 17 keeps the file consistent.

- [ ] **Step 2: Replace the header markup**

In `public/index.html`, replace the entire `<header>` element with:
```html
<header>
  <div class="logo">proxai <span>/ chat</span></div>
  <div class="header-controls">
    <div class="mode-toggle" id="modeToggle" role="radiogroup" aria-label="Mode">
      <button type="button" class="mode-opt active" data-mode="ask">Ask</button>
      <button type="button" class="mode-opt" data-mode="agent">Agent</button>
    </div>
    <select id="modelSelect"><option value="">loading models</option></select>
    <details class="tokens">
      <summary>tokens</summary>
      <label>Ask <input type="password" id="askToken" placeholder="ask token"></label>
      <label>Agent <input type="password" id="agentToken" placeholder="agent token"></label>
    </details>
    <button type="button" id="clearBtn" class="clear">Clear</button>
  </div>
</header>
```

Add styles to the existing `<style>` block:
```css
.mode-toggle { display:inline-flex; border:1px solid var(--border); border-radius:4px; overflow:hidden; }
.mode-toggle .mode-opt { background:transparent; color:var(--text-secondary); font:600 11px var(--mono); padding:6px 10px; border:0; cursor:pointer; letter-spacing:.08em; text-transform:uppercase; }
.mode-toggle .mode-opt.active { background:var(--accent); color:var(--bg-primary); }
details.tokens { font:11px var(--mono); color:var(--text-secondary); }
details.tokens summary { cursor:pointer; padding:4px 8px; border:1px solid var(--border); border-radius:4px; background:var(--bg-tertiary); }
details.tokens label { display:block; margin-top:6px; }
details.tokens input { width:170px; }
button.clear { background:transparent; color:var(--text-secondary); border:1px solid var(--border); border-radius:4px; padding:6px 10px; cursor:pointer; font:11px var(--mono); text-transform:uppercase; }
button.clear:hover { color:var(--error); border-color:var(--error); }
```

- [ ] **Step 3: Replace the bottom `<script>` block with safe DOM helpers and state**

Replace the existing `<script>` content with:
```html
<script>
const $ = (sel) => document.querySelector(sel);
const messagesEl = $('#messages');
const input = $('#input');
const sendBtn = $('#sendBtn');
const modelSelect = $('#modelSelect');
const askTokenInput = $('#askToken');
const agentTokenInput = $('#agentToken');
const clearBtn = $('#clearBtn');
const modeToggle = $('#modeToggle');

let mode = localStorage.getItem('proxai.mode') || 'ask';
askTokenInput.value = localStorage.getItem('proxai.ask_token') || '';
agentTokenInput.value = localStorage.getItem('proxai.agent_token') || '';
const messageHistory = [];
let inFlight = null;

function setMode(m) {
  mode = m;
  localStorage.setItem('proxai.mode', m);
  for (const b of modeToggle.querySelectorAll('.mode-opt')) {
    b.classList.toggle('active', b.dataset.mode === m);
  }
}
setMode(mode);

modeToggle.addEventListener('click', (e) => {
  const t = e.target.closest('.mode-opt'); if (!t) return;
  setMode(t.dataset.mode);
});
askTokenInput.addEventListener('change', () => localStorage.setItem('proxai.ask_token', askTokenInput.value));
agentTokenInput.addEventListener('change', () => localStorage.setItem('proxai.agent_token', agentTokenInput.value));

function activeToken() { return mode === 'ask' ? askTokenInput.value : agentTokenInput.value; }

function resetTranscript() {
  while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  const icon = document.createElement('div'); icon.className = 'icon'; icon.textContent = 'o';
  const tip = document.createElement('div'); tip.textContent = 'Send a message to start a session';
  empty.appendChild(icon); empty.appendChild(tip);
  messagesEl.appendChild(empty);
}

clearBtn.addEventListener('click', () => { messageHistory.length = 0; resetTranscript(); });

input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; });
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } });
sendBtn.addEventListener('click', () => onSend());

function onSend() { /* implemented in Task 19 */ }
</script>
```

- [ ] **Step 4: Manual verification**

`npm run dev`, open http://127.0.0.1:3077/ui. Verify:
- Header shows mode toggle and tokens disclosure.
- Switching Ask/Agent updates highlight and persists across reload.
- Typing tokens persists (check localStorage values `proxai.ask_token` / `proxai.agent_token`).
- Clear button replaces transcript with the empty state.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): scaffold v2 header (mode toggle, tokens, clear) + safe DOM helpers"
```

---

## Task 18: UI — load models with live probe status, render availability badges

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add model loader to the `<script>` block**

Append to the script (before the `onSend` placeholder):
```js
async function loadModels() {
  while (modelSelect.firstChild) modelSelect.removeChild(modelSelect.firstChild);
  const loading = document.createElement('option');
  loading.value = ''; loading.textContent = 'loading';
  modelSelect.appendChild(loading);
  try {
    const r = await fetch('/v1/models', { headers: { 'Authorization': 'Bearer ' + activeToken() } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const body = await r.json();
    while (modelSelect.firstChild) modelSelect.removeChild(modelSelect.firstChild);
    for (const m of body.data) {
      const opt = document.createElement('option');
      opt.value = m.id;
      const badge = ({ ready: 'o', not_authenticated: '!', missing_binary: '?', error: 'x' })[m.status] || '?';
      opt.textContent = badge + '  ' + m.id;
      if (m.status === 'not_authenticated') opt.title = m.hint || '';
      else if (m.status === 'error') opt.title = m.message || '';
      opt.dataset.status = m.status;
      modelSelect.appendChild(opt);
    }
  } catch (err) {
    while (modelSelect.firstChild) modelSelect.removeChild(modelSelect.firstChild);
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = 'load failed: ' + err.message;
    modelSelect.appendChild(opt);
  }
}
loadModels();
askTokenInput.addEventListener('change', loadModels);
agentTokenInput.addEventListener('change', loadModels);
modeToggle.addEventListener('click', () => setTimeout(loadModels, 0));
```

Note: all option labels go in via `textContent`; tooltips via the property `opt.title` (a plain attribute).

Add CSS for status colors:
```css
#modelSelect option[data-status="ready"] { color: var(--accent); }
#modelSelect option[data-status="not_authenticated"], #modelSelect option[data-status="error"] { color: var(--error); }
#modelSelect option[data-status="missing_binary"] { color: var(--text-muted); }
```

- [ ] **Step 2: Manual verification**

Reload UI. With valid Ask token, the dropdown should populate with status badges. With invalid token, an "load failed" entry should appear. Switch mode → re-loads with the active token.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): model availability badges via /v1/models live probes"
```

---

## Task 19: UI — `/v1/chat/stream` consumer with abort + event timeline (createElement only)

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Implement DOM helpers and `onSend`**

Replace the placeholder `function onSend() { /* ... */ }` with the following block (every DOM mutation uses `createElement`/`textContent` — no `innerHTML`):

```js
function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function clearEl(el) { while (el.firstChild) el.removeChild(el.firstChild); }

function appendUserBubble(text) {
  const empty = messagesEl.querySelector('.empty-state'); if (empty) empty.remove();
  const div = makeEl('div', 'msg user');
  div.appendChild(makeEl('div', 'role-label', 'user'));
  div.appendChild(makeEl('div', 'content', text));
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendAssistantBubble() {
  const empty = messagesEl.querySelector('.empty-state'); if (empty) empty.remove();
  const div = makeEl('div', 'msg assistant');
  div.appendChild(makeEl('div', 'role-label', 'assistant'));
  const timeline = makeEl('div', 'timeline');
  const answer = makeEl('div', 'answer');
  const cursor = makeEl('span', 'cursor');
  answer.appendChild(cursor);
  div.appendChild(timeline);
  div.appendChild(answer);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return { bubble: div, timeline, answer };
}

function addTimelineRow(timeline, tagClass, tagText, text) {
  const row = makeEl('div', 'tl-row');
  row.appendChild(makeEl('span', 'tl-tag ' + tagClass, tagText));
  row.appendChild(document.createTextNode(' '));
  row.appendChild(document.createTextNode(text));
  timeline.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return row;
}

function addTimelineCode(timeline, tagClass, tagText, codeText, suffix) {
  const row = makeEl('div', 'tl-row');
  row.appendChild(makeEl('span', 'tl-tag ' + tagClass, tagText));
  row.appendChild(document.createTextNode(' '));
  row.appendChild(makeEl('code', null, codeText));
  if (suffix) row.appendChild(document.createTextNode(' ' + suffix));
  timeline.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return row;
}

function renderAnswer(answerEl, text) {
  // text-mode rendering for Task 19; Task 20 swaps this for markdown via DOMPurify.
  clearEl(answerEl);
  answerEl.appendChild(document.createTextNode(text));
  answerEl.appendChild(makeEl('span', 'cursor'));
}

function showAuthBanner(data) {
  let banner = document.querySelector('.auth-banner');
  if (banner) banner.remove();
  banner = makeEl('div', 'auth-banner');
  banner.appendChild(makeEl('strong', null, data.provider + ' auth required'));
  banner.appendChild(document.createTextNode(' — '));
  banner.appendChild(document.createTextNode(data.message));
  banner.appendChild(document.createTextNode(' — '));
  banner.appendChild(makeEl('code', null, data.hint));
  const btn = makeEl('button', null, 'Re-check');
  btn.addEventListener('click', async () => { await loadModels(); banner.remove(); });
  banner.appendChild(btn);
  document.body.insertBefore(banner, document.body.firstChild.nextSibling);
}

async function onSend() {
  if (inFlight) return;
  const text = input.value.trim(); if (!text) return;
  const model = modelSelect.value; if (!model) { alert('No model selected'); return; }
  const tok = activeToken(); if (!tok) { alert('Please set the ' + mode + ' token first.'); return; }

  messageHistory.push({ role: 'user', content: text });
  appendUserBubble(text);
  input.value = ''; input.style.height = 'auto';

  const { timeline, answer } = appendAssistantBubble();
  let assistantText = '';

  inFlight = new AbortController();
  sendBtn.textContent = 'Cancel';
  const sendHandler = () => onSend();
  sendBtn.onclick = () => inFlight && inFlight.abort();

  try {
    const res = await fetch('/v1/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ model: model, mode: mode, messages: messageHistory }),
      signal: inFlight.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body.error && body.error.message) || ('HTTP ' + res.status));
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let currentEvent = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line) continue;
        if (line.startsWith(':')) continue;
        if (line.startsWith('event: ')) { currentEvent = line.slice(7); continue; }
        if (line.startsWith('data: ')) {
          const json = line.slice(6);
          let data; try { data = JSON.parse(json); } catch { continue; }
          handleEvent(currentEvent || data.type, data);
        }
      }
    }
  } catch (err) {
    if (err && err.name === 'AbortError') addTimelineRow(timeline, 'err', 'aborted', '');
    else addTimelineRow(timeline, 'err', 'error', String(err && err.message ? err.message : err));
  } finally {
    const cur = answer.querySelector('.cursor'); if (cur) cur.remove();
    if (assistantText) messageHistory.push({ role: 'assistant', content: assistantText });
    inFlight = null;
    sendBtn.textContent = 'Send';
    sendBtn.onclick = sendHandler;
  }

  function handleEvent(type, data) {
    if (type === 'text_delta') {
      assistantText += data.text;
      renderAnswer(answer, assistantText);
    } else if (type === 'thinking_delta') {
      addTimelineRow(timeline, 'think', 'thinking', data.text);
    } else if (type === 'tool_use') {
      addTimelineCode(timeline, 'tool', 'tool ' + data.name, JSON.stringify(data.input).slice(0, 120));
    } else if (type === 'tool_result') {
      addTimelineRow(timeline, data.is_error ? 'err' : 'result', data.is_error ? 'error' : 'result', String(data.content).slice(0, 200));
    } else if (type === 'file_edit') {
      addTimelineRow(timeline, 'file', data.action, data.path + ' — ' + data.summary);
    } else if (type === 'command_exec') {
      addTimelineCode(timeline, 'cmd', 'exec', data.command, data.exit_code !== undefined ? '→ ' + data.exit_code : '');
    } else if (type === 'auth_required') {
      showAuthBanner(data);
    } else if (type === 'error') {
      addTimelineRow(timeline, 'err', 'error', data.message);
    } else if (type === 'usage') {
      addTimelineRow(timeline, 'usage', 'usage', 'in=' + data.input_tokens + ' out=' + data.output_tokens);
    }
  }
}
```

Add CSS for the timeline and banner:
```css
.msg .timeline { display:flex; flex-direction:column; gap:4px; margin:6px 0; }
.tl-row { font:12px var(--mono); color:var(--text-secondary); padding:4px 8px; background:var(--bg-tertiary); border-left:2px solid var(--border); border-radius:3px; }
.tl-tag { display:inline-block; padding:1px 6px; border-radius:3px; font-weight:600; text-transform:uppercase; font-size:10px; margin-right:6px; letter-spacing:.06em; }
.tl-tag.think { background:#553a99; color:#fff; }
.tl-tag.tool { background:#2a3a55; color:#9ab; }
.tl-tag.result { background:#2a553a; color:#9ba; }
.tl-tag.file { background:#553a2a; color:#ec9; }
.tl-tag.cmd { background:#3a3a55; color:#abe; }
.tl-tag.usage { background:var(--bg-input); color:var(--text-muted); }
.tl-tag.err { background:var(--error); color:#fff; }
.msg .answer { font-family:var(--sans); font-size:14px; line-height:1.65; white-space:pre-wrap; }
.auth-banner { background:var(--error-dim); color:var(--error); padding:10px 16px; font:13px var(--mono); border-bottom:1px solid var(--error); display:flex; gap:10px; align-items:center; }
.auth-banner button { margin-left:auto; background:var(--error); color:#fff; border:0; padding:4px 10px; cursor:pointer; border-radius:3px; }
```

- [ ] **Step 2: Manual verification**

`npm run dev`. With Agent token set and Agent mode + `claude-code`:
- Send "List the .ts files under src/." Verify timeline shows `tool` (Bash), `exec` row with command and exit code, and the final answer area shows text.
- Click Cancel mid-stream → an "aborted" row appears.

In Ask mode with a model that requires login:
- Hit send → auth banner appears with hint and Re-check button.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): consume /v1/chat/stream, event timeline, cancel, auth banner (DOM-safe)"
```

---

## Task 20: UI — Markdown rendering for assistant text via DOMPurify

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Replace `renderAnswer` with markdown rendering**

Find the `renderAnswer` function added in Task 19 and replace it with:
```js
function renderAnswer(answerEl, text) {
  const html = DOMPurify.sanitize(marked.parse(text), { USE_PROFILES: { html: true } });
  // DOMPurify returns a sanitized HTML string; assignment to innerHTML is safe AFTER sanitization.
  answerEl.innerHTML = html;
  answerEl.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el));
  answerEl.appendChild(makeEl('span', 'cursor'));
}
```

Reasoning: `marked.parse` converts model output to HTML; `DOMPurify.sanitize` strips any unsafe nodes/attributes; only the sanitized string is assigned, so XSS payloads are neutralised before they touch the DOM.

Add styles for rendered markdown:
```css
.msg .answer pre { background:var(--bg-input); border:1px solid var(--border); border-radius:4px; padding:10px 12px; overflow-x:auto; font:12px var(--mono); margin:8px 0; }
.msg .answer code { font-family:var(--mono); }
.msg .answer p { margin:6px 0; }
.msg .answer ul, .msg .answer ol { margin:6px 0 6px 22px; }
```

- [ ] **Step 2: Manual verification**

Ask the model to "return a TypeScript code sample wrapped in fenced backticks". Verify:
- Markdown renders (lists, bold, italic).
- Fenced code blocks are syntax-highlighted via highlight.js.
- Ask it to "return literally `<script>alert(1)</script>` inside backticks". The text appears as code, not executed.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): markdown rendering for assistant text via DOMPurify-sanitised HTML"
```

---

# Phase 7 — Startup self-test + docs

## Task 21: Startup self-test for CLI flags

**Files:**
- Create: `src/lifecycle/self-test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Implement `src/lifecycle/self-test.ts`**

```ts
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
```

- [ ] **Step 2: Hook into `src/index.ts`**

Replace `src/index.ts` with:
```ts
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { runStartupSelfTest } from './lifecycle/self-test.js';

(async () => {
  const config = loadConfig();
  await runStartupSelfTest();
  const { app, children } = createServer(config);
  const { host, port } = config.server;

  const server = app.listen(port, host, () => {
    console.log(`Proxai v2 listening on http://${host}:${port}`);
    console.log(`Test UI: http://${host}:${port}/ui`);
  });

  async function shutdown() {
    console.log('Shutting down...');
    await children.killAll(config.timeouts.process_kill_grace_ms);
    server.close(() => process.exit(0));
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
```

- [ ] **Step 3: Manual verification**

Run `npm run dev`. Verify no warning fires when `claude --help` advertises the flags. To simulate flag drift, temporarily make a wrapper that hides the flag:
```bash
mkdir -p /tmp/bin
cat > /tmp/bin/claude <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "--help" ]]; then echo "claude (fake) — no flags"; exit 0; fi
exec /usr/local/bin/claude "$@"
EOF
chmod +x /tmp/bin/claude
PATH=/tmp/bin:$PATH npm run dev
```
Expected: a warning about each missing flag is printed at startup. Reset `PATH` and remove `/tmp/bin/claude` afterwards.

- [ ] **Step 4: Commit**

```bash
git add src/lifecycle/self-test.ts src/index.ts
git commit -m "feat(lifecycle): startup self-test for required CLI flags"
```

---

## Task 22: Docs cleanup + release notes

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/tech-task-for-the-future.md`
- Create: `docs/superpowers/specs/2026-05-24-proxai-v2-ui-api-hardening-release-notes.md`

- [ ] **Step 1: Scan `CLAUDE.md` for stale references**

Run: `grep -n -i 'sqlite\|session\|sessions' CLAUDE.md || echo 'no hits'`

If hits exist, edit them out (the v2 server doesn't persist sessions). If "no hits", skip.

- [ ] **Step 2: Annotate `docs/tech-task-for-the-future.md`**

Prepend a note above the "PRD: Test UI Improvements" section:
```markdown
> **Superseded by** `docs/superpowers/specs/2026-05-24-proxai-v2-ui-api-hardening-design.md`.
> Items still relevant after v2 lands (stats dashboard, request inspector) can be re-extracted as a follow-up PRD.
```

- [ ] **Step 3: Write release notes**

Create `docs/superpowers/specs/2026-05-24-proxai-v2-ui-api-hardening-release-notes.md`:
```markdown
# Proxai v2 — Release Notes

## Breaking changes

- **Config:** `auth.bearer_token` is removed. Replace with:
  - `auth.ask_token` (required)
  - `auth.agent_token` (required)
  - `auth.admin_token` (optional; grants both modes)
- **Request schema:** every request to `/v1/chat/stream` and `/v1/chat/completions` must include `mode: "ask" | "agent"`.
- **Endpoints removed:** `/v1/sessions/*`. The server is stateless; clients own conversation history and resend the full `messages` array on every request.
- **Config:** `sessions:` block removed; `providers.*.args` removed.

## Additions

- `POST /v1/chat/stream` — typed-event SSE protocol (text_delta, thinking_delta, tool_use, file_edit, command_exec, auth_required, error, usage, turn_complete, done).
- `GET /openapi.json` and `GET /docs` — OpenAPI 3.1 schema + Swagger UI.
- `GET /v1/models` now performs live probes; the response includes `status` per model.
- Ask mode: tool whitelist + curated MCP config (`ask-mcp.json`) + system prompt.
- UI: mode toggle, two-token header, markdown rendering, event timeline, availability badges, auth banner, cancel button.

## Removals

- SQLite store and session manager.
- `better-sqlite3` dependency.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/tech-task-for-the-future.md docs/superpowers/specs/2026-05-24-proxai-v2-ui-api-hardening-release-notes.md
git commit -m "docs: v2 release notes + supersede Test UI PRD outline"
```

---

# Final verification

- [ ] **Run the full test suite**

`npx vitest run`
Expected: all tests pass.

- [ ] **Run a manual smoke against both modes**

`npm run dev`, then in a browser:
1. Set Ask + Agent tokens (matching `proxai.config.yaml`).
2. Ask mode, `claude-code` model, prompt: "Search for the latest TypeScript 5.4 release notes." Verify the agent uses WebSearch / Context7 only (no `file_edit` or `command_exec` events).
3. Agent mode, `claude-code` model, prompt: "List the .ts files under src/." Verify the timeline shows `command_exec` and a real `ls` output.
4. Open `/docs` and verify the three endpoints render with their schemas.

- [ ] **Type-check**

`npx tsc --noEmit`
Expected: clean.
