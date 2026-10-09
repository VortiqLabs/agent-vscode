import { AgentRequest, AgentResponse, AgentToolName } from "../agent/types";
import { randomUUID } from "crypto";

export interface AgentClientOptions {
    baseUrl?: string;
    authToken?: string;
}

export class AgentClient {
    private readonly baseUrl: string;
    private readonly authToken?: string;

    constructor(options: AgentClientOptions = {}) {
        const rawUrl = options.baseUrl || process.env.VORTIQLABS_AGENT_URL || "http://127.0.0.1:43127";
        this.baseUrl = rawUrl.replace(/\/+$/, "");
        this.authToken =
            options.authToken ||
            process.env.VORTIQLABS_AGENT_AUTH_TOKEN ||
            process.env.MCP_AUTH_TOKEN;
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }

    async sendRequest<T = unknown>(tool: AgentToolName, args: Record<string, unknown> = {}): Promise<T> {
        const requestId = "mcp-req-" + randomUUID();
        const requestPayload: AgentRequest = {
            id: requestId,
            tool,
            arguments: args
        };

        const targetUrl = `${this.baseUrl}/agent`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json"
        };

        const token =
            this.authToken ||
            process.env.VORTIQLABS_AGENT_AUTH_TOKEN ||
            process.env.MCP_AUTH_TOKEN;

        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        let response: Response;
        try {
            response = await fetch(targetUrl, {
                method: "POST",
                headers,
                body: JSON.stringify(requestPayload)
            });
        } catch (error) {
            throw new Error(
                `Failed to connect to VS Code extension Agent API at ${this.baseUrl}. ` +
                `Ensure the VortiqLabs Agent VS Code extension is installed, active, and running. ` +
                `Details: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        let bodyText: string;
        try {
            bodyText = await response.text();
        } catch {
            bodyText = "";
        }

        let responseData: AgentResponse | null = null;
        if (bodyText) {
            try {
                responseData = JSON.parse(bodyText) as AgentResponse;
            } catch {
                responseData = null;
            }
        }

        if (!response.ok) {
            if (response.status === 401) {
                const msg =
                    responseData && !responseData.success
                        ? responseData.error.message
                        : "Unauthorized: Invalid or missing token for VS Code Agent API.";
                throw new Error(`VS Code extension Agent API authentication failed: ${msg}`);
            }

            if (responseData && !responseData.success) {
                throw new Error(responseData.error.message);
            }

            throw new Error(
                `VS Code extension Agent API error (status ${response.status}): ${bodyText || response.statusText}`
            );
        }

        if (!responseData) {
            throw new Error("Invalid response received from VS Code extension Agent API.");
        }

        if (!responseData.success) {
            throw new Error(responseData.error.message);
        }

        return responseData.result as T;
    }
}
