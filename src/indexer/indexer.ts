import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import type { Codebase, CodebaseOptions, IndexProgress } from "@vortiqlabs/codebase-indexer/api" with { "resolution-mode": "import" };
import type { GitHubRepositoryIndexResult, GitHubRepositoryIndexerOptions } from "@vortiqlabs/codebase-indexer/github" with { "resolution-mode": "import" };
import { IndexerCLI } from "./cli";
import { IndexerExecutable } from "./executable";
import { IndexerRuntimeManager } from "./runtime/manager";
import type { IndexerOptions, IndexerResult } from "./types";

export const CODEBASE_INDEXER_SDK_VERSION = "0.2.0";

type CodebaseInstance = Codebase;
type CodebaseModule = typeof import("@vortiqlabs/codebase-indexer/api", { with: { "resolution-mode": "import" } });
type GitHubModule = typeof import("@vortiqlabs/codebase-indexer/github", { with: { "resolution-mode": "import" } });

/**
 * Application adapter around the official Codebase Indexer SDK.
 * The legacy executable is retained only for the dashboard and binary-index
 * inspection commands, which are not part of the stable SDK API.
 */
export class IndexerService {
    private readonly legacyCli: IndexerCLI;
    private readonly workspaceRoot: string;
    private readonly runtimeRoot: string;
    private readonly codebases = new Map<string, Promise<CodebaseInstance>>();
    private previousRuntimeRoot: string | undefined;
    private runtimeRootCaptured = false;
    private selectedGitHubTarget: { workspacePath: string; indexDir: string; partitionIds?: string[] } | undefined;
    private selectedIndexDir: string | undefined;

    constructor(
        runtimeManager: IndexerRuntimeManager,
        explicitWorkspaceRoot?: string,
        runtimeRoot?: string
    ) {
        this.workspaceRoot = explicitWorkspaceRoot ?? process.cwd();
        this.runtimeRoot = runtimeRoot ?? path.join(process.cwd(), "dist", "indexer-runtime");
        this.legacyCli = new IndexerCLI(new IndexerExecutable(runtimeManager, explicitWorkspaceRoot));
    }

    async ensureRuntime(): Promise<{ version: string; runtimeRoot: string; platform: string }> {
        const [grammars, wasmGrammars, githubWorker, parserRuntime] = await Promise.all([
            fs.stat(path.join(this.runtimeRoot, "grammars")),
            fs.stat(path.join(this.runtimeRoot, "tree-sitter-wasms")),
            fs.stat(path.join(this.runtimeRoot, "workers", "GitHubIndexPartWorker.js")),
            fs.stat(path.join(this.runtimeRoot, "workers", "tree-sitter.wasm"))
        ]);
        if (!grammars.isDirectory() || !wasmGrammars.isDirectory() || !githubWorker.isFile() || !parserRuntime.isFile()) {
            throw new Error(`Codebase Indexer SDK runtime assets are incomplete: ${this.runtimeRoot}`);
        }
        return {
            version: CODEBASE_INDEXER_SDK_VERSION,
            runtimeRoot: this.runtimeRoot,
            platform: `${process.platform}-${process.arch}`
        };
    }

    async index(workspacePath?: string, options?: IndexerOptions): Promise<IndexerResult> {
        this.selectedGitHubTarget = undefined;
        this.selectedIndexDir = options?.indexDir;
        const codebase = await this.getCodebase(workspacePath, options);
        const result = await codebase.index(options?.force === true, progress => this.reportProgress(progress));
        return this.success({
            indexPath: result.indexPath,
            added: result.added,
            changed: result.changed,
            unchanged: result.unchanged,
            deleted: result.deleted,
            errors: result.errors,
            counts: {
                files: result.snapshot.metadata.fileCount,
                symbols: result.snapshot.metadata.symbolCount,
                relations: result.snapshot.metadata.relationCount,
                chunks: result.snapshot.metadata.chunkCount,
                vectors: result.snapshot.metadata.vectorCount
            }
        });
    }

