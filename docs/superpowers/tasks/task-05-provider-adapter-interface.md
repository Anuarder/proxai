# Task 5: Provider Adapter Interface

**Chunk:** 3 — Provider Adapter Interface + Implementations
**Dependencies:** Task 1
**Status:** Not started

## Description

Define the `ProviderAdapter` interface and supporting types (`Message`, `SendResult`) that all CLI tool adapters must implement.

## Files

- Create: `src/providers/adapter.ts`

## Acceptance Criteria

- [ ] `Message` type has `role` ("system" | "user" | "assistant") and `content` (string)
- [ ] `SendResult` has `chunks` (AsyncIterable<string>) and `cliSessionId` (Promise<string | null>)
- [ ] `ProviderAdapter` interface has: `name`, `modelId`, `send(prompt, cliSessionId)`, `kill(sessionId)`
- [ ] File compiles without errors: `npx tsc --noEmit`

## Steps

- [ ] 1. Create `src/providers/adapter.ts` with types and interface
- [ ] 2. Commit

## Key Types

```typescript
export interface SendResult {
  chunks: AsyncIterable<string>;
  cliSessionId: Promise<string | null>;
}
export interface ProviderAdapter {
  readonly name: string;
  readonly modelId: string;
  send(prompt: string, cliSessionId: string | null): SendResult;
  kill(sessionId: string): Promise<void>;
}
```

## Commit Message

```
feat: define ProviderAdapter interface with SendResult
```
