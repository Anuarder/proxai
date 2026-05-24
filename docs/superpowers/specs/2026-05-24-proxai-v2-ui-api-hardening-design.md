# Proxai v2 — Stateless Wire, Rich Event Streaming, and a Daily-Driver UI

**Status:** Draft
**Date:** 2026-05-24
**Author:** anuar.i@epicstar.net

---

## 1. Overview

### Problem

Proxai today proxies Claude Code and Codex CLIs through an OpenAI-compatible REST API, but the daily-use experience has gaps:

- The UI shows every configured model regardless of whether the underlying CLI is installed or authenticated, so the user only learns about a missing binary or expired auth after a failed request.
- Hangs, silent failures, and orphaned child processes require server restarts to recover.
- The streamed response is plain text, with no visibility into what the agent did (tool calls, thinking, file edits) — the same information the user sees when running Claude Code natively.
- Conversation state is split between proxai's SQLite store and the CLI's own session files, making behaviour hard to reason about.
- There is no machine-readable API contract for the apps that use the proxy.

### Goal

Make proxai's UI and API a stable daily driver:

- A **stateless wire**: the UI owns the full message history and sends it on every request; the server keeps no conversation state.
- A **normalized typed-event SSE protocol** on a new `/v1/chat/stream` endpoint that exposes text deltas, thinking, tool calls, tool results, file edits, command executions, auth prompts, errors, and usage.
- **Live provider health checks** on `/v1/models` plus mid-stream auth detection, so the UI can surface auth prompts without a server restart.
- **Stability fixes** for hangs, silent failures, process leaks, and recovery from auth/config changes.
- A **published OpenAPI 3.1 schema** generated from Zod definitions.
- A UI that renders markdown, shows an event timeline, surfaces availability, and supports request cancellation.

### Non-goals (covered by other PRDs)

- RAG, project onboarding, cross-session memory — Context Management PRD.
- Provider coverage beyond claude + codex — Provider Coverage PRD.
- Model routing / classifier / cost optimization — `2026-03-14-token-optimization-design.md`.
- Agent system / parallel worktrees — Agent System PRD.
- Persistent stats dashboard, session list UI — out (server is stateless; UI is per-page-load).
- Cost estimation in `usage` events — the field is reserved but unset in v2.

### Clarification

Proxai today does not use MCP — it spawns CLI subprocesses (`claude -p …`, `codex exec --json …`) and parses their JSON output. v2 keeps that model. "Send all context for each request from the UI" means the UI assembles the full `messages[]` array on every call; the server passes that string to the CLI as a single prompt.

---

## 2. Stateless Wire & Adapter Changes

### Stateless server

The server stores no conversation state.

- Delete `src/sessions/manager.ts`, `src/sessions/store.ts`, `src/routes/sessions.ts`, and the `proxai.db*` artefacts.
- Remove `better-sqlite3` from dependencies.
- Drop the `sessions:` block from `proxai.config.yaml`.
- No `session_id` in requests or responses. No `--resume` flag passed to the CLIs.
- Each request spawns a single CLI run that handles the turn from scratch.

The trade-off is explicit: proxai re-pays the CLI's startup + context-replay cost on every turn. Future work (token-optimization spec) can reintroduce caching once it is needed.

### Prompt assembly

Adapters receive `messages: Message[]` and assemble a single prompt string via a shared helper `src/providers/prompt.ts`:

- System messages become `System: <content>\n\n` at the top.
- User/assistant turns become labeled blocks (`User: …`, `Assistant: …`).
- The final block is always the latest user message.

Both adapters pass the assembled string as a single positional argument (`claude -p <prompt>` / `codex exec <prompt>`).

### Adapter interface (`src/providers/adapter.ts`)

```ts
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderAdapter {
  readonly name: string;
  readonly modelId: string;
  send(messages: Message[], signal: AbortSignal): SendResult;
  probe(timeoutMs: number): Promise<ProbeResult>;
}

export interface SendResult {
  events: AsyncIterable<ProxaiEvent>;
}

export type ProbeResult =
  | { status: 'ready' }
  | { status: 'missing_binary' }
  | { status: 'not_authenticated'; hint: string }
  | { status: 'error'; message: string };
```