    async indexGithub(repository: string, options?: IndexerOptions): Promise<IndexerResult> {
        const { owner, name } = parseGitHubRepository(repository);
        await this.ensureRuntime();
        this.captureRuntimeRoot();
        const sdk = await import("@vortiqlabs/codebase-indexer/github") as GitHubModule;
        const githubOptions: GitHubRepositoryIndexerOptions = {
            indexDir: options?.indexDir ?? this.defaultIndexDir(),
            ...(process.env.GITHUB_TOKEN || process.env.GH_TOKEN
                ? { token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN }
                : {}),
            ...(options?.maxFileSize ? { maxFileSize: parseByteSize(options.maxFileSize) } : {}),
            ...(options?.ignore ? { patterns: options.ignore } : {}),
            onProgress: progress => this.reportProgress(progress)
        };
        const ref = options?.ref ?? "HEAD";
        const result: GitHubRepositoryIndexResult = await sdk.indexGitHubRepository(owner, name, ref, githubOptions);
        const partitionIds = result.parts?.map((_part, index) => {
            const refKey = createHash("sha256").update(ref).digest("hex").slice(0, 16);
            return `github:${owner.toLowerCase()}/${name.toLowerCase()}@${refKey}/part-${String(index).padStart(4, "0")}`;
        });
        this.selectedIndexDir = githubOptions.indexDir;
        this.selectedGitHubTarget = {
            workspacePath: result.workspacePath,
            indexDir: githubOptions.indexDir!,
            ...(partitionIds?.length ? { partitionIds } : {})
        };
        return this.success({ ...result, selectedForQueries: true, partitionCount: partitionIds?.length ?? 1 });
    }

    async status(options?: IndexerOptions): Promise<IndexerResult> {
        const codebases = await this.getQueryCodebases(options);
        const statuses = await Promise.all(codebases.map(async codebase => {
            const status = await codebase.getStatus();
            return { status, stats: status.indexed ? await codebase.getStats() : undefined };
        }));
        const indexed = statuses.filter(item => item.status.indexed && item.stats);
        if (indexed.length === 0) {
            return this.success({ indexed: false, message: "This workspace has not been indexed yet." });
        }
        if (indexed.length === 1) {
            return this.success({ indexed: true, ...indexed[0]!.stats, size: indexed[0]!.status.size });
        }
        const fields = ["fileCount", "symbolCount", "relationCount", "chunkCount", "vectorCount"] as const;
        const totals = Object.fromEntries(fields.map(field => [field, indexed.reduce((sum, item) => sum + (item.stats?.[field] ?? 0), 0)]));
        return this.success({ indexed: true, partitions: indexed.length, ...totals, indexes: indexed.map(item => item.stats) });
    }

    async search(query: string, options?: IndexerOptions): Promise<IndexerResult> {
        const codebases = await this.getQueryCodebases(options);
        const limit = clampInteger(options?.limit, 10, 1, 100);
        const resultsByIndex = await Promise.all(codebases.map(async codebase => {
            const status = await codebase.getStatus();
            if (!status.indexed) {return [];}
            return options?.semantic
                ? codebase.semanticSearch(query, limit)
                : options?.lexical
                    ? codebase.search(query, limit)
                    : codebase.hybridSearch(query, limit);
        }));
        const results = resultsByIndex.flat().sort((left, right) => right.score - left.score).slice(0, limit);
        if (resultsByIndex.every(results => results.length === 0)) {
            throw new Error("This workspace has not been indexed. Run indexer_index first.");
        }
        return this.success({ query, mode: options?.semantic ? "semantic" : options?.lexical ? "lexical" : "hybrid", results });
    }

    async symbols(query: string, options?: IndexerOptions): Promise<IndexerResult> {
        return this.runQuery(options, codebase => codebase.findSymbol(query));
    }

    async references(query: string, options?: IndexerOptions): Promise<IndexerResult> {
        return this.runQuery(options, codebase => codebase.findReferences(query));
    }

    async callers(query: string, options?: IndexerOptions): Promise<IndexerResult> {
        return this.runQuery(options, codebase => codebase.findCallers(query));
    }

    async callees(query: string, options?: IndexerOptions): Promise<IndexerResult> {
        return this.runQuery(options, codebase => codebase.findCallees(query));
    }

