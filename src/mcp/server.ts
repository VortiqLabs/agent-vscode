import * as http from "http";
import * as crypto from "crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

import { validateOrigin } from "./auth";
import { AgentClient } from "./agent-client";
import type { AgentToolName } from "../agent/types";

export interface McpServerOptions {
    host?: string;
    port?: number;
    workspaceRoot?: string;
    allowedOrigins?: string[];
    agentUrl?: string;
    agentAuthToken?: string;
}

export class VortiqMcpServer {
    private readonly host: string;
    private readonly port: number;
    private readonly workspaceRoot: string;
    private readonly allowedOrigins?: string[];
    private readonly agentClient: AgentClient;

    private httpServer: http.Server | null = null;
    private readonly sessions = new Map<
        string,
        { server: McpServer; transport: StreamableHTTPServerTransport }
    >();

    constructor(options: McpServerOptions = {}) {
        this.host = options.host || process.env.HOST || "127.0.0.1";
        this.port = options.port || (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);
        this.workspaceRoot = options.workspaceRoot || process.env.MCP_WORKSPACE_ROOT || process.cwd();
        this.allowedOrigins =
            options.allowedOrigins ||
            process.env.MCP_ALLOWED_ORIGINS?.split(",").map(origin => origin.trim()).filter(Boolean);

        this.agentClient = new AgentClient({
            baseUrl: options.agentUrl,
            authToken: options.agentAuthToken
        });
    }

    getHost(): string {
        return this.host;
    }

    getPort(): number {
        return this.port;
    }

    getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }

    getAgentClient(): AgentClient {
        return this.agentClient;
    }

    private setupTools(server: McpServer): void {
        // 1. ping
        server.tool(
            "ping",
            "Returns simple success response, server version, and basic status.",
            {},
            async () => {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(
                                {
                                    status: "ok",
                                    service: "VortiqLabs Agent MCP Server",
                                    version: "0.2.0",
                                    uptimeSeconds: Math.floor(process.uptime()),
                                    timestamp: new Date().toISOString()
                                },
                                null,
                                2
                            )
                        }
                    ]
                };
            }
        );

        // 2. workspace_info
        server.tool(
            "workspace_info",
            "Returns active workspace details and folder metadata via VS Code extension Agent.",
            {},
            async () => {
                try {
                    const result = await this.agentClient.sendRequest("workspace.get");
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    };
                } catch (error) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Error fetching workspace info: ${error instanceof Error ? error.message : String(error)}`
                            }
                        ]
                    };
                }
            }
        );

        // 3. list_workspace_files
        server.tool(
            "list_workspace_files",
            "Lists files and directories in the workspace via VS Code extension Agent.",
            {
                dirPath: z.string().optional().describe("Workspace-relative directory path to list (defaults to root)"),
                recursive: z.boolean().optional().describe("Whether to recursively scan subdirectories"),
                maxDepth: z.number().int().positive().optional().describe("Maximum directory depth to scan"),
                maxResults: z.number().int().positive().optional().describe("Maximum number of entries to return")
            },
            async args => {
                try {
                    const result = await this.agentClient.sendRequest("workspace.list_files", args);
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    };
                } catch (error) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Error listing workspace files: ${error instanceof Error ? error.message : String(error)}`
                            }
                        ]
                    };
                }
            }
        );

        // 4. read_file
        server.tool(
            "read_file",
            "Reads specified workspace file contents via VS Code extension Agent.",
            {
                path: z.string().describe("Workspace-relative file path")
            },
            async args => {
                try {
                    const fileResult = await this.agentClient.sendRequest("file.read", { path: args.path });
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(fileResult, null, 2)
                            }
                        ]
                    };
                } catch (error) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Error reading file: ${error instanceof Error ? error.message : String(error)}`
                            }
                        ]
                    };
                }
            }
        );

        // 5. write_file
        server.tool(
            "write_file",
            "Creates or overwrites a file in the workspace via VS Code extension Agent.",
            {
                path: z.string().describe("Workspace-relative file path"),
                content: z.string().describe("Content to write to the file")
            },
            async args => {
                try {
                    const result = await this.agentClient.sendRequest("file.write", {
                        path: args.path,
                        content: args.content
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    };
                } catch (error) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Error writing file: ${error instanceof Error ? error.message : String(error)}`
                            }
                        ]
                    };
                }
            }
        );

        // 6. edit_file
        server.tool(
            "edit_file",
            "Replaces line range in a workspace file via VS Code extension Agent.",
            {
                path: z.string().describe("Workspace-relative file path"),
                startLine: z.number().int().positive().describe("Start line number (1-indexed)"),
                endLine: z.number().int().positive().describe("End line number (1-indexed, inclusive)"),
                content: z.string().describe("Replacement content for specified line range")
            },
            async args => {
                try {
                    const result = await this.agentClient.sendRequest("file.replace_range", {
                        path: args.path,
                        startLine: args.startLine,
                        endLine: args.endLine,
                        content: args.content
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    };
                } catch (error) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Error editing file: ${error instanceof Error ? error.message : String(error)}`
                            }
                        ]
                    };
                }
            }
        );

        // 7. git_status
        server.tool(
            "git_status",
            "Returns current Git branch and working tree status via VS Code extension Agent.",
            {},
            async () => {
                try {
                    const status = await this.agentClient.sendRequest("git.status");
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(status, null, 2)
                            }
                        ]
                    };
                } catch (error) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Error checking Git status: ${error instanceof Error ? error.message : String(error)}`
                            }
                        ]
                    };
                }
            }
        );

        // 8. git_diff
        server.tool(
            "git_diff",
            "Returns working-tree git diff via VS Code extension Agent.",
            {
                path: z.string().optional().describe("Optional workspace-relative file path to limit diff")
            },
            async args => {
                try {
                    const diffResult = await this.agentClient.sendRequest<{ diff?: string }>("git.diff", { path: args.path });
                    return {
                        content: [
                            {
                                type: "text",
                                text: diffResult.diff || "(No diff changes found)"
                            }
                        ]
                    };
                } catch (error) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Error obtaining git diff: ${error instanceof Error ? error.message : String(error)}`
                            }
                        ]
                    };
                }
            }
        );

        // 9. git_apply_patch
        server.tool(
            "git_apply_patch",
            "Applies a git patch to workspace via VS Code extension Agent.",
            {
                patch: z.string().describe("Unified patch content to apply")
            },
            async args => {
                try {
                    const result = await this.agentClient.sendRequest("git.apply_patch", { patch: args.patch });
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    };
                } catch (error) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Error applying patch: ${error instanceof Error ? error.message : String(error)}`
                            }
                        ]
                    };
                }
            }
        );

        // Find TODO-style markers in the active workspace.
        server.tool(
            "find_todos",
            "Finds TODO, FIXME, HACK, and XXX markers in supported text files across the active VS Code workspace. Returns file paths and line numbers; scanning is bounded for safety.",
            {
                maxResults: z.number().int().positive().max(500).optional().describe("Maximum matching lines to return (default 100, maximum 500)")
            },
            async args => {
                try {
                    const result = await this.agentClient.sendRequest("workspace.find_todos", args);
                    return {
                        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
                    };
                } catch (error) {
                    return {
                        isError: true,
                        content: [{
                            type: "text",
                            text: `Error finding TODO markers: ${error instanceof Error ? error.message : String(error)}`
                        }]
                    };
                }
            }
        );

        server.tool(
            "run_terminal",
            "Execute a shell command from the active workspace root. Use this for commands such as tests, builds, linters, and Git inspection. Always provide a complete non-interactive command; do not use commands that require user input or leave a long-running process running. The command runs with a 30-second default timeout and a 120-second maximum timeout. A non-zero exit code is returned as a normal result so you can inspect stdout and stderr.",
            {
                command: z.string().min(1).describe("Complete non-interactive shell command to run from the workspace root"),
                timeoutMs: z.number().int().min(1000).max(120000).optional().describe("Optional timeout in milliseconds; defaults to 30000 and is capped at 120000")
            },
            async args => {
                try {
                    const result = await this.agentClient.sendRequest("terminal.execute", args);
                    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                } catch (error) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error running terminal command: ${error instanceof Error ? error.message : String(error)}` }]
                    };
                }
            }
        );

        server.tool(
            "file_diagnostics",
            "Get every current VS Code error and warning for exactly one workspace file. Use this after editing or when validating a file. Provide a workspace-relative path, then inspect the returned severity, message, source/code, and 1-based range for each diagnostic. Informational and hint diagnostics are intentionally excluded.",
            {
                path: z.string().min(1).describe("Workspace-relative path of the file to inspect, for example src/index.ts")
            },
            async args => {
                try {
                    const result = await this.agentClient.sendRequest("file.diagnostics", args);
                    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                } catch (error) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error getting file diagnostics: ${error instanceof Error ? error.message : String(error)}` }]
                    };
                }
            }
        );

        // 12. indexer_status
        server.tool(
            "indexer_status",
            "Inspects Codebase Indexer status via VS Code extension Agent.",
            {},
            async () => {
                try {
                    const result = await this.agentClient.sendRequest("indexer.status");
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    };
                } catch (error) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Codebase Indexer status error: ${error instanceof Error ? error.message : String(error)}`
                            }
                        ]
                    };
                }
            }
        );

        // 11. indexer_search
        server.tool(
            "indexer_search",
            "Searches codebase index via VS Code extension Agent.",
            {
                query: z.string().min(1).describe("Text or concept to search for in the indexed codebase"),
                limit: z.number().int().min(1).max(100).optional().describe("Maximum results, between 1 and 100"),
                mode: z.enum(["hybrid", "lexical", "semantic"]).optional().describe("Search strategy; hybrid is the default")
            },
            async args => {
                try {
                    const result = await this.agentClient.sendRequest("indexer.search", {
                        query: args.query,
                        limit: args.limit,
                        lexical: args.mode === "lexical",
                        semantic: args.mode === "semantic"
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    };
                } catch (error) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Codebase Indexer search error: ${error instanceof Error ? error.message : String(error)}`
                            }
                        ]
                    };
                }
            }
        );

        // 12. indexer_symbols
        server.tool(
            "indexer_symbols",
            "Retrieves symbol information via VS Code extension Agent.",
            {
                query: z.string().describe("Symbol search query")
            },
            async args => {
                try {
                    const result = await this.agentClient.sendRequest("indexer.symbols", { query: args.query });
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    };
                } catch (error) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Codebase Indexer symbols error: ${error instanceof Error ? error.message : String(error)}`
                            }
                        ]
                    };
                }
            }
        );

        // 13. index_workspace
        server.tool(
            "index_workspace",
            "Indexes authorized workspace via VS Code extension Agent.",
            {
                path: z.string().optional().describe("Optional workspace-relative subdirectory to index"),
                force: z.boolean().optional().describe("Force a full re-index"),
                indexDir: z.string().optional().describe("Optional directory for storing index files"),
                maxFileSize: z.string().optional().describe("Maximum source file size, e.g. 5mb"),
                ignore: z.array(z.string()).max(100).optional().describe("Additional ignore patterns"),
                workers: z.number().int().min(1).max(16).optional().describe("Parser worker count (1–16)"),
                memoryLimit: z.number().int().min(256).max(65536).optional().describe("Memory limit in MB (256–65536)"),
                profile: z.enum(["default", "large"]).optional().describe("Indexing profile for normal or large codebases"),
                noEmbeddings: z.boolean().optional().describe("Disable vector embeddings"),
                verboseMemory: z.boolean().optional().describe("Log memory usage during large index runs")
            },
            async args => {
                try {
                    const result = await this.agentClient.sendRequest("indexer.index", args as unknown as Record<string, unknown>);
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(result, null, 2)
                            }
                        ]
                    };
                } catch (error) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Codebase Indexer index error: ${error instanceof Error ? error.message : String(error)}`
                            }
                        ]
                    };
                }
            }
        );

        this.registerAdvancedIndexerTools(server);
    }

    private registerAdvancedIndexerTools(server: McpServer): void {
        this.registerForwardingTool(
            server,
            "indexer_install",
            "Download and install the pinned Codebase Indexer runtime for this OS/architecture, verify its SHA-256, and reuse the cached installation on subsequent calls.",
            {},
            "indexer.install"
        );
        this.registerForwardingTool(
            server,
            "indexer_index_github",
            "Download and index a GitHub repository using the Codebase Indexer runtime. Provide owner/repository or a GitHub URL; private repositories require GITHUB_TOKEN or GH_TOKEN in the extension environment.",
            {
                repository: z.string().min(3).describe("GitHub owner/repository slug or repository URL"),
                ref: z.string().optional().describe("Git branch, tag, or commit; defaults to HEAD"),
                indexDir: z.string().optional().describe("Optional directory for storing the index"),
                force: z.boolean().optional().describe("Force re-indexing of the repository"),
                workers: z.number().int().min(1).max(16).optional().describe("Parser worker count (1–16)"),
                memoryLimit: z.number().int().min(256).max(65536).optional().describe("Memory limit in MB (256–65536)"),
                profile: z.enum(["default", "large"]).optional().describe("Indexing profile for normal or large codebases"),
                noEmbeddings: z.boolean().optional().describe("Disable vector embeddings")
            },
            "indexer.index_github"
        );
        this.registerForwardingTool(
            server,
            "indexer_inspect",
            "Read and validate metadata from a Codebase Indexer .index file. Use the index path returned by indexer_status or index_workspace.",
            { path: z.string().min(1).describe("Path to an existing Codebase Indexer .index file") },
            "indexer.inspect"
        );
        this.registerForwardingTool(
            server,
            "indexer_remove",
            "Delete the Codebase Indexer index for the specified workspace directory. This does not delete source files. Requires confirm=true; prefer the active workspace or a validated workspace-relative path.",
            {
                path: z.string().optional().describe("Workspace-relative path for the indexed workspace; defaults to the active workspace"),
                confirm: z.literal(true).describe("Must be true to confirm permanent deletion of this workspace's index")
            },
            "indexer.remove"
        );
        this.registerForwardingTool(
            server,
            "indexer_references",
            "Find references to a symbol in the active workspace's Codebase Indexer index.",
            { query: z.string().min(1).describe("Symbol name") },
            "indexer.references"
        );
        this.registerForwardingTool(
            server,
            "indexer_callers",
            "Find functions or symbols that call the specified symbol.",
            { query: z.string().min(1).describe("Target symbol name") },
            "indexer.callers"
        );
        this.registerForwardingTool(
            server,
            "indexer_callees",
            "Find functions or symbols called by the specified symbol.",
            { query: z.string().min(1).describe("Source symbol name") },
            "indexer.callees"
        );
        this.registerForwardingTool(
            server,
            "indexer_dependencies",
            "Explore outgoing dependency relations for a symbol, with a bounded graph depth.",
            {
                query: z.string().min(1).describe("Symbol name"),
                depth: z.number().int().min(1).max(12).optional().describe("Graph traversal depth (default 1; maximum 12)")
            },
            "indexer.dependencies"
        );
        this.registerForwardingTool(
            server,
            "indexer_dependents",
            "Find symbols that depend on or use the requested symbol, with a bounded graph depth.",
            {
                query: z.string().min(1).describe("Symbol name"),
                depth: z.number().int().min(1).max(12).optional().describe("Graph traversal depth (default 1; maximum 12)")
            },
            "indexer.dependents"
        );
        this.registerForwardingTool(
            server,
            "indexer_symbol_path",
            "Find a bounded dependency path between two symbol names in the indexed codebase.",
            {
                from: z.string().min(1).describe("Starting symbol"),
                to: z.string().min(1).describe("Target symbol"),
                maxDepth: z.number().int().min(1).max(12).optional().describe("Maximum traversal depth (default 4)"),
                maxNodes: z.number().int().min(1).max(200).optional().describe("Maximum graph nodes to visit (default 32)")
            },
            "indexer.path"
        );
        this.registerForwardingTool(
            server,
            "indexer_files",
            "List indexed files in the active workspace, optionally filtered by language or path substring.",
            {
                language: z.string().optional().describe("Language identifier, e.g. TypeScript or Python"),
                pattern: z.string().optional().describe("Substring to match in file paths")
            },
            "indexer.files"
        );
        this.registerForwardingTool(
            server,
            "indexer_repository_map",
            "Return a high-level map of repository areas, files, and indexed symbols.",
            {},
            "indexer.repository_map"
        );
        this.registerForwardingTool(
            server,
            "indexer_api_endpoints",
            "Discover API endpoint definitions detected in the indexed workspace.",
            {},
            "indexer.api_endpoints"
        );
        this.registerForwardingTool(
            server,
            "indexer_classify_query",
            "Classify a codebase question by likely query intent, helping choose the right search approach.",
            { query: z.string().min(1).describe("Natural-language question about the codebase") },
            "indexer.classify_query"
        );
        this.registerForwardingTool(
            server,
            "indexer_sensitive_regions",
            "Scan the indexed workspace for likely sensitive regions such as credentials or tokens. The detector is heuristic; verify results and do not expose secrets in responses.",
            {},
            "indexer.sensitive_regions"
        );
        this.registerForwardingTool(
            server,
            "indexer_watch",
            "Start an incremental Codebase Indexer watch process for the active workspace or a safe workspace-relative subdirectory. Use indexer_stop_watch when finished.",
            { path: z.string().optional().describe("Optional workspace-relative directory to watch") },
            "indexer.watch"
        );
        this.registerForwardingTool(
            server,
            "indexer_stop_watch",
            "Stop the watch process started by this extension instance.",
            {},
            "indexer.stop_watch"
        );
        this.registerForwardingTool(
            server,
            "indexer_dashboard",
            "Start the Codebase Indexer web dashboard on localhost. Use indexer_stop_dashboard when finished.",
            {
                host: z.enum(["127.0.0.1", "localhost"]).optional().describe("Local-only bind host; defaults to 127.0.0.1"),
                port: z.number().int().min(0).max(65535).optional().describe("Port; defaults to 4173"),
                indexDir: z.string().optional().describe("Optional index storage directory")
            },
            "indexer.dashboard"
        );
        this.registerForwardingTool(
            server,
            "indexer_stop_dashboard",
            "Stop the dashboard process started by this extension instance.",
            {},
            "indexer.stop_dashboard"
        );
    }

    private registerForwardingTool(
        server: McpServer,
        name: string,
        description: string,
        schema: ZodRawShapeCompat,
        agentTool: AgentToolName
    ): void {
        server.tool(name, description, schema, async (args): Promise<CallToolResult> => {
            try {
                const result = await this.agentClient.sendRequest(
                    agentTool,
                    args as unknown as Record<string, unknown>
                );
                return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
            } catch (error) {
                return {
                    isError: true,
                    content: [{
                        type: "text" as const,
                        text: `${name} failed: ${error instanceof Error ? error.message : String(error)}`
                    }]
                };
            }
        });
    }

    async start(): Promise<void> {
        if (this.httpServer) {
            return;
        }

        this.httpServer = http.createServer(async (req, res) => {
            try {
                const origin = req.headers.origin;
                if (origin && validateOrigin(origin, this.allowedOrigins)) {
                    res.setHeader("Access-Control-Allow-Origin", origin);
                    res.setHeader("Vary", "Origin");
                }
                res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version");

                if (req.method === "OPTIONS") {
                    if (!validateOrigin(req.headers.origin, this.allowedOrigins)) {
                        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
                        res.end(JSON.stringify({ error: "Forbidden: Origin not allowed." }));
                        return;
                    }
                    res.writeHead(204);
                    res.end();
                    return;
                }

                const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

                if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
                    const sessionId = req.headers["mcp-session-id"];
                    if (Array.isArray(sessionId)) {
                        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
                        res.end(JSON.stringify({ error: "Invalid MCP session ID header." }));
                        return;
                    }

                    let session = sessionId ? this.sessions.get(sessionId) : undefined;
                    if (sessionId && !session) {
                        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
                        res.end(JSON.stringify({ error: "MCP session not found." }));
                        return;
                    }

                    if (!session) {
                        const server = new McpServer(
                            {
                                name: "VortiqLabs Agent MCP Server",
                                version: "0.2.0"
                            },
                            {
                                instructions:
                                    "Before using workspace-specific context or prior memories, call workspace_info and read the active workspace ID. Reuse a prior memory only when it explicitly records the exact same workspace ID. If the memory has no workspace ID, the IDs differ, or the active ID cannot be verified, ignore that memory for this workspace. Never infer a match from the workspace name or path alone."
                            }
                        );
                        this.setupTools(server);
                        const transport = new StreamableHTTPServerTransport({
                            sessionIdGenerator: () => crypto.randomUUID()
                        });
                        transport.onclose = () => {
                            const closedSessionId = transport.sessionId;
                            if (closedSessionId) {
                                this.sessions.delete(closedSessionId);
                            }
                        };
                        await server.connect(transport);
                        session = { server, transport };
                    }

                    await session.transport.handleRequest(req, res);

                    const initializedSessionId = session.transport.sessionId;
                    if (!sessionId && initializedSessionId) {
                        this.sessions.set(initializedSessionId, session);
                    }
                    return;
                }

                if (req.method === "GET" && url.pathname === "/health") {
                    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                    res.end(
                        JSON.stringify({
                            status: "ok",
                            service: "vortiqlabs-agent-mcp",
                            version: "0.2.0"
                        })
                    );
                    return;
                }

                res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ error: "Endpoint not found. Use /mcp" }));
            } catch (error) {
                process.stderr.write(`MCP HTTP Error: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
                if (!res.headersSent) {
                    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ error: "Internal server error." }));
                }
            }
        });

        await new Promise<void>((resolve, reject) => {
            const onError = (err: Error) => {
                this.httpServer?.removeListener("listening", onListening);
                reject(err);
            };

            const onListening = () => {
                this.httpServer?.removeListener("error", onError);
                process.stderr.write(
                    `VortiqLabs Agent MCP Server started.\n` +
                    `Listening on http://${this.host}:${this.port}/mcp\n` +
                    `Extension Agent API URL: ${this.agentClient.getBaseUrl()}\n` +
                    `Workspace Root: ${this.workspaceRoot}\n` +
                    `MCP authentication: disabled\n`
                );
                resolve();
            };

            this.httpServer?.once("error", onError);
            this.httpServer?.once("listening", onListening);
            this.httpServer?.listen(this.port, this.host);
        });
    }

    async stop(): Promise<void> {
        if (!this.httpServer) {
            return;
        }

        const server = this.httpServer;
        this.httpServer = null;

        await Promise.all(
            [...this.sessions.values()].map(async session => {
                await session.transport.close();
                await session.server.close();
            })
        );
        this.sessions.clear();

        await new Promise<void>((resolve, reject) => {
            server.close(err => {
                if (err) {
                    reject(err);
                    return;
                }
                process.stderr.write("VortiqLabs Agent MCP Server stopped gracefully.\n");
                resolve();
            });
        });
    }
}
