# Task 9: Auth Middleware

**Chunk:** 4 — HTTP Layer (Auth, Routes, Server)
**Dependencies:** Task 1
**Status:** Not started

## Description

Express middleware that validates `Authorization: Bearer <token>` header against the configured static token.

## Files

- Create: `src/middleware/auth.ts`
- Create: `tests/auth.test.ts`

## Acceptance Criteria

- [ ] Allows requests with valid `Bearer <token>` header (200)
- [ ] Rejects requests without `Authorization` header (401, `"Missing Authorization header"`)
- [ ] Rejects requests with wrong token (401, `"Invalid API key"`)
- [ ] Returns OpenAI-style error format: `{ error: { message, type: "auth_error" } }`
- [ ] All tests pass: `npx vitest run tests/auth.test.ts`

## Steps

- [ ] 1. Write failing test (`tests/auth.test.ts`) — 3 test cases using `supertest`
- [ ] 2. Run test to verify it fails
- [ ] 3. Implement `src/middleware/auth.ts`
- [ ] 4. Run test to verify it passes
- [ ] 5. Commit

## Commit Message

```
feat: add Bearer token auth middleware
```
