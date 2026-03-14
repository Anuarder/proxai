# Task 3: SQLite Store

**Chunk:** 2 — SQLite Store + Session Manager
**Dependencies:** Task 1
**Status:** Done

## Description

SQLite-backed persistence layer for sessions and messages. Uses `better-sqlite3` with WAL mode and foreign key enforcement. Handles session CRUD, message storage, and CLI-native session ID tracking.

## Files

- Create: `src/sessions/store.ts`
- Create: `tests/store.test.ts`

## Acceptance Criteria

- [x] `SessionStore` creates tables on construction (sessions + messages)
- [x] `createSession(modelId, provider)` returns a `SessionRow` with UUID, status "active"
- [x] `getSession(id)` returns session or `null`
- [x] `listSessions()` returns all sessions ordered by `last_active` DESC
- [x] `updateSessionStatus(id, status)` updates status field
- [x] `updateCliSessionId(id, cliSessionId)` stores CLI-native session ID
- [x] `touchSession(id)` updates `last_active` timestamp
- [x] `deleteSession(id)` removes session AND cascades to delete messages (via `PRAGMA foreign_keys = ON`)
- [x] `addMessage(sessionId, role, content)` inserts message with timestamp
- [x] `getMessages(sessionId)` returns messages ordered by `id ASC`
- [x] `close()` closes the database connection
- [x] All tests pass with `:memory:` database: `npx vitest run tests/store.test.ts`

## Steps

- [x] 1. Write failing tests (`tests/store.test.ts`) — 7 test cases
- [x] 2. Run test to verify it fails
- [x] 3. Implement `src/sessions/store.ts`
- [x] 4. Run test to verify it passes
- [x] 5. Commit

## Key Interfaces

```typescript
export interface SessionRow {
  id: string; model_id: string; provider: string; status: string;
  created_at: string; last_active: string; cli_session_id: string | null; config: string | null;
}
export interface MessageRow {
  id: number; session_id: string; role: string; content: string; timestamp: string;
}
```

## Notes

- `cli_session_id` stores the native session ID returned by the CLI tool (e.g., Claude's `session_id` from its `result` event). Different from Proxai's internal UUID.
- `PRAGMA foreign_keys = ON` is required for `ON DELETE CASCADE` to work on messages.

## Commit Message

```
feat: add SQLite session store with CRUD and cascade deletes
```
