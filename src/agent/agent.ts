import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import type * as vscodeTypes from "vscode";
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
import { AgentActivity } from "../ui/activity";

interface FileSnapshot {
    path: string;
    content: string | null;
}

interface PendingChangeReview {
    id: string;
    activityId: string;
    paths: string[];
    before: FileSnapshot[];
    preview: string;
    apply: () => Promise<unknown>;
    status: "pending" | "accepted" | "declined";
}

export class Agent {
    private readonly context?: unknown;
    private readonly workspaceManager: WorkspaceManager;
    private readonly safeWorkspace: SafeWorkspace;
    private readonly fileTool: FileTool;
    private readonly gitTool: GitTool;
    private readonly terminalTool: TerminalTool;
    private readonly runtimeManager: IndexerRuntimeManager;
    private readonly indexer: IndexerService;
    private readonly activity?: AgentActivity;
    private readonly changeReviews = new Map<string, PendingChangeReview>();

    constructor(
        context?: unknown,
        explicitWorkspaceRoot?: string,
        activity?: AgentActivity
    ) {
        this.context = context;
        this.activity = activity;
        this.workspaceManager = new WorkspaceManager(context, explicitWorkspaceRoot);
        const rootPath = this.workspaceManager.getWorkspaceRootPath();
        this.safeWorkspace = new SafeWorkspace(rootPath);
        this.fileTool = new FileTool(this.workspaceManager);
        this.gitTool = new GitTool(this.workspaceManager, rootPath);
        this.terminalTool = new TerminalTool(this.workspaceManager);
        this.runtimeManager = new IndexerRuntimeManager(context);
        this.indexer = new IndexerService(this.runtimeManager, rootPath);
    }

    async resolveChangeReview(id: string, decision: "accept" | "decline"): Promise<{ id: string; status: "accepted" | "declined"; paths: string[] }> {
        const review = this.changeReviews.get(id);
        if (!review || review.status !== "pending") {
            throw new Error("This code change is no longer awaiting a decision.");
        }

        if (decision === "accept") {
            // The proposal may have been waiting while the user edited a file.
            // Refuse to apply stale work rather than overwrite newer content.
            for (const snapshot of review.before) {
                const fullPath = this.workspaceManager.resolvePath(snapshot.path);
                if (!fullPath) {throw new Error(`Cannot safely apply an invalid workspace path: ${snapshot.path}`);}
                const current = await fs.promises.readFile(fullPath, "utf8").catch(error => {
                    if ((error as NodeJS.ErrnoException).code === "ENOENT") {return null;}
                    throw error;
                });
                if (current !== snapshot.content) {
                    throw new Error(`Cannot accept this proposal because ${snapshot.path} changed while it was awaiting review. Ask the agent to reread the file and prepare a fresh change.`);
                }
            }
            await review.apply();
            review.status = "accepted";
        } else {
            // Changes are staged until acceptance, so declining is a safe no-op.
            review.status = "declined";
        }

        this.changeReviews.delete(id);
        const activityItem = this.activity?.snapshot().find(item => item.id === review.activityId);
        let result: Record<string, unknown> = {};
        try {
            if (activityItem?.resultText) {
                const parsed: unknown = JSON.parse(activityItem.resultText);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {result = parsed as Record<string, unknown>;}
            }
        } catch { /* Preserve at least the review status if the original result was truncated. */ }
        result.pendingApproval = false;
        result.message = review.status === "accepted" ? "The reviewed code change was accepted and applied." : "The proposed code change was declined; no files were changed.";
        result.changeReview = { id: review.id, paths: review.paths, preview: review.preview, status: review.status };
        this.activity?.updateResult(review.activityId, result);
        return { id, status: review.status, paths: review.paths };
    }