    async dependencies(query: string, options?: IndexerOptions): Promise<IndexerResult> {
        return this.runQuery(options, codebase => codebase.findDependencies(query, clampInteger(options?.depth ?? options?.maxDepth, 1, 1, 12)));
    }

    async dependents(query: string, options?: IndexerOptions): Promise<IndexerResult> {
        return this.runQuery(options, codebase => codebase.findDependents(query, clampInteger(options?.depth ?? options?.maxDepth, 1, 1, 12)));
    }

    async symbolPath(from: string, to: string, options?: IndexerOptions): Promise<IndexerResult> {
        return this.runQuery(options, codebase => codebase.findPath(from, to, {
            maxDepth: clampInteger(options?.maxDepth ?? options?.depth, 8, 1, 32),
            maxNodes: clampInteger(options?.maxNodes, 500, 1, 5000)
        }));
    }

    async repositoryMap(options?: IndexerOptions): Promise<IndexerResult> {
        return this.runQuery(options, codebase => codebase.getRepositoryMap());
    }

    async apiEndpoints(options?: IndexerOptions): Promise<IndexerResult> {
        return this.runQuery(options, codebase => codebase.findApiEndpoints());
    }

    async classifyQuery(query: string, options?: IndexerOptions): Promise<IndexerResult> {
        return this.runQuery(options, codebase => codebase.classifyQuery(query));
    }

    async sensitiveRegions(options?: IndexerOptions): Promise<IndexerResult> {
        return this.runQuery(options, codebase => codebase.findSensitiveRegions());
    }

    async context(query: string, options?: IndexerOptions & { maxFiles?: number; maxTokens?: number; includeRelatedFiles?: boolean }): Promise<IndexerResult> {
        const codebases = await this.getQueryCodebases(options);
        const maxFiles = clampInteger(options?.maxFiles, 8, 1, 32);
        const maxTokens = clampInteger(options?.maxTokens, 6000, 256, 50000);
        const contexts = await Promise.all(codebases.map(codebase => codebase.getContext(query, {
            maxFiles: Math.max(1, Math.floor(maxFiles / codebases.length)),
            maxTokens: Math.max(256, Math.floor(maxTokens / codebases.length)),
            includeRelatedFiles: options?.includeRelatedFiles !== false
        })));
        return this.success(contexts.length === 1 ? contexts[0] : {
            files: uniqueBy(contexts.flatMap(context => context.files), file => file.path),
            symbols: uniqueBy(contexts.flatMap(context => context.symbols), symbol => symbol.id),
            relations: uniqueBy(contexts.flatMap(context => context.relations), relation => relation.id),
            chunks: uniqueBy(contexts.flatMap(context => context.chunks), chunk => chunk.id),
            estimatedTokens: contexts.reduce((sum, context) => sum + context.estimatedTokens, 0)
        });
    }

    async chunks(options?: IndexerOptions & { query?: string; filePath?: string; limit?: number; offset?: number }): Promise<IndexerResult> {
        return this.runQuery(options, codebase => codebase.getChunks({
            ...(options?.query ? { query: options.query } : {}),
            ...(options?.filePath ? { filePath: options.filePath } : {}),
            limit: clampInteger(options?.limit, 20, 1, 500),
            offset: clampInteger(options?.offset, 0, 0, 100000)
        }));
    }

    async files(options?: IndexerOptions): Promise<IndexerResult> {
        return this.runQuery(options, async codebase => {
            let files = await codebase.getFiles();
            if (options?.language) {files = files.filter(file => file.language.toLowerCase() === options.language!.toLowerCase());}
            if (options?.pattern) {
                const pattern = options.pattern.toLowerCase();
                files = files.filter(file => file.path.toLowerCase().includes(pattern));
            }
            return files.slice(0, clampInteger(options?.limit, 5000, 1, 20000));
        });
    }

    async inspect(indexPath: string, options?: IndexerOptions): Promise<IndexerResult> {
        return this.legacyCli.inspect(indexPath, options);
    }

