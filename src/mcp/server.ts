import * as http from "http";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { authenticateHttpRequest } from "./auth";
import { SafeWorkspace } from "./workspace";
import { FileTool } from "../tools/file";
import { GitTool } from "../tools/git";
import { IndexerRuntimeManager } from "../indexer/runtime/manager";
import { IndexerService } from "../indexer/indexer";
import { WorkspaceManager } from "../workspace/manager";

export interface McpServerOptions {
    host?: string;
    port?: number;
    authToken?: string;
    workspaceRoot?: string;
    allowedOrigins?: string[];
}

export class VortiqMcpServer {
    private readonly host: string;
    private readonly port: number;
    private readonly authToken?: string;
    private readonly workspaceRoot: string;
    private readonly allowedOrigins?: string[];

    private readonly safeWorkspace: SafeWorkspace;
    private readonly workspaceManager: WorkspaceManager;
    private readonly fileTool: FileTool;
    private readonly gitTool: GitTool;
    private readonly indexerService: IndexerService;
    private readonly runtimeManager: IndexerRuntimeManager;

    private httpServer: http.Server | null = null;
    private mcpServer: McpServer | null = null;

    constructor(options: McpServerOptions = {}) {
        this.host = options.host || process.env.HOST || "127.0.0.1";
        this.port = options.port || (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);
        this.authToken = options.authToken || process.env.MCP_AUTH_TOKEN;
        this.workspaceRoot = options.workspaceRoot || process.env.MCP_WORKSPACE_ROOT || process.cwd();
        this.allowedOrigins = options.allowedOrigins;

        this.safeWorkspace = new SafeWorkspace(this.workspaceRoot);
        this.workspaceManager = new WorkspaceManager(undefined, this.workspaceRoot);
        this.fileTool = new FileTool(this.workspaceManager);
        this.gitTool = new GitTool(this.workspaceManager, this.workspaceRoot);
        this.runtimeManager = new IndexerRuntimeManager(this.workspaceRoot);
        this.indexerService = new IndexerService(this.runtimeManager, this.workspaceRoot);
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
            "Returns authorized workspace root, folder information, and project metadata.",
            {},
            async () => {
                const info = this.workspaceManager.getCurrent();
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(
                                {
                                    authorizedRoot: this.safeWorkspace.getRootPath(),
                                    workspace: info
                                },
                                null,
                                2
                            )
                        }
                    ]
                };
            }
        );

        // 3. list_workspace_files
        server.tool(
            "list_workspace_files",
            "Lists files and directories under an authorized workspace-relative path.",
            {
                dirPath: z.string().optional().describe("Workspace-relative directory path to list (defaults to root)"),
                recursive: z.boolean().optional().describe("Whether to recursively scan subdirectories"),
                maxDepth: z.number().int().positive().optional().describe("Maximum directory depth to scan"),
                maxResults: z.number().int().positive().optional().describe("Maximum number of entries to return")
            },
            async args => {
                try {
                    const result = await this.safeWorkspace.listFiles({
                        dirPath: args.dirPath,
                        recursive: args.recursive,
                        maxDepth: args.maxDepth,
                        maxResults: args.maxResults
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
            "Reads specified workspace-relative file subject to authorized root and size limits.",
            {
                path: z.string().describe("Workspace-relative file path")
            },
            async args => {
                try {
                    const fileResult = await this.fileTool.read({ path: args.path });
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

        // 5. git_status
        server.tool(
            "git_status",
            "Returns current Git branch and working tree status for the workspace.",
            {},
            async () => {
                try {
                    const status = await this.gitTool.status();
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

        // 6. git_diff
        server.tool(
            "git_diff",
            "Returns working-tree git diff for the workspace or specified file.",
            {
                path: z.string().optional().describe("Optional workspace-relative file path to limit diff")
            },
            async args => {
                try {
                    const diffResult = await this.gitTool.diff({ path: args.path });
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

        // 7. indexer_status
        server.tool(
            "indexer_status",
            "Inspects Codebase Indexer status using CLI integration.",
            {},
            async () => {
                try {
                    const result = await this.indexerService.cli.status();
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

        // 8. indexer_search
        server.tool(
            "indexer_search",
            "Searches the codebase index using Codebase Indexer CLI.",
            {
                query: z.string().describe("Search query string")
            },
            async args => {
                try {
                    const result = await this.indexerService.cli.search(args.query);
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

        // 9. indexer_symbols
        server.tool(
            "indexer_symbols",
            "Retrieves symbol information using Codebase Indexer CLI.",
            {
                query: z.string().describe("Symbol search query")
            },
            async args => {
                try {
                    const result = await this.indexerService.cli.symbols(args.query);
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

        // 10. index_workspace
        server.tool(
            "index_workspace",
            "Indexes the authorized workspace using Codebase Indexer CLI.",
            {
                path: z.string().optional().describe("Optional subdirectory path to index inside workspace"),
                force: z.boolean().optional().describe("Force re-indexing")
            },
            async args => {
                try {
                    const targetPath = args.path ? this.safeWorkspace.resolveSafePath(args.path) : undefined;
                    const result = await this.indexerService.cli.index(targetPath, {
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
