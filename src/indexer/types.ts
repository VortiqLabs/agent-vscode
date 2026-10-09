export type IndexerCommand =
    | "index"
    | "index-github"
    | "status"
    | "search"
    | "symbols"
    | "references"
    | "callers"
    | "callees"
    | "files"
    | "inspect"
    | "remove"
    | "watch"
    | "dashboard";

export interface IndexerOptions {
    indexDir?: string;
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
}

export interface IndexerRequest {
    command: IndexerCommand;
    argument?: string;
    options?: IndexerOptions;
}

export interface IndexerResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}