# Task 14: Entry Point

**Chunk:** 5 — Server Assembly + Entry Point
**Dependencies:** Task 2, Task 13
**Status:** Not started

## Description

Application entry point. Loads config, creates server, starts listening, handles graceful shutdown.

## Files

- Create: `src/index.ts`

## Acceptance Criteria

- [ ] Loads config from `proxai.config.yaml`
- [ ] Creates server and starts listening on configured host:port
- [ ] Logs startup URL and test UI URL
- [ ] Handles `SIGINT` and `SIGTERM` for graceful shutdown
- [ ] Shutdown calls `manager.shutdown()`, `store.close()`, `server.close()`
- [ ] `npx tsx src/index.ts` starts the server without errors

## Steps

- [ ] 1. Implement `src/index.ts`
- [ ] 2. Commit

## Commit Message

```
feat: add entry point with graceful shutdown
```
