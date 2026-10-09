"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const auth_1 = require("../src/mcp/auth");
const workspace_1 = require("../src/mcp/workspace");
const platform_1 = require("../src/indexer/runtime/platform");
const manager_1 = require("../src/indexer/runtime/manager");
const server_1 = require("../src/mcp/server");
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
(0, node_test_1.default)("Authentication - validateAuthToken and timing safety", () => {
    const secret = "my_secret_token_1234567890_abcdef";
    strict_1.default.equal((0, auth_1.validateAuthToken)(secret, secret), true);
    strict_1.default.equal((0, auth_1.validateAuthToken)("wrong_token", secret), false);
    strict_1.default.equal((0, auth_1.validateAuthToken)("", secret), false);
});
(0, node_test_1.default)("Authentication - validateOrigin checks", () => {
    strict_1.default.equal((0, auth_1.validateOrigin)("http://localhost:3000"), true);
    strict_1.default.equal((0, auth_1.validateOrigin)("http://127.0.0.1:3000"), true);
    strict_1.default.equal((0, auth_1.validateOrigin)("https://my-codespace.app.github.dev"), true);
    strict_1.default.equal((0, auth_1.validateOrigin)("https://evil.com"), false);
});
(0, node_test_1.default)("Workspace Safety - SafeWorkspace path resolution and traversal rejection", () => {
    setupFixture();
    try {
        const workspace = new workspace_1.SafeWorkspace(TEST_WORKSPACE);
        // Valid relative path
        const resolved = workspace.resolveSafePath("hello.txt");
        strict_1.default.equal(resolved, path.join(TEST_WORKSPACE, "hello.txt"));
        // Reject path traversal
        strict_1.default.throws(() => {
            workspace.resolveSafePath("../secret.txt");
        }, /traversal|outside/i);
        // Reject absolute path
        strict_1.default.throws(() => {
            workspace.resolveSafePath("/etc/passwd");
        }, /absolute/i);
    }
    finally {
        teardownFixture();
    }
});
(0, node_test_1.default)("Workspace Safety - File listing caps and filters", async () => {
    setupFixture();
    try {
        const workspace = new workspace_1.SafeWorkspace(TEST_WORKSPACE);
        const result = await workspace.listFiles({ maxResults: 10 });
        strict_1.default.ok(result.files.length > 0);
        strict_1.default.ok(result.files.some(f => f.relativePath === "hello.txt"));
    }
    finally {
        teardownFixture();
    }
});
(0, node_test_1.default)("Codebase Indexer Runtime - Platform mapping & checksum verification", async () => {
    const platform = (0, platform_1.getRuntimePlatform)();
    strict_1.default.ok(platform);
    const artifact = manager_1.ARTIFACTS[platform];
    strict_1.default.ok(artifact);
    strict_1.default.equal(manager_1.INDEXER_VERSION, "0.1.7");
    strict_1.default.ok(artifact.url.includes("v0.1.7"));
    strict_1.default.ok(artifact.sha256.length === 64);
    const manager = new manager_1.IndexerRuntimeManager(TEST_WORKSPACE);
    // Create a dummy file and test verifyChecksum with expected hash
    setupFixture();
    try {
        const dummyFile = path.join(TEST_WORKSPACE, "hello.txt");
        // SHA-256 for "Hello, VortiqLabs Agent!" is 23ecf3b1458e0a16ed7beeead8ee6b4f7a77e38c92a95f9c968e7d23d537d9cf
        const crypto = await import("crypto");
        const content = fs.readFileSync(dummyFile);
        const actualHash = crypto.createHash("sha256").update(content).digest("hex");
        await manager.verifyChecksum(dummyFile, actualHash);
        await strict_1.default.rejects(async () => {
            await manager.verifyChecksum(dummyFile, "0000000000000000000000000000000000000000000000000000000000000000");
        }, /verification failed/i);
    }
    finally {
        teardownFixture();
    }
});
(0, node_test_1.default)("MCP Server - HTTP server startup, health check, and auth protection", async () => {
    setupFixture();
    const port = 43128;
    const authToken = "test_secret_auth_token_value_999";
    const server = new server_1.VortiqMcpServer({
        host: "127.0.0.1",
        port,
        authToken,
        workspaceRoot: TEST_WORKSPACE
    });
    try {
        await server.start();
        // 1. Check health endpoint (unauthenticated)
        const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
        strict_1.default.equal(healthRes.status, 200);
        const healthData = await healthRes.json();
        strict_1.default.equal(healthData.status, "ok");
        // 2. Check /mcp without token (should be rejected 401)
        const unauthRes = await fetch(`http://127.0.0.1:${port}/mcp`);
        strict_1.default.equal(unauthRes.status, 401);
        // 3. Check /mcp with invalid token (should be rejected 401)
        const badTokenRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
            headers: { Authorization: "Bearer wrong_token" }
        });
        strict_1.default.equal(badTokenRes.status, 401);
        // 4. Check /mcp with valid token
        const validRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        // Valid bearer token is accepted by auth handler (GET returns 200 or 400 depending on transport message body)
        strict_1.default.notEqual(validRes.status, 401);
    }
    finally {
        await server.stop();
        teardownFixture();
    }
});
//# sourceMappingURL=mcp.test.js.map