# Tech Tasks for the Future

## Classifier Heuristic Signals — Revisit Approach

The current design uses weighted heuristic signals (token count, keywords, code markers, message history length, explicit instructions) for prompt complexity classification. This may not be accurate enough in practice.

**Consider:**
- Replace heuristics with LLM-based classification once API providers are available
- Use logged routing data to evaluate heuristic accuracy before investing in improvements
- Explore embedding-based classification for better semantic understanding
- Test with real traffic to identify where heuristics misroute most often

---

## PRD: Provider Coverage

Expand proxai beyond Claude CLI and Codex CLI to support more AI providers.

**Scope:**
- **Gemini CLI** — Google's CLI tool, similar pattern to Claude/Codex. Needs adapter implementing `ProviderAdapter` interface, research CLI flags for model selection, streaming output format, and session management
- **Local LLMs** — Ollama, LM Studio, llama.cpp server. These expose OpenAI-compatible HTTP APIs locally, so the adapter would be HTTP-based rather than CLI-based. Different adapter pattern from CLI providers
- **OpenRouter / API providers** — Single API gateway to hundreds of models (Claude, GPT, Gemini, Llama, Mistral). HTTP adapter with API key auth. Would unlock the full tier routing potential (cheap models for trivial, expensive for complex)
- **Generic CLI adapter** — A configurable adapter that can wrap any CLI tool with minimal config (command, args, output parsing rules). Reduces effort to add new CLI tools

**Key questions to research:**
- Which providers have CLI tools vs API-only?
- How does each handle streaming output? (SSE, JSON stream, line-delimited)
- Session/context management differences across providers
- Should HTTP-based adapters share a base class separate from CLI adapters?
- Authentication patterns (API keys, OAuth, local auth)

---

## PRD: Test UI Improvements

The current test UI (`public/index.html`) is a minimal vanilla JS chat. Needs significant upgrades to be useful for daily development and debugging.

**Scope:**
- **Model selector per message** — pick which model to use for each request, or select "auto" for classifier routing
- **Stats dashboard** — visualize token usage, routing decisions, latency, cost estimates from the `/v1/stats` API endpoints (built in token optimization PRD)
- **Session management** — list active sessions, switch between them, see message history, delete sessions
- **Request inspector** — for each message, show: which model was requested vs used, classifier tier, token estimates, latency. Useful for debugging routing decisions
- **Markdown rendering** — render assistant responses with proper markdown, code highlighting
- **Multi-provider status** — show which providers/models are available and healthy
- **Settings panel** — configure bearer token, default model, routing preferences from the UI

**Key questions to research:**
- Keep it vanilla JS or migrate to a lightweight framework (Preact, Lit)?
- Should the UI be a separate package or stay as a static file?
- Real-time updates (WebSocket) vs polling for stats?

---

## PRD: Context Management & RAG

Smart context handling to ensure AI models get the right information without wasting tokens.

**Scope:**
- **Project onboarding** — auto-generate project descriptions by scanning codebase (README, package.json, directory structure, key files). Store as reusable context that gets prepended to requests
- **RAG system** — index project files and documentation, retrieve relevant chunks based on the user's prompt. Avoids sending entire codebase as context
- **Cross-session memory** — persist key decisions, preferences, and facts across sessions (similar to Claude Code's memory system but for all providers)
- **Context budget** — set max token limits per request, auto-trim context to fit within budget while preserving most relevant information

**Key questions to research:**
- Is RAG overkill for a local proxy? Maybe simpler file-inclusion rules are enough
- Embedding model for RAG — local (Ollama) or API-based?
- Storage for vector embeddings (SQLite with vector extensions? Separate vector DB?)
- How does this interact with CLI providers that manage their own context?

---

## PRD: Agent System

Use proxai as the backbone for an autonomous agent system that can handle complex multi-step tasks.

**Scope:**
- **Task ingestion** — accept tasks from Jira (by ID), UI input, or API. Parse requirements into structured format
- **Project understanding** — onboard to a codebase automatically (structure, conventions, dependencies, architecture)
- **Task decomposition** — break complex tasks into sub-tasks, identify dependencies, determine what can run in parallel
- **PRD generation** — auto-generate PRDs for each sub-task
- **Parallel execution** — run independent sub-tasks in separate git worktrees concurrently
- **Progress tracking** — monitor agent progress, allow human review at checkpoints

**Key questions to research:**
- Orchestration model — single coordinator agent + worker agents, or peer-to-peer?
- How to handle agent failures and retries?
- Human-in-the-loop: when should the agent pause and ask for review?
- Integration with existing tools (Jira, GitHub, Confluence)
- How does this relate to existing agent frameworks (Claude Code agents, Codex agents)?
