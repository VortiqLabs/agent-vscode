# VortiqLabs Agent — Remote MCP Server & VS Code Agent Foundation

VortiqLabs Agent provides a secure Model Context Protocol (MCP) server that connects ChatGPT and external MCP clients directly to a developer's workspace through the active VortiqLabs Agent VS Code Extension.

---

## Architecture Overview

```
ChatGPT / MCP Client
         │
         │  (HTTP + SSE / Streamable HTTP, Bearer Auth)
         ▼
┌───────────────────────────────┐
│ VortiqLabs MCP Gateway Server │  (Port 3000, 0.0.0.0 / 127.0.0.1)
└──────────────┬────────────────┘
               │
               │  (Local HTTP RPC + Bearer Shared Secret)
               ▼
┌───────────────────────────────┐
│ VS Code Extension Agent API   │  (Port 43127, 127.0.0.1 loopback)
└──────────────┬────────────────┘
               │
               │  (Extension Agent / Safe Workspace APIs)
               ▼
┌───────────────────────────────┐
│ Active Workspace Files        │
└───────────────────────────────┘
```

The **VS Code Extension** acts as the execution layer and sole source of truth for workspace operations. The **MCP Server** acts as the protocol adapter delegating tool execution directly to the extension Agent.

---

## Quick Start & Development Workflow

### 1. Prerequisites
- Node.js `v20+` or `v22+`
- npm `v10+`

### 2. Installation
Clone the repository and install dependencies:
```bash
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Configure environment variables in `.env`:
- `HOST`: Set to `127.0.0.1` for local development, or `0.0.0.0` inside GitHub Codespaces when remote network access is required.
- `PORT`: MCP server port (default: `3000`).
- `MCP_ALLOWED_ORIGINS`: Optional comma-separated list of exact browser origins
  allowed for CORS. Requests without an `Origin` header are supported.
- `VORTIQLABS_AGENT_URL`: URL of running VS Code extension Agent API (default: `http://127.0.0.1:43127`).
- `VORTIQLABS_AGENT_AUTH_TOKEN`: Shared secret Bearer token for authenticating MCP requests to the extension Agent.

### 4. Running the VS Code Extension & MCP Gateway

#### Step A: Launch VS Code Extension
1. Open the project folder in VS Code.
2. Press `F5` (or run **Extension** launch configuration) to launch the **Extension Development Host**.
3. The extension activates and starts the Agent API on `http://127.0.0.1:43127`.

#### Step B: Start MCP Gateway
In your terminal, start the MCP gateway server:
```bash
npm run mcp:dev
```
Or start the pre-built gateway:
```bash
npm run mcp:start
```

The MCP endpoint will be available at:
`http://127.0.0.1:3000/mcp`

---

## GitHub Codespaces Connectivity

Follow this workflow to connect ChatGPT to your active workspace inside GitHub Codespaces:

1. **Open Workspace**: Open the repository inside GitHub Codespaces.
2. **Install & Compile**: Run `npm install && npm run compile`.
3. **Launch Extension**: Start the VS Code Extension in Extension Development Host or run `node esbuild.js` / enable extension in host.
4. **Configure Environment**: Ensure `.env` has:
   - `HOST=0.0.0.0`
   - `PORT=3000`
   - `VORTIQLABS_AGENT_URL=http://127.0.0.1:43127`
   - `VORTIQLABS_AGENT_AUTH_TOKEN=<your_shared_agent_token>`
5. **Start Gateway**: The VS Code extension starts the MCP gateway automatically
   after its local Agent API is ready. To run it separately without the
   extension, use `npm run mcp:dev` or `npm run mcp:start` (do not run both
   gateways on the same port).
6. **Forward Port**:
   - Go to the **Ports** tab in Codespaces.
   - Forward port `3000`.
   - Set Port Visibility to **Public** (or **Private** with an authenticated proxy).
   - Copy the Forwarded Address URL (e.g. `https://<codespace-id>-3000.app.github.dev`).
