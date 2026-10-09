import { spawn } from "child_process";
import {
    FileApplyPatchRequest,
    FileApplyPatchResult,
    FileDiffRequest,
    FileDiffResult
} from "./types";
import { WorkspaceManager } from "../workspace/manager";

export interface GitStatusResult {
    branch: string;
    clean: boolean;
    modified: string[];
    untracked: string[];
    staged: string[];
    statusRaw: string;
}

export class GitTool {
    constructor(
        private readonly workspaceManager?: WorkspaceManager,
        private readonly explicitWorkspaceRoot?: string
    ) {}

    private getWorkspaceRoot(): string {
        if (this.explicitWorkspaceRoot) {
            return this.explicitWorkspaceRoot;
        }

        if (this.workspaceManager) {
            return this.workspaceManager.getWorkspaceRootPath();
        }

        if (process.env.MCP_WORKSPACE_ROOT) {
            return process.env.MCP_WORKSPACE_ROOT;
        }

        try {
            const vscode = require("vscode");
            const folders = vscode.workspace?.workspaceFolders;
            if (folders && folders.length > 0) {
                return folders[0].uri.fsPath;
            }
        } catch {
            // Not in VS Code context
        }

        return process.cwd();
    }

    private runGit(
        args: string[],
        cwd: string,
        input?: string
    ): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const child = spawn("git", args, {
                cwd,
                stdio: ["pipe", "pipe", "pipe"]
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

            child.on("close", code => {
                if (code !== 0) {
                    reject(
                        new Error(
                            stderr.trim() || `git exited with code ${code}`
                        )
                    );
                    return;
                }
                resolve({ stdout, stderr });
            });

            if (input !== undefined) {
                child.stdin.write(input);
            }
            child.stdin.end();
        });
    }

    async status(): Promise<GitStatusResult> {
        const cwd = this.getWorkspaceRoot();
        const { stdout: branchOut } = await this.runGit(["branch", "--show-current"], cwd).catch(() => ({ stdout: "unknown", stderr: "" }));
        const branch = branchOut.trim() || "HEAD";

        const { stdout: statusOut } = await this.runGit(["status", "--porcelain"], cwd);

        const modified: string[] = [];
        const untracked: string[] = [];
        const staged: string[] = [];

        for (const line of statusOut.split(/\r?\n/)) {
            if (!line.trim()) {
                continue;
            }
            const indexStatus = line[0];
            const workTreeStatus = line[1];
            const filePath = line.slice(3).trim();

            if (indexStatus !== " " && indexStatus !== "?" && indexStatus !== "!") {
                staged.push(filePath);
            }
            if (workTreeStatus === "M" || workTreeStatus === "D") {
                modified.push(filePath);
            } else if (indexStatus === "?" && workTreeStatus === "?") {
                untracked.push(filePath);
            }
        }

        return {
            branch,
            clean: modified.length === 0 && untracked.length === 0 && staged.length === 0,
            modified,
            untracked,
            staged,
            statusRaw: statusOut
        };
    }

    async diff(
        request: FileDiffRequest
    ): Promise<FileDiffResult> {
        const cwd = this.getWorkspaceRoot();

        const args = [
            "diff",
            "--no-ext-diff",
            "--no-color"
        ];

        if (request.path) {
            args.push("--", request.path);
        }

        const { stdout } = await this.runGit(args, cwd);

        return {
            path: request.path,
            diff: stdout
        };
    }

    async applyPatch(
        request: FileApplyPatchRequest
    ): Promise<FileApplyPatchResult> {
        if (!request.patch || request.patch.trim().length === 0) {
            throw new Error("Patch cannot be empty.");
        }

        const cwd = this.getWorkspaceRoot();

        await this.runGit(
            ["apply", "--check", "--whitespace=nowarn", "-"],
            cwd,
            request.patch
        );

        await this.runGit(
            ["apply", "--whitespace=nowarn", "-"],
            cwd,
            request.patch
        );

        return {
            filesChanged: this.extractChangedFiles(request.patch),
            patch: request.patch
        };
    }

    private extractChangedFiles(patch: string): string[] {
        const files = new Set<string>();

        for (const line of patch.split(/\r?\n/)) {
            if (!line.startsWith("+++ ")) {
                continue;
            }

            const value = line.slice(4).trim();
            if (value === "/dev/null") {
                continue;
            }

            const pathStr = value.startsWith("b/") ? value.slice(2) : value;
            files.add(pathStr);
        }

        return [...files];
    }
}
