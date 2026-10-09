import { randomUUID } from "crypto";
import * as path from "path";
import * as fs from "fs";
import { VortiqWorkspace, WorkspaceFolder, WorkspaceState } from "./types";

export class WorkspaceManager {
    private workspaceId: string | null = null;
    private state: WorkspaceState = "none";
    private standaloneRoot: string | null = null;

    constructor(
        private readonly context?: any,
        explicitRoot?: string
    ) {
        if (explicitRoot) {
            this.standaloneRoot = path.resolve(explicitRoot);
        } else if (process.env.MCP_WORKSPACE_ROOT) {
            this.standaloneRoot = path.resolve(process.env.MCP_WORKSPACE_ROOT);
        }

        this.initialize();

        if (this.context) {
            try {
                const vscode = require("vscode");
                if (vscode.workspace?.onDidChangeWorkspaceFolders) {
                    const listener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
                        this.refresh();
                    });
                    this.context.subscriptions.push(listener);
                }
            } catch {
                // Not running in VS Code context
            }
        }
    }

    private initialize(): void {
        let hasFolders = false;
        if (this.context) {
            try {
                const vscode = require("vscode");
                const folders = vscode.workspace?.workspaceFolders;
                if (folders && folders.length > 0) {
                    hasFolders = true;
                }
            } catch {
                // Ignored
            }
        }

        if (!hasFolders && !this.standaloneRoot) {
            this.standaloneRoot = process.cwd();
            hasFolders = true;
        }

        if (this.context) {
            let storedId = this.context.workspaceState.get("vortiqlabs.workspaceId");
            if (!storedId) {
                storedId = randomUUID();
                void this.context.workspaceState.update("vortiqlabs.workspaceId", storedId);
            }
            this.workspaceId = storedId;
        } else {
            this.workspaceId = "standalone-workspace-" + randomUUID().slice(0, 8);
        }

        this.state = "ready";
    }

    private refresh(): void {
        this.initialize();
        this.state = "changed";
    }

    getWorkspaceRootPath(): string {
        if (this.standaloneRoot) {
            return this.standaloneRoot;
        }

        try {
            const vscode = require("vscode");
            const folders = vscode.workspace?.workspaceFolders;
            if (folders && folders.length > 0) {
                return folders[0].uri.fsPath;
            }
        } catch {
            // Ignored
        }

        return process.cwd();
    }

    getCurrent(): VortiqWorkspace | null {
        const rootPath = this.getWorkspaceRootPath();
        const folderName = path.basename(rootPath) || "Workspace";

        const workspaceFolders: WorkspaceFolder[] = [
            {
                id: `${this.workspaceId ?? "ws"}-folder-0`,
                name: folderName,
                relativePath: "."
            }
        ];

        return {
            id: this.workspaceId ?? "standalone-workspace",
            name: folderName,
            folders: workspaceFolders,
            state: this.state
        };
    }

    getId(): string | null {
        return this.workspaceId;
    }

    getState(): WorkspaceState {
        return this.state;
    }

    resolvePath(relativePath: string): string | null {
        if (!relativePath || relativePath.trim() === "") {
            return null;
        }

        const normalizedPath = relativePath.replace(/\\/g, "/");

        // Reject absolute paths supplied as relative arguments
        if (
            normalizedPath.startsWith("/") ||
            /^[a-zA-Z]:[\\/]/.test(normalizedPath)
        ) {
            return null;
        }

        if (
            normalizedPath === ".." ||
            normalizedPath.startsWith("../") ||
            normalizedPath.includes("/../")
        ) {
            return null;
        }

        const root = this.getWorkspaceRootPath();
        const candidate = path.resolve(root, normalizedPath);

        // Check canonical path to prevent symlink traversal
        let canonicalRoot: string;
        try {
            canonicalRoot = fs.realpathSync(root);
        } catch {
            canonicalRoot = path.resolve(root);
        }

        let canonicalCandidate: string;
        try {
            canonicalCandidate = fs.realpathSync(candidate);
        } catch {
            // File might not exist yet (e.g. write)
            canonicalCandidate = path.resolve(candidate);
        }

        const relative = path.relative(canonicalRoot, canonicalCandidate);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
            return null;
        }

        return candidate;
    }
}
