# Task 5: Provider Adapter Interface

**Chunk:** 3 — Provider Adapter Interface + Implementations
**Dependencies:** Task 1
**Status:** Done

## Description

Define the `ProviderAdapter` interface and supporting types (`Message`, `SendResult`) that all CLI tool adapters must implement.

## Files

- Create: `src/providers/adapter.ts`

## Acceptance Criteria

- [x] `Message` type has `role` ("system" | "user" | "assistant") and `content` (string)
- [x] `SendResult` has `chunks` (AsyncIterable<string>) and `cliSessionId` (Promise<string | null>)
- [x] `ProviderAdapter` interface has: `name`, `modelId`, `send(prompt, cliSessionId)`, `kill(sessionId)`
- [x] File compiles without errors: `npx tsc --noEmit`

## Steps

- [x] 1. Create `src/providers/adapter.ts` with types and interface
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
