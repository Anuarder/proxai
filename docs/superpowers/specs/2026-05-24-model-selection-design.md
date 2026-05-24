---
title: Model selection (Opus / Sonnet / Haiku) for proxai
date: 2026-05-24
status: draft
---

# Model selection (Opus / Sonnet / Haiku) for proxai

## Problem

Today, proxai exposes one model id per CLI provider (`claude-code`, `codex-cli`)
and the Claude adapter never passes a `--model` flag, so clients always get
whatever default the underlying CLI picks. Users want to choose between Opus,
Sonnet, and Haiku per request via the standard OpenAI-style `model` field.

`GET /v1/models` already exists and the test UI in `public/index.html` already
populates a `<select>` from it, so the catalog mechanism is in place — what is
missing is (a) a config-driven catalog of selectable models per provider, and
(b) the wiring to translate the requested model id into the right `--model`
flag for the underlying CLI.

## Scope

In scope:

- Multiple selectable model ids per provider, defined in `proxai.config.yaml`.
- Translation from the client-facing model id to the provider CLI's `--model`
  value (Claude only — Codex flag surface is still unverified).
- Backwards compatibility: existing `claude-code` and `codex-cli` ids keep
  working, aliased to a configurable default.
- `/v1/models` returns the full catalog with per-entry `cli_model` exposed.
- Minor test-UI label tweak to show `cli_model` alongside the id.

Out of scope:

- Codex model variants. Codex stays single-entry (`codex-cli`) until its
  `--model`/`-m` flag is verified against an installed Codex CLI.
- Per-model auth, quotas, or rate limits.
- Surfacing model capabilities (context window, modalities, etc.) on
  `/v1/models`.

## Design

### Config schema

Each provider gains two optional fields: a `models` array and a
`default_model` pointer. `model_id` is preserved as a back-compat alias.

```yaml
providers:
  claude:
    command: "claude"
    model_id: "claude-code"          # back-compat alias
    default_model: "claude-sonnet"   # which catalog entry the alias resolves to
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
    # no `models:` → stays single-entry; current behaviour preserved
```

