# Task 10: Models Route

**Chunk:** 4 — HTTP Layer (Auth, Routes, Server)
**Dependencies:** Task 1
**Status:** Done

## Description

`GET /v1/models` endpoint that returns available providers in OpenAI-compatible format.

## Files

- Create: `src/routes/models.ts`
- Create: `tests/routes/models.test.ts`

## Acceptance Criteria

- [x] Returns `{ object: "list", data: [...] }` format
- [x] Each model has: `id`, `object: "model"`, `created` (unix timestamp), `owned_by: "proxai:<name>"`
- [x] Lists all configured providers
- [x] All tests pass: `npx vitest run tests/routes/models.test.ts`

## Steps

- [x] 1. Write failing test (`tests/routes/models.test.ts`) — 1 test case
- [x] 2. Run test to verify it fails
- [x] 3. Implement `src/routes/models.ts`
- [x] 4. Run test to verify it passes
- [x] 5. Commit

## Response Format

```json
{
  "object": "list",
  "data": [
    { "id": "claude-code", "object": "model", "created": 1710000000, "owned_by": "proxai:claude" },
    { "id": "codex-cli", "object": "model", "created": 1710000000, "owned_by": "proxai:codex" }
  ]
}
```

## Commit Message

```
feat: add GET /v1/models endpoint
```
