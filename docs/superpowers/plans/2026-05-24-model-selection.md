# Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let clients select between Claude variants (Opus / Sonnet / Haiku) per request by sending a new `model` id, translated by proxai into the corresponding `--model` flag on the underlying `claude` CLI.

**Architecture:** Config-driven model catalog. Each provider may declare a `models` array (`{id, cli_model}`) plus an optional `default_model` aliasing the legacy `model_id`. `ProviderRouter` builds a `ModelEntry[]` catalog; routes resolve the request's `model` id via `getModelEntry`, then pass `entry.cliModel` to `ProviderAdapter.send()`, which appends `--model <cliModel>` to the spawned CLI args. `/v1/models` returns the full catalog; probes still run once per provider and are fanned out across that provider's entries.

**Tech Stack:** TypeScript (ESM), Node 18+, Express 5, Zod 4, Vitest 4, supertest. Spec: `docs/superpowers/specs/2026-05-24-model-selection-design.md`.

**Constraints from CLAUDE.md:** never add `Co-Authored-By` lines to commit messages.

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/config.ts` | Modify | Add `models[]` + `default_model` to provider schema; cross-provider refinement |
| `src/providers/adapter.ts` | Modify | Add optional `cliModel` param to `send()` |
| `src/providers/claude.ts` | Modify | Extract pure `buildClaudeArgs`; pass `--model <cliModel>` when set |
| `src/providers/codex.ts` | Modify | Accept and ignore `cliModel` (signature only) |
| `src/providers/router.ts` | Modify | Build `ModelEntry` catalog; expose `getModelEntry`, `listModels`, `probeProviders` |
| `src/routes/completions.ts` | Modify | Use `getModelEntry`; forward `cliModel` to adapter |
| `src/routes/stream.ts` | Modify | Same as completions |
| `src/routes/models.ts` | Modify | Iterate `listModels()`; fan provider probe across entries; emit `cli_model` |
| `src/server.ts` | Modify | Wire new router methods into route deps |
| `proxai.config.yaml` | Modify | Add Claude `models` array + `default_model` |
| `public/index.html` | Modify | Append `cli_model` to option label when present |
| `tests/config.test.ts` | Modify | New cases for models, default_model, duplicate detection |
| `tests/providers/claude.test.ts` | Modify | Test `buildClaudeArgs` with and without `cliModel` |
| `tests/providers/router.test.ts` | Create | Catalog assembly + `getModelEntry` resolution |
| `tests/routes/completions.test.ts` | Modify | Forwards `cliModel` correctly |
| `tests/routes/stream.test.ts` | Modify | Forwards `cliModel` correctly |
| `tests/routes/models.test.ts` | Modify | Updated deps shape; fan-out + `cli_model` echo |

---

## Task 1: Extract pure `buildClaudeArgs` from `ClaudeCodeAdapter`

Refactor only — no behaviour change yet. This pulls the args list construction out of `send()` into a pure function so we can unit-test the eventual `--model` flag without spawning a real process. `cliModel` is added as an accepted-but-ignored parameter at this stage so we can lock in the signature.

**Files:**
- Modify: `src/providers/claude.ts`
- Modify: `tests/providers/claude.test.ts`

- [ ] **Step 1: Write failing test for `buildClaudeArgs` with no `cliModel`**

Append to `tests/providers/claude.test.ts`:

```ts
import { buildClaudeArgs } from '../../src/providers/claude.js';