Zod schema changes in `src/config.ts`:

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
```

Top-level refinement after parsing:

- All `id` values across all providers' `models` arrays plus all `model_id`
  values must be unique. On collision, throw with the colliding id and the
  two providers involved.
- If `default_model` is set, it must match one of that provider's
  `models[i].id`. Otherwise throw with the offending value.

### Router and catalog

`src/providers/router.ts` builds a catalog keyed by the client-facing model id.

```ts
export interface ModelEntry {
  id: string;
  adapter: ProviderAdapter;
  cliModel: string | null; // value for --model; null = let CLI default
  providerName: string;
}
```

Population rules per provider:

- For each entry in `provider.models`, add a `ModelEntry` with that
  `cli_model`.
- Always add a back-compat entry whose id is `provider.model_id`. Its
  `cliModel` is:
  - `provider.models[i].cli_model` where `models[i].id === default_model`, if
    `default_model` is set;
  - otherwise `null` (preserving current "no --model flag" behaviour).
- If `provider.models` is absent, only the back-compat entry exists, with
  `cliModel: null`. This is byte-for-byte equivalent to today.

API additions:

- `getModelEntry(id: string): ModelEntry | undefined` — replaces direct
  `getAdapter(id)` calls in routes, since callers now also need `cliModel`.
- Existing `getAdapter(id)` stays for any internal call sites that don't need
  the flag (e.g., probe).
- `listModels(): ModelEntry[]` — replaces `listAdapters()` for the
  `/v1/models` route.

### Adapter interface

`src/providers/adapter.ts`:

```ts
export interface ProviderAdapter {
  readonly name: string;
  readonly modelId: string; // unchanged: provider-level default id
  send(
    messages: Message[],
    modeConfig: ModeConfig,
    signal: AbortSignal,
    cliModel?: string | null, // new
  ): SendResult;
  probe(timeoutMs: number): Promise<ProbeResult>;
}
```

`ClaudeCodeAdapter.send()` appends `--model <cliModel>` to its CLI args when
`cliModel` is a non-empty string. When `cliModel` is `null`, `undefined`, or
empty, no `--model` flag is added — preserving current behaviour for the
back-compat path.

`CodexAdapter.send()` accepts the `cliModel` parameter but ignores it. The
parameter is wired through so the surface is uniform; activating it requires
verifying Codex's actual flag.

### Routes

`src/routes/completions.ts` and `src/routes/stream.ts`:

- Replace `deps.getAdapter(model)` with `deps.getModelEntry(model)`.
- On miss, return the existing 400 `unknown_model` error unchanged.
- On hit, call `entry.adapter.send(messages, modeConfig, signal, entry.cliModel)`.
- The `model` echoed in `chat.completion`/`chat.completion.chunk` responses
  stays as the client-supplied id (not the resolved `cli_model`), matching
  OpenAI conventions.

`src/routes/models.ts`:

- `probeAll` continues to probe **per adapter**, not per model id. The route
  fans each adapter's probe result out across every `ModelEntry` whose
  `providerName` matches.
- Response shape adds `cli_model`:

```json
{
  "object": "list",
  "data": [
    { "id": "claude-opus",   "object": "model", "owned_by": "proxai:claude", "cli_model": "opus",   "status": "ready" },
    { "id": "claude-sonnet", "object": "model", "owned_by": "proxai:claude", "cli_model": "sonnet", "status": "ready" },
    { "id": "claude-haiku",  "object": "model", "owned_by": "proxai:claude", "cli_model": "haiku",  "status": "ready" },
    { "id": "claude-code",   "object": "model", "owned_by": "proxai:claude", "cli_model": "sonnet", "status": "ready" },
    { "id": "codex-cli",     "object": "model", "owned_by": "proxai:codex",  "cli_model": null,     "status": "ready" }
  ]
}
```

Probe status (`ready` / `not_authenticated` / `missing_binary` / `error`) is
identical across all entries from the same provider. Auth `hint` and error
`message` carry through unchanged.

### Test UI

`public/index.html` — the `<select>` already populates from `/v1/models`.
One small label tweak: when an option's entry has a non-null `cli_model`,
append it to the visible label so users see what `--model` value will be
passed.

Examples:
- `claude-opus — opus`
- `claude-sonnet — sonnet`
- `claude-code — sonnet`
- `codex-cli` (no suffix when `cli_model` is null)

No logic change to the request flow — the `model` field sent to
`/v1/chat/stream` is still the option's `value` (the id).

## Error handling

| Case                                             | Behaviour                                                    |
| ------------------------------------------------ | ------------------------------------------------------------ |
| Duplicate `id` across providers' `models`        | Startup throws with the colliding id + both provider names   |
| `default_model` references unknown `models[i].id`| Startup throws with the offending value                      |
| `cli_model` is an empty string                   | Treated same as omitted — no `--model` flag passed           |
| Client sends unknown `model`                     | Existing 400 `unknown_model` (no change)                     |
| Provider lookup succeeds but probe still says `error`/`not_authenticated` | `/v1/models` surfaces the existing status fields unchanged   |

## Testing

New / extended tests:

- `tests/config.test.ts`
  - `models` array parses with `id` + `cli_model`.
  - Absent `models` still parses (back-compat).
  - Duplicate id across providers is rejected.
  - `default_model` not in `models` is rejected.
  - `default_model` set correctly maps to the matching `cli_model`.

- `tests/providers/router.test.ts` (new file)
  - Catalog contains every `models[i].id` plus the back-compat `model_id`.
  - `getModelEntry("claude-opus")` returns the Claude adapter and
    `cliModel === "opus"`.
  - Alias `claude-code` resolves to the `default_model`'s `cli_model`.
  - With no `models` configured, single entry exists and `cliModel` is `null`.

- `tests/providers/claude.test.ts`
  - When `send()` is called with `cliModel: "opus"`, the spawned `claude`
    process receives `--model opus` in its argv.
  - When `cliModel` is `null`, no `--model` flag is present.

- `tests/routes/models.test.ts`
  - Response includes all configured model ids, each with `cli_model`.
  - All entries from the same provider share probe `status`.
  - Probe is invoked once per adapter, not once per model entry.

- `tests/routes/completions.test.ts` and `tests/routes/stream.test.ts`
  - Selecting `claude-opus` ends up invoking the adapter with `cliModel:
    "opus"`. Selecting the back-compat alias resolves to the configured
    default's `cli_model`.

## Migration

The default `proxai.config.yaml` shipped in the repo is updated to include the
three Claude entries (`claude-opus`, `claude-sonnet`, `claude-haiku`) and
`default_model: claude-sonnet`. Users with existing customised configs need
take no action — the new fields are optional, and an absent `models` array
preserves today's behaviour exactly.

## Files touched

- `proxai.config.yaml` — add Claude `models` and `default_model`.
- `src/config.ts` — extend Zod schema; cross-provider refinement.
- `src/providers/adapter.ts` — add `cliModel` parameter to `send()`.
- `src/providers/router.ts` — build catalog; expose `getModelEntry`,
  `listModels`.
- `src/providers/claude.ts` — pass `--model <cliModel>` when set.
- `src/providers/codex.ts` — accept and ignore `cliModel` (documented).
- `src/routes/completions.ts` — use `getModelEntry`; forward `cliModel`.
- `src/routes/stream.ts` — same.
- `src/routes/models.ts` — emit `cli_model`; fan probe results across entries.
- `src/server.ts` — wire `getModelEntry` and `listModels` into route deps.
- `public/index.html` — append `cli_model` to option labels when present.
- `tests/...` — as enumerated above.
