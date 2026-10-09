import {
    IndexerExecutable
} from "./executable";

import {
    IndexerOptions,
    IndexerResult
} from "./types";

export class IndexerCLI {
    constructor(
        private readonly executable:
            IndexerExecutable
    ) {}

    async ensureRuntime() {
        return this.executable.getRuntimeInfo();
    }

    async stopBackground(command: "watch" | "dashboard"): Promise<IndexerResult> {
        return this.executable.stopBackground(command);
    }

    async dependencies(query: string, options?: IndexerOptions): Promise<IndexerResult> {
        return this.executable.run({ command: "deps", argument: query, options });
    }

    async dependents(query: string, options?: IndexerOptions): Promise<IndexerResult> {
        return this.executable.run({ command: "dependents", argument: query, options });
    }

    async symbolPath(from: string, to: string, options?: IndexerOptions): Promise<IndexerResult> {
        return this.executable.run({ command: "path", arguments: [from, to], options });
    }

    async repositoryMap(options?: IndexerOptions): Promise<IndexerResult> {
        return this.executable.run({ command: "map", options });
    }

    async apiEndpoints(options?: IndexerOptions): Promise<IndexerResult> {
        return this.executable.run({ command: "api", options });
    }

    async classifyQuery(query: string, options?: IndexerOptions): Promise<IndexerResult> {
        return this.executable.run({ command: "intent", argument: query, options });
    }

    async sensitiveRegions(options?: IndexerOptions): Promise<IndexerResult> {
        return this.executable.run({ command: "sensitive", options });
    }

    async index(
        path?: string,
        options?: IndexerOptions
    ): Promise<IndexerResult> {
        return this.executable.run({
            command: "index",
            argument: path,
            options
        });
    }

    async indexGithub(
        repository: string,
        options?: IndexerOptions
    ): Promise<IndexerResult> {
        return this.executable.run({
            command: "index-github",
            argument: repository,
            options
        });
    }

    async status(
        options?: IndexerOptions
    ): Promise<IndexerResult> {
        return this.executable.run({
            command: "status",
            options
        });
    }

    async search(
        query: string,
        options?: IndexerOptions
    ): Promise<IndexerResult> {
        return this.executable.run({
            command: "search",
            argument: query,
            options
        });
    }

    async symbols(
        query: string,
        options?: IndexerOptions
    ): Promise<IndexerResult> {
        return this.executable.run({
            command: "symbols",
            argument: query,
            options
        });
    }

    async references(
        query: string,
        options?: IndexerOptions
    ): Promise<IndexerResult> {
        return this.executable.run({
            command: "references",
            argument: query,
            options
        });
    }

    async callers(
        query: string,
        options?: IndexerOptions
    ): Promise<IndexerResult> {
        return this.executable.run({
            command: "callers",
            argument: query,
            options
        });
    }

    async callees(
        query: string,
        options?: IndexerOptions
    ): Promise<IndexerResult> {
        return this.executable.run({
            command: "callees",
            argument: query,
            options
        });
    }

    async files(
        options?: IndexerOptions
    ): Promise<IndexerResult> {
        return this.executable.run({
            command: "files",
            options
        });
    }

    async inspect(
        path: string,
        options?: IndexerOptions
    ): Promise<IndexerResult> {
        return this.executable.run({
            command: "inspect",
            argument: path,
            options
        });
    }

    async remove(
        path: string,
        options?: IndexerOptions
    ): Promise<IndexerResult> {
        return this.executable.run({
            command: "remove",
            argument: path,
            options
        });
    }

    async watch(
        path?: string,
        options?: IndexerOptions
    ): Promise<IndexerResult> {
        return this.executable.run({
            command: "watch",
            argument: path,
            options
        });
    }

    async dashboard(
        options?: IndexerOptions
    ): Promise<IndexerResult> {
        return this.executable.run({
            command: "dashboard",
            options
        });
    }
}