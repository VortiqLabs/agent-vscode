# VortiqLabs Agent — Remote MCP Server & VS Code Agent Foundation

VortiqLabs Agent provides a secure Model Context Protocol (MCP) server that connects ChatGPT and external MCP clients directly to a developer's workspace (including GitHub Codespaces).

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
Copy the sample environment file `.env.example` to `.env`:
```bash
cp .env.example .env
```

Configure your environment variables in `.env`:
- `HOST`: Set to `127.0.0.1` for local development, or `0.0.0.0` inside GitHub Codespaces when remote network access is required.
- `PORT`: Server port (default: `3000`).
- `MCP_AUTH_TOKEN`: Secure Bearer token used to authenticate incoming requests.
- `MCP_WORKSPACE_ROOT`: Path to the authorized workspace folder (defaults to current working directory).

To generate a new secret auth token:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Running the MCP Server
Start the development MCP server:
```bash
npm run mcp:dev
```

Or start the pre-built server directly:
```bash
npm run mcp:start
```

The MCP endpoint will be available at:
`http://127.0.0.1:3000/mcp`

---

## Connecting from GitHub Codespaces to ChatGPT

### Step 1: Start Server inside Codespace
Inside your GitHub Codespace terminal:
1. Ensure `.env` has `HOST=0.0.0.0` and a generated `MCP_AUTH_TOKEN`.
2. Run `npm run mcp:dev`.

### Step 2: Forward Port in Codespaces
1. Open the **Ports** tab in Codespaces (bottom panel or VS Code UI).
2. Locate port `3000` (or add port `3000` manually).
3. Right-click port `3000` -> **Port Visibility** -> Select **Public** (or **Private** if accessing through authenticated proxy).
4. Copy the **Forwarded Address** URL (e.g. `https://<codespace-id>-3000.app.github.dev`).

Your remote MCP endpoint is:
`https://<codespace-id>-3000.app.github.dev/mcp`

---

## Testing & Verification

### Testing with MCP Inspector
You can inspect tool schemas and execute tools locally or remotely using the official MCP Inspector:
```bash
npx @modelcontextprotocol/inspector http://127.0.0.1:3000/mcp
```
For remote forwarded endpoints, pass the Bearer token header in MCP Inspector configuration or URL header settings:
`Authorization: Bearer <your_mcp_auth_token>`

### Registering Endpoint in ChatGPT Custom MCP Apps
1. Open ChatGPT (interfaces supporting custom MCP connectors).
2. Add a new **Custom MCP Server / App**.
3. Set Server URL: `https://<codespace-id>-3000.app.github.dev/mcp`
4. Set Authentication: **Bearer Token**
5. Enter your `MCP_AUTH_TOKEN` value.
6. Verify tool discovery and invoke tools such as `ping`, `workspace_info`, `list_workspace_files`, `git_status`, and `indexer_status`.

---

## Implemented MCP Tools

| Tool Name | Description |
|---|---|
| `ping` | Returns server health, version (`0.1.0`), uptime, and timestamp. |
| `workspace_info` | Returns authorized workspace root, folder structure, and project metadata. |
| `list_workspace_files` | Safely lists directory contents with recursive/depth limits and result caps. |
| `read_file` | Reads workspace-relative file contents subject to path traversal guards and 10MB file limits. |
| `git_status` | Returns working-tree Git status, branch, modified files, and staged files. |
| `git_diff` | Returns working-tree git diff for the workspace or a specific file. |
| `indexer_status` | Inspects status of the Codebase Indexer release (`v0.1.7`). |
| `indexer_search` | Performs text/AST search in the index using Codebase Indexer CLI. |
| `indexer_symbols` | Retrieves symbol information using Codebase Indexer CLI. |
| `index_workspace` | Indexes authorized workspace using Codebase Indexer CLI. |

---

## Codebase Indexer Integration

This server automatically integrates with **Codebase Indexer v0.1.7**:
- Release download: `https://github.com/VortiqLabs/codebase-indexer/releases/download/v0.1.7/`
- Platform support: Linux (x64, ARM64), macOS (x64, ARM64), Windows (x64, ARM64).
- Integrity: Verifies SHA-256 checksums from `SHA256SUMS` before extracting archives.
- Resources: Preserves native assets (`grammars/`, `tree-sitter-wasms/`, `workers/`, `dashboard/`).

---

## Security & Architecture

- **Path Traversal Protection**: Enforces `MCP_WORKSPACE_ROOT` using `realpath` verification and rejects `../` traversal or absolute path escapes.
- **Constant-time Auth**: Uses `crypto.timingSafeEqual` for secret validation to prevent timing side-channel attacks.
- **Origin Header Checks**: Protects against DNS rebinding attacks while allowing localhost and Codespaces domains.
- **Independent Node Process**: Runs completely independently of the VS Code UI while sharing tool implementations with the VS Code extension.

---

## Test & Build Commands

- **Run Type Checks**: `npm run check-types`
- **Run Linter**: `npm run lint`
- **Run Unit Tests**: `npm test`
- **Build Extension & MCP Server**: `node esbuild.js`
