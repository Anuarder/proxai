# Task 11: Chat Completions Route

**Chunk:** 4 — HTTP Layer (Auth, Routes, Server)
**Dependencies:** Task 4, Task 5
**Status:** Not started

## Description

Core endpoint: `POST /v1/chat/completions`. Handles both streaming (SSE) and non-streaming responses. Creates/reuses sessions, stores messages, and captures CLI-native session IDs for `--resume` support.

## Files

- Create: `src/routes/completions.ts`
- Create: `tests/routes/completions.test.ts`

## Acceptance Criteria

- [ ] Non-streaming: returns OpenAI `chat.completion` format with `choices[0].message.content`
- [ ] Streaming: returns SSE with `chat.completion.chunk` events, ends with `data: [DONE]`
- [ ] Returns `session_id` in response (custom extension for multi-turn)
- [ ] Creates new session if no `session_id` in request body
- [ ] Reuses existing session if `session_id` is provided
- [ ] Returns 400 for unknown model
- [ ] Returns 400 for missing `model` or `messages`
- [ ] Stores user and assistant messages in session history
- [ ] Captures CLI-native session ID from adapter's `SendResult.cliSessionId`
- [ ] All tests pass (with mock adapter): `npx vitest run tests/routes/completions.test.ts`

## Steps

- [ ] 1. Write failing tests (`tests/routes/completions.test.ts`) — 4 test cases with `MockAdapter`
- [ ] 2. Run test to verify it fails
- [ ] 3. Implement `src/routes/completions.ts`
- [ ] 4. Run test to verify it passes
- [ ] 5. Commit

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
