export type AgentToolName =
    | "workspace.get"
    | "workspace.list_files"
    | "file.read"
    | "file.write"
    | "file.replace_range"
    | "git.status"
    | "git.diff"
    | "git.apply_patch"
    | "indexer.index"
    | "indexer.index_github"
    | "indexer.status"
    | "indexer.search"
    | "indexer.symbols"
    | "indexer.references"
    | "indexer.callers"
    | "indexer.callees"
    | "indexer.files"
    | "indexer.inspect"
    | "indexer.remove"
    | "indexer.watch"
    | "indexer.dashboard";

export interface AgentRequest {
    id: string;
    tool: AgentToolName;
    arguments: Record<string, unknown>;
}

export interface AgentSuccessResponse {
    id: string;
    success: true;
    result: unknown;
}

export interface AgentErrorResponse {
    id: string;
    success: false;
    error: {
        code: string;
        message: string;
    };
}

export type AgentResponse =
    | AgentSuccessResponse
    | AgentErrorResponse;