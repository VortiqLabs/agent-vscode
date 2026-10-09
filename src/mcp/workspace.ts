import * as path from "path";
import * as fs from "fs";

export interface FileEntry {
    relativePath: string;
    type: "file" | "directory" | "symlink" | "other";
    size: number;
    mtime: string;
}

export interface ListFilesOptions {
    dirPath?: string;
    recursive?: boolean;
    maxDepth?: number;
    maxResults?: number;
    ignorePatterns?: string[];
}

export interface ListFilesResult {
    dirPath: string;
    files: FileEntry[];
    totalCount: number;
    truncated: boolean;
}

export class SafeWorkspace {
    private readonly rootPath: string;

    constructor(explicitRoot?: string) {
        const rootCandidate =
            explicitRoot ||
            process.env.MCP_WORKSPACE_ROOT ||
            process.cwd();

        this.rootPath = path.resolve(rootCandidate);
    }

    getRootPath(): string {
        return this.rootPath;
    }

    getCanonicalRoot(): string {
        try {
            return fs.realpathSync(this.rootPath);
        } catch {
            return this.rootPath;
        }
    }

    resolveSafePath(relativePath: string): string {
        if (!relativePath || relativePath.trim() === "") {
            return this.rootPath;
        }

        const normalized = relativePath.replace(/\\/g, "/");

        // Reject absolute paths
        if (path.isAbsolute(normalized) || /^[a-zA-Z]:[\\/]/.test(normalized)) {
            throw new Error(`Absolute paths are not allowed: ${relativePath}`);
        }

        // Reject path traversal tokens
        if (
            normalized === ".." ||
            normalized.startsWith("../") ||
            normalized.includes("/../")
        ) {
            throw new Error(`Path traversal attempt detected: ${relativePath}`);
        }

        const resolved = path.resolve(this.rootPath, normalized);
        const canonicalRoot = this.getCanonicalRoot();

        let canonicalResolved: string;
        try {
            canonicalResolved = fs.realpathSync(resolved);
        } catch {
            canonicalResolved = resolved;
        }

        const relative = path.relative(canonicalRoot, canonicalResolved);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error(`Access denied: Path resolves outside authorized workspace root.`);
        }

        return resolved;
    }

    async listFiles(options: ListFilesOptions = {}): Promise<ListFilesResult> {
        const targetRelative = options.dirPath || ".";
        const targetFull = this.resolveSafePath(targetRelative);

        const maxDepth = options.maxDepth ?? 10;
        const maxResults = options.maxResults ?? 1000;
        const recursive = options.recursive ?? true;

        const stat = await fs.promises.stat(targetFull);
        if (!stat.isDirectory()) {
            throw new Error(`Path is not a directory: ${targetRelative}`);
        }

        const files: FileEntry[] = [];
        let truncated = false;

        const defaultIgnored = new Set([
            ".git",
            "node_modules",
            "dist",
            "out",
            "build",
            ".vscode",
            ".DS_Store"
        ]);

        const scan = async (currentDir: string, currentDepth: number) => {
            if (currentDepth > maxDepth || files.length >= maxResults) {
                if (files.length >= maxResults) {
                    truncated = true;
                }
                return;
            }

            let entries: fs.Dirent[];
            try {
                entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
            } catch {
                return;
            }

            for (const entry of entries) {
                if (files.length >= maxResults) {
                    truncated = true;
                    break;
                }

                if (defaultIgnored.has(entry.name)) {
                    continue;
                }

                const entryFull = path.join(currentDir, entry.name);
                let entryRelative = path.relative(this.rootPath, entryFull).replace(/\\/g, "/");

                let entryType: "file" | "directory" | "symlink" | "other" = "other";
                let size = 0;
                let mtime = "";

                try {
                    const entryStat = await fs.promises.lstat(entryFull);
                    if (entryStat.isSymbolicLink()) {
                        entryType = "symlink";
                        // Verify symlink target stays within workspace
                        try {
                            this.resolveSafePath(entryRelative);
                        } catch {
                            // Symlink target escapes workspace - skip it
                            continue;
                        }
                    } else if (entryStat.isDirectory()) {
                        entryType = "directory";
                    } else if (entryStat.isFile()) {
                        entryType = "file";
                        size = entryStat.size;
                    }
                    mtime = entryStat.mtime.toISOString();
                } catch {
                    continue;
                }

                files.push({
                    relativePath: entryRelative,
                    type: entryType,
                    size,
                    mtime
                });

                if (entryType === "directory" && recursive) {
                    await scan(entryFull, currentDepth + 1);
                }
            }
        };

        await scan(targetFull, 1);

        return {
            dirPath: targetRelative,
            files,
            totalCount: files.length,
            truncated
        };
    }
}