7. **Connect ChatGPT**:
   - Exact MCP connection endpoint URL to configure in ChatGPT:
     `https://<codespace-id>-3000.app.github.dev/mcp`
8. **Invoke Tools**: Trigger MCP tools (`list_workspace_files`, `read_file`, `write_file`, `edit_file`, etc.) and verify that edits execute through the running VS Code extension Agent against your workspace.

> **Note**: The VS Code Extension must be running for workspace operations to succeed. If the extension is stopped, MCP tool calls will clearly fail with an error stating that the extension must be active.

---

## Implemented MCP Tools (Delegated to VS Code Extension Agent)

| Tool Name | Description |
|---|---|
| `ping` | Returns server health, version (`0.3.0`), uptime, and timestamp. |
| `workspace_info` | Returns active workspace information via VS Code extension Agent API. |
| `list_workspace_files` | Lists files and directories via VS Code extension Agent API. |
| `read_file` | Reads workspace file contents via VS Code extension Agent API. |
| `write_file` | Creates or writes workspace file contents via VS Code extension Agent API. |
| `edit_file` | Replaces specified line range in a file via VS Code extension Agent API. |
| `git_status` | Returns Git branch and working tree status via VS Code extension Agent API. |
| `git_diff` | Returns working-tree git diff via VS Code extension Agent API. |
| `git_apply_patch` | Applies unified git patch via VS Code extension Agent API. |
| `run_terminal` | Executes a complete non-interactive command from the workspace root. Use it for tests, builds, linters, and Git inspection; inspect stdout, stderr, and the exit code. Defaults to 30 seconds and is capped at 120 seconds. |
| `file_diagnostics` | Returns every current VS Code error and warning for one workspace-relative file, including severity, message, source/code, and 1-based ranges. Use it after editing or when validating a file. |
| `indexer_install` | Verifies the bundled Codebase Indexer SDK and its parser/GitHub worker assets. Core indexing needs no separate runtime download. |
| `indexer_status` | Inspects Codebase Indexer status via VS Code extension Agent API. |
| `indexer_search` | Hybrid or lexical search; semantic mode requires an explicitly configured embedding provider. |
| `indexer_context` | Builds LLM-ready context from relevant indexed files, symbols, relations, and chunks within file/token budgets. |
| `indexer_chunks` | Retrieves indexed code chunks with query/file filters and pagination. |
| `indexer_symbols` | Finds indexed symbol definitions. |
| `indexer_references` | Finds symbol references. |
| `indexer_callers` / `indexer_callees` | Explores caller and callee relationships. |
| `indexer_dependencies` / `indexer_dependents` | Explores dependency graph edges with bounded depth. |
| `indexer_symbol_path` | Finds a bounded path between two symbols. |
| `indexer_files` | Lists indexed files with optional language/path filters. |
| `indexer_repository_map` | Summarizes repository areas and indexed structure. |
| `indexer_api_endpoints` | Detects indexed API endpoint definitions. |
| `indexer_classify_query` | Classifies a natural-language codebase question. |
| `indexer_sensitive_regions` | Detects likely sensitive regions with heuristic/redacted reporting. |
| `indexer_index_github` | Indexes a GitHub repository, optionally at a selected ref. |
| `indexer_inspect` | Reads metadata from an existing binary index file. |
| `indexer_remove` | Removes an index after explicit `confirm=true`; source files are not deleted. |
| `indexer_watch` / `indexer_stop_watch` | Starts or stops incremental watch mode. |
| `indexer_dashboard` / `indexer_stop_dashboard` | Starts or stops the local-only web dashboard. |
| `index_workspace` | Indexes the active workspace or a validated subdirectory, with size/worker/profile options. |

