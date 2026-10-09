import { ChildProcess, spawn } from "child_process";
import { IndexerRequest, IndexerResult } from "./types";
import { IndexerRuntimeManager } from "./runtime/manager";

export class IndexerExecutable {
    private readonly backgroundProcesses = new Map<"watch" | "dashboard", ChildProcess>();

    constructor(
        private readonly runtimeManager: IndexerRuntimeManager,
        private readonly explicitWorkspaceRoot?: string
    ) {}

    async run(request: IndexerRequest): Promise<IndexerResult> {
        if (request.command === "watch" || request.command === "dashboard") {
            return this.startBackground(request);
        }

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
                stdout = (stdout + data.toString()).slice(-1_000_000);
            });

            child.stderr.on("data", data => {
                stderr = (stderr + data.toString()).slice(-256_000);
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

    async getRuntimeInfo() {
        return this.runtimeManager.resolve();
    }

    async stopBackground(command: "watch" | "dashboard"): Promise<IndexerResult> {
        const child = this.backgroundProcesses.get(command);
        if (!child || child.killed || child.exitCode !== null) {
            this.backgroundProcesses.delete(command);
            return { stdout: `${command} is not running.`, stderr: "", exitCode: 0, running: false };
        }

        const pid = child.pid;
        child.kill();
        await new Promise<void>(resolve => {
            if (child.exitCode !== null) {return resolve();}
            const timeout = setTimeout(resolve, 2000);
            child.once("close", () => { clearTimeout(timeout); resolve(); });
        });
        if (this.backgroundProcesses.get(command) === child) {this.backgroundProcesses.delete(command);}
        return { stdout: `Stopped ${command}${pid ? ` (pid ${pid})` : ""}.`, stderr: "", exitCode: 0, running: false, pid };
    }

    private async startBackground(request: IndexerRequest): Promise<IndexerResult> {
        const command = request.command as "watch" | "dashboard";
        const existing = this.backgroundProcesses.get(command);
        if (existing && !existing.killed && existing.exitCode === null) {
            return { stdout: `${command} is already running${existing.pid ? ` (pid ${existing.pid})` : ""}.`, stderr: "", exitCode: 0, running: true, pid: existing.pid };
        }
        this.backgroundProcesses.delete(command);

        const runtime = await this.runtimeManager.resolve();
        const args = this.buildArguments(request);
        const cwd = this.getWorkspaceRoot();
        const child = spawn(runtime.executablePath, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        this.backgroundProcesses.set(command, child);

        return new Promise((resolve, reject) => {
            let stdout = "";
            let stderr = "";
            let settled = false;
            const startupTimer = setTimeout(() => {
                if (settled) {return;}
                child.kill();
                finishError(new Error(`${command} did not report that it started within 15 seconds${stderr ? `: ${stderr.slice(-2000)}` : ""}`));
            }, 15_000);

            const finishError = (error: Error) => {
                if (settled) {return;}
                settled = true;
                clearTimeout(startupTimer);
                this.backgroundProcesses.delete(command);
                reject(error);
            };

            child.on("error", finishError);
            child.stdout.on("data", chunk => {
                stdout = (stdout + chunk.toString()).slice(-32_000);
                const readyLine = stdout.split(/\r?\n/).find(line => command === "dashboard" ? /Dashboard:\s+https?:\/\//i.test(line) : /^Watching\s+/i.test(line));
                if (readyLine && !settled) {
                    settled = true;
                    clearTimeout(startupTimer);
                    const url = command === "dashboard" ? /https?:\/\/[^\s]+/i.exec(readyLine)?.[0] : undefined;
                    resolve({ stdout: readyLine, stderr, exitCode: 0, running: true, pid: child.pid, ...(url ? { url } : {}) });
                }
            });
            child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-32_000); });
            child.on("close", code => {
                if (this.backgroundProcesses.get(command) === child) {this.backgroundProcesses.delete(command);}
                if (!settled) {finishError(new Error(`${command} exited before startup (code ${code ?? -1})${stderr ? `: ${stderr.slice(-2000)}` : ""}`));}
            });
        });
    }

    private buildArguments(request: IndexerRequest): string[] {
        const args: string[] = [request.command];

        if (request.arguments) {
            args.push(...request.arguments);
        } else if (request.argument) {
            args.push(request.argument);
        }

        const options = request.options;
        if (!options) {
            return args;
        }

        if (options.indexDir) {
            args.push("--index-dir", options.indexDir);
        }
        if (options.workspacePath) {
            args.push("--path", options.workspacePath);
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
        if (options.language) {
            args.push("--language", options.language);
        }
        if (options.pattern) {
            args.push("--pattern", options.pattern);
        }
        if (options.limit !== undefined) {
            args.push("--limit", String(options.limit));
        }
        if (options.depth !== undefined) {
            args.push("--depth", String(options.depth));
        }
        if (options.maxDepth !== undefined) {
            args.push("--depth", String(options.maxDepth));
        }
        if (options.maxNodes !== undefined) {
            args.push("--max-nodes", String(options.maxNodes));
        }
        if (options.lexical) {
            args.push("--lexical");
        }
        if (options.semantic) {
            args.push("--semantic");
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
