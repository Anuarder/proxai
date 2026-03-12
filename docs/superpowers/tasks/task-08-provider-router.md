# Task 8: Provider Router

**Chunk:** 3 — Provider Adapter Interface + Implementations
**Dependencies:** Task 6, Task 7
**Status:** Not started

## Description

Maps model names (from config) to their corresponding adapter instances. Provides `getAdapter(modelId)`, `listModels()`, and `killSession()` for idle cleanup.

## Files

- Create: `src/providers/router.ts`

## Acceptance Criteria

- [ ] Reads `config.providers` and instantiates the correct adapter for each known provider
- [ ] Warns and skips unknown provider names
- [ ] `getAdapter(modelId)` returns the adapter or `undefined`
- [ ] `listModels()` returns `Array<{ id: string; name: string }>`
- [ ] `killSession(sessionId)` calls `kill()` on all adapters
- [ ] File compiles without errors

## Steps

- [ ] 1. Implement `src/providers/router.ts`
- [ ] 2. Commit

## Notes

- Uses a factory map: `{ claude: ClaudeAdapter, codex: CodexAdapter }`
- Adapters are keyed by `provider.model_id` in the Map (not by provider name)

## Commit Message

```
feat: add provider router for model-to-adapter lookup
```
