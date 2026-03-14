# Token & Cost Optimization — Design Spec

**Date:** 2026-03-14
**Status:** Draft
**Scope:** Minimize token spend by smart model routing, context management, and usage tracking

---

## Problem

Proxai currently routes every request to a single model per provider. There's no way to:
- Route simple tasks to cheaper models automatically
- Manage conversation context across model switches
- Track token usage or verify optimization is working

## Approach

**Tiered Heuristics + Feedback Loop** — heuristic-based prompt classifier that routes to the cheapest adequate model, with full logging and a stats dashboard for data-driven tuning. Upgrade path to LLM-based classification later.

---

## 1. Prompt Complexity Classifier

New module: `src/classifier.ts`

### Classification Output

```typescript
interface ClassifyResult {
  tier: 'trivial' | 'simple' | 'moderate' | 'complex';
  confidence: number;   // 0-1
  signals: string[];    // which heuristics fired, for logging
}
```

### Heuristic Signals

| Signal | Trivial | Simple | Moderate | Complex |
|--------|---------|--------|----------|---------|
| Token count | < 50 | 50-150 | 150-500 | > 500 |
| Keywords | "hello", "hi", "thanks" | factual questions | "fix", "implement", "write" | "architect", "design", "PRD", "refactor", "analyze" |
| Code markers | none | none | single code block / file path | multiple code blocks, stack traces |
| Message history | 0-2 turns | 3-5 turns | 6-15 turns | 15+ turns |
| Explicit instructions | none | none | some | "step by step", "be thorough", "in detail" |

Signals are weighted and summed to produce a tier. Thresholds are configurable.

### Token Estimation

CLI providers don't return token counts. Use a character-based heuristic: `Math.ceil(text.length / 4)`. This is rough but sufficient for classification and logging. Can be replaced with a tokenizer library (e.g., `tiktoken`) later if precision matters.

### Confidence & Fallback

In v1, `confidence` is logged for analytics only. If the classifier can't determine a tier (e.g., all signals conflict), it defaults to `routing.default_model`. Future versions may add a `min_confidence` threshold to trigger LLM-based classification.

### Routing Behavior

- `model: "auto"` — classifier picks the tier, router maps tier → model
- `model: "claude-sonnet"` (explicit) — used as-is, but classifier still runs and logs what it *would* have picked (for analytics)

---

## 2. Multi-Model Provider Support

### Key Insight

Both Claude CLI (`--model <model>`) and Codex CLI (`-m <model>`) support per-request model selection. A single provider can serve multiple tiers.

### Config Changes

The `providers` section changes from a single `model_id` to a `models` list. Adapters now use the `command` and `args` from config (instead of hardcoding):

```yaml
providers:
  claude:
    command: "claude"
    args: ["--print"]
    model_flag: "--model"     # CLI flag for model selection
    models:
      - id: "claude-haiku"
        cli_model: "haiku"
        tier: "trivial"
      - id: "claude-sonnet"
        cli_model: "sonnet"
        tier: "moderate"
      - id: "claude-opus"
        cli_model: "opus"
        tier: "complex"
  codex:
    command: "codex"
    args: []
    model_flag: "-m"          # CLI flag for model selection
    models:
      - id: "codex-5-mini"
        cli_model: "gpt-5-codex-mini"
        tier: "trivial"
      - id: "codex-5"
        cli_model: "gpt-5-codex"
        tier: "moderate"
      - id: "codex-5.4"
        cli_model: "gpt-5.4"
        tier: "complex"
```

### Adapter Interface Changes

Updated `ProviderAdapter` interface:

```typescript
interface ProviderAdapter {
  readonly name: string;
  send(prompt: string, cliSessionId: string | null, cliModel: string): SendResult;
  kill(sessionId: string): Promise<void>;
}
```

- The `modelId` property is removed from the adapter interface — adapters no longer own a single model
- `send()` receives `cliModel` per-call and appends the appropriate flag (`--model` for Claude, `-m` for Codex)
- One adapter instance per provider (not per model)
- `ProviderRouter` maps each model ID to `{ adapter, cliModel }` pairs
- `listModels()` returns all model IDs across all providers

### Prompt Assembly

When `send()` is called, the `prompt` parameter contains the fully assembled context string. The completions route is responsible for building this:

- **Same model, has CLI session** → just the new user message (CLI handles history via `--resume`)
- **Cross-model or no CLI session** → assembled by `src/context.ts`: `[summary (if any)] + [recent messages formatted as text] + [new prompt]`

The adapter treats `prompt` as an opaque string — it never knows whether it contains assembled context or a single message.

### Tier Routing Config

```yaml
routing:
  default_model: "claude-sonnet"
  tiers:
    trivial: "codex-5-mini"
    simple: "claude-haiku"
    moderate: "claude-sonnet"
    complex: "codex-5.4"
```

Tiers can mix providers for best value. Fully customizable by the user.