Changes from v1:

- `kill(sessionId)` is gone; cancellation is via `AbortSignal`.
- `cliSessionId` is gone from results.
- `chunks: AsyncIterable<string>` becomes `events: AsyncIterable<ProxaiEvent>`.
- New `probe(timeoutMs)` method per adapter.

### ClaudeCodeAdapter behaviour

- Spawn `claude -p --output-format stream-json --verbose --include-partial-messages <prompt>`.
- Parse each JSON line and emit typed events per the mapping table in §3.
- Capture stderr; on non-zero exit without a `result` event, emit an `error` event with `stderr_tail` (last 4 KB).
- Recognise auth-prompt patterns in stdout/stderr (e.g. `Please run /login`, `not authenticated`); on match, emit `auth_required` and terminate.
- `probe()` runs `claude --version` for binary presence, then a minimal auth probe (`claude -p --output-format stream-json "ping"` with `probe_timeout_ms` budget) and inspects the first event for a `system` block (ready) or an auth pattern (`not_authenticated`).

### CodexAdapter behaviour

- Spawn `codex exec --json <prompt>`.
- Parse `thread.started`, `item.completed` (`agent_message` / `reasoning` / `command` / `file_change`), `turn.completed`.
- Same stderr capture and auth-pattern handling.
- `probe()` runs `codex --version`, then a short `codex exec --json "ping"` probe with the same pattern matching.

### Process lifecycle

- The `AbortSignal` on `send()` is wired to `process.kill('SIGTERM')` → `process_kill_grace_ms` wait → `SIGKILL`.
- The server maintains a `Set<ChildProcess>` of live children.
- `req.on('close')` aborts the signal → adapter kills the child.
- `SIGINT` / `SIGTERM` on the server iterate the set and clean up.
- A periodic reaper (every 30 s) detects orphans whose `req` is already closed and kills them as a safety net.
- Two timeouts (config):
  - `request_timeout_ms` (default 300_000) — hard cap on the whole request.
  - `idle_timeout_ms` (default 60_000) — kill if no event arrives within the window.

### Files affected

- **Delete:** `src/sessions/manager.ts`, `src/sessions/store.ts`, `src/routes/sessions.ts`, `proxai.db*`, sessions-related tests.
- **Modify:** `src/providers/adapter.ts`, `src/providers/claude.ts`, `src/providers/codex.ts`, `src/providers/router.ts`, `src/server.ts`, `src/routes/completions.ts`, `src/config.ts`, `proxai.config.yaml`.
- **Add:** `src/providers/prompt.ts`, `src/providers/probe.ts`, `src/events/schema.ts`, `src/routes/stream.ts`, `src/routes/openapi.ts`, `src/lifecycle/children.ts`.

---

## 3. Event Protocol, Endpoints, OpenAPI

### Wire format

Server-Sent Events with named event types. Each event:

```
event: <type>
data: <json>

```

A final `event: done\ndata: {}\n\n` closes the stream cleanly. The server writes `: keep-alive\n\n` heartbeats every 15 s to keep the connection alive through proxies and reverse proxies.

### Event schema

Defined in `src/events/schema.ts` as Zod schemas so OpenAPI can be derived. The union is `ProxaiEvent`.

