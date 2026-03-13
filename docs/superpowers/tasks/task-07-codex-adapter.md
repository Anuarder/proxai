# Task 7: Codex Adapter

**Chunk:** 3 — Provider Adapter Interface + Implementations
**Dependencies:** Task 5
**Status:** Done

## Description

Adapter for the Codex CLI. Spawns `codex exec --json` processes. Parses JSONL output for `task_started` (session ID) and `message` events with `output_text` content blocks.

## Files

- Create: `src/providers/codex.ts`
- Create: `tests/providers/codex.test.ts`

## Acceptance Criteria

- [x] `adapter.name` is `"codex"`, `adapter.modelId` is `"codex-cli"`
- [x] `send(prompt, _)` spawns `codex` with base args + prompt as last arg
- [x] Captures session ID from `task_started` event
- [x] Streams text from `message` events where `role === "assistant"` and content blocks have `type: "output_text"`
- [x] `kill()` is a no-op (exec processes exit on their own)
- [x] All tests pass: `npx vitest run tests/providers/codex.test.ts`

## Steps

- [x] 1. Write failing test with mocked `node:child_process` — 2 test cases
- [x] 2. Run test to verify it fails
- [x] 3. Implement `src/providers/codex.ts`
- [x] 4. Run test to verify it passes
- [x] 5. Commit

## Codex CLI JSONL Format

```
{"type":"task_started","session_id":"codex-session-456"}
{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Hello from Codex"}]}
```

## Notes

- MVP: Codex runs fresh each time (no `--resume`). `_cliSessionId` param is ignored.
- Session context could be managed by replaying history in prompt if needed later.

## Commit Message

```
feat: add Codex CLI adapter
```
