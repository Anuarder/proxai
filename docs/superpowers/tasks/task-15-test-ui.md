# Task 15: Minimal Chat UI

**Chunk:** 6 — Test UI
**Dependencies:** Task 13
**Status:** Not started

## Description

Single HTML file with embedded CSS/JS for testing the API. Dark theme, streaming support, session tracking.

## Files

- Create: `public/index.html`

## Acceptance Criteria

- [ ] Single file, no build step
- [ ] Model selector dropdown populated from `GET /v1/models`
- [ ] Bearer token input field (defaults to "change-me")
- [ ] Chat message list with user/assistant bubbles
- [ ] Streaming response display (token-by-token via SSE)
- [ ] Session ID shown in header after first message
- [ ] Multi-turn: `session_id` sent with subsequent requests
- [ ] Enter to send, Shift+Enter for newline
- [ ] Auto-resize textarea
- [ ] Error messages displayed inline
- [ ] Dark theme

## Steps

- [ ] 1. Create `public/index.html` with embedded CSS and JS
- [ ] 2. Commit

## Notes

- Uses `fetch` with `ReadableStream` for SSE parsing
- Parses `data: {...}` lines from the stream
- Captures `session_id` from first chunk and sends it with follow-up requests

## Commit Message

```
feat: add minimal chat test UI
```