| event | fields | when |
|---|---|---|
| `start` | `{ request_id: string, model: string, provider: string }` | first event of every stream |
| `text_delta` | `{ text: string }` | streamed assistant text chunk |
| `thinking_delta` | `{ text: string }` | streamed thinking/reasoning chunk (Claude `thinking` blocks, Codex `reasoning` items) |
| `tool_use` | `{ id: string, name: string, input: unknown }` | agent calls a tool (raw, provider-faithful) |
| `tool_result` | `{ tool_use_id: string, content: string, is_error: boolean }` | tool result returned to the agent |
| `file_edit` | `{ path: string, action: 'read' \| 'write' \| 'edit', summary: string }` | derived from tool calls (Edit/Write/Read tools, Codex `file_change`) |
| `command_exec` | `{ command: string, exit_code?: number, output_summary: string }` | derived from Bash tool / Codex `command` |
| `auth_required` | `{ provider: string, message: string, hint: string }` | CLI signalled missing auth; stream then closes |
| `error` | `{ code: string, message: string, retriable: boolean, stderr_tail?: string }` | unrecoverable error; stream then closes |
| `usage` | `{ input_tokens: number, output_tokens: number, total_tokens: number, cost_usd?: number }` | emitted near end if the CLI reports it |
| `turn_complete` | `{ reason: 'stop' \| 'max_tokens' \| 'aborted' \| 'error' }` | last non-`done` event |
| `done` | `{}` | terminator |

`file_edit` and `command_exec` are **derived** events: when the adapter sees a `tool_use` whose name maps to a known tool (`Edit`, `Write`, `Read`, `Bash`, Codex `file_change` / `command`), it emits both the raw `tool_use` and the derived event. The UI prefers the derived event for rendering; raw `tool_use` remains in the stream for non-mapped tools (`WebSearch`, MCP tools, etc.) and for clients that want full fidelity.

### Provider → common event mapping

**Claude (`stream-json`)**

| Claude event | Proxai event(s) |
|---|---|
| `system: init` | capture session id internally (not emitted); emit `start` |
| `stream_event: content_block_start { type: 'text' }` + subsequent `content_block_delta { type: 'text_delta' }` | `text_delta` per delta |
| `stream_event: content_block_start { type: 'thinking' }` + subsequent `thinking_delta` | `thinking_delta` per delta |
| `assistant message content_block: tool_use { id, name, input }` | `tool_use`, plus `file_edit` if name ∈ {`Edit`, `Write`, `Read`, `NotebookEdit`} or `command_exec` if name == `Bash` |
| `user message content_block: tool_result { tool_use_id, content, is_error }` | `tool_result` |
| `result` | `usage` (if `usage` present), then `turn_complete: { reason: 'stop' }` |

**Codex (`--json`)**

