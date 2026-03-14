# Proxai MVP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Task completion rule:** When a task is done, update its task file: set `**Status:** Done` and change all `- [ ]` checkboxes to `- [x]`.

**Goal:** Build a local Express server that proxies OpenAI-compatible API requests to Claude Code and Codex CLI tools, with session management and SQLite persistence, plus a minimal test UI.

**Architecture:** Express server with provider adapter pattern. Each CLI tool gets an adapter implementing a common interface. Session Manager handles process lifecycle (spawn, idle kill, resume) with SQLite backing. Auth via static Bearer token. Each adapter spawns a CLI process per `send()` call using `--print` mode, captures the CLI's native session ID from the result event, and uses `--resume` for follow-up messages.

**Tech Stack:** Node.js 24, TypeScript, Express, better-sqlite3, zod, js-yaml, uuid

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies and scripts |
| `tsconfig.json` | TypeScript config |
| `proxai.config.yaml` | Default server config |
| `src/index.ts` | Entry point — load config, start server |
| `src/config.ts` | Load + validate YAML config with zod |
| `src/server.ts` | Express app setup, mount routes + middleware |
| `src/middleware/auth.ts` | Bearer token validation middleware |
| `src/sessions/store.ts` | SQLite schema + CRUD operations |
| `src/sessions/manager.ts` | Session lifecycle: create, get, idle timeout, kill, resume |
| `src/providers/adapter.ts` | ProviderAdapter interface + Message type |
| `src/providers/router.ts` | Model name → adapter lookup |
| `src/providers/claude.ts` | Claude Code CLI adapter |
| `src/providers/codex.ts` | Codex CLI adapter |
| `src/routes/models.ts` | `GET /v1/models` |
| `src/routes/completions.ts` | `POST /v1/chat/completions` (streaming + non-streaming) |
| `src/routes/sessions.ts` | Session CRUD endpoints |
| `public/index.html` | Minimal test UI — chat interface |
| `tests/config.test.ts` | Config loading tests |
| `tests/store.test.ts` | SQLite store tests |
| `tests/manager.test.ts` | Session manager tests |
| `tests/auth.test.ts` | Auth middleware tests |
| `tests/routes/models.test.ts` | Models endpoint tests |
| `tests/routes/completions.test.ts` | Completions endpoint tests (mocked adapters) |
| `tests/routes/sessions.test.ts` | Sessions endpoint tests |
| `tests/providers/claude.test.ts` | Claude adapter test |
| `tests/providers/codex.test.ts` | Codex adapter test |

---

## Chunk 1: Project Scaffolding + Config

### Task 1: Initialize Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: Initialize npm project**

