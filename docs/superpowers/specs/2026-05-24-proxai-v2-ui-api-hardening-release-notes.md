# Proxai v2 — Release Notes

## Breaking changes

- **Config:** `auth.bearer_token` is removed. Replace with:
  - `auth.ask_token` (required)
  - `auth.agent_token` (required)
  - `auth.admin_token` (optional; grants both modes)
- **Request schema:** every request to `/v1/chat/stream` and `/v1/chat/completions` must include `mode: "ask" | "agent"`.
- **Endpoints removed:** `/v1/sessions/*`. The server is stateless; clients own conversation history and resend the full `messages` array on every request.
- **Config:** `sessions:` block removed; `providers.*.args` removed.

## Additions

- `POST /v1/chat/stream` — typed-event SSE protocol (text_delta, thinking_delta, tool_use, file_edit, command_exec, auth_required, error, usage, turn_complete, done).
- `GET /openapi.json` and `GET /docs` — OpenAPI 3.1 schema + Swagger UI.
- `GET /v1/models` now performs live probes; the response includes `status` per model.
- Ask mode: tool whitelist + curated MCP config (`ask-mcp.json`) + system prompt.
- UI: mode toggle, two-token header, markdown rendering, event timeline, availability badges, auth banner, cancel button.

## Removals

- SQLite store and session manager.
- `better-sqlite3` dependency.

## Known gaps

- **Codex + ask mode is not supported in v2.** The Codex CLI flag surface for tool whitelisting / MCP config / system prompt has not been verified, so the adapter fails closed: any request to the `codex-cli` model with a non-null `allowed_tools`, `mcp_config_file`, or `system_prompt` (i.e. ask mode with the default `proxai.config.yaml`) returns a typed `error` event with `code: 'mode_unsupported'` instead of spawning. Use `claude-code` for ask mode, or use Codex only in agent mode. A follow-up task will verify the Codex flag set and re-enable Codex ask mode.
- **`ask-mcp.json` ships with Context7 only.** No standard web-search MCP is bundled. Extend the file to add any additional safe MCPs your environment provides.
