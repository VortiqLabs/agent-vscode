import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import { test } from "node:test";

import { Agent } from "../agent/agent";
import { AgentServer } from "../transport/server";
import { VortiqMcpServer } from "../mcp/server";
import { AgentClient } from "../mcp/agent-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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

    await t.test("3. Terminal execution and diagnostics forwarding", async () => {
        const client = mcpServer.getAgentClient();
        const terminalResult = await client.sendRequest<{
            stdout: string;
            exitCode: number;
            timedOut: boolean;
        }>("terminal.execute", {
            command: process.platform === "win32" ? "echo terminal-ok" : "printf terminal-ok"
        });
        assert.equal(terminalResult.stdout, "terminal-ok");
        assert.equal(terminalResult.exitCode, 0);
        assert.equal(terminalResult.timedOut, false);

        await assert.rejects(
            () => client.sendRequest("file.diagnostics", { path: "sample.txt" }),
            /require the VS Code extension Agent/i
        );
    });

    await t.test("4. Path traversal & workspace escape rejection in Agent", async () => {
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

    await t.test("5. Invalid authentication to Agent Server", async () => {
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

    await t.test("6. Disconnected / Unavailable extension Agent handling", async () => {
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

    await t.test("7. Agent error propagation to MCP responses", async () => {
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

    await t.test("8. Indexer removal requires confirmation and stays inside the workspace", async () => {
        const client = mcpServer.getAgentClient();
        await assert.rejects(
            () => client.sendRequest("indexer.remove", { path: ".", confirm: false }),
            /Index removal is destructive/i
        );
        await assert.rejects(
            () => client.sendRequest("indexer.remove", { path: "../outside", confirm: true }),
            /outside the active workspace/i
        );
    });

    await t.test("9. MCP workspace tool forwards through the running extension agent", async () => {
        const client = new Client({ name: "integration-client", version: "1.0.0" });
        const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`));
        try {
            await client.connect(transport);
            const listedTools = await client.listTools();
            const advertisedNames = new Set(listedTools.tools.map(tool => tool.name));
            for (const name of [
                "indexer_install",
                "indexer_index_github",
                "indexer_context",
                "indexer_chunks",
                "indexer_dependencies",
                "indexer_dependents",
                "indexer_symbol_path",
                "indexer_repository_map",
                "indexer_api_endpoints",
                "indexer_classify_query",
                "indexer_sensitive_regions",
                "indexer_watch",
                "indexer_stop_watch",
                "indexer_dashboard",
                "indexer_stop_dashboard",
                "indexer_inspect",
                "indexer_remove"
            ]) {
                assert.ok(advertisedNames.has(name), `Expected MCP tool ${name} to be advertised`);
            }
            const result = await client.callTool({ name: "workspace_info", arguments: {} });
            assert.equal(result.isError, undefined);
            const content = (result as { content: Array<{ text?: string }> }).content;
            assert.match(String(content[0]?.text), /workspace|name/i);
        } finally {
            await transport.close().catch(() => undefined);
        }
    });
});
