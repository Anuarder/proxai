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

### Routing Behavior

- `model: "auto"` — classifier picks the tier, router maps tier → model
- `model: "claude-sonnet"` (explicit) — used as-is, but classifier still runs and logs what it *would* have picked (for analytics)

---

## 2. Multi-Model Provider Support

### Key Insight

Both Claude CLI (`--model <model>`) and Codex CLI (`-m <model>`) support per-request model selection. A single provider can serve multiple tiers.

### Config Changes

The `providers` section changes from a single `model_id` to a `models` list:

```yaml
providers:
  claude:
    command: "claude"
    args: ["--print"]
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

### Adapter Changes

- `ProviderAdapter.send()` receives the `cli_model` string and appends the appropriate flag (`--model` for Claude, `-m` for Codex) to spawn args
- Each adapter exposes multiple model IDs instead of one
- `ProviderRouter` maps model IDs to `{ adapter, cliModel }` pairs

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

---

## 3. Context Management

### Strategy by Situation

**Same provider, same session:**
- Let the CLI handle context via session resume (`--resume` / thread ID)
- Proxai passes `cliSessionId` as before — no change

**Cross-model handoff** (switching models mid-conversation):
- Proxai pulls message history from SQLite
- If history is small (< `max_messages_before_summary` messages): send all messages as context
- If history is large: generate summary + send last `recent_window_size` messages

**Summarization engine:**
- New module: `src/context.ts`
- Triggered when message count exceeds `max_messages_before_summary`
- Uses the cheapest available model to generate a summary of older messages
- Summary stored in SQLite alongside the session (`sessions.summary` column)
- New requests get: `[summary] + [last N messages] + [new prompt]`

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
| session_id | TEXT | FK to sessions |
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

- Existing single-`model_id` config format should still work (treated as a single-model provider)
- New `routing` and `context` sections are optional with sensible defaults
- `model: "auto"` is new; existing clients sending specific model IDs work unchanged
- `request_logs` table is created on startup if it doesn't exist (same pattern as existing tables)

---

## 7. Future Upgrade Path

- **LLM-as-Judge classification:** When API-based providers are added, optionally use a cheap model to classify instead of heuristics
- **Cost estimates:** Map model IDs to known pricing for real dollar-amount tracking
- **Adaptive routing:** Use logged data to auto-tune classifier thresholds
- **Test UI stats panel:** Visual dashboard (separate UI PRD scope)