describe('buildClaudeArgs', () => {
  it('produces the v1 arg list (no --model) when cliModel is null', () => {
    const args = buildClaudeArgs('PROMPT', {
      systemPrompt: null,
      allowedTools: null,
      mcpConfigFile: null,
    }, null);
    expect(args).toEqual([
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      'PROMPT',
    ]);
  });

  it('includes allowedTools, mcp config, and system prompt flags', () => {
    const args = buildClaudeArgs('PROMPT', {
      systemPrompt: 'be nice',
      allowedTools: ['WebSearch', 'WebFetch'],
      mcpConfigFile: './ask-mcp.json',
    }, null);
    expect(args).toContain('--allowedTools');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('WebSearch,WebFetch');
    expect(args).toContain('--mcp-config');
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('./ask-mcp.json');
    expect(args).toContain('--append-system-prompt');
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe('be nice');
    expect(args[args.length - 1]).toBe('PROMPT');
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
npx vitest run tests/providers/claude.test.ts
```

Expected: failure with `buildClaudeArgs is not a function` or `not exported`.

- [ ] **Step 3: Extract and export `buildClaudeArgs` in `src/providers/claude.ts`**

Add this export above the `ClaudeCodeAdapter` class (around line 86):

```ts
export function buildClaudeArgs(
  prompt: string,
  modeConfig: ModeConfig,
  cliModel: string | null,
): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  if (modeConfig.allowedTools) args.push('--allowedTools', modeConfig.allowedTools.join(','));
  if (modeConfig.mcpConfigFile) args.push('--mcp-config', modeConfig.mcpConfigFile);
  if (modeConfig.systemPrompt) args.push('--append-system-prompt', modeConfig.systemPrompt);
  if (cliModel) args.push('--model', cliModel);
  args.push(prompt);
  return args;
}
```

Then replace the inline args block inside `send()` (currently lines 93-98) with:

```ts
const prompt = assemblePrompt(messages);
const args = buildClaudeArgs(prompt, modeConfig, null);
```

(`null` is passed for now — Task 4 wires the real value through.)

- [ ] **Step 4: Run tests, confirm they pass**

```bash
npx vitest run tests/providers/claude.test.ts
```

Expected: PASS (including the two existing `mapClaudeStream` tests).

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/claude.ts tests/providers/claude.test.ts
git commit -m "refactor(claude): extract buildClaudeArgs as pure, testable function"
```

---

## Task 2: Config schema — `models[]`, `default_model`, cross-provider refinement

Add the new optional fields to the provider schema and enforce two cross-provider invariants: (a) all model ids (including `model_id`) are unique across providers; (b) if `default_model` is set, it must match one of that provider's `models[i].id`.

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/config.test.ts`:

```ts
const validYamlWithModels = `
server:
  port: 3077
  host: "127.0.0.1"
auth:
  ask_token: "ask-secret"
  agent_token: "agent-secret"
modes:
  ask:
    system_prompt: "x"
    allowed_tools: ["WebSearch"]
    mcp_config_file: null
  agent:
    system_prompt: null
    allowed_tools: null
    mcp_config_file: null
providers:
  claude:
    command: "claude"
    model_id: "claude-code"
    default_model: "claude-sonnet"
    models:
      - id: "claude-opus"
        cli_model: "opus"
      - id: "claude-sonnet"
        cli_model: "sonnet"
      - id: "claude-haiku"
        cli_model: "haiku"
  codex:
    command: "codex"
    model_id: "codex-cli"
`;

describe('parseConfig (model selection)', () => {
  it('parses providers.models[] with id + cli_model', () => {
    const c = parseConfig(validYamlWithModels);
    expect(c.providers['claude'].models).toEqual([
      { id: 'claude-opus', cli_model: 'opus' },
      { id: 'claude-sonnet', cli_model: 'sonnet' },
      { id: 'claude-haiku', cli_model: 'haiku' },
    ]);
    expect(c.providers['claude'].default_model).toBe('claude-sonnet');
  });

  it('absent models[] is still valid (back-compat)', () => {
    const c = parseConfig(validYaml);
    expect(c.providers['claude'].models).toBeUndefined();
    expect(c.providers['claude'].default_model).toBeUndefined();
  });

  it('rejects duplicate id across providers', () => {
    const dup = validYamlWithModels.replace('id: "claude-opus"', 'id: "codex-cli"');
    expect(() => parseConfig(dup)).toThrow(/duplicate model id/i);
  });

  it('rejects default_model that does not match any models[i].id', () => {
    const bad = validYamlWithModels.replace('default_model: "claude-sonnet"', 'default_model: "claude-bogus"');
    expect(() => parseConfig(bad)).toThrow(/default_model/i);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
npx vitest run tests/config.test.ts
```

Expected: 4 failures.

- [ ] **Step 3: Update `src/config.ts`**

Replace the `ProviderSchema` block and `ConfigSchema` block:

```ts
const ProviderModelSchema = z.object({
  id: z.string().min(1),
  cli_model: z.string().min(1),
});

const ProviderSchema = z.object({
  command: z.string(),
  model_id: z.string(),
  default_model: z.string().optional(),
  models: z.array(ProviderModelSchema).optional(),
});

const ConfigSchema = z
  .object({
    server: z
      .object({ port: z.number(), host: z.string() })
      .default({ port: 3077, host: '127.0.0.1' }),
    auth: z.object({
      ask_token: z.string(),
      agent_token: z.string(),
      admin_token: z.string().optional(),
    }),
    timeouts: z
      .object({
        request_timeout_ms: z.number().int().default(300000),
        idle_timeout_ms: z.number().int().default(60000),
        probe_timeout_ms: z.number().int().default(5000),
        process_kill_grace_ms: z.number().int().default(2000),
      })
      .default({
        request_timeout_ms: 300000,
        idle_timeout_ms: 60000,
        probe_timeout_ms: 5000,
        process_kill_grace_ms: 2000,
      }),
    modes: z.object({
      ask: ModeSchema,
      agent: ModeSchema,
    }),
    providers: z.record(z.string(), ProviderSchema),
  })
  .superRefine((cfg, ctx) => {
    // Cross-provider uniqueness of every selectable model id.
    const seen = new Map<string, string>(); // id -> providerName
    for (const [providerName, provider] of Object.entries(cfg.providers)) {
      const ids = [provider.model_id, ...(provider.models?.map((m) => m.id) ?? [])];
      for (const id of ids) {
        const prior = seen.get(id);
        if (prior && prior !== providerName) {
          ctx.addIssue({
            code: 'custom',
            path: ['providers', providerName],
            message: `duplicate model id "${id}" in providers "${prior}" and "${providerName}"`,
          });
        }
        seen.set(id, providerName);
      }
    }
    // default_model must reference one of this provider's models[i].id.
    for (const [providerName, provider] of Object.entries(cfg.providers)) {
      if (!provider.default_model) continue;
      const ok = provider.models?.some((m) => m.id === provider.default_model);
      if (!ok) {
        ctx.addIssue({
          code: 'custom',
          path: ['providers', providerName, 'default_model'],
          message: `default_model "${provider.default_model}" does not match any models[i].id`,
        });
      }
    }
  });
```

- [ ] **Step 4: Run tests, confirm they pass**

```bash
npx vitest run tests/config.test.ts
```

Expected: all 4 new tests PASS plus existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat(config): add models[] and default_model for per-provider catalog"
```

---

## Task 3: `ModelEntry` catalog in `ProviderRouter`

Replace the current `adapters: Map<modelId, ProviderAdapter>` model with a `ModelEntry[]` catalog. Add `listModels()`, `getModelEntry(id)`, and `probeProviders(timeoutMs)` (one probe per adapter, returns `Map<providerName, ProbeResult>`). Keep `getAdapter(id)` as a thin wrapper over `getModelEntry(id)?.adapter` for any internal callers and tests.

**Files:**
- Modify: `src/providers/router.ts`
- Create: `tests/providers/router.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/providers/router.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ProviderRouter } from '../../src/providers/router.js';
import { ChildRegistry } from '../../src/lifecycle/children.js';
import type { ProxaiConfig } from '../../src/config.js';

function makeConfig(overrides: Partial<ProxaiConfig['providers']> = {}): ProxaiConfig {
  return {
    server: { port: 3077, host: '127.0.0.1' },
    auth: { ask_token: 'a', agent_token: 'b' },
    timeouts: {
      request_timeout_ms: 1000,
      idle_timeout_ms: 1000,
      probe_timeout_ms: 1000,
      process_kill_grace_ms: 100,
    },
    modes: {
      ask: { system_prompt: null, allowed_tools: null, mcp_config_file: null },
      agent: { system_prompt: null, allowed_tools: null, mcp_config_file: null },
    },
    providers: {
      claude: {
        command: 'claude',
        model_id: 'claude-code',
        default_model: 'claude-sonnet',
        models: [
          { id: 'claude-opus', cli_model: 'opus' },
          { id: 'claude-sonnet', cli_model: 'sonnet' },
          { id: 'claude-haiku', cli_model: 'haiku' },
        ],
      },
      codex: { command: 'codex', model_id: 'codex-cli' },
      ...overrides,
    },
  } as ProxaiConfig;
}

describe('ProviderRouter catalog', () => {
  it('listModels returns one entry per configured model id plus back-compat alias', () => {
    const router = new ProviderRouter(makeConfig(), new ChildRegistry());
    const ids = router.listModels().map((m) => m.id).sort();
    expect(ids).toEqual(['claude-code', 'claude-haiku', 'claude-opus', 'claude-sonnet', 'codex-cli']);
  });

  it('getModelEntry resolves explicit models to their cliModel', () => {
    const router = new ProviderRouter(makeConfig(), new ChildRegistry());
    const opus = router.getModelEntry('claude-opus');
    expect(opus?.cliModel).toBe('opus');
    expect(opus?.providerName).toBe('claude');
  });

  it('back-compat alias model_id resolves to default_model.cli_model', () => {
    const router = new ProviderRouter(makeConfig(), new ChildRegistry());
    const alias = router.getModelEntry('claude-code');
    expect(alias?.cliModel).toBe('sonnet');
  });

  it('back-compat alias resolves to null cliModel when default_model is absent', () => {
    const router = new ProviderRouter(makeConfig({
      claude: { command: 'claude', model_id: 'claude-code' },
    }), new ChildRegistry());
    const alias = router.getModelEntry('claude-code');
    expect(alias?.cliModel).toBeNull();
  });

  it('provider with no models[] yields a single entry with null cliModel', () => {
    const router = new ProviderRouter(makeConfig(), new ChildRegistry());
    const codex = router.getModelEntry('codex-cli');
    expect(codex?.cliModel).toBeNull();
    expect(codex?.providerName).toBe('codex');
  });

  it('getModelEntry returns undefined for unknown ids', () => {
    const router = new ProviderRouter(makeConfig(), new ChildRegistry());
    expect(router.getModelEntry('does-not-exist')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
npx vitest run tests/providers/router.test.ts
```

Expected: failures referencing `listModels`/`getModelEntry`.

- [ ] **Step 3: Rewrite `src/providers/router.ts`**

Replace the file contents with:

```ts
import type { ProxaiConfig } from '../config.js';
import type { ProviderAdapter, ProbeResult } from './adapter.js';
import { ClaudeCodeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import type { ChildRegistry } from '../lifecycle/children.js';

type AdapterFactory = new (registry: ChildRegistry) => ProviderAdapter;

const adapterFactories: Record<string, AdapterFactory> = {
  claude: ClaudeCodeAdapter,
  codex: CodexAdapter,
};

export interface ModelEntry {
  id: string;
  adapter: ProviderAdapter;
  cliModel: string | null;
  providerName: string;
}

export interface ProbedModel {
  id: string;
  providerName: string;
  result: ProbeResult;
}

export class ProviderRouter {
  private byId = new Map<string, ModelEntry>();
  private adaptersByProvider = new Map<string, ProviderAdapter>();

  constructor(config: ProxaiConfig, registry: ChildRegistry) {
    for (const [providerName, provider] of Object.entries(config.providers)) {
      const Factory = adapterFactories[providerName];
      if (!Factory) {
        console.warn(`Unknown provider "${providerName}", skipping`);
        continue;
      }
      const adapter = new Factory(registry);
      this.adaptersByProvider.set(providerName, adapter);

      // Explicit catalog entries from provider.models[].
      for (const m of provider.models ?? []) {
        this.byId.set(m.id, {
          id: m.id,
          adapter,
          cliModel: m.cli_model,
          providerName,
        });
      }

      // Back-compat alias keyed by provider.model_id, mapped to default_model's cli_model (or null).
      if (!this.byId.has(provider.model_id)) {
        const defaultEntry = provider.default_model
          ? provider.models?.find((m) => m.id === provider.default_model)
          : undefined;
        this.byId.set(provider.model_id, {
          id: provider.model_id,
          adapter,
          cliModel: defaultEntry?.cli_model ?? null,
          providerName,
        });
      }
    }
  }

  getAdapter(modelId: string): ProviderAdapter | undefined {
    return this.byId.get(modelId)?.adapter;
  }

  getModelEntry(modelId: string): ModelEntry | undefined {
    return this.byId.get(modelId);
  }

  listModels(): ModelEntry[] {
    return Array.from(this.byId.values());
  }

  async probeProviders(timeoutMs: number): Promise<Map<string, ProbeResult>> {
    const entries = Array.from(this.adaptersByProvider.entries());
    const results = await Promise.all(
      entries.map(async ([name, adapter]) => [name, await adapter.probe(timeoutMs)] as const),
    );
    return new Map(results);
  }
}
```

- [ ] **Step 4: Run router tests, confirm they pass**

```bash
npx vitest run tests/providers/router.test.ts
```

Expected: all 6 new tests PASS.

- [ ] **Step 5: Run the full test suite**

```bash
npx vitest run
```

Existing route tests should still pass because they call mock `getAdapter` directly. The old `probeAll` method has been removed; `tests/routes/models.test.ts` will start failing because it uses the v1 shape — that's expected; Task 6 fixes it. For now, check that *only* models.test.ts is failing and note the failure count.

If anything other than `tests/routes/models.test.ts` fails, stop and investigate before proceeding.

- [ ] **Step 6: Commit**

```bash
git add src/providers/router.ts tests/providers/router.test.ts
git commit -m "feat(router): build ModelEntry catalog with getModelEntry, listModels, probeProviders"
```

---

## Task 4: Wire `cliModel` through `ProviderAdapter.send()`

Add an optional `cliModel` parameter to the adapter interface. `ClaudeCodeAdapter` forwards it into `buildClaudeArgs`. `CodexAdapter` accepts and ignores it (signature only).

**Files:**
- Modify: `src/providers/adapter.ts`
- Modify: `src/providers/claude.ts`
- Modify: `src/providers/codex.ts`
- Modify: `tests/providers/claude.test.ts`

- [ ] **Step 1: Write failing test for `buildClaudeArgs` with `cliModel`**

Append to `tests/providers/claude.test.ts`:

```ts
describe('buildClaudeArgs with cliModel', () => {
  it('appends --model <cliModel> when set', () => {
    const args = buildClaudeArgs('PROMPT', {
      systemPrompt: null,
      allowedTools: null,
      mcpConfigFile: null,
    }, 'opus');
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('opus');
    expect(args[args.length - 1]).toBe('PROMPT');
  });

  it('omits --model when cliModel is empty string', () => {
    const args = buildClaudeArgs('PROMPT', {
      systemPrompt: null,
      allowedTools: null,
      mcpConfigFile: null,
    }, '');
    expect(args).not.toContain('--model');
  });
});
```

- [ ] **Step 2: Run tests, confirm one passes (`--model opus`) and check empty-string behaviour**

The first test passes because Task 1 already added the `if (cliModel) args.push(...)` line. The second test (`cliModel === ''`) also passes because the empty string is falsy. Run:

```bash
npx vitest run tests/providers/claude.test.ts
```

Expected: PASS. (If either fails, fix `buildClaudeArgs` so `if (cliModel)` correctly treats `null`, `undefined`, and `''` as "omit the flag".)

- [ ] **Step 3: Update the `ProviderAdapter` interface**

In `src/providers/adapter.ts`, change the `send` signature:

```ts
export interface ProviderAdapter {
  readonly name: string;
  readonly modelId: string;
  send(
    messages: import('./prompt.js').Message[],
    modeConfig: ModeConfig,
    signal: AbortSignal,
    cliModel?: string | null,
  ): SendResult;
  probe(timeoutMs: number): Promise<ProbeResult>;
}
```

- [ ] **Step 4: Update `ClaudeCodeAdapter.send()` to forward `cliModel`**

In `src/providers/claude.ts`, change the `send` method signature (around line 92) and pass `cliModel` to `buildClaudeArgs`:

```ts
send(messages: Message[], modeConfig: ModeConfig, signal: AbortSignal, cliModel: string | null = null): SendResult {
  const prompt = assemblePrompt(messages);
  const args = buildClaudeArgs(prompt, modeConfig, cliModel);
  // ... rest unchanged
}
```

- [ ] **Step 5: Update `CodexAdapter.send()` to accept and ignore `cliModel`**

In `src/providers/codex.ts`, change the `send` signature (around line 69):

```ts
send(messages: Message[], modeConfig: ModeConfig, signal: AbortSignal, _cliModel: string | null = null): SendResult {
  // ... body unchanged; _cliModel is accepted but not used until codex --model flag is verified.
```

- [ ] **Step 6: Update the in-test `FakeAdapter`s and `adapter`s in `tests/routes/stream.test.ts` and `tests/routes/completions.test.ts` to accept the new arg**

The existing fakes already have signatures like `send() { ... }`. They don't need changes — extra args to a JS function are simply ignored. But the test that asserts `abortedEarly` (stream.test.ts line 57) uses a typed signature `send(_msgs, _mode, signal)` — extend it:

```ts
send(_msgs, _mode, signal, _cliModel) {
  // ... unchanged
}
```

Apply the same `_cliModel` parameter to any other typed fake `send` implementations in the routes tests (search for `send(_msgs`).

- [ ] **Step 7: Run all tests**

```bash
npx vitest run
```

Expected: the only failures should still be in `tests/routes/models.test.ts` (Task 6 fixes that).

- [ ] **Step 8: Commit**

```bash
git add src/providers/adapter.ts src/providers/claude.ts src/providers/codex.ts tests/providers/claude.test.ts tests/routes/stream.test.ts tests/routes/completions.test.ts
git commit -m "feat(adapters): plumb optional cliModel through send(); claude passes --model"
```

---

## Task 5: Routes use `getModelEntry` and forward `cliModel`

Both `completions.ts` and `stream.ts` currently call `deps.getAdapter(model)`. Replace with `deps.getModelEntry(model)` and pass `entry.cliModel` into `entry.adapter.send(...)`.

**Files:**
- Modify: `src/routes/completions.ts`
- Modify: `src/routes/stream.ts`
- Modify: `tests/routes/completions.test.ts`
- Modify: `tests/routes/stream.test.ts`

- [ ] **Step 1: Write failing test in `tests/routes/stream.test.ts` for cliModel forwarding**

Append a new test case inside the `describe('POST /v1/chat/stream', ...)` block:

```ts
it('forwards entry.cliModel to adapter.send', async () => {
  let receivedCliModel: string | null | undefined;
  const adapter: ProviderAdapter = {
    name: 'claude',
    modelId: 'claude-code',
    async probe() { return { status: 'ready' as const }; },
    send(_msgs, _mode, _signal, cliModel) {
      receivedCliModel = cliModel;
      return {
        events: (async function* () {
          yield { type: 'start', request_id: 'r', model: 'claude-opus', provider: 'claude' };
          yield { type: 'done' };
        })(),
      };
    },
  };
  const app = express();
  app.use(express.json());
  const route = createStreamRoute({
    getModelEntry: () => ({ id: 'claude-opus', adapter, cliModel: 'opus', providerName: 'claude' }),
    resolveModeConfig: () => ({ systemPrompt: null, allowedTools: null, mcpConfigFile: null }),
    timeouts: { request_timeout_ms: 5000, idle_timeout_ms: 5000, probe_timeout_ms: 1000, process_kill_grace_ms: 100 },
  });
  app.post('/v1/chat/stream', (req, _res, next) => { (req as any).mode = 'agent'; next(); }, route);

  await request(app)
    .post('/v1/chat/stream')
    .send({ model: 'claude-opus', mode: 'agent', messages: [{ role: 'user', content: 'hi' }] });

  expect(receivedCliModel).toBe('opus');
});
```

Update the three existing tests in `tests/routes/stream.test.ts` that build a route via `createStreamRoute({ getAdapter, ... })`:

- Replace `getAdapter: () => fake,` with `getModelEntry: () => ({ id: 'claude-code', adapter: fake, cliModel: null, providerName: 'claude' }),`
- Replace `getAdapter: () => adapter,` (the abort-regression test) similarly: `getModelEntry: () => ({ id: 'claude-code', adapter, cliModel: null, providerName: 'claude' }),`
- Replace `getAdapter: () => undefined,` with `getModelEntry: () => undefined,`

Apply the same edits to `tests/routes/completions.test.ts` (two tests, both with `getAdapter: () => new FakeAdapter()` → `getModelEntry: () => ({ id: 'claude-code', adapter: new FakeAdapter(), cliModel: null, providerName: 'claude' })`).

- [ ] **Step 2: Run tests, confirm failures**

```bash
npx vitest run tests/routes/stream.test.ts tests/routes/completions.test.ts
```

Expected: TypeScript / runtime failures pointing at the new `getModelEntry` shape.

- [ ] **Step 3: Update `src/routes/completions.ts`**

Change the deps interface and the body of `createCompletionsRoute` to use `getModelEntry` and forward `cliModel`:

```ts
import type { ModelEntry } from '../providers/router.js';

export interface CompletionsRouteDeps {
  getModelEntry: (modelId: string) => ModelEntry | undefined;
  resolveModeConfig: (mode: ModeName) => ModeConfig;
  timeouts: {
    request_timeout_ms: number;
    idle_timeout_ms: number;
    probe_timeout_ms: number;
    process_kill_grace_ms: number;
  };
}

export function createCompletionsRoute(deps: CompletionsRouteDeps) {
  return async (req: AuthedRequest, res: Response): Promise<void> => {
    const { model, messages, stream } = req.body ?? {};
    const mode = req.mode!;

    if (!model || typeof model !== 'string') {
      res.status(400).json({ error: { code: 'invalid_model', message: 'Missing or invalid `model`' } });
      return;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: { code: 'invalid_messages', message: 'Missing or empty `messages`' } });
      return;
    }
    const entry = deps.getModelEntry(model);
    if (!entry) {
      res.status(400).json({ error: { code: 'unknown_model', message: `Unknown model: ${model}` } });
      return;
    }

    const abort = new AbortController();
    const requestTimeout = setTimeout(() => abort.abort(), deps.timeouts.request_timeout_ms);
    res.on('close', () => abort.abort());
    const result = entry.adapter.send(messages, deps.resolveModeConfig(mode), abort.signal, entry.cliModel);

    // ... rest of the function unchanged
```

Remove the no-longer-used `ProviderAdapter` import (it's only used via `ModelEntry` now).

- [ ] **Step 4: Update `src/routes/stream.ts`**

Apply the symmetric change:

```ts
import type { ModelEntry } from '../providers/router.js';

export interface StreamRouteDeps {
  getModelEntry: (modelId: string) => ModelEntry | undefined;
  resolveModeConfig: (mode: ModeName) => ModeConfig;
  timeouts: { /* same as above */ };
}

export function createStreamRoute(deps: StreamRouteDeps) {
  return async (req: AuthedRequest, res: Response): Promise<void> => {
    const { model, messages } = req.body ?? {};
    const mode = req.mode!;

    if (!model || typeof model !== 'string') {
      res.status(400).json({ error: { code: 'invalid_model', message: 'Missing or invalid `model`' } });
      return;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: { code: 'invalid_messages', message: 'Missing or empty `messages`' } });
      return;
    }
    const entry = deps.getModelEntry(model);
    if (!entry) {
      res.status(400).json({ error: { code: 'unknown_model', message: `Unknown model: ${model}` } });
      return;
    }

    // ... unchanged through to:
    const result = entry.adapter.send(messages, modeConfig, abort.signal, entry.cliModel);
    // ... rest unchanged
```

- [ ] **Step 5: Run tests, confirm they pass**

```bash
npx vitest run tests/routes/stream.test.ts tests/routes/completions.test.ts
```

Expected: all stream + completions tests PASS, including the new `forwards entry.cliModel` test.

- [ ] **Step 6: Commit**

```bash
git add src/routes/completions.ts src/routes/stream.ts tests/routes/completions.test.ts tests/routes/stream.test.ts
git commit -m "feat(routes): resolve model via getModelEntry; forward cliModel to adapter"
```

---

## Task 6: `/v1/models` route — emit `cli_model`, fan provider probe across entries

Change the route's deps shape from a single `probeAll()` to `listModels()` + `probeProviders()`. Iterate the catalog, look up each entry's provider probe, and include `cli_model` in the response.

**Files:**
- Modify: `src/routes/models.ts`
- Modify: `tests/routes/models.test.ts`

- [ ] **Step 1: Rewrite the models test with the new deps shape**

Replace the contents of `tests/routes/models.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createModelsRoute } from '../../src/routes/models.js';
import type { ModelEntry } from '../../src/providers/router.js';
import type { ProviderAdapter, ProbeResult } from '../../src/providers/adapter.js';

const dummyAdapter = (name: string, modelId: string): ProviderAdapter => ({
  name,
  modelId,
  async probe() { return { status: 'ready' }; },
  send() { return { events: (async function* () {})() }; },
});

describe('GET /v1/models', () => {
  it('returns one entry per ModelEntry with cli_model and fanned-out provider probe', async () => {
    const claude = dummyAdapter('claude', 'claude-code');
    const codex = dummyAdapter('codex', 'codex-cli');
    const models: ModelEntry[] = [
      { id: 'claude-opus', adapter: claude, cliModel: 'opus', providerName: 'claude' },
      { id: 'claude-sonnet', adapter: claude, cliModel: 'sonnet', providerName: 'claude' },
      { id: 'claude-code', adapter: claude, cliModel: 'sonnet', providerName: 'claude' },
      { id: 'codex-cli', adapter: codex, cliModel: null, providerName: 'codex' },
    ];
    const probes = new Map<string, ProbeResult>([
      ['claude', { status: 'ready' }],
      ['codex', { status: 'not_authenticated', hint: 'Run: codex login' }],
    ]);

    const app = express();
    app.get('/v1/models', createModelsRoute({
      listModels: () => models,
      probeProviders: async () => probes,
    }));

    const res = await request(app).get('/v1/models');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: 'claude-opus', object: 'model', owned_by: 'proxai:claude', cli_model: 'opus', status: 'ready' },
      { id: 'claude-sonnet', object: 'model', owned_by: 'proxai:claude', cli_model: 'sonnet', status: 'ready' },
      { id: 'claude-code', object: 'model', owned_by: 'proxai:claude', cli_model: 'sonnet', status: 'ready' },
      { id: 'codex-cli', object: 'model', owned_by: 'proxai:codex', cli_model: null, status: 'not_authenticated', hint: 'Run: codex login' },
    ]);
  });

  it('probes each provider exactly once even with multiple model entries', async () => {
    const claude = dummyAdapter('claude', 'claude-code');
    let probeCalls = 0;
    const probeProviders = async () => {
      probeCalls += 1;
      return new Map<string, ProbeResult>([['claude', { status: 'ready' }]]);
    };
    const models: ModelEntry[] = [
      { id: 'claude-opus', adapter: claude, cliModel: 'opus', providerName: 'claude' },
      { id: 'claude-sonnet', adapter: claude, cliModel: 'sonnet', providerName: 'claude' },
      { id: 'claude-haiku', adapter: claude, cliModel: 'haiku', providerName: 'claude' },
    ];

    const app = express();
    app.get('/v1/models', createModelsRoute({
      listModels: () => models,
      probeProviders,
    }));

    const res = await request(app).get('/v1/models');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(probeCalls).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
npx vitest run tests/routes/models.test.ts
```

Expected: failures referencing `listModels`/`probeProviders` not being valid deps.

- [ ] **Step 3: Rewrite `src/routes/models.ts`**

Replace the file contents with:

```ts
import type { Request, Response } from 'express';
import type { ModelEntry } from '../providers/router.js';
import type { ProbeResult } from '../providers/adapter.js';

export interface ModelsRouteDeps {
  listModels: () => ModelEntry[];
  probeProviders: () => Promise<Map<string, ProbeResult>>;
}

export function createModelsRoute(deps: ModelsRouteDeps) {
  return async (_req: Request, res: Response): Promise<void> => {
    const probes = await deps.probeProviders();
    const data = deps.listModels().map((entry) => {
      const result: ProbeResult = probes.get(entry.providerName) ?? { status: 'error', message: 'provider not probed' };
      const base = {
        id: entry.id,
        object: 'model' as const,
        owned_by: `proxai:${entry.providerName}`,
        cli_model: entry.cliModel,
      };
      if (result.status === 'ready') return { ...base, status: 'ready' };
      if (result.status === 'not_authenticated') return { ...base, status: 'not_authenticated', hint: result.hint };
      if (result.status === 'missing_binary') return { ...base, status: 'missing_binary' };
      return { ...base, status: 'error', message: result.message };
    });
    res.json({ object: 'list', data });
  };
}
```

- [ ] **Step 4: Run tests, confirm they pass**

```bash
npx vitest run tests/routes/models.test.ts
```

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/models.ts tests/routes/models.test.ts
git commit -m "feat(models): emit cli_model per entry; fan provider probe across catalog"
```

---

## Task 7: Wire new router methods into `src/server.ts`

`server.ts` builds the route `deps` object. Replace the old `getAdapter` / `probeAll` wiring with `getModelEntry`, `listModels`, and `probeProviders`.

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Update `src/server.ts`**

Replace the `deps` block and the `/v1/models` registration:

```ts
const deps = {
  getModelEntry: (id: string) => router.getModelEntry(id),
  resolveModeConfig: (m: 'ask' | 'agent') => resolveModeConfig(m, config),
  timeouts: config.timeouts,
};

app.get('/v1/models', auth, createModelsRoute({
  listModels: () => router.listModels(),
  probeProviders: () => router.probeProviders(config.timeouts.probe_timeout_ms),
}));
```

- [ ] **Step 2: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 3: Type-check the build**

```bash
npx tsc --noEmit
```

Expected: no type errors. If there are any (e.g., dangling `ProvedModel` import in `src/routes/models.ts` or unused imports elsewhere), remove them.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat(server): wire getModelEntry/listModels/probeProviders into routes"
```

---

## Task 8: Populate `proxai.config.yaml` with Claude model variants

Add the three Claude entries plus `default_model: claude-sonnet` to the shipped default config.

**Files:**
- Modify: `proxai.config.yaml`

- [ ] **Step 1: Update `proxai.config.yaml`**

Replace the `providers.claude` block. Result:

```yaml
providers:
  claude:
    command: "claude"
    model_id: "claude-code"
    default_model: "claude-sonnet"
    models:
      - id: "claude-opus"
        cli_model: "opus"
      - id: "claude-sonnet"
        cli_model: "sonnet"
      - id: "claude-haiku"
        cli_model: "haiku"
  codex:
    command: "codex"
    model_id: "codex-cli"
```

- [ ] **Step 2: Sanity check that the server still starts and `/v1/models` responds**

In one terminal:

```bash
npx tsx src/index.ts
```

Expected: startup succeeds (no Zod validation errors).

In another terminal:

```bash
curl -s -H "Authorization: Bearer change-me-agent" http://127.0.0.1:3077/v1/models | head -200
```

Expected JSON includes `claude-opus`, `claude-sonnet`, `claude-haiku`, `claude-code`, and `codex-cli`, each with a `cli_model` field. Status values reflect whichever CLIs are actually installed locally.

Stop the dev server (Ctrl-C).

- [ ] **Step 3: Commit**

```bash
git add proxai.config.yaml
git commit -m "config: ship default Claude model catalog (opus/sonnet/haiku)"
```

---

## Task 9: Test UI label tweak in `public/index.html`

When a model entry has a non-null `cli_model`, append it to the visible option label. Pure label change — no logic change to which value is sent on the request.

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Update the `loadModels` function in `public/index.html`**

Find the line that sets `opt.textContent` (around line 424). Replace:

```js
opt.textContent = badge + '  ' + m.id;
```

with:

```js
opt.textContent = badge + '  ' + m.id + (m.cli_model ? ' — ' + m.cli_model : '');
```

(`—` is an em-dash.)

- [ ] **Step 2: Smoke-test in the browser**

Start the dev server:

```bash
npx tsx src/index.ts
```

Open `http://127.0.0.1:3077/ui/` in a browser, enter the configured agent token, and confirm the model dropdown now shows entries like `o  claude-sonnet — sonnet` and `o  codex-cli` (no suffix when `cli_model` is null). Send a short prompt with `claude-opus` selected and confirm a response streams.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): show cli_model suffix in the model selector"
```

---

## Task 10: Final verification + push

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Verify end-to-end with curl**

Start the server (`npx tsx src/index.ts`) and run, in another terminal:

```bash
curl -s -H "Authorization: Bearer change-me-agent" http://127.0.0.1:3077/v1/models | python3 -m json.tool
```

Expected: catalog includes `claude-opus`, `claude-sonnet`, `claude-haiku`, `claude-code`, `codex-cli`, each with `cli_model`.

```bash
curl -N -s -X POST http://127.0.0.1:3077/v1/chat/stream \
  -H "Authorization: Bearer change-me-agent" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus","mode":"agent","messages":[{"role":"user","content":"say hi"}]}'
```

Expected: SSE stream including `event: start`, `event: text_delta`, `event: done`. The spawned `claude` invocation will include `--model opus`. (If you have the `claude` CLI installed and authenticated, you should see it use the Opus tier.)

Stop the server.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feature/v2-ui-api-hardening-prd
```

Then inform the user the branch is updated and ready for review/merge.

---

## Self-review notes

- **Spec coverage:** Config schema → Task 2. Router + catalog → Task 3. Adapter interface → Task 4. Claude `--model` passing → Tasks 1 + 4. Codex accept-and-ignore → Task 4. Routes use `getModelEntry` → Task 5. `/v1/models` shape + fan-out → Task 6. Server wiring → Task 7. `proxai.config.yaml` update → Task 8. UI label tweak → Task 9.
- **Test coverage:** Config (4 cases), router (6 cases), `buildClaudeArgs` (4 cases total), stream forwarding (1 case + 3 updated), completions (2 updated), models route (2 cases). Every behaviour-changing module has at least one new test.
- **Empty-string `cli_model`:** rejected at parse time by Zod (`z.string().min(1)`), and treated identically to `null` at the args-building layer via the `if (cliModel)` falsy check. Both layers agree.
- **Back-compat:** an existing `proxai.config.yaml` with no `models` array continues to work — Task 3 inserts a single entry with `cliModel: null`, and Task 4 leaves `cliModel` falsy so no `--model` flag is emitted. Behaviour is byte-equivalent to today.
