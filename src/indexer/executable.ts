import { spawn } from "child_process";
import { IndexerRequest, IndexerResult } from "./types";
import { IndexerRuntimeManager } from "./runtime/manager";

export class IndexerExecutable {
    constructor(
        private readonly runtimeManager: IndexerRuntimeManager,
        private readonly explicitWorkspaceRoot?: string
    ) {}

    async run(request: IndexerRequest): Promise<IndexerResult> {
        const runtime = await this.runtimeManager.resolve();
        const args = this.buildArguments(request);
        const cwd = this.getWorkspaceRoot();

        return new Promise((resolve, reject) => {
            const child = spawn(runtime.executablePath, args, {
                cwd,
                stdio: ["ignore", "pipe", "pipe"]
            });

            let stdout = "";
            let stderr = "";

            child.stdout.on("data", data => {
                stdout += data.toString();
            });

            child.stderr.on("data", data => {
                stderr += data.toString();
            });

            child.on("error", reject);

            child.on("close", exitCode => {
                resolve({
                    stdout,
                    stderr,
                    exitCode: exitCode ?? -1
                });
            });
        });
    }

    private buildArguments(request: IndexerRequest): string[] {
        const args: string[] = [request.command];

        if (request.argument) {
            args.push(request.argument);
        }

        const options = request.options;
        if (!options) {
            return args;
        }

        if (options.indexDir) {
            args.push("--index-dir", options.indexDir);
        }
        if (options.force) {
            args.push("--force");
        }
        if (options.json) {
            args.push("--json");
        }
        if (options.maxFileSize) {
            args.push("--max-file-size", options.maxFileSize);
        }
        if (options.ignore) {
            for (const pattern of options.ignore) {
                args.push("--ignore", pattern);
            }
        }
        if (options.host) {
            args.push("--host", options.host);
        }
        if (options.port !== undefined) {
            args.push("--port", String(options.port));
        }
        if (options.ref) {
            args.push("--ref", options.ref);
        }
        if (options.workers !== undefined) {
            args.push("--workers", String(options.workers));
        }
        if (options.memoryLimit !== undefined) {
            args.push("--memory-limit", String(options.memoryLimit));
        }
        if (options.profile) {
            args.push("--profile", options.profile);
        }
        if (options.noEmbeddings) {
            args.push("--no-embeddings");
        }
        if (options.verboseMemory) {
            args.push("--verbose-memory");
        }

        return args;
    }

    private getWorkspaceRoot(): string {
        if (this.explicitWorkspaceRoot) {
            return this.explicitWorkspaceRoot;
        }

        if (process.env.MCP_WORKSPACE_ROOT) {
            return process.env.MCP_WORKSPACE_ROOT;
        }

        try {
            // Safely attempt VS Code workspace resolution if module is present
            const vscode = require("vscode");
            const folders = vscode.workspace?.workspaceFolders;
            if (folders && folders.length > 0) {
                return folders[0].uri.fsPath;
            }
        } catch {
            // VS Code API is not available
        }

        return process.cwd();
    }
}
