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
        query?: string,
        options?: IndexerOptions
    ): Promise<IndexerResult> {
        return this.executable.run({
            command: "files",
            argument: query,
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