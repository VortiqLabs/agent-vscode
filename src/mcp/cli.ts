#!/usr/bin/env node
import * as path from "path";
import * as fs from "fs";
import { VortiqMcpServer } from "./server";
import { generateAuthToken } from "./auth";

async function main() {
    // Load .env file if present in working directory or repo root
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
        try {
            const content = fs.readFileSync(envPath, "utf8");
            for (const line of content.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
                    const eqIndex = trimmed.indexOf("=");
                    const key = trimmed.slice(0, eqIndex).trim();
                    const val = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
                    if (key && process.env[key] === undefined) {
                        process.env[key] = val;
                    }
                }
            }
        } catch {
            // Ignore .env read errors
        }
    }

    const host = process.env.HOST || "127.0.0.1";
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    const workspaceRoot = process.env.MCP_WORKSPACE_ROOT || process.cwd();

    let authToken = process.env.MCP_AUTH_TOKEN;
    if (!authToken) {
        authToken = generateAuthToken();
        process.env.MCP_AUTH_TOKEN = authToken;
        process.stderr.write(
            `\n============================================================\n` +
            `[NOTICE] No MCP_AUTH_TOKEN found in environment.\n` +
            `Generated temporary auth token for this session:\n\n` +
            `  MCP_AUTH_TOKEN=${authToken}\n\n` +
            `Use header 'Authorization: Bearer ${authToken}' when making requests.\n` +
            `============================================================\n\n`
        );
    }

    const server = new VortiqMcpServer({
        host,
        port,
        authToken,
        workspaceRoot
    });

    const shutdown = async (signal: string) => {
        process.stderr.write(`Received ${signal}. Shutting down MCP server...\n`);
        try {
            await server.stop();
            process.exit(0);
        } catch (err) {
            process.stderr.write(`Error during shutdown: ${err}\n`);
            process.exit(1);
        }
    };

    process.on("SIGINT", () => {
        void shutdown("SIGINT");
    });

    process.on("SIGTERM", () => {
        void shutdown("SIGTERM");
    });

    try {
        await server.start();
    } catch (error) {
        process.stderr.write(`Failed to start MCP server: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
        process.exit(1);
    }
}

void main();
