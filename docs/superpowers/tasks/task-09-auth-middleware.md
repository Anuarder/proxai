# Task 9: Auth Middleware

**Chunk:** 4 — HTTP Layer (Auth, Routes, Server)
**Dependencies:** Task 1
**Status:** Done

## Description

Express middleware that validates `Authorization: Bearer <token>` header against the configured static token.

## Files

- Create: `src/middleware/auth.ts`
- Create: `tests/auth.test.ts`

## Acceptance Criteria

- [x] Allows requests with valid `Bearer <token>` header (200)
- [x] Rejects requests without `Authorization` header (401, `"Missing Authorization header"`)
- [x] Rejects requests with wrong token (401, `"Invalid API key"`)
- [x] Returns OpenAI-style error format: `{ error: { message, type: "auth_error" } }`
- [x] All tests pass: `npx vitest run tests/auth.test.ts`

## Steps

- [x] 1. Write failing test (`tests/auth.test.ts`) — 3 test cases using `supertest`
- [x] 2. Run test to verify it fails
- [x] 3. Implement `src/middleware/auth.ts`
- [x] 4. Run test to verify it passes
- [x] 5. Commit

## Commit Message

```
feat: add Bearer token auth middleware
```
