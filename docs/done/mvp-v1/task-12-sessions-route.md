# Task 12: Sessions Route

**Chunk:** 4 — HTTP Layer (Auth, Routes, Server)
**Dependencies:** Task 4
**Status:** Done

## Description

Session management CRUD endpoints. Custom extension to the OpenAI API for managing CLI sessions.

## Files

- Create: `src/routes/sessions.ts`
- Create: `tests/routes/sessions.test.ts`

## Acceptance Criteria

- [x] `POST /v1/sessions` creates a session (201) with `{ model, provider }` body
- [x] `POST /v1/sessions` returns 400 if `model` or `provider` missing
- [x] `POST /v1/sessions` returns 429 if max concurrent reached
- [x] `GET /v1/sessions` lists all sessions (200)
- [x] `GET /v1/sessions/:id` returns session with messages (200)
- [x] `GET /v1/sessions/:id` returns 404 for missing session
- [x] `DELETE /v1/sessions/:id` deletes session (204)
- [x] `DELETE /v1/sessions/:id` returns 404 for missing session
- [x] All tests pass: `npx vitest run tests/routes/sessions.test.ts`

## Steps

- [x] 1. Write failing tests (`tests/routes/sessions.test.ts`) — 5 test cases
- [x] 2. Run test to verify it fails
- [x] 3. Implement `src/routes/sessions.ts`
- [x] 4. Run test to verify it passes
- [x] 5. Commit

## Endpoints

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/v1/sessions` | `{ model, provider }` | 201 — session object |
| GET | `/v1/sessions` | — | 200 — array of sessions |
| GET | `/v1/sessions/:id` | — | 200 — session + messages |
| DELETE | `/v1/sessions/:id` | — | 204 — no content |

## Commit Message

```
feat: add sessions CRUD endpoints
```
