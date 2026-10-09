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
- `MCP_AUTH_TOKEN`: Secure Bearer token used to authenticate incoming requests from ChatGPT/MCP clients.
- `VORTIQLABS_AGENT_URL`: URL of running VS Code extension Agent API (default: `http://127.0.0.1:43127`).
- `VORTIQLABS_AGENT_AUTH_TOKEN`: Shared secret Bearer token for authenticating MCP requests to the extension Agent.

Generate a secure random secret token:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

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
   - `MCP_AUTH_TOKEN=<your_generated_secret_token>`
   - `VORTIQLABS_AGENT_URL=http://127.0.0.1:43127`
   - `VORTIQLABS_AGENT_AUTH_TOKEN=<your_shared_agent_token>`
5. **Start Gateway**: Run `npm run mcp:dev` or `npm run mcp:start`.
6. **Forward Port**:
   - Go to the **Ports** tab in Codespaces.
   - Forward port `3000`.
   - Set Port Visibility to **Public** (or **Private** with authenticated proxy).
   - Copy the Forwarded Address URL (e.g. `https://<codespace-id>-3000.app.github.dev`).
7. **Connect ChatGPT**:
   - Exact MCP connection endpoint URL to configure in ChatGPT:
     `https://<codespace-id>-3000.app.github.dev/mcp`
   - Authentication method: **Bearer Token**
   - Token value: `<your_mcp_auth_token>`
8. **Invoke Tools**: Trigger MCP tools (`list_workspace_files`, `read_file`, `write_file`, `edit_file`, etc.) and verify that edits execute through the running VS Code extension Agent against your workspace.

> **Note**: The VS Code Extension must be running for workspace operations to succeed. If the extension is stopped, MCP tool calls will clearly fail with an error stating that the extension must be active.

---

## Implemented MCP Tools (Delegated to VS Code Extension Agent)

| Tool Name | Description |
|---|---|
| `ping` | Returns server health, version (`0.1.0`), uptime, and timestamp. |
| `workspace_info` | Returns active workspace information via VS Code extension Agent API. |
| `list_workspace_files` | Lists files and directories via VS Code extension Agent API. |
| `read_file` | Reads workspace file contents via VS Code extension Agent API. |
| `write_file` | Creates or writes workspace file contents via VS Code extension Agent API. |
| `edit_file` | Replaces specified line range in a file via VS Code extension Agent API. |
| `git_status` | Returns Git branch and working tree status via VS Code extension Agent API. |
| `git_diff` | Returns working-tree git diff via VS Code extension Agent API. |
| `git_apply_patch` | Applies unified git patch via VS Code extension Agent API. |
| `indexer_status` | Inspects Codebase Indexer status via VS Code extension Agent API. |
| `indexer_search` | Searches codebase index via VS Code extension Agent API. |
| `indexer_symbols` | Retrieves symbol information via VS Code extension Agent API. |
| `index_workspace` | Indexes authorized workspace via VS Code extension Agent API. |

---

## Security & Architectural Guarantees

- **Extension Layer Authorization**: Every workspace operation is validated and executed by the VS Code extension Agent.
- **Loopback Binding**: Extension Agent API is strictly bound to `127.0.0.1:43127` loopback.
- **Shared Secret Authentication**: MCP server authenticates to Agent API via `Authorization: Bearer <token>`.
- **Remote Access Controls**: External MCP endpoint requires constant-time Bearer token verification and validates origin headers to defend against DNS rebinding.
- **Path Traversal Protection**: Enforces canonical path verification (`realpath`) to block `../` traversal or symlink escapes.
- **Graceful Shutdown**: Stopping the extension cleanly stops its local Agent server.

---

## Test & Build Commands

- **Run Type Checks**: `npm run check-types`
- **Run Linter**: `npm run lint`
- **Run Unit & Integration Tests**: `npm test`
- **Build Extension & MCP Gateway**: `node esbuild.js`
