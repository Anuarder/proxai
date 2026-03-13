# Task 15: Minimal Chat UI

**Chunk:** 6 — Test UI
**Dependencies:** Task 13
**Status:** Done

## Description

Single HTML file with embedded CSS/JS for testing the API. Dark theme, streaming support, session tracking.

## Files

- Create: `public/index.html`

## Acceptance Criteria

- [x] Single file, no build step
- [x] Model selector dropdown populated from `GET /v1/models`
- [x] Bearer token input field (defaults to "change-me")
- [x] Chat message list with user/assistant bubbles
- [x] Streaming response display (token-by-token via SSE)
- [x] Session ID shown in header after first message
- [x] Multi-turn: `session_id` sent with subsequent requests
- [x] Enter to send, Shift+Enter for newline
- [x] Auto-resize textarea
- [x] Error messages displayed inline
- [x] Dark theme

## Steps

- [x] 1. Create `public/index.html` with embedded CSS and JS
- [ ] 2. Commit

## Notes

- Uses `fetch` with `ReadableStream` for SSE parsing
- Parses `data: {...}` lines from the stream
- Captures `session_id` from first chunk and sends it with follow-up requests

## Commit Message

```
feat: add minimal chat test UI
```
