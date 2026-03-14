# Task 16: End-to-End Smoke Test

**Chunk:** 7 — Smoke Test
**Dependencies:** Task 14, Task 15
**Status:** Done

## Description

Manual end-to-end verification that the full system works: server starts, endpoints respond, Codex CLI integration works, streaming works, and the test UI is served with the expected model/session wiring.

## Acceptance Criteria

- [x] Server starts with `npx tsx src/index.ts`
- [x] `GET /health` returns `{"status":"ok"}`
- [x] `GET /v1/models` (with auth) returns list with `claude-code` and `codex-cli`
- [x] `POST /v1/chat/completions` (non-streaming, `codex-cli`) returns OpenAI-format response with `session_id`
- [x] `POST /v1/chat/completions` (streaming, `codex-cli`) returns SSE stream with `data:` chunks and `[DONE]`
- [x] UI at `/ui` loads and serves the expected model/session wiring for the smoke test
- [x] Session ID is included in the verified completions responses and the UI contains the header update logic
- [x] All unit tests pass: `npm test`

## Steps

- [x] 1. Start server: `npx tsx src/index.ts`
- [x] 2. Test health: `curl http://127.0.0.1:3077/health`
- [x] 3. Test models: `curl -H "Authorization: Bearer your-secret-key" http://127.0.0.1:3077/v1/models`
- [x] 4. Test non-streaming completions with Codex CLI
- [x] 5. Test streaming completions with Codex CLI
- [x] 6. Verify the UI payload at `http://127.0.0.1:3077/ui` includes model loading, completions fetch, and session badge wiring
- [x] 7. Run unit tests with `npm test`
- [x] 8. Kill server

## Test Commands

```bash
# Health
curl http://127.0.0.1:3077/health

# Models
curl -H "Authorization: Bearer your-secret-key" http://127.0.0.1:3077/v1/models

# Non-streaming
curl -X POST http://127.0.0.1:3077/v1/chat/completions \
  -H "Authorization: Bearer your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"codex-cli","messages":[{"role":"user","content":"Say hello in one word"}],"stream":false}'

# Streaming
curl -N -X POST http://127.0.0.1:3077/v1/chat/completions \
  -H "Authorization: Bearer your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"codex-cli","messages":[{"role":"user","content":"Say hello"}],"stream":true}'
```

## Verification Notes

- Verified on March 13, 2026 with `codex-cli` because Claude Code was unavailable due to usage limits.
- Live non-streaming response returned `"Hello"` with a generated `session_id`.
- Live streaming response returned `data:` chunks followed by `data: [DONE]`.
- `/ui` served the expected HTML/JS wiring for model loading, completions fetch, and session badge updates.

## Commit Message

```
chore: MVP complete — smoke test passed
```
