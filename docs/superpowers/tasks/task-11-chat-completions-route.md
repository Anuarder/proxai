# Task 11: Chat Completions Route

**Chunk:** 4 — HTTP Layer (Auth, Routes, Server)
**Dependencies:** Task 4, Task 5
**Status:** Done

## Description

Core endpoint: `POST /v1/chat/completions`. Handles both streaming (SSE) and non-streaming responses. Creates/reuses sessions, stores messages, and captures CLI-native session IDs for `--resume` support.

## Files

- Create: `src/routes/completions.ts`
- Create: `tests/routes/completions.test.ts`

## Acceptance Criteria

- [x] Non-streaming: returns OpenAI `chat.completion` format with `choices[0].message.content`
- [x] Streaming: returns SSE with `chat.completion.chunk` events, ends with `data: [DONE]`
- [x] Returns `session_id` in response (custom extension for multi-turn)
- [x] Creates new session if no `session_id` in request body
- [x] Reuses existing session if `session_id` is provided
- [x] Returns 400 for unknown model
- [x] Returns 400 for missing `model` or `messages`
- [x] Stores user and assistant messages in session history
- [x] Captures CLI-native session ID from adapter's `SendResult.cliSessionId`
- [x] All tests pass (with mock adapter): `npx vitest run tests/routes/completions.test.ts`

## Steps

- [x] 1. Write failing tests (`tests/routes/completions.test.ts`) — 4 test cases with `MockAdapter`
- [x] 2. Run test to verify it fails
- [x] 3. Implement `src/routes/completions.ts`
- [x] 4. Run test to verify it passes
- [x] 5. Commit

## Data Flow

1. Client sends `{ model, messages, stream?, session_id? }`
2. Resolve adapter by model name
3. Find or create session
4. Store user message, touch session
5. Call `adapter.send(prompt, cliSessionId)` — pass stored CLI session ID for `--resume`
6. Stream/collect response chunks
7. Store assistant message
8. Capture CLI session ID for future calls

## Commit Message

```
feat: add POST /v1/chat/completions with streaming and session resume
```