Core indexing now uses the official `@vortiqlabs/codebase-indexer` TypeScript SDK (`createCodebase`) from upstream v0.2.0. The SDK source is pinned to upstream commit `364f30be53fe0e167144cb0794fe37de8fb45895` under `vendor/codebase-indexer` because the GitHub Packages registry currently publishes only through 0.1.7; the SDK API used here is not yet available in those published versions. Its Tree-sitter grammars, WASM runtime, and GitHub import worker are built into the extension. Indexing, search, graph queries, context retrieval, GitHub imports, and incremental watch mode use the SDK directly. The dashboard and raw binary-index inspection remain on the legacy standalone runtime because those capabilities are not currently exposed by the stable SDK API. See `THIRD_PARTY_NOTICES.md` for attribution and licensing.

---

## VS Code Agent Activity Sidebar

The extension adds a **VortiqLabs Agent** Activity Bar view that streams MCP activity from the extension Agent: tool name, arguments, running/success/error status, elapsed time, bounded results, terminal stdout/stderr, exit codes, and syntax-coloured unified diffs/patches. Use the refresh button to request a snapshot or Clear to clear the in-memory activity feed. The feed is intentionally bounded and is not persisted to disk.

Additional VS Code-native MCP tools:

- `editor_context` — active document, language, cursor, selection and selected text.
- `editor_diagnostics` — current language-service diagnostics for the active document or a workspace-relative path.
- `editor_symbols` — document symbols from installed VS Code language providers.
- `workspace_search` — bounded literal text search while skipping common dependency/build folders.
- `browser_open_url` — opens HTTP(S) URLs in the user's configured external browser.

Terminal stdout/stderr is forwarded as process chunks while the command is running, then the completed output and exit code are recorded. Output and execution time are bounded. Browser automation and inspection of arbitrary existing browser tabs are **not** part of the stable VS Code Extension API; `browser_open_url` intentionally opens the user's configured browser instead of pretending otherwise. Browser automation can be added through an explicit Playwright/browser MCP integration where installed and authorized.

The VS Code Extension API is extensive and not every API is a suitable MCP tool. APIs tied to UI interactions, debugging, authentication, extension installation, or destructive operations need capability checks and user consent rather than unrestricted generic invocation.

## Security & Architectural Guarantees

- **Extension Layer Authorization**: Every workspace operation is validated and executed by the VS Code extension Agent.
- **Loopback Binding**: Extension Agent API is strictly bound to `127.0.0.1:43127` loopback.
- **MCP Gateway Authentication**: When OneAuth is configured, the MCP endpoint advertises OAuth Protected Resource Metadata and validates each bearer token against OneAuth `/api/oauth/userinfo`. The loopback extension Agent remains protected by `VORTIQLABS_AGENT_AUTH_TOKEN`.
- **Path Traversal Protection**: Enforces canonical path verification (`realpath`) to block `../` traversal or symlink escapes.
- **Graceful Shutdown**: Stopping the extension cleanly stops its local Agent server.

---

## Test & Build Commands

- **Run Type Checks**: `npm run check-types`
- **Run Linter**: `npm run lint`
- **Run Unit & Integration Tests**: `npm test`

## OneAuth Sign-in and Tunnel Allocation

The Activity sidebar includes **Sign in**, **Sign out**, and **Get tunnel URL + port** actions.

For the OAuth client in OneAuth, register this exact redirect URI:

`http://localhost:8765/callback`

The extension uses Authorization Code + PKCE (S256) and requests the `openid profile email` scopes. The default OAuth client ID and OneAuth base URL are contributed extension settings; override them through VS Code Settings if your deployment uses different values. Tunnel creation is manual, so the extension does not request the `tunnel:manage` scope. Access and refresh tokens are stored using VS Code's SecretStorage, not in workspace files.

After signing in, select **Get tunnel URL + port**. The extension calls `POST /api/agent/tunnel` with the OAuth bearer token and displays the returned public URL, hostname, and port. This action provisions/displays the tunnel allocation; it does not by itself guarantee end-to-end traffic forwarding through the shared gateway.
