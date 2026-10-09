export type AgentToolName =
    | "workspace.get"
    | "workspace.list_files"
    | "workspace.find_todos"
    | "terminal.execute"
    | "file.diagnostics"
    | "file.read"
    | "file.write"
    | "file.replace_range"
    | "git.status"
    | "git.diff"
    | "git.apply_patch"
    | "indexer.install"
    | "indexer.index"
    | "indexer.index_github"
    | "indexer.status"
    | "indexer.search"
    | "indexer.symbols"
    | "indexer.references"
    | "indexer.callers"
    | "indexer.callees"
    | "indexer.dependencies"
    | "indexer.dependents"
    | "indexer.path"
    | "indexer.files"
    | "indexer.repository_map"
    | "indexer.api_endpoints"
    | "indexer.classify_query"
    | "indexer.sensitive_regions"
    | "indexer.inspect"
    | "indexer.remove"
    | "indexer.watch"
    | "indexer.stop_watch"
    | "indexer.dashboard"
    | "indexer.stop_dashboard";

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