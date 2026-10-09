import { WorkspaceManager } from "../workspace/manager";
import { SafeWorkspace } from "../mcp/workspace";
import { FileTool } from "../tools/file";
import { GitTool } from "../tools/git";
import { TerminalTool } from "../tools/terminal";
import { FileDiagnostic, FileDiagnosticsResult } from "../tools/diagnostics";
import { IndexerService } from "../indexer/indexer";
import { IndexerOptions } from "../indexer/types";
import { IndexerRuntimeManager } from "../indexer/runtime/manager";
import { AgentRequest, AgentResponse } from "./types";
import { parseAgentRequest } from "./protocol";

export class Agent {
    private readonly context?: unknown;
    private readonly workspaceManager: WorkspaceManager;
    private readonly safeWorkspace: SafeWorkspace;
    private readonly fileTool: FileTool;
    private readonly gitTool: GitTool;
    private readonly terminalTool: TerminalTool;
    private readonly runtimeManager: IndexerRuntimeManager;
    private readonly indexer: IndexerService;

    constructor(
        context?: unknown,
        explicitWorkspaceRoot?: string
    ) {
        this.context = context;
        this.workspaceManager = new WorkspaceManager(context, explicitWorkspaceRoot);
        const rootPath = this.workspaceManager.getWorkspaceRootPath();
        this.safeWorkspace = new SafeWorkspace(rootPath);
        this.fileTool = new FileTool(this.workspaceManager);
        this.gitTool = new GitTool(this.workspaceManager, rootPath);
        this.terminalTool = new TerminalTool(this.workspaceManager);
        this.runtimeManager = new IndexerRuntimeManager(context);
        this.indexer = new IndexerService(this.runtimeManager, rootPath);
    }

    async handle(input: unknown): Promise<AgentResponse> {
        let request: AgentRequest;

        try {
            request = parseAgentRequest(input);
        } catch (error) {
            return {
                id: "unknown",
                success: false,
                error: {
                    code: "INVALID_REQUEST",
                    message: error instanceof Error ? error.message : String(error)
                }
            };
        }

        try {
            const result = await this.execute(request);
            return {
                id: request.id,
                success: true,
                result
            };
        } catch (error) {
            return {
                id: request.id,
                success: false,
                error: {
                    code: "TOOL_EXECUTION_FAILED",
                    message: error instanceof Error ? error.message : String(error)
                }
            };
        }
    }

