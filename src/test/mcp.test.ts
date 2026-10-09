import test from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import * as fs from "fs";

import { validateAuthToken, validateOrigin } from "../mcp/auth";
import { SafeWorkspace } from "../mcp/workspace";
import { getRuntimePlatform } from "../indexer/runtime/platform";
import { ARTIFACTS, INDEXER_VERSION, IndexerRuntimeManager } from "../indexer/runtime/manager";
import { VortiqMcpServer } from "../mcp/server";

const TEST_WORKSPACE = path.resolve(__dirname, "test_workspace_fixture");

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

test("Authentication - validateAuthToken and timing safety", () => {
    const secret = "my_secret_token_1234567890_abcdef";
    assert.equal(validateAuthToken(secret, secret), true);
    assert.equal(validateAuthToken("wrong_token", secret), false);
    assert.equal(validateAuthToken("", secret), false);
});

test("Authentication - validateOrigin checks", () => {
    assert.equal(validateOrigin("http://localhost:3000"), true);
    assert.equal(validateOrigin("http://127.0.0.1:3000"), true);
    assert.equal(validateOrigin("https://my-codespace.app.github.dev"), true);
    assert.equal(validateOrigin("https://evil.com"), false);
});

test("Workspace Safety - SafeWorkspace path resolution and traversal rejection", () => {
    setupFixture();
    try {
        const workspace = new SafeWorkspace(TEST_WORKSPACE);

        // Valid relative path
        const resolved = workspace.resolveSafePath("hello.txt");
        assert.equal(resolved, path.join(TEST_WORKSPACE, "hello.txt"));

        // Reject path traversal
        assert.throws(() => {
            workspace.resolveSafePath("../secret.txt");
        }, /traversal|outside/i);

        // Reject absolute path
        assert.throws(() => {
            workspace.resolveSafePath("/etc/passwd");
        }, /absolute/i);
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
        assert.ok(result.files.some(f => f.relativePath === "hello.txt"));
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
    assert.ok(artifact.sha256.length === 64);

    const manager = new IndexerRuntimeManager(TEST_WORKSPACE);

    setupFixture();
    try {
        const dummyFile = path.join(TEST_WORKSPACE, "hello.txt");
        const crypto = await import("crypto");
        const content = fs.readFileSync(dummyFile);
        const actualHash = crypto.createHash("sha256").update(content).digest("hex");

        await manager.verifyChecksum(dummyFile, actualHash);

        await assert.rejects(async () => {
            await manager.verifyChecksum(dummyFile, "0000000000000000000000000000000000000000000000000000000000000000");
        }, /verification failed/i);
    } finally {
        teardownFixture();
    }
});

test("MCP Server - HTTP server startup, health check, and auth protection", async () => {
    setupFixture();
    const port = 43129;
    const authToken = "test_secret_auth_token_value_999";

    const server = new VortiqMcpServer({
        host: "127.0.0.1",
        port,
        authToken,
        workspaceRoot: TEST_WORKSPACE
    });

    try {
        await server.start();

        // 1. Check health endpoint (unauthenticated)
        const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
        assert.equal(healthRes.status, 200);
        const healthData = await healthRes.json() as { status: string };
        assert.equal(healthData.status, "ok");

        // 2. Check /mcp without token (should be rejected 401)
        const unauthRes = await fetch(`http://127.0.0.1:${port}/mcp`);
        assert.equal(unauthRes.status, 401);

        // 3. Check /mcp with invalid token (should be rejected 401)
        const badTokenRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
            headers: { Authorization: "Bearer wrong_token" }
        });
        assert.equal(badTokenRes.status, 401);

        // 4. Check /mcp with valid token
        const validRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        assert.notEqual(validRes.status, 401);
    } finally {
        await server.stop();
        teardownFixture();
    }
});