    async remove(workspacePath: string, options?: IndexerOptions): Promise<IndexerResult> {
        const codebase = await this.getCodebase(workspacePath, options);
        const removed = await codebase.removeIndex();
        return this.success({ removed, workspacePath: path.resolve(workspacePath) });
    }

    async watch(workspacePath?: string, options?: IndexerOptions): Promise<IndexerResult> {
        this.selectedGitHubTarget = undefined;
        const codebase = await this.getCodebase(workspacePath ?? this.workspaceRoot, options);
        const status = await codebase.startWatching({
            ...(options?.ignore ? { patterns: options.ignore } : {}),
            ...(options?.maxFileSize ? { maxFileSize: parseByteSize(options.maxFileSize) } : {}),
            onProgress: progress => this.reportProgress(progress),
            onError: error => console.error("Codebase Indexer watcher:", error)
        });
        return this.success(status);
    }

    async dashboard(options?: IndexerOptions): Promise<IndexerResult> {
        // Dashboard is not currently part of the public SDK; keep its standalone
        // runtime path available without routing core indexing through the CLI.
        return this.legacyCli.dashboard(options);
    }

    async stopBackground(command: "watch" | "dashboard"): Promise<IndexerResult> {
        if (command === "dashboard") {return this.legacyCli.stopBackground("dashboard");}
        const statuses = await Promise.all([...this.codebases.values()].map(async pending => {
            const codebase = await pending;
            return codebase.stopWatching();
        }));
        return this.success({ watching: statuses.some(status => status.watching), stopped: true, workspaces: statuses.length });
    }

    async dispose(): Promise<void> {
        await Promise.all([...this.codebases.values()].map(async pending => {
            const codebase = await pending.catch(() => undefined);
            await codebase?.close();
        }));
        this.codebases.clear();
        await this.legacyCli.stopBackground("dashboard").catch(() => undefined);
        if (this.runtimeRootCaptured) {
            if (this.previousRuntimeRoot === undefined) {delete process.env.CODEBASE_INDEXER_RUNTIME_ROOT;}
            else {process.env.CODEBASE_INDEXER_RUNTIME_ROOT = this.previousRuntimeRoot;}
            this.runtimeRootCaptured = false;
        }
    }

    private async runQuery<T>(options: IndexerOptions | undefined, operation: (codebase: CodebaseInstance) => Promise<T>): Promise<IndexerResult> {
        const codebases = await this.getQueryCodebases(options);
        const results = await Promise.all(codebases.map(async codebase => {
            const status = await codebase.getStatus();
            return status.indexed ? operation(codebase) : undefined;
        }));
        const available = results.filter((result): result is Awaited<T> => result !== undefined);
        if (available.length === 0) {throw new Error("This workspace has not been indexed. Run indexer_index first.");}
        if (available.length === 1) {return this.success(available[0]);}
        if (available.every(Array.isArray)) {return this.success(available.flat());}
        return this.success(available);
    }

    private async getQueryCodebases(options?: IndexerOptions): Promise<CodebaseInstance[]> {
        const target = this.selectedGitHubTarget;
        if (!target || (options?.indexDir && path.resolve(options.indexDir) !== path.resolve(target.indexDir))) {
            return [await this.getCodebase(undefined, options)];
        }
        if (!target.partitionIds?.length) {
            return [await this.getCodebase(target.workspacePath, { ...options, indexDir: target.indexDir })];
        }
        return Promise.all(target.partitionIds.map(partitionId => this.getCodebase(
            target.workspacePath,
            { ...options, indexDir: target.indexDir },
            partitionId
        )));
    }

    private async getCodebase(workspacePath?: string, options?: IndexerOptions, partitionId?: string): Promise<CodebaseInstance> {
        const root = path.resolve(workspacePath ?? this.selectedGitHubTarget?.workspacePath ?? this.workspaceRoot);
        const indexDir = path.resolve(options?.indexDir ?? this.selectedGitHubTarget?.indexDir ?? this.selectedIndexDir ?? this.defaultIndexDir());
        const key = `${root}\0${indexDir}\0${partitionId ?? ""}`;
        let pending = this.codebases.get(key);
        if (!pending) {
            pending = this.openCodebase(root, indexDir, options, partitionId);
            this.codebases.set(key, pending);
            pending.catch(() => {
                if (this.codebases.get(key) === pending) {this.codebases.delete(key);}
            });
        }
        return pending;
    }