| Codex event | Proxai event(s) |
|---|---|
| `thread.started` | capture thread_id internally; emit `start` |
| `item.completed: agent_message { text }` | `text_delta { text }` (whole message in one chunk; Codex doesn't stream tokens) |
| `item.completed: reasoning { text }` | `thinking_delta { text }` |
| `item.completed: command { command, output, exit_code }` | `tool_use { name: 'shell', input: { command } }`, then `command_exec` |
| `item.completed: file_change { path, action }` | `tool_use { name: 'file_change', input: { path, action } }`, then `file_edit` |
| `turn.completed { usage? }` | `usage` (if present), then `turn_complete` |

### Endpoints

#### `GET /v1/models`

Probes every provider on every request (no cache).

Response:
```json
{
  "object": "list",
  "data": [
    {
      "id": "claude-code",
      "object": "model",
      "owned_by": "proxai:claude",
      "status": "ready"
    },
    {
      "id": "codex-cli",
      "object": "model",
      "owned_by": "proxai:codex",
      "status": "not_authenticated",
      "hint": "Run: codex login"
    }
  ]
}
```

`status` is one of `ready`, `missing_binary`, `not_authenticated`, `error`. Probes run in parallel; each is bounded by `probe_timeout_ms` (default 5_000).

#### `POST /v1/chat/stream`

New rich-event endpoint. Always streams.

Request:
```json
{
  "model": "claude-code",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." },
    { "role": "user", "content": "..." }
  ]
}
```

Response: SSE per the event schema above.

Synchronous validation failures (missing `model`, unknown `model`, missing binary discovered on probe before stream begins) return HTTP 400/503 with JSON body `{ error: { code, message } }` — no SSE in that case. Once the stream has begun, all failures are typed `error` or `auth_required` events followed by `done`.

#### `POST /v1/chat/completions` (kept for OpenAI compatibility)

Same OpenAI shape as today (`choices[].delta.content` SSE chunks or non-streaming JSON). Internally consumes the same typed-event stream and down-converts:

- `text_delta` → `choices[0].delta.content`.
- `auth_required` / `error` → terminate stream with an OpenAI-style error chunk (`{ error: { message } }`).
- All other event types are discarded.

The UI does not use this endpoint; it exists for external apps that already speak the OpenAI shape.

#### `GET /openapi.json`

OpenAPI 3.1 schema generated from Zod definitions via `@asteasolutions/zod-to-openapi`. Both endpoints documented. The event schema appears in `components.schemas.ProxaiEvent` as a discriminated union so consumers can codegen typed clients.

#### `GET /docs`

Swagger UI bundle (standalone, pinned CDN) served as a single static HTML that points at `/openapi.json`.

### Auth

Bearer token middleware stays on `/v1/*`. `/openapi.json` and `/docs` are unauthenticated for ease of inspection (the schema does not expose secrets).

---

## 4. UI, Stability, Config, Testing, Migration

### UI changes

The UI stays a single-page vanilla JS application in `public/index.html` (no build step). The existing dark theme and layout are preserved; the additions are:

- **Markdown rendering.** Assistant text rendered with `marked` + `highlight.js` from a pinned CDN. User messages stay plain text. All HTML is passed through `DOMPurify` before insertion.
- **Event timeline panel.** Each assistant turn renders as a vertical timeline above the final markdown answer:
  - `thinking_delta` chunks: collapsed by default, expandable, dim italic mono.
  - `tool_use`: one row per call showing tool name + abbreviated input; click to expand full input/result.
  - `file_edit`: row shows `path` + action icon + summary.
  - `command_exec`: row shows the command and exit code.
  - The final assistant message is rendered as markdown below the timeline.
- **Cancel button.** Replaces the Send button while a request is in flight; clicking calls `AbortController.abort()` on the fetch, which closes the SSE and triggers server-side child kill.
- **Model availability badges.** The model `<select>` shows each option's status next to the label:
  - green dot — `ready`
  - red `!` (with tooltip showing `hint`) — `not_authenticated`
  - grey `?` — `missing_binary`
  - red `x` — `error`

  Unavailable models stay selectable so the user can hit one and see the error directly. Clarity over magic.
- **Auth-required banner.** When the stream emits `auth_required`, the UI shows a sticky banner with `message` + `hint`. A "Re-check" button calls `GET /v1/models` again and re-renders the badge.
- **Full-context-from-UI.** UI keeps `messages: Message[]` in memory (no `sessionStorage` — fresh on reload, matching the stateless server). Every request sends the whole array. A "Clear" button resets the array and the rendered transcript.
- **Endpoint switch.** UI calls `/v1/chat/stream`, not `/v1/chat/completions`.

### Stability rules

Closes all four categories called out during brainstorming:

- **Hangs.** `request_timeout_ms` (default 300_000) and `idle_timeout_ms` (default 60_000) emit `error { code: 'request_timeout' \| 'idle_timeout' }` then kill the child.
- **Silent failures.** Every adapter error path emits a typed `error` with `stderr_tail` (last 4 KB). HTTP-level failures return JSON `{ error: { code, message } }`. UI renders `error` events inline in the timeline at the position they occurred.
- **Process leaks.** `Set<ChildProcess>` of live children; cleanup on `SIGINT`/`SIGTERM`, `req.on('close')`, and a 30 s reaper for orphans. SIGTERM → `process_kill_grace_ms` (default 2_000) → SIGKILL.
- **Recovery from auth/config changes.** No state to invalidate. After the user runs `claude login` / `codex login`, the next `/v1/models` call (or the UI's Re-check button) reflects live status without a restart.

### Config (`proxai.config.yaml`)

```yaml
server:
  port: 3077
  host: "127.0.0.1"

auth:
  bearer_token: "your-secret-key"

timeouts:
  request_timeout_ms: 300000
  idle_timeout_ms: 60000
  probe_timeout_ms: 5000
  process_kill_grace_ms: 2000

providers:
  claude:
    command: "claude"
    model_id: "claude-code"
  codex:
    command: "codex"
    model_id: "codex-cli"
```

The `sessions:` block is removed. The `args:` field on each provider is removed (adapters own their CLI invocation).

### Testing

- **Unit:**
  - `assemblePrompt(messages)` for system/user/assistant interleavings.
  - Event-mapping fixtures: record real CLI stream-json output into `tests/fixtures/claude/*.jsonl` and `tests/fixtures/codex/*.jsonl`; assert mapping to `ProxaiEvent[]`.
  - Auth-pattern detection against canned stderr samples.
- **Integration:**
  - Probe results: missing binary (mock `spawn` to throw `ENOENT`); not_authenticated (mock stdout to emit auth pattern); ready.
  - Stream cancel: start a request, `AbortController.abort()`, assert SSE closes and child receives SIGTERM.
  - Timeout: stub adapter to never emit; assert `idle_timeout` error event fires.
- **Smoke:** rewrite the existing smoke test to use `/v1/chat/stream` against a real CLI; verify at least one `text_delta` and one `turn_complete` event arrive.

### Migration & cleanup

- Delete `src/sessions/`, `src/routes/sessions.ts`, `proxai.db*`, related tests.
- Remove `better-sqlite3` from dependencies.
- Update `CLAUDE.md` if it references SQLite or sessions.
- Annotate the Test UI PRD outline in `docs/tech-task-for-the-future.md` as covered by this spec (or move it under a "Superseded" heading).
- Add CDN script tags for `marked`, `highlight.js`, `DOMPurify` to `public/index.html` (pinned versions).
- Add `@asteasolutions/zod-to-openapi` to dependencies.
- Add Swagger UI standalone bundle as a CDN script tag in a new `public/docs.html` served at `/docs`.

### Locked defaults (originally open questions)

- **UI library load:** CDN imports with pinned versions. Matches the current no-build-step UI pattern.
- **Cost estimation:** out of scope for v2. `usage.cost_usd` stays optional and is never set by adapters. Future PRD owns it.
- **OpenAPI library:** `@asteasolutions/zod-to-openapi`.

---

## 5. Build sequence (rough)

1. Event schema + Zod types (`src/events/schema.ts`).
2. Adapter interface change + shared prompt assembler (`src/providers/adapter.ts`, `src/providers/prompt.ts`).
3. Claude adapter: event mapping + probe + lifecycle.
4. Codex adapter: event mapping + probe + lifecycle.
5. Child-process registry + timeouts (`src/lifecycle/children.ts`).
6. `/v1/chat/stream` route (`src/routes/stream.ts`).
7. Refactor `/v1/chat/completions` to consume the typed-event stream and down-convert.
8. Refactor `/v1/models` to call live probes.
9. Delete `src/sessions/*`, `src/routes/sessions.ts`, drop `better-sqlite3`, prune config.
10. OpenAPI generation + `/openapi.json` + `/docs` page.
11. UI: endpoint switch, markdown rendering, event timeline, availability badges, auth banner, cancel button, full-context-from-UI semantics.
12. Tests: unit fixtures, integration tests, smoke rewrite.
13. Docs/CLAUDE.md cleanup.

---

## 6. Risks

- **CLI auth-pattern detection is heuristic.** New CLI versions may change the wording; detection should fail-safe (treat unknown errors as `error`, not `auth_required`) and the patterns should be centralised so a single edit covers both code paths.
- **Stateless model loses CLI session warm-state.** First turns are unaffected; long conversations re-pay context cost. Acceptable for v2; revisit when token-optimization lands.
- **Event-mapping coverage.** Tool sets (Claude tool names, Codex item types) evolve. Mitigation: emit raw `tool_use` alongside derived events so the UI degrades gracefully when a new tool isn't mapped.
- **OpenAPI for SSE.** OpenAPI's support for SSE response bodies is awkward. The schema will document the event union under `components.schemas.ProxaiEvent` and reference it from the endpoint with `text/event-stream` content; tooling support varies, but the schema is still useful as a typed contract.
