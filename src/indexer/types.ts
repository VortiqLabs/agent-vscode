export type IndexerCommand =
    | "index"
    | "index-github"
    | "status"
    | "search"
    | "symbols"
    | "references"
    | "callers"
    | "callees"
    | "deps"
    | "dependents"
    | "path"
    | "map"
    | "api"
    | "apis"
    | "intent"
    | "sensitive"
    | "files"
    | "inspect"
    | "remove"
    | "watch"
    | "dashboard";

export interface IndexerOptions {
    indexDir?: string;
    workspacePath?: string;
    force?: boolean;
    json?: boolean;
    maxFileSize?: string;
    ignore?: string[];
    host?: string;
    port?: number;
    ref?: string;
    workers?: number;
    memoryLimit?: number;
    profile?: "default" | "large";
    noEmbeddings?: boolean;
    verboseMemory?: boolean;
    language?: string;
    pattern?: string;
    limit?: number;
    depth?: number;
    maxDepth?: number;
    maxNodes?: number;
    lexical?: boolean;
    semantic?: boolean;
}

export interface IndexerRequest {
    command: IndexerCommand;
    argument?: string;
    arguments?: string[];
    options?: IndexerOptions;
}

export interface IndexerResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    running?: boolean;
    pid?: number;
    url?: string;
}