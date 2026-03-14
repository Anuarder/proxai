# Proxai — Product Requirements Document

> Local AI gateway that proxies OpenAI-compatible API requests to authenticated CLI tools (Claude Code, Codex, and more).

## Problem

You already have AI CLI tools authenticated on your machine. But every new app, UI, or project that uses AI demands its own API key and billing. Proxai eliminates that — it wraps your local CLI tools behind a standard OpenAI-compatible API so any client can use them without separate keys.

## Core Concept

```
Any OpenAI-compatible client
        │
        ▼
   ┌─────────┐
   │  Proxai  │  ← Express server, OpenAI-compatible API
   └────┬─────┘
        │
   ┌────▼──────────┐
   │ Provider Router│  ← model name → adapter
   └──┬─────────┬──┘
      │         │
  ┌───▼──┐  ┌──▼───┐
  │Claude │  │Codex │   ← one adapter per CLI tool
  │Code   │  │CLI   │
  └───┬───┘  └──┬───┘
      │         │
  child_process (stdin/stdout)
```

## MVP Scope

### In Scope

- **OpenAI-compatible endpoints:**
  - `POST /v1/chat/completions` — send messages, get responses (streaming + non-streaming)
  - `GET /v1/models` — list available providers as models
- **Session management (custom extension):**
  - `POST /v1/sessions` — create a new session (optionally tied to a provider)
  - `GET /v1/sessions` — list sessions
  - `GET /v1/sessions/:id` — get session details + history
  - `DELETE /v1/sessions/:id` — kill session process and clean up
- **Two providers:**
  - Claude Code adapter (`claude` CLI)
  - Codex adapter (`codex` CLI)
- **SQLite storage:**
  - Session metadata (id, provider, created_at, last_active, status)
  - Message history (session_id, role, content, timestamp)
- **Auth:** Static Bearer token from config
- **Process lifecycle:** One child process per session, killed after configurable idle timeout

### Out of Scope (Future)

- User accounts / multi-user auth
- Web UI
- Tool/function calling passthrough
- Rate limiting
- Multiple simultaneous models per session
- Session sharing between providers (future — store history, replay into new provider)

## Architecture

### Components

| Component | Responsibility |
|-----------|---------------|
| **Express Server** | HTTP layer, OpenAI-compatible routes, SSE streaming |
| **Auth Middleware** | Validates `Authorization: Bearer <key>` header |
| **Session Manager** | CRUD for sessions, idle timeout tracking, SQLite persistence |
| **Provider Router** | Maps model name to the correct adapter |
| **Provider Adapter** (interface) | Common contract: `send(messages) → AsyncIterable<string>` |
| **Claude Code Adapter** | Spawns/manages `claude` CLI process |
| **Codex Adapter** | Spawns/manages `codex` CLI process |
| **Process Pool** | Tracks active child processes, handles cleanup on idle/exit |

### Provider Adapter Interface

```typescript
interface ProviderAdapter {
  readonly name: string;
  readonly modelId: string;

  spawn(sessionId: string): Promise<void>;
  send(messages: Message[]): AsyncIterable<string>;
  isAlive(): boolean;
  kill(): Promise<void>;
}
```

Every new CLI tool = one new file implementing this interface. No changes to the server, router, or session logic.

### Data Flow

1. Client sends `POST /v1/chat/completions` with model + messages
2. Auth middleware checks Bearer token
3. Session Manager finds or creates a session
4. Provider Router selects adapter by model name
5. Adapter sends messages to the CLI process via stdin
6. CLI process streams response via stdout
7. Server converts chunks to OpenAI SSE format (`data: {"choices": [{"delta": {"content": "..."}}]}`)
8. Message history saved to SQLite

### Session Lifecycle

```
Created → Active (process running) → Idle → Killed (process dead, history preserved)
                                                │
                                                ▼
                                        Resumable (spawn new process, replay context)
```

- Sessions are created on first request or explicitly via `POST /v1/sessions`
- Idle timeout is configurable (default: 5 minutes)
- Killed sessions retain their history in SQLite
- Resuming a session spawns a new CLI process; the adapter decides how to restore context (e.g., `claude --resume` flag, or replaying history)

### SQLite Schema

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  last_active TEXT NOT NULL,
  config TEXT  -- JSON blob for provider-specific settings
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,  -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL
);
```

### Config

```yaml
# proxai.config.yaml
server:
  port: 3077
  host: "127.0.0.1"

auth:
  bearer_token: "your-secret-key"

sessions:
  idle_timeout_ms: 300000  # 5 minutes
  max_concurrent: 10

providers:
  claude:
    command: "claude"
    args: ["--print"]  # flags for non-interactive mode
    model_id: "claude-code"
  codex:
    command: "codex"
    args: []
    model_id: "codex-cli"
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js 20+ |
| Language | TypeScript |
| HTTP | Express |
| Database | SQLite via better-sqlite3 |
| Process mgmt | Node child_process (spawn) |
| Streaming | Server-Sent Events (SSE) |
| Config | YAML (js-yaml) |
| Validation | zod |

## Project Structure

```
proxai/
├── src/
│   ├── index.ts              # entry point
│   ├── server.ts             # Express setup + routes
│   ├── middleware/
│   │   └── auth.ts           # Bearer token check
│   ├── routes/
│   │   ├── completions.ts    # /v1/chat/completions
│   │   ├── models.ts         # /v1/models
│   │   └── sessions.ts       # /v1/sessions CRUD
│   ├── sessions/
│   │   ├── manager.ts        # Session lifecycle + idle tracking
│   │   └── store.ts          # SQLite operations
│   ├── providers/
│   │   ├── adapter.ts        # ProviderAdapter interface
│   │   ├── router.ts         # Model name → adapter lookup
│   │   ├── claude.ts         # Claude Code adapter
│   │   └── codex.ts          # Codex adapter
│   └── config.ts             # Load + validate config
├── proxai.config.yaml
├── package.json
├── tsconfig.json
└── PRD.md
```

## Success Criteria (MVP)

1. `curl` to `POST /v1/chat/completions` with model `claude-code` returns a streamed response from the Claude Code CLI
2. Same request with model `codex-cli` routes to Codex
3. Sessions persist across requests — sending follow-up messages maintains context
4. Idle sessions are automatically killed after timeout
5. Killed sessions can be resumed
6. Any OpenAI-compatible client (e.g., setting `base_url` in the OpenAI Python SDK) works without modification
