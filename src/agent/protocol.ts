import {
    AgentRequest,
    AgentToolName
} from "./types";

const VALID_TOOLS: readonly AgentToolName[] = [
    "workspace.get",
    "workspace.list_files",
    "file.read",
    "file.write",
    "file.replace_range",
    "git.status",
    "git.diff",
    "git.apply_patch",
    "indexer.index",
    "indexer.index_github",
    "indexer.status",
    "indexer.search",
    "indexer.symbols",
    "indexer.references",
    "indexer.callers",
    "indexer.callees",
    "indexer.files",
    "indexer.inspect",
    "indexer.remove",
    "indexer.watch",
    "indexer.dashboard"
];

export function parseAgentRequest(
    input: unknown
): AgentRequest {
    if (
        typeof input !== "object" ||
        input === null
    ) {
        throw new Error(
            "Agent request must be an object."
        );
    }

    const request =
        input as Record<string, unknown>;

    if (
        typeof request.id !== "string" ||
        request.id.length === 0
    ) {
        throw new Error(
            "Agent request requires a valid id."
        );
    }

    if (
        typeof request.tool !== "string" ||
        !VALID_TOOLS.includes(
            request.tool as AgentToolName
        )
    ) {
        throw new Error(
            `Unknown agent tool: ${String(request.tool)}`
        );
    }

    if (
        typeof request.arguments !== "object" ||
        request.arguments === null ||
        Array.isArray(request.arguments)
    ) {
        throw new Error(
            "Agent request arguments must be an object."
        );
    }

    return {
        id: request.id,
        tool:
            request.tool as AgentToolName,
        arguments:
            request.arguments as Record<string, unknown>
    };
}