import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import { test } from "node:test";

import { Agent } from "../agent/agent";
import { AgentServer } from "../transport/server";
import { VortiqMcpServer } from "../mcp/server";
import { AgentClient } from "../mcp/agent-client";

const TEST_WORKSPACE = path.resolve(__dirname, "test_workspace_fixture");

function ensureFixtureDir(): void {
    if (!fs.existsSync(TEST_WORKSPACE)) {
        fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
    }
}

test("Integration - Full MCP to Agent forwarding, operations, security & edge cases", async (t) => {
    ensureFixtureDir();
    const token = "test-secret-token-1234567890";
    const agentPort = 43130;
    const mcpPort = 43131;

    // Create Agent & AgentServer
    const agent = new Agent(undefined, TEST_WORKSPACE);
    const agentServer = new AgentServer(agent, {
        host: "127.0.0.1",
        port: agentPort,
        authToken: token
    });

    await agentServer.start();

    // Create MCP Server pointing to AgentServer
    const mcpServer = new VortiqMcpServer({
        host: "127.0.0.1",
        port: mcpPort,
        authToken: token,
        workspaceRoot: TEST_WORKSPACE,
        agentUrl: `http://127.0.0.1:${agentPort}`,
        agentAuthToken: token
    });

    await mcpServer.start();

    t.after(async () => {
        await mcpServer.stop();
        await agentServer.stop();
    });

    await t.test("1. Forwarding - workspace_info through Agent Client", async () => {
        const client = mcpServer.getAgentClient();
        const info = await client.sendRequest<{ name: string }>("workspace.get");
        assert.ok(info);
        assert.ok(info.name);
    });

    await t.test("2. File operations - write_file, read_file, edit_file through Agent Client", async () => {
        const client = mcpServer.getAgentClient();
        const testFile = "sample.txt";

        // Write
        const writeResult = await client.sendRequest<{ path: string; size: number }>("file.write", {
            path: testFile,
            content: "Line 1\nLine 2\nLine 3"
        });
        assert.strictEqual(writeResult.path, testFile);

        // Read
        const readResult = await client.sendRequest<{ path: string; content: string }>("file.read", {
            path: testFile
        });
        assert.strictEqual(readResult.content, "Line 1\nLine 2\nLine 3");

        // Edit
        const editResult = await client.sendRequest<{ path: string }>("file.replace_range", {
            path: testFile,
            startLine: 2,
            endLine: 2,
            content: "Line 2 Updated"
        });
        assert.strictEqual(editResult.path, testFile);

        // Read again
        const readUpdated = await client.sendRequest<{ path: string; content: string }>("file.read", {
            path: testFile
        });
        assert.strictEqual(readUpdated.content, "Line 1\nLine 2 Updated\nLine 3");
    });

    await t.test("3. Path traversal & workspace escape rejection in Agent", async () => {
        const client = mcpServer.getAgentClient();

        await assert.rejects(
            async () => {
                await client.sendRequest("file.read", { path: "../outside.txt" });
            },
            (err: Error) => {
                return err.message.includes("outside the active workspace") || err.message.includes("traversal");
            }
        );
    });

    await t.test("4. Invalid authentication to Agent Server", async () => {
        const badClient = new AgentClient({
            baseUrl: `http://127.0.0.1:${agentPort}`,
            authToken: "invalid-wrong-token"
        });

        await assert.rejects(
            async () => {
                await badClient.sendRequest("workspace.get");
            },
            (err: Error) => {
                return err.message.includes("authentication failed") || err.message.includes("Unauthorized");
            }
        );
    });

    await t.test("5. Disconnected / Unavailable extension Agent handling", async () => {
        const unreachableClient = new AgentClient({
            baseUrl: "http://127.0.0.1:59999",
            authToken: token
        });

        await assert.rejects(
            async () => {
                await unreachableClient.sendRequest("workspace.get");
            },
            (err: Error) => {
                return err.message.includes("Ensure the VortiqLabs Agent VS Code extension is installed, active, and running");
            }
        );
    });

    await t.test("6. Agent error propagation to MCP responses", async () => {
        const client = mcpServer.getAgentClient();

        await assert.rejects(
            async () => {
                await client.sendRequest("file.read", { path: "nonexistent_file_12345.txt" });
            },
            (err: Error) => {
                return err.message.length > 0;
            }
        );
    });
});
