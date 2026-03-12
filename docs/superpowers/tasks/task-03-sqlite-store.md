# Task 3: SQLite Store

**Chunk:** 2 — SQLite Store + Session Manager
**Dependencies:** Task 1
**Status:** Not started

## Description

SQLite-backed persistence layer for sessions and messages. Uses `better-sqlite3` with WAL mode and foreign key enforcement. Handles session CRUD, message storage, and CLI-native session ID tracking.

## Files

- Create: `src/sessions/store.ts`
- Create: `tests/store.test.ts`

## Acceptance Criteria

- [ ] `SessionStore` creates tables on construction (sessions + messages)
- [ ] `createSession(modelId, provider)` returns a `SessionRow` with UUID, status "active"
- [ ] `getSession(id)` returns session or `null`
- [ ] `listSessions()` returns all sessions ordered by `last_active` DESC
- [ ] `updateSessionStatus(id, status)` updates status field
- [ ] `updateCliSessionId(id, cliSessionId)` stores CLI-native session ID
- [ ] `touchSession(id)` updates `last_active` timestamp
- [ ] `deleteSession(id)` removes session AND cascades to delete messages (via `PRAGMA foreign_keys = ON`)
- [ ] `addMessage(sessionId, role, content)` inserts message with timestamp
- [ ] `getMessages(sessionId)` returns messages ordered by `id ASC`
- [ ] `close()` closes the database connection
- [ ] All tests pass with `:memory:` database: `npx vitest run tests/store.test.ts`

## Steps

- [ ] 1. Write failing tests (`tests/store.test.ts`) — 7 test cases
- [ ] 2. Run test to verify it fails
- [ ] 3. Implement `src/sessions/store.ts`
- [ ] 4. Run test to verify it passes
- [ ] 5. Commit

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
