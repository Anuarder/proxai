# Task 14: Entry Point

**Chunk:** 5 — Server Assembly + Entry Point
**Dependencies:** Task 2, Task 13
**Status:** Done

## Description

Application entry point. Loads config, creates server, starts listening, handles graceful shutdown.

## Files

- Create: `src/index.ts`

## Acceptance Criteria

- [x] Loads config from `proxai.config.yaml`
- [x] Creates server and starts listening on configured host:port
- [x] Logs startup URL and test UI URL
- [x] Handles `SIGINT` and `SIGTERM` for graceful shutdown
- [x] Shutdown calls `manager.shutdown()`, `store.close()`, `server.close()`
- [x] `npx tsx src/index.ts` starts the server without errors

## Steps

- [x] 1. Implement `src/index.ts`
- [x] 2. Commit

## Commit Message

```
feat: add entry point with graceful shutdown
```
