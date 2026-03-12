# Task 4: Session Manager

**Chunk:** 2 — SQLite Store + Session Manager
**Dependencies:** Task 3
**Status:** Not started

## Description

Wraps `SessionStore` with session lifecycle logic: max concurrent session enforcement, idle timeout checking, and an `onIdle` callback for killing adapter processes.

## Files

- Create: `src/sessions/manager.ts`
- Create: `tests/manager.test.ts`

## Acceptance Criteria

- [ ] `createSession()` enforces `max_concurrent` limit — throws when exceeded
- [ ] `getSession()`, `listSessions()`, `touchSession()`, `deleteSession()` delegate to store
- [ ] `updateStatus()`, `updateCliSessionId()`, `addMessage()`, `getMessages()` delegate to store
- [ ] Idle checker runs on interval, marks sessions as "idle" when `last_active` exceeds timeout
- [ ] `setOnIdleCallback(cb)` sets callback that fires when a session goes idle
- [ ] `shutdown()` clears the idle checker interval
- [ ] All tests pass: `npx vitest run tests/manager.test.ts`

## Steps

- [ ] 1. Write failing tests (`tests/manager.test.ts`) — 5 test cases including async idle callback
- [ ] 2. Run test to verify it fails
- [ ] 3. Implement `src/sessions/manager.ts`
- [ ] 4. Run test to verify it passes
- [ ] 5. Commit

## Key Interface

```typescript
export interface SessionManagerConfig {
  idle_timeout_ms: number;
  max_concurrent: number;
}
```

## Notes

- Idle checker interval: `Math.min(config.idle_timeout_ms, 10000)` — checks at most every 10s
- The idle callback test uses `setTimeout(r, 700)` with a 500ms idle timeout to ensure the checker fires

## Commit Message

```
feat: add session manager with idle timeout and onIdle callback
```
