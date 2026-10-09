import { spawn } from "child_process";
import * as vscode from "vscode";
import {
    FileApplyPatchRequest,
    FileApplyPatchResult,
    FileDiffRequest,
    FileDiffResult
} from "./types";

export class GitTool {
    private getWorkspaceRoot(): string {
        const folders =
            vscode.workspace.workspaceFolders;

        if (!folders || folders.length === 0) {
            throw new Error(
                "No VS Code workspace is currently open."
            );
        }

        if (folders.length > 1) {
            throw new Error(
                "Git operations currently require a single-root workspace."
            );
        }

        return folders[0].uri.fsPath;
    }

    private runGit(
        args: string[],
        cwd: string,
        input?: string
    ): Promise<{
        stdout: string;
        stderr: string;
    }> {
        return new Promise(
            (resolve, reject) => {
                const child =
                    spawn(
                        "git",
                        args,
                        {
                            cwd,
                            stdio: [
                                "pipe",
                                "pipe",
                                "pipe"
                            ]
                        }
                    );

                let stdout = "";
                let stderr = "";

                child.stdout.on(
                    "data",
                    data => {
                        stdout +=
                            data.toString();
                    }
                );

                child.stderr.on(
                    "data",
                    data => {
                        stderr +=
                            data.toString();
                    }
                );

                child.on(
                    "error",
                    reject
                );

                child.on(
                    "close",
                    code => {
                        if (code !== 0) {
                            reject(
                                new Error(
                                    stderr.trim() ||
                                    `git exited with code ${code}`
                                )
                            );

                            return;
                        }

                        resolve({
                            stdout,
                            stderr
                        });
                    }
                );

                if (input !== undefined) {
                    child.stdin.write(input);
                }

                child.stdin.end();
            }
        );
    }

    async diff(
        request: FileDiffRequest
    ): Promise<FileDiffResult> {
        const cwd =
            this.getWorkspaceRoot();

        const args = [
            "diff",
            "--no-ext-diff",
            "--no-color"
        ];

        if (request.path) {
            args.push(
                "--",
                request.path
            );
        }

        const { stdout } =
            await this.runGit(
                args,
                cwd
            );

        return {
            path: request.path,
            diff: stdout
        };
    }

    async applyPatch(
        request: FileApplyPatchRequest
    ): Promise<FileApplyPatchResult> {
        if (
            !request.patch ||
            request.patch.trim().length === 0
        ) {
            throw new Error(
                "Patch cannot be empty."
            );
        }

        const cwd =
            this.getWorkspaceRoot();

        await this.runGit(
            [
                "apply",
                "--check",
                "--whitespace=nowarn",
                "-"
            ],
            cwd,
            request.patch
        );

        await this.runGit(
            [
                "apply",
                "--whitespace=nowarn",
                "-"
            ],
            cwd,
            request.patch
        );

        return {
            filesChanged:
                this.extractChangedFiles(
                    request.patch
                ),
            patch: request.patch
        };
    }

    private extractChangedFiles(
        patch: string
    ): string[] {
        const files =
            new Set<string>();

        for (
            const line of
            patch.split(/\r?\n/)
        ) {
            if (!line.startsWith("+++ ")) {
                continue;
            }

            const value =
                line.slice(4).trim();

            if (value === "/dev/null") {
                continue;
            }

            const path =
                value.startsWith("b/")
                    ? value.slice(2)
                    : value;

            files.add(path);
        }

        return [...files];
    }
}