    private async execute(request: AgentRequest): Promise<unknown> {
        switch (request.tool) {
            case "workspace.get":
                return this.workspaceManager.getCurrent();

            case "workspace.list_files":
                return this.safeWorkspace.listFiles({
                    dirPath: this.optionalString(request.arguments, "dirPath"),
                    recursive: request.arguments.recursive === true || request.arguments.recursive === undefined ? true : false,
                    maxDepth: this.optionalNumber(request.arguments, "maxDepth"),
                    maxResults: this.optionalNumber(request.arguments, "maxResults")
                });

            case "workspace.find_todos":
                return this.findTodos(
                    this.optionalNumber(request.arguments, "maxResults")
                );

            case "terminal.execute":
                return this.terminalTool.execute(
                    this.requireString(request.arguments, "command"),
                    this.optionalNumber(request.arguments, "timeoutMs")
                );

            case "file.diagnostics":
                return this.getFileDiagnostics(
                    this.requireString(request.arguments, "path")
                );

            case "file.read":
                return this.fileTool.read({
                    path: this.requireString(request.arguments, "path")
                });

            case "file.write":
                return this.fileTool.write({
                    path: this.requireString(request.arguments, "path"),
                    content: this.requireString(request.arguments, "content")
                });

            case "file.replace_range":
                return this.fileTool.replaceRange({
                    path: this.requireString(request.arguments, "path"),
                    startLine: this.requireInteger(request.arguments, "startLine"),
                    endLine: this.requireInteger(request.arguments, "endLine"),
                    content: this.requireString(request.arguments, "content")
                });

            case "git.status":
                return this.gitTool.status();

            case "git.diff":
                return this.gitTool.diff({
                    path:
                        request.arguments.path === undefined
                            ? undefined
                            : this.requireString(request.arguments, "path")
                });

            case "git.apply_patch":
                return this.gitTool.applyPatch({
                    patch: this.requireString(request.arguments, "patch")
                });

            case "indexer.install":
                return this.installIndexerRuntime();

            case "indexer.index": {
                const requestedPath = this.optionalString(request.arguments, "path");
                const safePath = requestedPath ? this.workspaceManager.resolvePath(requestedPath) ?? undefined : undefined;
                if (requestedPath && !safePath) {
                    throw new Error(`Index path is outside the active workspace or invalid: ${requestedPath}`);
                }
                return this.indexer.cli.index(safePath, this.indexerOptions(request.arguments));
            }

            case "indexer.index_github":
                return this.indexer.cli.indexGithub(
                    this.requireString(request.arguments, "repository"),
                    this.indexerOptions(request.arguments)
                );

            case "indexer.status":
                return this.indexer.cli.status(this.indexerOptions(request.arguments));

            case "indexer.search":
                return this.indexer.cli.search(
                    this.requireString(request.arguments, "query"),
                    this.indexerOptions(request.arguments)
                );

            case "indexer.symbols":
                return this.indexer.cli.symbols(
                    this.requireString(request.arguments, "query"),
                    this.indexerOptions(request.arguments)
                );

            case "indexer.references":
                return this.indexer.cli.references(
                    this.requireString(request.arguments, "query"),
                    this.indexerOptions(request.arguments)
                );

            case "indexer.callers":
                return this.indexer.cli.callers(
                    this.requireString(request.arguments, "query"),
                    this.indexerOptions(request.arguments)
                );

            case "indexer.callees":
                return this.indexer.cli.callees(
                    this.requireString(request.arguments, "query"),
                    this.indexerOptions(request.arguments)
                );

            case "indexer.dependencies":
                return this.indexer.cli.dependencies(
                    this.requireString(request.arguments, "query"),
                    this.indexerOptions(request.arguments)
                );

            case "indexer.dependents":
                return this.indexer.cli.dependents(
                    this.requireString(request.arguments, "query"),
                    this.indexerOptions(request.arguments)
                );

            case "indexer.path":
                return this.indexer.cli.symbolPath(
                    this.requireString(request.arguments, "from"),
                    this.requireString(request.arguments, "to"),
                    this.indexerOptions(request.arguments)
                );

            case "indexer.repository_map":
                return this.indexer.cli.repositoryMap(this.indexerOptions(request.arguments));

            case "indexer.api_endpoints":
                return this.indexer.cli.apiEndpoints(this.indexerOptions(request.arguments));

            case "indexer.classify_query":
                return this.indexer.cli.classifyQuery(
                    this.requireString(request.arguments, "query"),
                    this.indexerOptions(request.arguments)
                );

            case "indexer.sensitive_regions":
                return this.indexer.cli.sensitiveRegions(this.indexerOptions(request.arguments));

            case "indexer.stop_watch":
                return this.indexer.cli.stopBackground("watch");

            case "indexer.stop_dashboard":
                return this.indexer.cli.stopBackground("dashboard");

            case "indexer.files":
                return this.indexer.cli.files(this.indexerOptions(request.arguments));

            case "indexer.inspect":
                return this.indexer.cli.inspect(
                    this.requireString(request.arguments, "path"),
                    this.indexerOptions(request.arguments)
                );

            case "indexer.remove": {
                if (request.arguments.confirm !== true) {
                    throw new Error("Index removal is destructive; pass confirm=true after verifying the target workspace.");
                }
                const requestedPath = this.optionalString(request.arguments, "path") ?? ".";
                const safePath = this.workspaceManager.resolvePath(requestedPath);
                if (!safePath) {
                    throw new Error(`Index removal path is outside the active workspace or invalid: ${requestedPath}`);
                }
                return this.indexer.cli.remove(safePath, { ...this.indexerOptions(request.arguments), force: true });
            }

            case "indexer.watch": {
                const requestedPath = this.optionalString(request.arguments, "path");
                const safePath = requestedPath ? this.workspaceManager.resolvePath(requestedPath) ?? undefined : undefined;
                if (requestedPath && !safePath) {
                    throw new Error(`Watch path is outside the active workspace or invalid: ${requestedPath}`);
                }
                return this.indexer.cli.watch(safePath, this.indexerOptions(request.arguments));
            }

            case "indexer.dashboard":
                return this.indexer.cli.dashboard(this.indexerOptions(request.arguments));

            default:
                throw new Error(`Unsupported tool: ${request.tool}`);
        }
    }