```bash
cd /home/anuarder/Documents/Projects/proxai
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install express better-sqlite3 js-yaml zod uuid
npm install -D typescript @types/express @types/better-sqlite3 @types/js-yaml @types/uuid @types/node tsx vitest supertest @types/supertest
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Add scripts to package.json**

Add to `package.json`:
```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
*.db
*.db-wal
*.db-shm
```

- [ ] **Step 6: Initialize git repo and commit**

```bash
cd /home/anuarder/Documents/Projects/proxai
git init
git add package.json tsconfig.json .gitignore PRD.md docs/
git commit -m "chore: scaffold proxai project"
```

---

### Task 2: Config Loading

**Files:**
- Create: `proxai.config.yaml`
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing config test**

```typescript
// tests/config.test.ts
import { describe, it, expect } from "vitest";
import { parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("parses a valid YAML config string", () => {
    const yaml = `
server:
  port: 3077
  host: "127.0.0.1"
auth:
  bearer_token: "test-key"
sessions:
  idle_timeout_ms: 300000
  max_concurrent: 10
providers:
  claude:
    command: "claude"
    args: ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]
    model_id: "claude-code"
`;
    const config = parseConfig(yaml);
    expect(config.server.port).toBe(3077);
    expect(config.auth.bearer_token).toBe("test-key");
    expect(config.providers.claude.command).toBe("claude");
  });

  it("throws on missing required fields", () => {
    expect(() => parseConfig("server:\n  port: 3077")).toThrow();
  });

  it("applies defaults for optional fields", () => {
    const yaml = `
server:
  port: 3077
  host: "127.0.0.1"
auth:
  bearer_token: "key"
sessions:
  idle_timeout_ms: 300000
  max_concurrent: 5
providers:
  claude:
    command: "claude"
    args: []
    model_id: "claude-code"
`;
    const config = parseConfig(yaml);
    expect(config.sessions.max_concurrent).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/config.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement config.ts**

```typescript
// src/config.ts
import { z } from "zod";
import { load as loadYaml } from "js-yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ProviderSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  model_id: z.string(),
});

const ConfigSchema = z.object({
  server: z.object({
    port: z.number().default(3077),
    host: z.string().default("127.0.0.1"),
  }),
  auth: z.object({
    bearer_token: z.string(),
  }),
  sessions: z.object({
    idle_timeout_ms: z.number().default(300000),
    max_concurrent: z.number().default(10),
  }),
  providers: z.record(z.string(), ProviderSchema),
});

export type ProxaiConfig = z.infer<typeof ConfigSchema>;

export function parseConfig(yamlString: string): ProxaiConfig {
  const raw = loadYaml(yamlString);
  return ConfigSchema.parse(raw);
}

export function loadConfig(path?: string): ProxaiConfig {
  const configPath = path ?? resolve(process.cwd(), "proxai.config.yaml");
  const content = readFileSync(configPath, "utf-8");
  return parseConfig(content);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/config.test.ts
```
Expected: PASS

- [ ] **Step 5: Create default config file**

```yaml
# proxai.config.yaml
server:
  port: 3077
  host: "127.0.0.1"

auth:
  bearer_token: "change-me"

sessions:
  idle_timeout_ms: 300000
  max_concurrent: 10

providers:
  claude:
    command: "claude"
    args: ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]
    model_id: "claude-code"
  codex:
    command: "codex"
    args: ["exec", "--json"]
    model_id: "codex-cli"
```

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config.test.ts proxai.config.yaml
git commit -m "feat: add config loading with zod validation"
```

---

## Chunk 2: SQLite Store + Session Manager

### Task 3: SQLite Store

**Files:**
- Create: `src/sessions/store.ts`
- Create: `tests/store.test.ts`

- [ ] **Step 1: Write failing store tests**

```typescript
// tests/store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { SessionStore } from "../src/sessions/store.js";

describe("SessionStore", () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(":memory:");
  });

  it("creates and retrieves a session", () => {
    const session = store.createSession("claude-code", "claude");
    const retrieved = store.getSession(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.provider).toBe("claude");
    expect(retrieved!.status).toBe("active");
  });

  it("lists all sessions", () => {
    store.createSession("claude-code", "claude");
    store.createSession("codex-cli", "codex");
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(2);
  });

  it("updates session status", () => {
    const session = store.createSession("claude-code", "claude");
    store.updateSessionStatus(session.id, "idle");
    const updated = store.getSession(session.id);
    expect(updated!.status).toBe("idle");
  });

  it("stores and retrieves cli_session_id", () => {
    const session = store.createSession("claude-code", "claude");
    store.updateCliSessionId(session.id, "claude-native-abc123");
    const updated = store.getSession(session.id);
    expect(updated!.cli_session_id).toBe("claude-native-abc123");
  });

  it("deletes a session and cascades messages", () => {
    const session = store.createSession("claude-code", "claude");
    store.addMessage(session.id, "user", "Hello");
    store.deleteSession(session.id);
    expect(store.getSession(session.id)).toBeNull();
    expect(store.getMessages(session.id)).toHaveLength(0);
  });

  it("adds and retrieves messages in order", () => {
    const session = store.createSession("claude-code", "claude");
    store.addMessage(session.id, "user", "Hello");
    store.addMessage(session.id, "assistant", "Hi there");
    const messages = store.getMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });

  it("touches session last_active", () => {
    const session = store.createSession("claude-code", "claude");
    store.touchSession(session.id);
    const updated = store.getSession(session.id);
    expect(updated!.last_active).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/store.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement store.ts**

Note: `cli_session_id` stores the native session ID returned by the CLI tool (e.g., Claude's `session_id` from its `result` event). This is different from the Proxai session `id` (a UUID we generate).

```typescript
// src/sessions/store.ts
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface SessionRow {
  id: string;
  model_id: string;
  provider: string;
  status: string;
  created_at: string;
  last_active: string;
  cli_session_id: string | null;
  config: string | null;
}

export interface MessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  timestamp: string;
}

export class SessionStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        last_active TEXT NOT NULL,
        cli_session_id TEXT,
        config TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
    `);
  }

  createSession(modelId: string, provider: string): SessionRow {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(
      "INSERT INTO sessions (id, model_id, provider, status, created_at, last_active) VALUES (?, ?, ?, 'active', ?, ?)"
    ).run(id, modelId, provider, now, now);
    return { id, model_id: modelId, provider, status: "active", created_at: now, last_active: now, cli_session_id: null, config: null };
  }

  getSession(id: string): SessionRow | null {
    return (this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow) ?? null;
  }

  listSessions(): SessionRow[] {
    return this.db.prepare("SELECT * FROM sessions ORDER BY last_active DESC").all() as SessionRow[];
  }

  updateSessionStatus(id: string, status: string): void {
    this.db.prepare("UPDATE sessions SET status = ? WHERE id = ?").run(status, id);
  }

  updateCliSessionId(id: string, cliSessionId: string): void {
    this.db.prepare("UPDATE sessions SET cli_session_id = ? WHERE id = ?").run(cliSessionId, id);
  }

  touchSession(id: string): void {
    this.db.prepare("UPDATE sessions SET last_active = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    // messages cascade-deleted via PRAGMA foreign_keys = ON
  }

  addMessage(sessionId: string, role: string, content: string): void {
    this.db.prepare(
      "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)"
    ).run(sessionId, role, content, new Date().toISOString());
  }

  getMessages(sessionId: string): MessageRow[] {
    return this.db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC").all(sessionId) as MessageRow[];
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/store.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sessions/store.ts tests/store.test.ts
git commit -m "feat: add SQLite session store with CRUD and cascade deletes"
```

---

### Task 4: Session Manager

**Files:**
- Create: `src/sessions/manager.ts`
- Create: `tests/manager.test.ts`

The Session Manager wraps the store and adds idle timeout logic. It also accepts an `onIdle` callback so the server layer can kill adapter processes when sessions go idle.

- [ ] **Step 1: Write failing manager tests**

```typescript
// tests/manager.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SessionManager } from "../src/sessions/manager.js";
import { SessionStore } from "../src/sessions/store.js";

describe("SessionManager", () => {
  let store: SessionStore;
  let manager: SessionManager;

  beforeEach(() => {
    store = new SessionStore(":memory:");
    manager = new SessionManager(store, {
      idle_timeout_ms: 500,
      max_concurrent: 2,
    });
  });

  afterEach(() => {
    manager.shutdown();
    store.close();
  });

  it("creates a session and stores it", () => {
    const session = manager.createSession("claude-code", "claude");
    expect(session.id).toBeDefined();
    expect(store.getSession(session.id)).not.toBeNull();
  });

  it("rejects when max concurrent sessions reached", () => {
    manager.createSession("claude-code", "claude");
    manager.createSession("claude-code", "claude");
    expect(() => manager.createSession("claude-code", "claude")).toThrow(/max concurrent/i);
  });

  it("gets a session by id", () => {
    const session = manager.createSession("claude-code", "claude");
    const retrieved = manager.getSession(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(session.id);
  });

  it("deletes a session", () => {
    const session = manager.createSession("claude-code", "claude");
    manager.deleteSession(session.id);
    expect(manager.getSession(session.id)).toBeNull();
  });

  it("calls onIdle callback when session goes idle", async () => {
    const onIdle = vi.fn();
    manager.setOnIdleCallback(onIdle);
    const session = manager.createSession("claude-code", "claude");
    // Wait for idle checker to run
    await new Promise((r) => setTimeout(r, 700));
    expect(onIdle).toHaveBeenCalledWith(session.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/manager.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement manager.ts**

```typescript
// src/sessions/manager.ts
import { SessionStore, type SessionRow } from "./store.js";

export interface SessionManagerConfig {
  idle_timeout_ms: number;
  max_concurrent: number;
}

export class SessionManager {
  private store: SessionStore;
  private config: SessionManagerConfig;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private onIdle: ((sessionId: string) => void) | null = null;

  constructor(store: SessionStore, config: SessionManagerConfig) {
    this.store = store;
    this.config = config;
    this.startIdleChecker();
  }

  setOnIdleCallback(cb: (sessionId: string) => void): void {
    this.onIdle = cb;
  }

  createSession(modelId: string, provider: string): SessionRow {
    const active = this.store.listSessions().filter(s => s.status === "active");
    if (active.length >= this.config.max_concurrent) {
      throw new Error(`Max concurrent sessions (${this.config.max_concurrent}) reached`);
    }
    return this.store.createSession(modelId, provider);
  }

  getSession(id: string): SessionRow | null {
    return this.store.getSession(id);
  }

  listSessions(): SessionRow[] {
    return this.store.listSessions();
  }

  touchSession(id: string): void {
    this.store.touchSession(id);
  }

  deleteSession(id: string): void {
    this.store.deleteSession(id);
  }

  updateStatus(id: string, status: string): void {
    this.store.updateSessionStatus(id, status);
  }

  updateCliSessionId(id: string, cliSessionId: string): void {
    this.store.updateCliSessionId(id, cliSessionId);
  }

  addMessage(sessionId: string, role: string, content: string): void {
    this.store.addMessage(sessionId, role, content);
  }

  getMessages(sessionId: string) {
    return this.store.getMessages(sessionId);
  }

  private startIdleChecker(): void {
    this.idleTimer = setInterval(() => {
      const sessions = this.store.listSessions();
      const now = Date.now();
      for (const session of sessions) {
        if (session.status !== "active") continue;
        const lastActive = new Date(session.last_active).getTime();
        if (now - lastActive > this.config.idle_timeout_ms) {
          this.store.updateSessionStatus(session.id, "idle");
          if (this.onIdle) {
            this.onIdle(session.id);
          }
        }
      }
    }, Math.min(this.config.idle_timeout_ms, 10000));
  }

  shutdown(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/manager.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sessions/manager.ts tests/manager.test.ts
git commit -m "feat: add session manager with idle timeout and onIdle callback"
```

---

## Chunk 3: Provider Adapter Interface + Implementations

### Task 5: Provider Adapter Interface

**Files:**
- Create: `src/providers/adapter.ts`

- [ ] **Step 1: Define the adapter interface and types**

The `send()` method returns an `AsyncIterable<string>` of text chunks AND a way to report the CLI-native session ID back (for `--resume` on follow-ups). We use a result object for this.

```typescript
// src/providers/adapter.ts
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SendResult {
  chunks: AsyncIterable<string>;
  /** Resolves to the CLI-native session ID (if returned by the tool). */
  cliSessionId: Promise<string | null>;
}

export interface ProviderAdapter {
  readonly name: string;
  readonly modelId: string;

  send(prompt: string, cliSessionId: string | null): SendResult;
  kill(sessionId: string): Promise<void>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/providers/adapter.ts
git commit -m "feat: define ProviderAdapter interface with SendResult"
```

---

### Task 6: Claude Code Adapter

**Files:**
- Create: `src/providers/claude.ts`
- Create: `tests/providers/claude.test.ts`

Claude Code CLI key flags for non-interactive use:
- `claude -p "prompt"` — print mode, exits after response
- `--output-format stream-json` — streams JSON objects line by line
- `--verbose --include-partial-messages` — required for token-by-token streaming
- `--resume <session-id>` — resumes an existing CLI session (NOT `--session-id`)

Stream-json events with `--verbose --include-partial-messages`:
- `{ "type": "stream_event", "event": { "type": "content_block_delta", "delta": { "type": "text_delta", "text": "..." } } }` — incremental tokens
- `{ "type": "result", "session_id": "...", "result": "..." }` — final result with CLI session ID

- [ ] **Step 1: Write failing Claude adapter test**

```typescript
// tests/providers/claude.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaudeAdapter } from "../src/providers/claude.js";

vi.mock("node:child_process", () => {
  const { EventEmitter } = require("node:events");
  const { Readable } = require("node:stream");

  return {
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as any;
      const lines = [
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
        }),
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "world" } },
        }),
        JSON.stringify({
          type: "result",
          session_id: "claude-native-session-123",
          result: "Hello world",
        }),
      ];
      const output = lines.join("\n") + "\n";

      proc.stdout = Readable.from(output);
      proc.stderr = Readable.from("");
      proc.stdin = { write: vi.fn(), end: vi.fn() };
      proc.pid = 1234;

      setTimeout(() => proc.emit("close", 0), 50);
      return proc;
    }),
  };
});

describe("ClaudeAdapter", () => {
  let adapter: ClaudeAdapter;

  beforeEach(() => {
    adapter = new ClaudeAdapter("claude", ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]);
  });

  it("has correct name and modelId", () => {
    expect(adapter.name).toBe("claude");
    expect(adapter.modelId).toBe("claude-code");
  });

  it("streams text chunks incrementally", async () => {
    const { chunks, cliSessionId } = adapter.send("Hi", null);
    const collected: string[] = [];
    for await (const chunk of chunks) {
      collected.push(chunk);
    }
    expect(collected).toEqual(["Hello ", "world"]);
    expect(await cliSessionId).toBe("claude-native-session-123");
  });

  it("passes --resume when cliSessionId is provided", async () => {
    const { spawn } = await import("node:child_process");
    adapter.send("Follow up", "claude-native-session-123");
    const call = (spawn as any).mock.calls.at(-1);
    expect(call[1]).toContain("--resume");
    expect(call[1]).toContain("claude-native-session-123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/providers/claude.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement Claude adapter**

```typescript
// src/providers/claude.ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ProviderAdapter, SendResult } from "./adapter.js";

export class ClaudeAdapter implements ProviderAdapter {
  readonly name = "claude";
  readonly modelId = "claude-code";

  private command: string;
  private baseArgs: string[];

  constructor(command: string, args: string[]) {
    this.command = command;
    this.baseArgs = args;
  }

  send(prompt: string, cliSessionId: string | null): SendResult {
    const args = [...this.baseArgs];
    if (cliSessionId) {
      args.push("--resume", cliSessionId);
    }
    args.push(prompt);

    const proc = spawn(this.command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let resolveCliSessionId: (value: string | null) => void;
    const cliSessionIdPromise = new Promise<string | null>((resolve) => {
      resolveCliSessionId = resolve;
    });

    const self = this;

    async function* streamChunks(): AsyncIterable<string> {
      const rl = createInterface({ input: proc.stdout! });
      let foundSessionId = false;

      try {
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);

            // Incremental streaming tokens
            if (
              event.type === "stream_event" &&
              event.event?.type === "content_block_delta" &&
              event.event?.delta?.type === "text_delta" &&
              event.event.delta.text
            ) {
              yield event.event.delta.text;
            }

            // Final result — capture CLI session ID
            if (event.type === "result" && event.session_id) {
              foundSessionId = true;
              resolveCliSessionId!(event.session_id);
            }
          } catch {
            // Non-JSON line, skip
          }
        }
      } finally {
        rl.close();
        if (!foundSessionId) {
          resolveCliSessionId!(null);
        }
      }
    }

    return {
      chunks: streamChunks(),
      cliSessionId: cliSessionIdPromise,
    };
  }

  async kill(): Promise<void> {
    // Claude -p processes exit on their own after responding.
    // Nothing to kill for print-mode invocations.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/providers/claude.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/claude.ts tests/providers/claude.test.ts
git commit -m "feat: add Claude Code CLI adapter with --resume support"
```

---

### Task 7: Codex Adapter

**Files:**
- Create: `src/providers/codex.ts`
- Create: `tests/providers/codex.test.ts`

Codex CLI `exec --json` outputs JSONL events. Key event types:
- `{ "type": "task_started", ... }` — session started
- `{ "type": "message", "role": "assistant", "content": [...] }` — assistant response (content is array of content blocks)
- Content blocks: `{ "type": "output_text", "text": "..." }` for text, `{ "type": "tool_use", ... }` for tool calls
- Session persistence: Codex saves sessions locally. We can use `codex exec resume --last` or `codex resume` for follow-ups, but for MVP we send full prompt each time.

- [ ] **Step 1: Write failing Codex adapter test**

```typescript
// tests/providers/codex.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CodexAdapter } from "../src/providers/codex.js";

vi.mock("node:child_process", () => {
  const { EventEmitter } = require("node:events");
  const { Readable } = require("node:stream");

  return {
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as any;
      const lines = [
        JSON.stringify({ type: "task_started", session_id: "codex-session-456" }),
        JSON.stringify({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Hello from Codex" }],
        }),
      ];
      const output = lines.join("\n") + "\n";

      proc.stdout = Readable.from(output);
      proc.stderr = Readable.from("");
      proc.stdin = { write: vi.fn(), end: vi.fn() };
      proc.pid = 5678;

      setTimeout(() => proc.emit("close", 0), 50);
      return proc;
    }),
  };
});

describe("CodexAdapter", () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    adapter = new CodexAdapter("codex", ["exec", "--json"]);
  });

  it("has correct name and modelId", () => {
    expect(adapter.name).toBe("codex");
    expect(adapter.modelId).toBe("codex-cli");
  });

  it("streams text chunks from output_text blocks", async () => {
    const { chunks, cliSessionId } = adapter.send("Hi", null);
    const collected: string[] = [];
    for await (const chunk of chunks) {
      collected.push(chunk);
    }
    expect(collected).toEqual(["Hello from Codex"]);
    expect(await cliSessionId).toBe("codex-session-456");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/providers/codex.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement Codex adapter**

```typescript
// src/providers/codex.ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ProviderAdapter, SendResult } from "./adapter.js";

export class CodexAdapter implements ProviderAdapter {
  readonly name = "codex";
  readonly modelId = "codex-cli";

  private command: string;
  private baseArgs: string[];

  constructor(command: string, args: string[]) {
    this.command = command;
    this.baseArgs = args;
  }

  send(prompt: string, _cliSessionId: string | null): SendResult {
    // For MVP, codex exec runs fresh each time with the prompt.
    // Session context is managed by replaying history in the prompt if needed.
    const args = [...this.baseArgs, prompt];

    const proc = spawn(this.command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let resolveCliSessionId: (value: string | null) => void;
    const cliSessionIdPromise = new Promise<string | null>((resolve) => {
      resolveCliSessionId = resolve;
    });

    async function* streamChunks(): AsyncIterable<string> {
      const rl = createInterface({ input: proc.stdout! });
      let foundSessionId = false;

      try {
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);

            // Capture session ID from task_started
            if (event.type === "task_started" && event.session_id) {
              foundSessionId = true;
              resolveCliSessionId!(event.session_id);
            }

            // Extract text from assistant messages
            if (event.type === "message" && event.role === "assistant" && Array.isArray(event.content)) {
              for (const block of event.content) {
                if (block.type === "output_text" && block.text) {
                  yield block.text;
                }
              }
            }
          } catch {
            // Non-JSON line, skip
          }
        }
      } finally {
        rl.close();
        if (!foundSessionId) {
          resolveCliSessionId!(null);
        }
      }
    }

    return {
      chunks: streamChunks(),
      cliSessionId: cliSessionIdPromise,
    };
  }

  async kill(): Promise<void> {
    // Codex exec processes exit on their own after responding.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/providers/codex.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/codex.ts tests/providers/codex.test.ts
git commit -m "feat: add Codex CLI adapter"
```

---

### Task 8: Provider Router

**Files:**
- Create: `src/providers/router.ts`

- [ ] **Step 1: Implement the router**

```typescript
// src/providers/router.ts
import type { ProviderAdapter } from "./adapter.js";
import type { ProxaiConfig } from "../config.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";

const ADAPTER_FACTORIES: Record<string, (command: string, args: string[]) => ProviderAdapter> = {
  claude: (cmd, args) => new ClaudeAdapter(cmd, args),
  codex: (cmd, args) => new CodexAdapter(cmd, args),
};

export class ProviderRouter {
  private adapters: Map<string, ProviderAdapter> = new Map();

  constructor(config: ProxaiConfig) {
    for (const [name, provider] of Object.entries(config.providers)) {
      const factory = ADAPTER_FACTORIES[name];
      if (!factory) {
        console.warn(`Unknown provider "${name}" — skipping`);
        continue;
      }
      const adapter = factory(provider.command, provider.args);
      this.adapters.set(provider.model_id, adapter);
    }
  }

  getAdapter(modelId: string): ProviderAdapter | undefined {
    return this.adapters.get(modelId);
  }

  listModels(): Array<{ id: string; name: string }> {
    return Array.from(this.adapters.entries()).map(([id, adapter]) => ({
      id,
      name: adapter.name,
    }));
  }

  /** Kill all adapter processes for a given session */
  async killSession(sessionId: string): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.kill(sessionId);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/providers/router.ts
git commit -m "feat: add provider router for model→adapter lookup"
```

---

## Chunk 4: HTTP Layer (Auth, Routes, Server)

### Task 9: Auth Middleware

**Files:**
- Create: `src/middleware/auth.ts`
- Create: `tests/auth.test.ts`

- [ ] **Step 1: Write failing auth test**

```typescript
// tests/auth.test.ts
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { authMiddleware } from "../src/middleware/auth.js";

function createApp(token: string) {
  const app = express();
  app.use(authMiddleware(token));
  app.get("/test", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("authMiddleware", () => {
  it("allows requests with valid Bearer token", async () => {
    const app = createApp("secret");
    const res = await request(app)
      .get("/test")
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("rejects requests without Authorization header", async () => {
    const app = createApp("secret");
    const res = await request(app).get("/test");
    expect(res.status).toBe(401);
  });

  it("rejects requests with wrong token", async () => {
    const app = createApp("secret");
    const res = await request(app)
      .get("/test")
      .set("Authorization", "Bearer wrong");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/auth.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement auth middleware**

```typescript
// src/middleware/auth.ts
import type { Request, Response, NextFunction } from "express";

export function authMiddleware(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: { message: "Missing Authorization header", type: "auth_error" } });
      return;
    }
    const token = header.slice(7);
    if (token !== expectedToken) {
      res.status(401).json({ error: { message: "Invalid API key", type: "auth_error" } });
      return;
    }
    next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/auth.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/middleware/auth.ts tests/auth.test.ts
git commit -m "feat: add Bearer token auth middleware"
```

---

### Task 10: Models Route

**Files:**
- Create: `src/routes/models.ts`
- Create: `tests/routes/models.test.ts`

- [ ] **Step 1: Write failing models test**

```typescript
// tests/routes/models.test.ts
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { modelsRoute } from "../src/routes/models.js";

function createApp() {
  const app = express();
  const mockModels = [
    { id: "claude-code", name: "claude" },
    { id: "codex-cli", name: "codex" },
  ];
  app.use("/v1/models", modelsRoute(mockModels));
  return app;
}

describe("GET /v1/models", () => {
  it("returns models in OpenAI format", async () => {
    const app = createApp();
    const res = await request(app).get("/v1/models");
    expect(res.status).toBe(200);
    expect(res.body.object).toBe("list");
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].id).toBe("claude-code");
    expect(res.body.data[0].object).toBe("model");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/routes/models.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement models route**

```typescript
// src/routes/models.ts
import { Router } from "express";

export function modelsRoute(models: Array<{ id: string; name: string }>) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      object: "list",
      data: models.map((m) => ({
        id: m.id,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: `proxai:${m.name}`,
      })),
    });
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/routes/models.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/models.ts tests/routes/models.test.ts
git commit -m "feat: add GET /v1/models endpoint"
```

---

### Task 11: Chat Completions Route

**Files:**
- Create: `src/routes/completions.ts`
- Create: `tests/routes/completions.test.ts`

This is the core endpoint. Handles streaming (SSE) and non-streaming. Uses `session_id` (custom extension in request body) for multi-turn. Stores the CLI-native session ID from the adapter's `SendResult.cliSessionId` for follow-up `--resume` calls.

- [ ] **Step 1: Write failing completions tests**

```typescript
// tests/routes/completions.test.ts
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { completionsRoute } from "../src/routes/completions.js";
import { SessionManager } from "../src/sessions/manager.js";
import { SessionStore } from "../src/sessions/store.js";
import type { ProviderAdapter, SendResult } from "../src/providers/adapter.js";

class MockAdapter implements ProviderAdapter {
  readonly name = "mock";
  readonly modelId = "mock-model";

  send(_prompt: string, _cliSessionId: string | null): SendResult {
    async function* gen() {
      yield "Hello ";
      yield "world!";
    }
    return {
      chunks: gen(),
      cliSessionId: Promise.resolve("mock-cli-session-1"),
    };
  }

  async kill(): Promise<void> {}
}

function createApp() {
  const store = new SessionStore(":memory:");
  const manager = new SessionManager(store, { idle_timeout_ms: 300000, max_concurrent: 10 });
  const mockAdapter = new MockAdapter();
  const getAdapter = (modelId: string) => modelId === "mock-model" ? mockAdapter : undefined;

  const app = express();
  app.use(express.json());
  app.use("/v1/chat/completions", completionsRoute(manager, getAdapter));
  return { app, manager, store };
}

describe("POST /v1/chat/completions", () => {
  it("returns non-streaming response in OpenAI format", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/v1/chat/completions")
      .send({
        model: "mock-model",
        messages: [{ role: "user", content: "Hi" }],
        stream: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.object).toBe("chat.completion");
    expect(res.body.choices[0].message.content).toBe("Hello world!");
    expect(res.body.choices[0].message.role).toBe("assistant");
  });

  it("returns session_id in response for multi-turn", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/v1/chat/completions")
      .send({
        model: "mock-model",
        messages: [{ role: "user", content: "Hi" }],
      });
    expect(res.body.session_id).toBeDefined();
  });

  it("returns 400 for unknown model", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/v1/chat/completions")
      .send({
        model: "unknown",
        messages: [{ role: "user", content: "Hi" }],
      });
    expect(res.status).toBe(400);
  });

  it("returns streaming SSE response", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/v1/chat/completions")
      .send({
        model: "mock-model",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.text).toContain("data: ");
    expect(res.text).toContain("[DONE]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/routes/completions.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement completions route**

```typescript
// src/routes/completions.ts
import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { SessionManager } from "../sessions/manager.js";
import type { ProviderAdapter } from "../providers/adapter.js";

export function completionsRoute(
  manager: SessionManager,
  getAdapter: (modelId: string) => ProviderAdapter | undefined
) {
  const router = Router();

  router.post("/", async (req, res) => {
    const { model, messages, stream, session_id } = req.body;

    if (!model || !messages || !Array.isArray(messages)) {
      res.status(400).json({
        error: { message: "Missing required fields: model, messages", type: "invalid_request_error" },
      });
      return;
    }

    const adapter = getAdapter(model);
    if (!adapter) {
      res.status(400).json({
        error: { message: `Model "${model}" not found`, type: "invalid_request_error" },
      });
      return;
    }

    // Find or create session
    let session = session_id ? manager.getSession(session_id) : null;
    if (!session) {
      session = manager.createSession(model, adapter.name);
    }

    // Store user message
    const lastMessage = messages[messages.length - 1];
    manager.addMessage(session.id, lastMessage.role, lastMessage.content);
    manager.touchSession(session.id);

    const prompt = lastMessage.content;
    const completionId = `chatcmpl-${randomUUID()}`;

    // Pass the CLI-native session ID (if any) for --resume
    const cliSessionId = session.cli_session_id ?? null;

    try {
      const { chunks, cliSessionId: cliSessionIdPromise } = adapter.send(prompt, cliSessionId);

      if (stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        let fullContent = "";

        for await (const chunk of chunks) {
          fullContent += chunk;
          const data = {
            id: completionId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            session_id: session.id,
            choices: [
              {
                index: 0,
                delta: { content: chunk },
                finish_reason: null,
              },
            ],
          };
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }

        // Final chunk
        const finalData = {
          id: completionId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          session_id: session.id,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        res.write(`data: ${JSON.stringify(finalData)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();

        manager.addMessage(session.id, "assistant", fullContent);
      } else {
        let content = "";
        for await (const chunk of chunks) {
          content += chunk;
        }

        manager.addMessage(session.id, "assistant", content);

        res.json({
          id: completionId,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          session_id: session.id,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }

      // Capture CLI-native session ID for future --resume calls
      const nativeSessionId = await cliSessionIdPromise;
      if (nativeSessionId) {
        manager.updateCliSessionId(session.id, nativeSessionId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      if (!res.headersSent) {
        res.status(500).json({
          error: { message, type: "server_error" },
        });
      }
    }
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/routes/completions.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/completions.ts tests/routes/completions.test.ts
git commit -m "feat: add POST /v1/chat/completions with streaming and session resume"
```

---

### Task 12: Sessions Route

**Files:**
- Create: `src/routes/sessions.ts`
- Create: `tests/routes/sessions.test.ts`

- [ ] **Step 1: Write failing sessions tests**

```typescript
// tests/routes/sessions.test.ts
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { sessionsRoute } from "../src/routes/sessions.js";
import { SessionManager } from "../src/sessions/manager.js";
import { SessionStore } from "../src/sessions/store.js";

function createApp() {
  const store = new SessionStore(":memory:");
  const manager = new SessionManager(store, { idle_timeout_ms: 300000, max_concurrent: 10 });
  const app = express();
  app.use(express.json());
  app.use("/v1/sessions", sessionsRoute(manager));
  return { app, manager, store };
}

describe("Sessions API", () => {
  it("POST /v1/sessions creates a session", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/v1/sessions")
      .send({ model: "claude-code", provider: "claude" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.provider).toBe("claude");
  });

  it("GET /v1/sessions lists sessions", async () => {
    const { app, manager } = createApp();
    manager.createSession("claude-code", "claude");
    const res = await request(app).get("/v1/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("GET /v1/sessions/:id returns session with messages", async () => {
    const { app, manager } = createApp();
    const session = manager.createSession("claude-code", "claude");
    manager.addMessage(session.id, "user", "Hello");
    const res = await request(app).get(`/v1/sessions/${session.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(session.id);
    expect(res.body.messages).toHaveLength(1);
  });

  it("DELETE /v1/sessions/:id deletes a session", async () => {
    const { app, manager } = createApp();
    const session = manager.createSession("claude-code", "claude");
    const res = await request(app).delete(`/v1/sessions/${session.id}`);
    expect(res.status).toBe(204);
    expect(manager.getSession(session.id)).toBeNull();
  });

  it("GET /v1/sessions/:id returns 404 for missing session", async () => {
    const { app } = createApp();
    const res = await request(app).get("/v1/sessions/nonexistent");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/routes/sessions.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement sessions route**

```typescript
// src/routes/sessions.ts
import { Router } from "express";
import type { SessionManager } from "../sessions/manager.js";

export function sessionsRoute(manager: SessionManager) {
  const router = Router();

  router.post("/", (req, res) => {
    const { model, provider } = req.body;
    if (!model || !provider) {
      res.status(400).json({
        error: { message: "Missing required fields: model, provider", type: "invalid_request_error" },
      });
      return;
    }
    try {
      const session = manager.createSession(model, provider);
      res.status(201).json(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      res.status(429).json({ error: { message, type: "rate_limit_error" } });
    }
  });

  router.get("/", (_req, res) => {
    res.json(manager.listSessions());
  });

  router.get("/:id", (req, res) => {
    const session = manager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: { message: "Session not found", type: "not_found" } });
      return;
    }
    const messages = manager.getMessages(session.id);
    res.json({ ...session, messages });
  });

  router.delete("/:id", (req, res) => {
    const session = manager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: { message: "Session not found", type: "not_found" } });
      return;
    }
    manager.deleteSession(session.id);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/routes/sessions.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/sessions.ts tests/routes/sessions.test.ts
git commit -m "feat: add sessions CRUD endpoints"
```

---

## Chunk 5: Server Assembly + Entry Point

### Task 13: Express Server Assembly

**Files:**
- Create: `src/server.ts`

- [ ] **Step 1: Implement server.ts**

```typescript
// src/server.ts
import express from "express";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProxaiConfig } from "./config.js";
import { authMiddleware } from "./middleware/auth.js";
import { SessionManager } from "./sessions/manager.js";
import { SessionStore } from "./sessions/store.js";
import { ProviderRouter } from "./providers/router.js";
import { modelsRoute } from "./routes/models.js";
import { completionsRoute } from "./routes/completions.js";
import { sessionsRoute } from "./routes/sessions.js";

export function createServer(config: ProxaiConfig) {
  const app = express();
  app.use(express.json());

  // Dependencies
  const store = new SessionStore("proxai.db");
  const manager = new SessionManager(store, config.sessions);
  const router = new ProviderRouter(config);

  // Kill adapter processes when sessions go idle
  manager.setOnIdleCallback((sessionId) => {
    router.killSession(sessionId);
  });

  // Serve static test UI (no auth)
  const __dirname = resolve(fileURLToPath(import.meta.url), "..");
  app.use("/ui", express.static(resolve(__dirname, "../public")));

  // Health check (no auth)
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Auth-protected API routes
  app.use("/v1", authMiddleware(config.auth.bearer_token));
  app.use("/v1/models", modelsRoute(router.listModels()));
  app.use("/v1/chat/completions", completionsRoute(manager, (m) => router.getAdapter(m)));
  app.use("/v1/sessions", sessionsRoute(manager));

  return { app, manager, store };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server.ts
git commit -m "feat: assemble Express server with all routes and static UI"
```

---

### Task 14: Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement index.ts**

```typescript
// src/index.ts
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

const config = loadConfig();
const { app, manager, store } = createServer(config);

const server = app.listen(config.server.port, config.server.host, () => {
  console.log(`Proxai running at http://${config.server.host}:${config.server.port}`);
  console.log(`Test UI: http://${config.server.host}:${config.server.port}/ui`);
  console.log("Press Ctrl+C to stop");
});

function shutdown() {
  console.log("\nShutting down...");
  manager.shutdown();
  store.close();
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: add entry point with graceful shutdown"
```

---

## Chunk 6: Test UI

### Task 15: Minimal Chat UI

**Files:**
- Create: `public/index.html`

A single HTML file with embedded CSS and JS. No build step. Features:
- Model selector dropdown
- Chat message list
- Input box + send button
- Streaming response display
- Session ID shown in header (for multi-turn)

- [ ] **Step 1: Create the test UI**

```html
<!-- public/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Proxai — Test UI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      padding: 12px 20px;
      background: #141414;
      border-bottom: 1px solid #2a2a2a;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    header h1 { font-size: 16px; font-weight: 600; color: #fff; }
    header select, header input {
      background: #1e1e1e;
      border: 1px solid #333;
      color: #e0e0e0;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 13px;
    }
    header input { width: 200px; }
    .session-info { font-size: 11px; color: #666; margin-left: auto; }
    #chat {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .msg {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .msg.user {
      align-self: flex-end;
      background: #1a3a5c;
      color: #d0e8ff;
    }
    .msg.assistant {
      align-self: flex-start;
      background: #1e1e1e;
      color: #e0e0e0;
    }
    .msg.error {
      align-self: center;
      background: #3c1111;
      color: #ff8888;
      font-size: 12px;
    }
    #input-area {
      padding: 16px 20px;
      background: #141414;
      border-top: 1px solid #2a2a2a;
      display: flex;
      gap: 10px;
    }
    #prompt {
      flex: 1;
      background: #1e1e1e;
      border: 1px solid #333;
      color: #e0e0e0;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      resize: none;
      min-height: 44px;
      max-height: 120px;
    }
    #prompt:focus { outline: none; border-color: #4a9eff; }
    #send {
      background: #4a9eff;
      color: #fff;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
      font-weight: 500;
    }
    #send:hover { background: #3a8eef; }
    #send:disabled { background: #333; color: #666; cursor: not-allowed; }
  </style>
</head>
<body>
  <header>
    <h1>Proxai</h1>
    <select id="model">
      <option value="">Loading models...</option>
    </select>
    <input id="api-key" type="password" placeholder="Bearer token" value="change-me">
    <span class="session-info" id="session-info">No session</span>
  </header>
  <div id="chat"></div>
  <div id="input-area">
    <textarea id="prompt" placeholder="Type a message..." rows="1"></textarea>
    <button id="send">Send</button>
  </div>

  <script>
    const chatEl = document.getElementById("chat");
    const promptEl = document.getElementById("prompt");
    const sendBtn = document.getElementById("send");
    const modelEl = document.getElementById("model");
    const apiKeyEl = document.getElementById("api-key");
    const sessionInfoEl = document.getElementById("session-info");

    let sessionId = null;

    function headers() {
      return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKeyEl.value}`,
      };
    }

    async function loadModels() {
      try {
        const res = await fetch("/v1/models", { headers: headers() });
        const data = await res.json();
        modelEl.innerHTML = "";
        for (const m of data.data) {
          const opt = document.createElement("option");
          opt.value = m.id;
          opt.textContent = `${m.id} (${m.owned_by})`;
          modelEl.appendChild(opt);
        }
      } catch (e) {
        modelEl.innerHTML = '<option value="">Failed to load</option>';
      }
    }

    function addMessage(role, content) {
      const div = document.createElement("div");
      div.className = `msg ${role}`;
      div.textContent = content;
      chatEl.appendChild(div);
      chatEl.scrollTop = chatEl.scrollHeight;
      return div;
    }

    async function sendMessage() {
      const prompt = promptEl.value.trim();
      if (!prompt) return;

      promptEl.value = "";
      sendBtn.disabled = true;
      addMessage("user", prompt);

      const assistantDiv = addMessage("assistant", "");

      try {
        const body = {
          model: modelEl.value,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        };
        if (sessionId) body.session_id = sessionId;

        const res = await fetch("/v1/chat/completions", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json();
          assistantDiv.className = "msg error";
          assistantDiv.textContent = err.error?.message || "Request failed";
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;

            try {
              const event = JSON.parse(payload);
              if (event.session_id && !sessionId) {
                sessionId = event.session_id;
                sessionInfoEl.textContent = `Session: ${sessionId.slice(0, 8)}...`;
              }
              const delta = event.choices?.[0]?.delta?.content;
              if (delta) {
                fullText += delta;
                assistantDiv.textContent = fullText;
                chatEl.scrollTop = chatEl.scrollHeight;
              }
            } catch {}
          }
        }
      } catch (e) {
        assistantDiv.className = "msg error";
        assistantDiv.textContent = e.message;
      } finally {
        sendBtn.disabled = false;
        promptEl.focus();
      }
    }

    sendBtn.addEventListener("click", sendMessage);
    promptEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-resize textarea
    promptEl.addEventListener("input", () => {
      promptEl.style.height = "auto";
      promptEl.style.height = Math.min(promptEl.scrollHeight, 120) + "px";
    });

    loadModels();
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: add minimal chat test UI"
```

---

## Chunk 7: Smoke Test

### Task 16: End-to-End Smoke Test

- [ ] **Step 1: Start the server**

```bash
cd /home/anuarder/Documents/Projects/proxai
npx tsx src/index.ts &
```

- [ ] **Step 2: Test health check**

```bash
curl http://127.0.0.1:3077/health
```
Expected: `{"status":"ok"}`

- [ ] **Step 3: Test models endpoint**

```bash
curl -H "Authorization: Bearer change-me" http://127.0.0.1:3077/v1/models
```
Expected: JSON list with `claude-code` and `codex-cli`

- [ ] **Step 4: Test non-streaming completions with Claude Code**

```bash
curl -X POST http://127.0.0.1:3077/v1/chat/completions \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-code","messages":[{"role":"user","content":"Say hello in one word"}],"stream":false}'
```
Expected: OpenAI-format JSON response with Claude's answer and a `session_id` field

- [ ] **Step 5: Test streaming**

```bash
curl -N -X POST http://127.0.0.1:3077/v1/chat/completions \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-code","messages":[{"role":"user","content":"Say hello"}],"stream":true}'
```
Expected: SSE stream with `data:` lines containing chunks and `[DONE]`

- [ ] **Step 6: Test the UI**

Open `http://127.0.0.1:3077/ui` in a browser. Send a message. Verify:
- Model dropdown shows `claude-code` and `codex-cli`
- Streaming response appears token-by-token
- Session ID appears in the header after first message

- [ ] **Step 7: Kill server and final commit**

```bash
kill %1
git add -A
git commit -m "chore: MVP complete — smoke test passed"
```
