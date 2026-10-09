import * as http from "http";
import * as crypto from "crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { authenticateHttpRequest } from "./auth";
import { AgentClient } from "./agent-client";

export interface McpServerOptions {
    host?: string;
    port?: number;
    authToken?: string;
    workspaceRoot?: string;
    allowedOrigins?: string[];
    agentUrl?: string;
    agentAuthToken?: string;
}

export class VortiqMcpServer {
    private readonly host: string;
    private readonly port: number;
    private readonly authToken?: string;
    private readonly workspaceRoot: string;
    private readonly allowedOrigins?: string[];
    private readonly agentClient: AgentClient;

    private httpServer: http.Server | null = null;
    private mcpServer: McpServer | null = null;

    constructor(options: McpServerOptions = {}) {
        this.host = options.host || process.env.HOST || "127.0.0.1";
        this.port = options.port || (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);
        this.authToken = options.authToken || process.env.MCP_AUTH_TOKEN;
        this.workspaceRoot = options.workspaceRoot || process.env.MCP_WORKSPACE_ROOT || process.cwd();
        this.allowedOrigins = options.allowedOrigins;

        this.agentClient = new AgentClient({
            baseUrl: options.agentUrl,
            authToken: options.agentAuthToken || this.authToken
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
                                    version: "0.1.0",
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

        // 10. indexer_status
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
                query: z.string().describe("Search query string")
            },
            async args => {
                try {
                    const result = await this.agentClient.sendRequest("indexer.search", { query: args.query });
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
                path: z.string().optional().describe("Optional subdirectory path to index inside workspace"),
                force: z.boolean().optional().describe("Force re-indexing")
            },
            async args => {
                try {
                    const result = await this.agentClient.sendRequest("indexer.index", {
                        path: args.path,
                        force: args.force
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
                                text: `Codebase Indexer index error: ${error instanceof Error ? error.message : String(error)}`
                            }
                        ]
                    };
                }
            }
        );
    }

    async start(): Promise<void> {
        if (this.httpServer) {
            return;
        }

        const mcpServer = new McpServer({
            name: "VortiqLabs Agent MCP Server",
            version: "0.1.0"
        });

        this.setupTools(mcpServer);
        this.mcpServer = mcpServer;

        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID()
        });

        await mcpServer.connect(transport);

        this.httpServer = http.createServer(async (req, res) => {
            try {
                // Set CORS headers
                const origin = req.headers.origin || "*";
                res.setHeader("Access-Control-Allow-Origin", origin);
                res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

                if (req.method === "OPTIONS") {
                    res.writeHead(204);
                    res.end();
                    return;
                }

                const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

                if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
                    if (!authenticateHttpRequest(req, res, this.authToken, this.allowedOrigins)) {
                        return;
                    }

                    await transport.handleRequest(req, res);
                    return;
                }

                if (req.method === "GET" && url.pathname === "/health") {
                    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                    res.end(
                        JSON.stringify({
                            status: "ok",
                            service: "vortiqlabs-agent-mcp",
                            version: "0.1.0"
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
                    `Authentication: ${this.authToken ? "Bearer token enabled" : "Unauthenticated (Local mode only)"}\n`
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
