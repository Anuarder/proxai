# Task 2: Config Loading

**Chunk:** 1 — Project Scaffolding + Config
**Dependencies:** Task 1
**Status:** Not started

## Description

Load and validate YAML config file using zod. Supports server settings, auth, session config, and provider definitions.

## Files

- Create: `src/config.ts`
- Create: `tests/config.test.ts`
- Create: `proxai.config.yaml`

## Acceptance Criteria

- [ ] `parseConfig(yamlString)` parses valid YAML and returns typed `ProxaiConfig`
- [ ] Throws on missing required fields (`auth.bearer_token`, `providers`)
- [ ] Applies defaults for optional fields (`server.port: 3077`, `sessions.idle_timeout_ms: 300000`)
- [ ] `loadConfig(path?)` reads from file path (defaults to `proxai.config.yaml` in cwd)
- [ ] Default config file includes both `claude` and `codex` providers
- [ ] All tests pass: `npx vitest run tests/config.test.ts`

## Steps

- [ ] 1. Write failing test (`tests/config.test.ts`) — 3 test cases: valid parse, missing fields, defaults
- [ ] 2. Run test to verify it fails (module not found)
- [ ] 3. Implement `src/config.ts` — zod schemas, `parseConfig()`, `loadConfig()`
- [ ] 4. Run test to verify it passes
- [ ] 5. Create `proxai.config.yaml` with default values
- [ ] 6. Commit

## Key Types

```typescript
export type ProxaiConfig = {
  server: { port: number; host: string };
  auth: { bearer_token: string };
  sessions: { idle_timeout_ms: number; max_concurrent: number };
  providers: Record<string, { command: string; args: string[]; model_id: string }>;
};
```

## Commit Message

```
feat: add config loading with zod validation
```