    private async openCodebase(workspacePath: string, indexDir: string, options?: IndexerOptions, partitionId?: string): Promise<CodebaseInstance> {
        await this.ensureRuntime();
        this.captureRuntimeRoot();
        const sdk = await import("@vortiqlabs/codebase-indexer/api") as CodebaseModule;
        const sdkOptions: CodebaseOptions = {
            workspacePath,
            indexDir,
            ...(partitionId ? { partitionId } : {}),
            workers: clampInteger(options?.workers, 2, 1, 16),
            ...(options?.memoryLimit !== undefined ? { memoryLimitMb: clampInteger(options.memoryLimit, 4096, 256, 65536) } : {}),
            ...(options?.profile ? { profile: options.profile } : {}),
            ...(options?.noEmbeddings !== undefined ? { noEmbeddings: options.noEmbeddings } : {}),
            ...(options?.ignore ? { patterns: options.ignore } : {}),
            ...(options?.maxFileSize ? { maxFileSize: parseByteSize(options.maxFileSize) } : {})
        };
        return sdk.createCodebase(sdkOptions);
    }

    private captureRuntimeRoot(): void {
        if (!this.runtimeRootCaptured) {
            this.previousRuntimeRoot = process.env.CODEBASE_INDEXER_RUNTIME_ROOT;
            this.runtimeRootCaptured = true;
        }
        process.env.CODEBASE_INDEXER_RUNTIME_ROOT = this.runtimeRoot;
    }

    private defaultIndexDir(): string {
        return path.join(os.homedir(), ".cache", "codebase-indexer");
    }

    private reportProgress(progress: IndexProgress | { stage: string; message: string; current?: number; total?: number }): void {
        // Keep SDK progress observable in the extension's output channel without
        // flooding the console for every parsed file.
        if (progress.current === undefined || progress.current === 1 || (progress.current % 100) === 0) {
            console.log(`[Codebase Indexer] ${progress.stage}: ${progress.message}`);
        }
    }

    private success(value: unknown): IndexerResult {
        return { stdout: JSON.stringify(value, null, 2), stderr: "", exitCode: 0 };
    }
}

function uniqueBy<T>(items: T[], keyOf: (item: T) => string): T[] {
    return [...new Map(items.map(item => [keyOf(item), item])).values()];
}

function parseGitHubRepository(value: string): { owner: string; name: string } {
    const trimmed = value.trim();
    let parts: string[];
    if (/^https?:\/\//i.test(trimmed)) {
        const url = new URL(trimmed);
        if (url.hostname.toLowerCase() !== "github.com") {throw new Error("Only github.com repository URLs are supported.");}
        parts = url.pathname.split("/").filter(Boolean);
    } else {
        parts = trimmed.split("/").filter(Boolean);
    }
    if (parts.length !== 2) {throw new Error("Repository must be owner/repository or a GitHub repository URL.");}
    const owner = parts[0]!;
    const name = parts[1]!.replace(/\.git$/i, "");
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(name)) {
        throw new Error("The GitHub repository owner or name is invalid.");
    }
    return { owner, name };
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
    if (value === undefined || !Number.isFinite(value)) {return fallback;}
    return Math.max(min, Math.min(max, Math.floor(value)));
}

function parseByteSize(value: string): number {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)?\s*$/i.exec(value);
    if (!match) {throw new Error(`Invalid maxFileSize value: ${value}`);}
    const amount = Number(match[1]);
    const unit = (match[2] ?? "b").toLowerCase();
    const multiplier = unit === "kb" || unit === "kib" ? 1024
        : unit === "mb" || unit === "mib" ? 1024 ** 2
            : unit === "gb" || unit === "gib" ? 1024 ** 3 : 1;
    const bytes = Math.floor(amount * multiplier);
    if (!Number.isSafeInteger(bytes) || bytes < 1) {throw new Error(`maxFileSize must be a positive byte size: ${value}`);}
    return bytes;
}
