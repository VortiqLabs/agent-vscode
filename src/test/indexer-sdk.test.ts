import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { IndexerService, CODEBASE_INDEXER_SDK_VERSION } from "../indexer/indexer";
import { IndexerRuntimeManager } from "../indexer/runtime/manager";

const RUNTIME_ROOT = path.resolve(__dirname, "../../dist/indexer-runtime");

test("Codebase Indexer SDK adapter indexes and queries a real workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vortiqlabs-indexer-sdk-"));
    const indexDir = path.join(root, ".index-data");
    const sourceDir = path.join(root, "src");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, "auth.ts"), [
        "export class AuthService {",
        "  authenticate(token: string): boolean { return this.validateToken(token); }",
        "  private validateToken(token: string): boolean { return token.length > 10; }",
        "}",
        "export function createSession(token: string) { return new AuthService().authenticate(token); }"
    ].join("\n"), "utf8");

    const indexer = new IndexerService(new IndexerRuntimeManager(root), root, RUNTIME_ROOT);
    try {
        const runtime = await indexer.ensureRuntime();
        assert.equal(runtime.version, CODEBASE_INDEXER_SDK_VERSION);

        const indexed = JSON.parse((await indexer.index(undefined, {
            indexDir,
            noEmbeddings: true,
            workers: 1
        })).stdout) as { added: number; counts: { files: number; symbols: number; chunks: number } };
        assert.ok(indexed.added >= 1);
        assert.ok(indexed.counts.files >= 1);
        assert.ok(indexed.counts.symbols >= 2);
        assert.ok(indexed.counts.chunks >= 2);

        const symbols = JSON.parse((await indexer.symbols("AuthService", { indexDir })).stdout) as Array<{ name: string }>;
        assert.ok(symbols.some(symbol => symbol.name === "AuthService"));

        const search = JSON.parse((await indexer.search("validate authentication token", { indexDir })).stdout) as { results: Array<{ file: { path: string } }> };
        assert.ok(search.results.some(result => result.file.path === "src/auth.ts"));

        const chunks = JSON.parse((await indexer.chunks({ indexDir, query: "validateToken", limit: 10 })).stdout) as Array<{ filePath: string; text: string }>;
        assert.ok(chunks.some(chunk => chunk.filePath === "src/auth.ts" && chunk.text.includes("validateToken")));

        const context = JSON.parse((await indexer.context("Where is validateToken authentication implemented?", { indexDir, maxFiles: 4, maxTokens: 2000 })).stdout) as { files?: Array<{ path: string }> };
        assert.ok(JSON.stringify(context).includes("auth.ts"));

        const status = JSON.parse((await indexer.status({ indexDir })).stdout) as { indexed: boolean; fileCount: number };
        assert.equal(status.indexed, true);
        assert.ok(status.fileCount >= 1);
    } finally {
        await indexer.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});