    private async withChangeReview<T>(activityId: string, paths: string[], preview: string, operation: () => Promise<T>): Promise<unknown> {
        // Non-extension/standalone Agents have no approval UI; preserve their
        // established direct-call behavior instead of creating an unresolvable proposal.
        if (!this.activity) {return operation();}
        const uniquePaths = [...new Set(paths)];
        if (uniquePaths.length === 0) {throw new Error("No files were identified for code-change review.");}
        const before = await Promise.all(uniquePaths.map(async relativePath => {
            const fullPath = this.workspaceManager.resolvePath(relativePath);
            if (!fullPath) {throw new Error(`Path is outside the active workspace or invalid: ${relativePath}`);}
            const content = await fs.promises.readFile(fullPath, "utf8").catch(error => {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") {return null;}
                throw error;
            });
            return { path: relativePath, content };
        }));
        if (this.changeReviews.size >= 20) {
            throw new Error("There are already 20 code changes awaiting review. Accept or decline an existing proposal before creating another.");
        }
        const id = randomUUID();
        const review: PendingChangeReview = {
            id, activityId, paths: uniquePaths, before, preview: preview.slice(0, 16_000), apply: async () => {await operation();}, status: "pending"
        };
        this.changeReviews.set(id, review);
        return {
            pendingApproval: true,
            message: "The proposed code change has not been applied. Review it in the VortiqLabs Agent sidebar and choose Accept changes or Decline.",
            changeReview: { id, paths: uniquePaths, preview: review.preview, status: "pending" }
        };
    }