    private requireString(args: Record<string, unknown>, name: string): string {
        const value = args[name];
        if (typeof value !== "string") {
            throw new Error(`Argument "${name}" must be a string.`);
        }
        return value;
    }

    private optionalString(args: Record<string, unknown>, name: string): string | undefined {
        const value = args[name];
        if (value === undefined || value === null) {
            return undefined;
        }
        if (typeof value !== "string") {
            throw new Error(`Argument "${name}" must be a string.`);
        }
        return value;
    }

    private requireInteger(args: Record<string, unknown>, name: string): number {
        const value = args[name];
        if (typeof value !== "number" || !Number.isInteger(value)) {
            throw new Error(`Argument "${name}" must be an integer.`);
        }
        return value;
    }

    private optionalNumber(args: Record<string, unknown>, name: string): number | undefined {
        const value = args[name];
        if (value === undefined || value === null) {
            return undefined;
        }
        if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new Error(`Argument "${name}" must be a number.`);
        }
        return value;
    }

    private async installIndexerRuntime(): Promise<unknown> {
        try {
            const vscode = require("vscode") as typeof import("vscode");
            if (vscode.window?.withProgress) {
                return vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: "Installing Codebase Indexer",
                        cancellable: false
                    },
                    async progress => {
                        progress.report({ message: "Downloading or verifying the platform runtime..." });
                        const runtime = await this.indexer.cli.ensureRuntime();
                        progress.report({ message: `Codebase Indexer ${runtime.version} is ready.` });
                        return runtime;
                    }
                );
            }
        } catch {
            // The Agent can also run in standalone/test contexts without VS Code UI.
        }
        return this.indexer.cli.ensureRuntime();
    }

    async dispose(): Promise<void> {
        await Promise.all([
            this.indexer.cli.stopBackground("watch"),
            this.indexer.cli.stopBackground("dashboard")
        ]);
    }

    private async getFileDiagnostics(filePath: string): Promise<FileDiagnosticsResult> {
        const fullPath = this.workspaceManager.resolvePath(filePath);
        if (!fullPath) {
            throw new Error(`Path is outside the active workspace or invalid: ${filePath}`);
        }

        if (!this.context) {
            throw new Error("File diagnostics require the VS Code extension Agent to be running.");
        }

        let vscode: typeof import("vscode");
        try {
            vscode = require("vscode") as typeof import("vscode");
        } catch {
            throw new Error("File diagnostics are only available inside VS Code.");
        }

        const diagnostics = vscode.languages.getDiagnostics(vscode.Uri.file(fullPath))
            .filter(diagnostic =>
                diagnostic.severity === vscode.DiagnosticSeverity.Error ||
                diagnostic.severity === vscode.DiagnosticSeverity.Warning
            )
            .map(diagnostic => ({
                message: diagnostic.message,
                severity: diagnostic.severity === vscode.DiagnosticSeverity.Error ? "error" as const : "warning" as const,
                source: diagnostic.source,
                code: typeof diagnostic.code === "object" ? diagnostic.code.value : diagnostic.code,
                range: {
                    startLine: diagnostic.range.start.line + 1,
                    startColumn: diagnostic.range.start.character + 1,
                    endLine: diagnostic.range.end.line + 1,
                    endColumn: diagnostic.range.end.character + 1
                }
            } satisfies FileDiagnostic));

        return {
            path: filePath,
            diagnostics,
            count: diagnostics.length
        };
    }

    private async findTodos(requestedMaxResults?: number) {
        const maxResults = Math.min(500, Math.max(1, Math.floor(requestedMaxResults ?? 100)));
        const listing = await this.safeWorkspace.listFiles({ recursive: true, maxDepth: 10, maxResults: 1000 });
        const searchableExtensions = new Set([
            ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md",
            ".py", ".rs", ".go", ".java", ".kt", ".html", ".css", ".scss",
            ".yml", ".yaml", ".toml", ".sh", ".sql", ".txt"
        ]);
        const matches: Array<{ path: string; line: number; marker: string; text: string }> = [];
        let filesScanned = 0;
        let scanTruncated = listing.truncated;
        const todoMarkerPattern = /\b(TODO|FIXME|HACK|XXX)\b/i;
        for (const file of listing.files) {
            if (file.type !== "file" || file.size > 1024 * 1024) {continue;}
            const dot = file.relativePath.lastIndexOf(".");
            const extension = dot >= 0 ? file.relativePath.slice(dot).toLowerCase() : "";
            if (!searchableExtensions.has(extension)) {continue;}
            if (filesScanned >= 500 || matches.length >= maxResults) {
                scanTruncated = true;
                break;
            }

            filesScanned++;
            try {
                const result = await this.fileTool.read({ path: file.relativePath });
                const fileLines = result.content.split(/\r?\n/);
                for (let index = 0; index < fileLines.length; index++) {
                    const match = todoMarkerPattern.exec(fileLines[index]);
                    if (!match) {continue;}
                    matches.push({
                        path: file.relativePath,
                        line: index + 1,
                        marker: match[1].toUpperCase(),
                        text: fileLines[index].trim().slice(0, 500)
                    });
                    if (matches.length >= maxResults) {
                        scanTruncated = true;
                        break;
                    }
                }
            } catch {
                // Ignore files that disappear or cannot be read during the scan.
            }
            if (matches.length >= maxResults) {break;}
        }
        return { matches, matchCount: matches.length, filesScanned, truncated: scanTruncated };
    }

    private indexerOptions(args: Record<string, unknown>) {
        const profile: IndexerOptions["profile"] =
            args.profile === "default"
                ? "default"
                : args.profile === "large"
                    ? "large"
                    : undefined;

        return {
            indexDir: this.optionalString(args, "indexDir"),
            force: args.force === true,
            json: args.json !== false,
            maxFileSize: this.optionalString(args, "maxFileSize"),
            ignore: Array.isArray(args.ignore)
                ? (args.ignore.filter(v => typeof v === "string") as string[])
                : undefined,
            host: this.optionalString(args, "host"),
            port: this.optionalNumber(args, "port"),
            ref: this.optionalString(args, "ref"),
            workers: this.optionalNumber(args, "workers"),
            memoryLimit: this.optionalNumber(args, "memoryLimit"),
            profile,
            noEmbeddings: args.noEmbeddings === true,
            verboseMemory: args.verboseMemory === true,
            language: this.optionalString(args, "language"),
            pattern: this.optionalString(args, "pattern"),
            limit: this.optionalNumber(args, "limit"),
            depth: this.optionalNumber(args, "depth"),
            maxDepth: this.optionalNumber(args, "maxDepth"),
            maxNodes: this.optionalNumber(args, "maxNodes"),
            lexical: args.lexical === true,
            semantic: args.semantic === true
        };
    }
}