**Note:** The `tier` field on individual models in the `providers` config is informational only (used by `GET /v1/models` to show each model's intended tier). Actual routing is controlled exclusively by the `routing.tiers` map. If a tier has no model mapped, `default_model` is used as fallback.

---

## 3. Context Management

### Strategy by Situation

**Same provider, same session:**
- Let the CLI handle context via session resume (`--resume` / thread ID)
- Proxai passes `cliSessionId` as before — no change

**Cross-model handoff** (switching models mid-conversation):
- Proxai pulls message history from SQLite
- If history is small (< `max_messages_before_summary` user+assistant messages): send all messages as context
- If history is large: use existing summary (or generate one) + send last `recent_window_size` messages
- **Important:** Cross-model handoff is context-degraded. The new model only receives message text history, not CLI-internal state (tool results, file state, working directory context). The CLI session ID is not transferable between models. A new CLI session starts for the new model.

**Summarization engine:**
- New module: `src/context.ts`
- Triggered when user+assistant message count exceeds `max_messages_before_summary` (system messages excluded from count)
- Skipped if total messages are fewer than `recent_window_size` (nothing to summarize)

### Summarization Call Flow

1. Context module calls `router.getAdapter(routing.tiers.trivial)` to get the cheapest model
2. Builds a summarization prompt: "Summarize this conversation concisely, preserving key decisions, code snippets, and context: [older messages]"
3. Calls `adapter.send(summaryPrompt, null, cliModel)` — a standalone call, no session resume
4. Collects all chunks into a summary string
5. Stores summary in SQLite (`sessions.summary` column)
6. Summary requests are logged in `request_logs` with `model_requested: "internal:summarize"`

**Error handling:** If summarization fails (model unavailable, timeout, error), fall back to truncated recent history only (last `recent_window_size` messages without summary). Log the failure but don't block the user's request.

**Latency:** Summarization runs synchronously before the user's request is forwarded. For v1 this is acceptable since it only triggers on cross-model handoff with long history. Future optimization: pre-compute summaries in the background after every N messages.

### Config

```yaml
context:
  max_messages_before_summary: 20
  recent_window_size: 10
```

---

## 4. Token Usage Tracking & Logging

### Per-Request Data

New SQLite table `request_logs`:

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| session_id | TEXT | References sessions (no FK constraint — logs persist after session deletion for analytics) |
| timestamp | INTEGER | Unix ms |
| model_requested | TEXT | What client asked for (or "auto") |
| model_used | TEXT | What was actually used |
| tier | TEXT | Classifier result |
| classifier_signals | TEXT | JSON array of fired signals |
| prompt_tokens_est | INTEGER | Estimated prompt tokens |
| response_tokens_est | INTEGER | Estimated response tokens |
| latency_ms | INTEGER | Time from send to last chunk |
| summary_triggered | INTEGER | 1 if summarization ran |

### Console Logging

Every request logs:
```
[proxai] POST /v1/chat/completions | session: abc123 | requested: auto → routed: claude-haiku (trivial) | ~45 prompt tokens | 128ms
```

### Dashboard API

New routes in `src/routes/stats.ts`:

- **`GET /v1/stats`** — aggregated stats:
  - Total requests, total estimated tokens
  - Tokens by model
  - Avg latency by model
  - Routing distribution (% per tier)
  - Estimated cost savings (trivial/simple requests that avoided expensive models)

- **`GET /v1/stats/sessions/:id`** — per-session breakdown:
  - Every request with model, tokens, latency, tier

- **`GET /v1/stats/models`** — per-model stats:
  - Total tokens, request count, avg latency, tier distribution

All stats routes require the same bearer token auth as other endpoints. Stats endpoints accept optional `?from=<unix_ms>&to=<unix_ms>` query params for time-range filtering to keep queries fast on large datasets.

---

## 5. Files to Create / Modify

### New Files

| File | Purpose |
|------|---------|
| `src/classifier.ts` | Prompt complexity classifier |
| `src/context.ts` | Context management & summarization |
| `src/routes/stats.ts` | Dashboard API routes |

### Modified Files

| File | Changes |
|------|---------|
| `src/config.ts` | New Zod schemas for `routing`, `context`, multi-model `providers` |
| `src/providers/adapter.ts` | `send()` accepts `cliModel` parameter |
| `src/providers/claude.ts` | Append `--model <cliModel>` to spawn args |
| `src/providers/codex.ts` | Append `-m <cliModel>` to spawn args |
| `src/providers/router.ts` | Map model IDs to `{ adapter, cliModel }`, tier-based lookup |
| `src/routes/completions.ts` | Integrate classifier, log routing decisions, context handoff |
| `src/sessions/store.ts` | New `request_logs` table, `summary` column on sessions |
| `src/server.ts` | Register stats routes |
| `proxai.config.yaml` | Updated with multi-model and routing config |

---

## 6. Migration & Backwards Compatibility

- Existing single-`model_id` config format still works — Zod schema accepts it as sugar for a single-model `models` array. If both `model_id` and `models` are present, validation errors.
- New `routing` and `context` sections are optional with sensible defaults
- `model: "auto"` is new; existing clients sending specific model IDs work unchanged
- `request_logs` table is created on startup if it doesn't exist (same pattern as existing tables)

---

## 7. Future Upgrade Path

- **LLM-as-Judge classification:** When API-based providers are added, optionally use a cheap model to classify instead of heuristics
- **Cost estimates:** Map model IDs to known pricing for real dollar-amount tracking
- **Adaptive routing:** Use logged data to auto-tune classifier thresholds
- **Test UI stats panel:** Visual dashboard (separate UI PRD scope)