    private async previewFile(pathValue: string): Promise<string> {
        const fullPath = this.workspaceManager.resolvePath(pathValue);
        if (!fullPath) {throw new Error(`Path is outside the active workspace or invalid: ${pathValue}`);}
        return fs.promises.readFile(fullPath, "utf8").catch(error => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {return "(file does not exist yet)";}
            throw error;
        });
    }

    private patchPaths(patch: string): string[] {
        const paths = new Set<string>();
        const lines = patch.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].startsWith("--- ")) {continue;}
            const oldPath = lines[i].slice(4).trim();
            const newLine = lines[i + 1];
            if (!newLine?.startsWith("+++ ")) {continue;}
            const newPath = newLine.slice(4).trim();
            for (const value of [oldPath, newPath]) {
                if (value === "/dev/null") {continue;}
                if (value.startsWith('"') || value.endsWith('"')) {
                    throw new Error("This patch uses quoted/escaped file paths, which cannot be safely previewed for approval. Use simple workspace-relative paths and retry.");
                }
                const relativePath = value.startsWith("a/") || value.startsWith("b/") ? value.slice(2) : value;
                if (relativePath) {paths.add(relativePath);}
            }
        }
        return [...paths];
    }

    getActivityDiagnostics(): { count: number; latest: { tool: string; status: string; startedAt: string } | null } {
        const items = this.activity?.snapshot() ?? [];
        const latest = items[0];
        return {
            count: items.length,
            latest: latest ? { tool: latest.tool, status: latest.status, startedAt: latest.startedAt } : null
        };
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

        const startedAt = Date.now();
        this.activity?.start(request);
        let response: AgentResponse;
        try {
            const result = await this.execute(request);
            response = { id: request.id, success: true, result };
        } catch (error) {
            response = {
                id: request.id, success: false,
                error: { code: "TOOL_EXECUTION_FAILED", message: error instanceof Error ? error.message : String(error) }
            };
        }
        this.activity?.finish(response, Date.now() - startedAt);
        return response;
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
                    this.optionalNumber(request.arguments, "timeoutMs"),
                    (stream, chunk) => this.activity?.appendTerminal(request.id, stream, chunk)
                );

            case "editor.context":
                return this.getEditorContext();

            case "editor.diagnostics":
                return this.getEditorDiagnostics(this.optionalString(request.arguments, "path"));

            case "editor.symbols":
                return this.getEditorSymbols(this.optionalString(request.arguments, "path"));

            case "workspace.search":
                return this.searchWorkspace(
                    this.requireString(request.arguments, "query"),
                    this.optionalString(request.arguments, "include"),
                    this.optionalNumber(request.arguments, "maxResults")
                );

            case "browser.open_url":
                return this.openBrowserUrl(this.requireString(request.arguments, "url"));

            case "file.diagnostics":
                return this.getFileDiagnostics(
                    this.requireString(request.arguments, "path")
                );

            case "file.read":
                return this.fileTool.read({
                    path: this.requireString(request.arguments, "path")
                });

            case "file.write": {
                const filePath = this.requireString(request.arguments, "path");
                const content = this.requireString(request.arguments, "content");
                const current = await this.previewFile(filePath);
                const preview = `File: ${filePath}\n--- Current\n${current}\n+++ Proposed\n${content}`;
                return this.withChangeReview(request.id, [filePath], preview, () => this.fileTool.write({ path: filePath, content }));
            }

            case "file.replace_range": {
                const filePath = this.requireString(request.arguments, "path");
                const startLine = this.requireInteger(request.arguments, "startLine");
                const endLine = this.requireInteger(request.arguments, "endLine");
                const content = this.requireString(request.arguments, "content");
                const current = await this.previewFile(filePath);
                const preview = `File: ${filePath}\nReplace lines ${startLine}-${endLine}\n--- Current\n${current}\n+++ Replacement\n${content}`;
                return this.withChangeReview(request.id, [filePath], preview, () => this.fileTool.replaceRange({ path: filePath, startLine, endLine, content }));
            }

            case "git.status":
                return this.gitTool.status();

            case "git.diff":
                return this.gitTool.diff({
                    path:
                        request.arguments.path === undefined
                            ? undefined
                            : this.requireString(request.arguments, "path")
                });

            case "git.apply_patch": {
                const patch = this.requireString(request.arguments, "patch");
                return this.withChangeReview(request.id, this.patchPaths(patch), patch, () => this.gitTool.applyPatch({ patch }));
            }

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

    private getVscode(): typeof import("vscode") {
        return require("vscode") as typeof import("vscode");
    }

    private getEditorContext(): unknown {
        const vscode = this.getVscode();
        const editor = vscode.window.activeTextEditor;
        if (!editor) {return { active: false, message: "No active text editor." };}
        const selection = editor.selection;
        return {
            active: true,
            file: vscode.workspace.asRelativePath(editor.document.uri, false),
            languageId: editor.document.languageId,
            version: editor.document.version,
            lineCount: editor.document.lineCount,
            isDirty: editor.document.isDirty,
            selection: {
                start: { line: selection.start.line + 1, character: selection.start.character + 1 },
                end: { line: selection.end.line + 1, character: selection.end.character + 1 },
                isEmpty: selection.isEmpty,
                text: selection.isEmpty ? "" : editor.document.getText(selection).slice(0, 12000)
            },
            cursor: { line: editor.selection.active.line + 1, character: editor.selection.active.character + 1 }
        };
    }

    private async getEditorDiagnostics(relativePath?: string): Promise<unknown> {
        const vscode = this.getVscode();
        let uri = vscode.window.activeTextEditor?.document.uri;
        if (relativePath) {
            const fullPath = this.workspaceManager.resolvePath(relativePath);
            if (!fullPath) {throw new Error(`Path is outside the active workspace or invalid: ${relativePath}`);}
            uri = vscode.Uri.file(fullPath);
        }
        if (!uri) {return { file: null, count: 0, diagnostics: [] };}
        const diagnostics = vscode.languages.getDiagnostics(uri).map(item => ({
            message: item.message,
            severity: item.severity === vscode.DiagnosticSeverity.Error ? "error" : item.severity === vscode.DiagnosticSeverity.Warning ? "warning" : item.severity === vscode.DiagnosticSeverity.Information ? "information" : "hint",
            source: item.source,
            code: typeof item.code === "object" ? item.code.value : item.code,
            range: { startLine: item.range.start.line + 1, startColumn: item.range.start.character + 1, endLine: item.range.end.line + 1, endColumn: item.range.end.character + 1 }
        }));
        return { file: vscode.workspace.asRelativePath(uri, false), count: diagnostics.length, diagnostics };
    }

    private async getEditorSymbols(relativePath?: string): Promise<unknown> {
        const vscode = this.getVscode();
        let document = vscode.window.activeTextEditor?.document;
        if (relativePath) {
            const fullPath = this.workspaceManager.resolvePath(relativePath);
            if (!fullPath) {throw new Error(`Path is outside the active workspace or invalid: ${relativePath}`);}
            document = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
        }
        if (!document) {return { file: null, symbols: [] };}
        const result = await vscode.commands.executeCommand<Array<vscodeTypes.DocumentSymbol | vscodeTypes.SymbolInformation>>("vscode.executeDocumentSymbolProvider", document.uri) ?? [];
        const symbols: Array<{ name: string; kind: string; detail?: string; range: { startLine: number; endLine: number }; children?: unknown[] }> = [];
        const flatten = (items: Array<vscodeTypes.DocumentSymbol | vscodeTypes.SymbolInformation>, depth = 0): void => {
            for (const item of items) {
                if (symbols.length >= 250) {return;}
                const isDocument = "children" in item;
                const range = isDocument ? item.range : item.location.range;
                symbols.push({ name: item.name, kind: this.getVscode().SymbolKind[item.kind], detail: isDocument ? item.detail : undefined, range: { startLine: range.start.line + 1, endLine: range.end.line + 1 }, ...(isDocument && depth < 4 ? { children: item.children.map(child => ({ name: child.name, kind: vscode.SymbolKind[child.kind], range: { startLine: child.range.start.line + 1, endLine: child.range.end.line + 1 } })) } : {}) });
                if (isDocument && depth < 2) {flatten(item.children, depth + 1);}
            }
        };
        flatten(result);
        return { file: vscode.workspace.asRelativePath(document.uri, false), count: symbols.length, symbols };
    }

    private async searchWorkspace(query: string, include?: string, maxResults?: number): Promise<unknown> {
        if (!query.trim()) {throw new Error("Search query must not be empty.");}
        const limit = Math.max(1, Math.min(200, Math.floor(maxResults ?? 100)));
        const root = this.workspaceManager.getWorkspaceRootPath();
        const needle = query.toLocaleLowerCase();
        const matches: Array<{ file: string; line: number; preview: string; range: { start: number; end: number } }> = [];
        let scanned = 0;
        const ignored = new Set([".git", "node_modules", "dist", "out", ".next", "coverage", "vendor", "target"]);
        const walk = async (dir: string): Promise<void> => {
            if (matches.length >= limit || scanned >= 2500) {return;}
            let entries: import("fs").Dirent[];
            try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
            for (const entry of entries) {
                if (matches.length >= limit || scanned >= 2500) {return;}
                if (entry.name.startsWith(".") && entry.name !== ".env.example") {continue;}
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { if (!ignored.has(entry.name)) {await walk(full);} continue; }
                if (!entry.isFile()) {continue;}
                const rel = path.relative(root, full).split(path.sep).join("/");
                if (include && !rel.includes(include.replace(/^\.\//, ""))) {continue;}
                if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|wasm|so|dll|exe|lock)$/i.test(entry.name)) {continue;}
                scanned++;
                try {
                    const stat = await fs.promises.stat(full);
                    if (stat.size > 1024 * 1024) {continue;}
                    const content = await fs.promises.readFile(full, "utf8");
                    if (content.includes("\u0000")) {continue;}
                    const lines = content.split(/\r?\n/);
                    for (let i = 0; i < lines.length && matches.length < limit; i++) {
                        const col = lines[i].toLocaleLowerCase().indexOf(needle);
                        if (col >= 0) {matches.push({ file: rel, line: i + 1, preview: lines[i].slice(0, 500), range: { start: col + 1, end: col + query.length + 1 } });}
                    }
                } catch { /* Skip unreadable or binary files. */ }
            }
        };
        await walk(root);
        return { query, count: matches.length, scannedFiles: scanned, truncated: matches.length >= limit || scanned >= 2500, matches };
    }

    private async openBrowserUrl(rawUrl: string): Promise<unknown> {
        const vscode = this.getVscode();
        let url: URL;
        try { url = new URL(rawUrl); } catch { throw new Error("Provide a valid absolute HTTP(S) URL."); }
        if (url.protocol !== "http:" && url.protocol !== "https:") {throw new Error("Only http and https URLs can be opened.");}
        await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
        return { opened: true, url: url.toString(), note: "Opened in the user's configured external browser. VS Code does not expose a universal stable API to inspect arbitrary browser tabs." };
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
