# Task 16: End-to-End Smoke Test

**Chunk:** 7 — Smoke Test
**Dependencies:** Task 14, Task 15
**Status:** Not started

## Description

Manual end-to-end verification that the full system works: server starts, endpoints respond, Claude CLI integration works, streaming works, UI works.

## Acceptance Criteria

- [ ] Server starts with `npx tsx src/index.ts`
- [ ] `GET /health` returns `{"status":"ok"}`
- [ ] `GET /v1/models` (with auth) returns list with `claude-code` and `codex-cli`
- [ ] `POST /v1/chat/completions` (non-streaming, `claude-code`) returns OpenAI-format response with `session_id`
- [ ] `POST /v1/chat/completions` (streaming, `claude-code`) returns SSE stream with `data:` chunks and `[DONE]`
- [ ] UI at `/ui` loads, model dropdown populates, sending a message shows streaming response
- [ ] Session ID appears in UI header after first message
- [ ] All unit tests pass: `npx vitest run`

## Steps

- [ ] 1. Start server: `npx tsx src/index.ts &`
- [ ] 2. Test health: `curl http://127.0.0.1:3077/health`
- [ ] 3. Test models: `curl -H "Authorization: Bearer change-me" http://127.0.0.1:3077/v1/models`
- [ ] 4. Test non-streaming completions with Claude Code
- [ ] 5. Test streaming completions with Claude Code
- [ ] 6. Test the UI in browser at `http://127.0.0.1:3077/ui`
- [ ] 7. Kill server and final commit

## Test Commands

```bash
# Health
curl http://127.0.0.1:3077/health

# Models
curl -H "Authorization: Bearer change-me" http://127.0.0.1:3077/v1/models

# Non-streaming
curl -X POST http://127.0.0.1:3077/v1/chat/completions \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-code","messages":[{"role":"user","content":"Say hello in one word"}],"stream":false}'

# Streaming
curl -N -X POST http://127.0.0.1:3077/v1/chat/completions \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-code","messages":[{"role":"user","content":"Say hello"}],"stream":true}'
```

## Commit Message

```
chore: MVP complete — smoke test passed
```
