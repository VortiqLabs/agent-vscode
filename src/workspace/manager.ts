import * as vscode from "vscode";
import { randomUUID } from "crypto";
import {
    VortiqWorkspace,
    WorkspaceFolder,
    WorkspaceState
} from "./types";

export class WorkspaceManager {
    private workspaceId: string | null = null;
    private state: WorkspaceState = "none";

    constructor(
        private readonly context: vscode.ExtensionContext
    ) {
        this.initialize();

        const workspaceFolderListener =
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.refresh();
            });

        context.subscriptions.push(workspaceFolderListener);
    }

    private initialize(): void {
        const folders = vscode.workspace.workspaceFolders;

        if (!folders?.length) {
            this.state = "none";
            return;
        }

        let storedId =
            this.context.workspaceState.get<string>(
                "vortiqlabs.workspaceId"
            );

        if (!storedId) {
            storedId = randomUUID();

            void this.context.workspaceState.update(
                "vortiqlabs.workspaceId",
                storedId
            );
        }

        this.workspaceId = storedId;
        this.state = "ready";
    }

    private refresh(): void {
        const folders = vscode.workspace.workspaceFolders;

        if (!folders?.length) {
            this.workspaceId = null;
            this.state = "none";
            return;
        }

        if (!this.workspaceId) {
            let storedId =
                this.context.workspaceState.get<string>(
                    "vortiqlabs.workspaceId"
                );

            if (!storedId) {
                storedId = randomUUID();

                void this.context.workspaceState.update(
                    "vortiqlabs.workspaceId",
                    storedId
                );
            }

            this.workspaceId = storedId;
        }

        this.state = "changed";
    }

    getCurrent(): VortiqWorkspace | null {
        const folders = vscode.workspace.workspaceFolders;

        if (!folders?.length || !this.workspaceId) {
            return null;
        }

        const workspaceFolders: WorkspaceFolder[] =
            folders.map((folder, index) => ({
                id: `${this.workspaceId}-folder-${index}`,
                name: folder.name,
                relativePath: "."
            }));

        return {
            id: this.workspaceId,
            name: vscode.workspace.name ?? null,
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

    getRoots(): readonly vscode.Uri[] {
        return vscode.workspace.workspaceFolders?.map(
            folder => folder.uri
        ) ?? [];
    }

    resolvePath(relativePath: string): vscode.Uri | null {
        if (!relativePath || relativePath.trim() === "") {
            return null;
        }

        if (
            relativePath.startsWith("/") ||
            relativePath.startsWith("\\") ||
            /^[a-zA-Z]:[\\/]/.test(relativePath)
        ) {
            return null;
        }

        const normalizedPath = relativePath
            .replace(/\\/g, "/");

        if (
            normalizedPath === ".." ||
            normalizedPath.startsWith("../") ||
            normalizedPath.includes("/../")
        ) {
            return null;
        }

        const folders = vscode.workspace.workspaceFolders;

        if (!folders?.length) {
            return null;
        }

        for (const folder of folders) {
            const candidate = vscode.Uri.joinPath(
                folder.uri,
                ...normalizedPath.split("/")
            );

            const relative = vscode.workspace.asRelativePath(
                candidate,
                false
            ).replace(/\\/g, "/");

            if (
                relative === normalizedPath ||
                (
                    !relative.startsWith("../") &&
                    relative !== ".."
                )
            ) {
                return candidate;
            }
        }

        return null;
    }
}