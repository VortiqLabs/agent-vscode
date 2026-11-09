import test from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import * as fs from "fs";

import { SafeWorkspace } from "../mcp/workspace";
import { getRuntimePlatform } from "../indexer/runtime/platform";
import { ARTIFACTS, INDEXER_VERSION, IndexerRuntimeManager } from "../indexer/runtime/manager";
import { VortiqMcpServer } from "../mcp/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const TEST_WORKSPACE = path.resolve(__dirname, "test_workspace_fixture_mcp");

function setupFixture() {
    if (!fs.existsSync(TEST_WORKSPACE)) {
        fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
    }
    fs.writeFileSync(path.join(TEST_WORKSPACE, "hello.txt"), "Hello, VortiqLabs Agent!", "utf8");
    fs.writeFileSync(path.join(TEST_WORKSPACE, "large.txt"), Buffer.alloc(11 * 1024 * 1024, "a"));
}

function teardownFixture() {
    if (fs.existsSync(TEST_WORKSPACE)) {
        fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    }
}

test("Workspace Safety - SafeWorkspace path resolution and traversal rejection", () => {
    setupFixture();
    try {
        const workspace = new SafeWorkspace(TEST_WORKSPACE);
        assert.equal(workspace.resolveSafePath("hello.txt"), path.join(TEST_WORKSPACE, "hello.txt"));
        assert.throws(() => workspace.resolveSafePath("../secret.txt"), /traversal|outside/i);
        assert.throws(() => workspace.resolveSafePath("/etc/passwd"), /absolute/i);
    } finally {
        teardownFixture();
    }
});

test("Workspace Safety - File listing caps and filters", async () => {
    setupFixture();
    try {
        const workspace = new SafeWorkspace(TEST_WORKSPACE);
        const result = await workspace.listFiles({ maxResults: 10 });
        assert.ok(result.files.length > 0);
        assert.ok(result.files.some(file => file.relativePath === "hello.txt"));
    } finally {
        teardownFixture();
    }
});

test("Codebase Indexer Runtime - Platform mapping & checksum verification", async () => {
    const platform = getRuntimePlatform();
    assert.ok(platform);
    const artifact = ARTIFACTS[platform];
    assert.ok(artifact);
    assert.equal(INDEXER_VERSION, "0.1.7");
    assert.ok(artifact.url.includes("v0.1.7"));
    assert.equal(artifact.sha256.length, 64);

    setupFixture();
    try {
        const manager = new IndexerRuntimeManager(TEST_WORKSPACE);
        const dummyFile = path.join(TEST_WORKSPACE, "hello.txt");
        const crypto = await import("crypto");
        const content = fs.readFileSync(dummyFile);
        const actualHash = crypto.createHash("sha256").update(content).digest("hex");
        await manager.verifyChecksum(dummyFile, actualHash);
        await assert.rejects(
            () => manager.verifyChecksum(dummyFile, "0000000000000000000000000000000000000000000000000000000000000000"),
            /verification failed/i
        );
    } finally {
        teardownFixture();
    }
});

test("MCP Server - HTTP server startup, health check, and unauthenticated access", async () => {
    setupFixture();
    const server = new VortiqMcpServer({ host: "127.0.0.1", port: 43129, workspaceRoot: TEST_WORKSPACE });
    try {
        await server.start();
        const healthRes = await fetch("http://127.0.0.1:43129/health");
        assert.equal(healthRes.status, 200);
        assert.equal((await healthRes.json() as { status: string }).status, "ok");
        const unauthenticatedRes = await fetch("http://127.0.0.1:43129/mcp");
        assert.notEqual(unauthenticatedRes.status, 401);
    } finally {
        await server.stop();
        teardownFixture();
    }
});

test("MCP Server - official Streamable HTTP client initialization, discovery, and sessions", async () => {
    const server = new VortiqMcpServer({ host: "127.0.0.1", port: 43134 });
    const transports: StreamableHTTPClientTransport[] = [];
    try {
        await server.start();
        for (const name of ["client-one", "client-two"]) {
            const client = new Client({ name, version: "1.0.0" });
            const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:43134/mcp"));
            transports.push(transport);
            await client.connect(transport);
            assert.equal(transport.protocolVersion, "2025-11-25");
            const tools = await client.listTools();
            assert.ok(tools.tools.length >= 18);
            assert.ok(tools.tools.every(tool => tool.name && tool.inputSchema));
            for (const expected of ["editor_context", "editor_diagnostics", "editor_symbols", "workspace_search", "browser_open_url"]) {
                assert.ok(tools.tools.some(tool => tool.name === expected), `missing MCP tool: ${expected}`);
            }
            const ping = await client.callTool({ name: "ping", arguments: {} });
            assert.equal(ping.isError, undefined);
            const content = (ping as { content: Array<{ text?: string }> }).content;
            assert.match(String(content[0]?.text), /"status": "ok"/);
        }
    } finally {
        await Promise.all(transports.map(transport => transport.close().catch(() => undefined)));
        await server.stop();
    }
});

test("MCP Server - accepts unauthenticated requests and rejects malformed requests", async () => {
    const server = new VortiqMcpServer({ host: "127.0.0.1", port: 43135 });
    try {
        await server.start();
        const missingAuth = await fetch("http://127.0.0.1:43135/mcp", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
            body: "{}"
        });
        assert.equal(missingAuth.status, 400);
        assert.match(await missingAuth.text(), /Invalid JSON-RPC message/i);

        const invalidJson = await fetch("http://127.0.0.1:43135/mcp", {
            method: "POST",
            headers: {
                Authorization: "Bearer mcp-test-token",
                "Content-Type": "application/json",
                Accept: "application/json, text/event-stream"
            },
            body: "{"
        });
        assert.equal(invalidJson.status, 400);
        assert.match(await invalidJson.text(), /Parse error|Invalid JSON/i);

        const unsupported = await fetch("http://127.0.0.1:43135/mcp", {
            method: "PUT",
            headers: { Authorization: "Bearer mcp-test-token" }
        });
        assert.equal(unsupported.status, 405);
    } finally {
        await server.stop();
    }
});

test("MCP Server - negotiates an older supported protocol version", async () => {
    const server = new VortiqMcpServer({ host: "127.0.0.1", port: 43136 });
    try {
        await server.start();
        const response = await fetch("http://127.0.0.1:43136/mcp", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json, text/event-stream",
                "MCP-Protocol-Version": "2025-03-26"
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                    protocolVersion: "2025-03-26",
                    capabilities: {},
                    clientInfo: { name: "protocol-test", version: "1.0.0" }
                }
            })
        });
        assert.equal(response.status, 200);
        const body = await response.text();
        const data = body.match(/^data: (.+)$/m)?.[1];
        assert.ok(data);
        assert.equal((JSON.parse(data) as { result: { protocolVersion: string } }).result.protocolVersion, "2025-03-26");
        assert.ok(response.headers.get("mcp-session-id"));
    } finally {
        await server.stop();
    }
});
