# Proxai MVP — Task Index

16 tasks across 7 chunks. Full implementation code is in the [plan](../plans/2026-03-13-proxai-mvp.md).

> **Task completion rule:** When a task is done, update its task file: set `**Status:** Done` and change all `- [ ]` checkboxes to `- [x]`.

## Dependency Graph

```
Task 1 (Init Project)
├── Task 2 (Config) ─────────────────────────────┐
├── Task 3 (SQLite Store) → Task 4 (Manager) ────┤
├── Task 5 (Adapter Interface)                    │
│   ├── Task 6 (Claude Adapter) ──┐               │
│   └── Task 7 (Codex Adapter) ───┴→ Task 8 (Router)
├── Task 9 (Auth Middleware)                      │
├── Task 10 (Models Route)                        │
├── Task 11 (Completions Route) ← Task 4, 5      │
└── Task 12 (Sessions Route) ← Task 4            │
                                                  │
Task 13 (Server Assembly) ← Task 2, 4, 8-12 ─────┘
Task 14 (Entry Point) ← Task 2, 13
Task 15 (Test UI) ← Task 13
Task 16 (Smoke Test) ← Task 14, 15
```

## Execution Order

### Chunk 1: Project Scaffolding + Config
| # | Task | Files | Tests | Deps |
|---|------|-------|-------|------|
| 1 | [Initialize Project](task-01-initialize-project.md) | `package.json`, `tsconfig.json`, `.gitignore` | — | — |
| 2 | [Config Loading](task-02-config-loading.md) | `src/config.ts`, `proxai.config.yaml` | `tests/config.test.ts` | 1 |

### Chunk 2: SQLite Store + Session Manager
| # | Task | Files | Tests | Deps |
|---|------|-------|-------|------|
| 3 | [SQLite Store](task-03-sqlite-store.md) | `src/sessions/store.ts` | `tests/store.test.ts` | 1 |
| 4 | [Session Manager](task-04-session-manager.md) | `src/sessions/manager.ts` | `tests/manager.test.ts` | 3 |

### Chunk 3: Provider Adapters
| # | Task | Files | Tests | Deps |
|---|------|-------|-------|------|
| 5 | [Adapter Interface](task-05-provider-adapter-interface.md) | `src/providers/adapter.ts` | — | 1 |
| 6 | [Claude Adapter](task-06-claude-adapter.md) | `src/providers/claude.ts` | `tests/providers/claude.test.ts` | 5 |
| 7 | [Codex Adapter](task-07-codex-adapter.md) | `src/providers/codex.ts` | `tests/providers/codex.test.ts` | 5 |
| 8 | [Provider Router](task-08-provider-router.md) | `src/providers/router.ts` | — | 6, 7 |

### Chunk 4: HTTP Layer
| # | Task | Files | Tests | Deps |
|---|------|-------|-------|------|
| 9 | [Auth Middleware](task-09-auth-middleware.md) | `src/middleware/auth.ts` | `tests/auth.test.ts` | 1 |
| 10 | [Models Route](task-10-models-route.md) | `src/routes/models.ts` | `tests/routes/models.test.ts` | 1 |
| 11 | [Completions Route](task-11-chat-completions-route.md) | `src/routes/completions.ts` | `tests/routes/completions.test.ts` | 4, 5 |
| 12 | [Sessions Route](task-12-sessions-route.md) | `src/routes/sessions.ts` | `tests/routes/sessions.test.ts` | 4 |

### Chunk 5: Server Assembly
| # | Task | Files | Tests | Deps |
|---|------|-------|-------|------|
| 13 | [Server Assembly](task-13-server-assembly.md) | `src/server.ts` | — | 2, 4, 8-12 |
| 14 | [Entry Point](task-14-entry-point.md) | `src/index.ts` | — | 2, 13 |

### Chunk 6: Test UI
| # | Task | Files | Tests | Deps |
|---|------|-------|-------|------|
| 15 | [Chat UI](task-15-test-ui.md) | `public/index.html` | — | 13 |

### Chunk 7: Verification
| # | Task | Files | Tests | Deps |
|---|------|-------|-------|------|
| 16 | [Smoke Test](task-16-smoke-test.md) | — | Manual | 14, 15 |

## Parallelization

Tasks that can run in parallel (after Task 1):
- **Group A:** Task 2, Task 3, Task 5, Task 9, Task 10
- **Group B:** Task 4 (after 3), Task 6 + 7 (after 5)
- **Group C:** Task 8 (after 6+7), Task 11 (after 4+5), Task 12 (after 4)
- **Sequential:** Task 13 → 14 → 15 → 16
