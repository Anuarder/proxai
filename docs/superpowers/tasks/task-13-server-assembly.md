# Task 13: Express Server Assembly

**Chunk:** 5 — Server Assembly + Entry Point
**Dependencies:** Task 2, Task 4, Task 8, Task 9, Task 10, Task 11, Task 12
**Status:** Not started

## Description

Assemble the Express app: wire up all dependencies (store, manager, router), mount middleware (auth, JSON), mount routes, serve static UI, add health check.

## Files

- Create: `src/server.ts`

## Acceptance Criteria

- [ ] `createServer(config)` returns `{ app, manager, store }`
- [ ] JSON body parsing enabled
- [ ] Static files served at `/ui` from `public/` directory (no auth)
- [ ] Health check at `GET /health` returns `{ status: "ok" }` (no auth)
- [ ] Auth middleware applied to all `/v1/*` routes
- [ ] Routes mounted: `/v1/models`, `/v1/chat/completions`, `/v1/sessions`
- [ ] Idle callback wired: `manager.setOnIdleCallback → router.killSession`
- [ ] File compiles without errors

## Steps

- [ ] 1. Implement `src/server.ts`
- [ ] 2. Commit

## Wiring

```
config → SessionStore("proxai.db")
       → SessionManager(store, config.sessions)
       → ProviderRouter(config)
       → manager.setOnIdleCallback → router.killSession
       → Express app with routes
```

## Commit Message

```
feat: assemble Express server with all routes and static UI
```
