# Task 6: Claude Code Adapter

**Chunk:** 3 — Provider Adapter Interface + Implementations
**Dependencies:** Task 5
**Status:** Not started

## Description

Adapter for the Claude Code CLI. Spawns `claude -p` processes with `--output-format stream-json --verbose --include-partial-messages` for token-by-token streaming. Supports `--resume <session-id>` for multi-turn conversations.

## Files

- Create: `src/providers/claude.ts`
- Create: `tests/providers/claude.test.ts`

## Acceptance Criteria

- [ ] `adapter.name` is `"claude"`, `adapter.modelId` is `"claude-code"`
- [ ] `send(prompt, null)` spawns `claude` with base args + prompt as last arg
- [ ] `send(prompt, cliSessionId)` adds `--resume <cliSessionId>` before prompt
- [ ] Streams text chunks from `stream_event` → `content_block_delta` → `text_delta` events
- [ ] Captures CLI session ID from `result` event's `session_id` field
- [ ] Returns `SendResult` with `chunks` (AsyncIterable) and `cliSessionId` (Promise)
- [ ] `kill()` is a no-op (print-mode processes exit on their own)
- [ ] All tests pass (with mocked child_process): `npx vitest run tests/providers/claude.test.ts`

## Steps

- [ ] 1. Write failing test with mocked `node:child_process` — 3 test cases
- [ ] 2. Run test to verify it fails
- [ ] 3. Implement `src/providers/claude.ts`
- [ ] 4. Run test to verify it passes
- [ ] 5. Commit

## Claude CLI Stream-JSON Format

```
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}}
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}}
{"type":"result","session_id":"claude-native-session-123","result":"Hello world"}
```

## Notes

- Uses `readline.createInterface` to parse stdout line-by-line
- Non-JSON lines are silently skipped
- If no `result` event with `session_id` is found, `cliSessionId` resolves to `null`

## Commit Message

```
feat: add Claude Code CLI adapter with --resume support
```
