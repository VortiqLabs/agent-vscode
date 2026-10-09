import { WorkspaceManager } from "../workspace/manager";
import { FileTool } from "../tools/file";
import { GitTool } from "../tools/git";
import { IndexerService } from "../indexer/indexer";
import { IndexerOptions } from "../indexer/types";
import { IndexerRuntimeManager } from "../indexer/runtime/manager";
import { AgentRequest, AgentResponse } from "./types";
import { parseAgentRequest } from "./protocol";

export class Agent {
    private readonly workspaceManager: WorkspaceManager;
    private readonly fileTool: FileTool;
    private readonly gitTool: GitTool;
    private readonly runtimeManager: IndexerRuntimeManager;
    private readonly indexer: IndexerService;

    constructor(
        context?: unknown,
        explicitWorkspaceRoot?: string
    ) {
        this.workspaceManager = new WorkspaceManager(context, explicitWorkspaceRoot);
        this.fileTool = new FileTool(this.workspaceManager);
        this.gitTool = new GitTool(this.workspaceManager, explicitWorkspaceRoot);
        this.runtimeManager = new IndexerRuntimeManager(context);
        this.indexer = new IndexerService(this.runtimeManager, explicitWorkspaceRoot);
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

            case "indexer.index":
                return this.indexer.cli.index(
                    this.optionalString(request.arguments, "path"),
                    this.indexerOptions(request.arguments)
                );

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

            case "indexer.files":
                return this.indexer.cli.files(
                    this.optionalString(request.arguments, "query"),
                    this.indexerOptions(request.arguments)
                );

            case "indexer.inspect":
                return this.indexer.cli.inspect(
                    this.requireString(request.arguments, "path"),
                    this.indexerOptions(request.arguments)
                );

            case "indexer.remove":
                return this.indexer.cli.remove(
                    this.requireString(request.arguments, "path"),
                    this.indexerOptions(request.arguments)
                );

            case "indexer.watch":
                return this.indexer.cli.watch(
                    this.optionalString(request.arguments, "path"),
                    this.indexerOptions(request.arguments)
                );

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
            json: args.json === true,
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
            verboseMemory: args.verboseMemory === true
        };
    }
}
