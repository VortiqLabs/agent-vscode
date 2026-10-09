import * as http from "http";

import {
    Agent
} from "../agent/agent";

import {
    parseAgentRequest
} from "../agent/protocol";

import {
    AgentResponse
} from "../agent/types";

import {
    HealthResponse
} from "./types";

import {
    validateAuthToken
} from "../mcp/auth";

export interface AgentServerOptions {
    host?: string;
    port?: number;
    authToken?: string;
}

export class AgentServer {
    private readonly host: string;
    private readonly port: number;
    private readonly authToken?: string;

    private server: http.Server | null = null;

    constructor(
        private readonly agent: Agent,
        options: AgentServerOptions = {}
    ) {
        this.host =
            options.host ??
            "127.0.0.1";

        this.port =
            options.port ??
            43127;

        this.authToken =
            options.authToken ??
            process.env.VORTIQLABS_AGENT_AUTH_TOKEN ??
            process.env.MCP_AUTH_TOKEN;
    }

    async start(): Promise<void> {
        if (this.server) {
            return;
        }

        const server =
            http.createServer(
                async (request, response) => {
                    await this.handleRequest(
                        request,
                        response
                    );
                }
            );

        this.server = server;

        await new Promise<void>(
            (resolve, reject) => {
                const onError =
                    (error: Error) => {
                        server.removeListener(
                            "listening",
                            onListening
                        );

                        reject(error);
                    };

                const onListening =
                    () => {
                        server.removeListener(
                            "error",
                            onError
                        );

                        resolve();
                    };

                server.once(
                    "error",
                    onError
                );

                server.once(
                    "listening",
                    onListening
                );

                server.listen(
                    this.port,
                    this.host
                );
            }
        );
    }

    async stop(): Promise<void> {
        const server =
            this.server;

        if (!server) {
            return;
        }

        this.server = null;

        await new Promise<void>(
            (resolve, reject) => {
                server.close(
                    error => {
                        if (error) {
                            reject(error);
                            return;
                        }

                        resolve();
                    }
                );
            }
        );
    }

    isRunning(): boolean {
        return this.server !== null;
    }

    getHost(): string {
        return this.host;
    }

    getPort(): number {
        return this.port;
    }

    private async handleRequest(
        request: http.IncomingMessage,
        response: http.ServerResponse
    ): Promise<void> {
        try {
            this.setCorsHeaders(
                response
            );

            if (
                request.method ===
                "OPTIONS"
            ) {
                response.writeHead(
                    204
                );

                response.end();

                return;
            }

            const url =
                new URL(
                    request.url ??
                    "/",
                    `http://${this.host}:${this.port}`
                );

            if (
                request.method ===
                    "GET" &&
                url.pathname ===
                    "/health"
            ) {
                this.sendJson(
                    response,
                    200,
                    {
                        ok: true,
                        service:
                            "vortiqlabs-agent",
                        version:
                            "0.1.0"
                    }
                );

                return;
            }

            if (
                request.method ===
                    "POST" &&
                url.pathname ===
                    "/agent"
            ) {
                if (!this.authenticateRequest(request, response)) {
                    return;
                }

                await this.handleAgentRequest(
                    request,
                    response
                );

                return;
            }

            this.sendJson(
                response,
                404,
                {
                    error:
                        "Not found."
                }
            );
        } catch (error) {
            this.sendJson(
                response,
                500,
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : String(error)
                }
            );
        }
    }

    private authenticateRequest(
        request: http.IncomingMessage,
        response: http.ServerResponse
    ): boolean {
        const requiredToken = this.authToken;
        if (!requiredToken) {
            // Fail closed if auth token is not configured
            this.sendJson(
                response,
                401,
                {
                    error: "Unauthorized: Agent server authentication token not configured."
                }
            );
            return false;
        }

        const authHeader = request.headers.authorization;
        if (!authHeader) {
            this.sendJson(
                response,
                401,
                {
                    error: "Unauthorized: Authorization header missing."
                }
            );
            return false;
        }

        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (!match) {
            this.sendJson(
                response,
                401,
                {
                    error: "Unauthorized: Invalid Authorization header format."
                }
            );
            return false;
        }

        const providedToken = match[1].trim();
        if (!validateAuthToken(providedToken, requiredToken)) {
            this.sendJson(
                response,
                401,
                {
                    error: "Unauthorized: Invalid token."
                }
            );
            return false;
        }

        return true;
    }

    private async handleAgentRequest(
        request: http.IncomingMessage,
        response: http.ServerResponse
    ): Promise<void> {
        let body: string;

        try {
            body =
                await this.readBody(
                    request
                );
        } catch (error) {
            this.sendJson(
                response,
                400,
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : String(error)
                }
            );

            return;
        }

        let parsed: unknown;

        try {
            parsed =
                JSON.parse(body);
        } catch {
            this.sendJson(
                response,
                400,
                {
                    error:
                        "Request body must contain valid JSON."
                }
            );

            return;
        }

        let agentRequest;

        try {
            agentRequest =
                parseAgentRequest(
                    parsed
                );
        } catch (error) {
            const invalidResponse:
                AgentResponse = {
                id: "unknown",
                success: false,
                error: {
                    code:
                        "INVALID_REQUEST",
                    message:
                        error instanceof Error
                            ? error.message
                            : String(error)
                }
            };

            this.sendJson(
                response,
                400,
                invalidResponse
            );

            return;
        }

        const result =
            await this.agent.handle(
                agentRequest
            );

        this.sendJson(
            response,
            result.success
                ? 200
                : 500,
            result
        );
    }

    private readBody(
        request: http.IncomingMessage
    ): Promise<string> {
        return new Promise(
            (resolve, reject) => {
                const chunks: Buffer[] = [];

                let size = 0;

                const MAX_BODY_SIZE =
                    10 * 1024 * 1024;

                request.on(
                    "data",
                    chunk => {
                        const buffer =
                            Buffer.isBuffer(
                                chunk
                            )
                                ? chunk
                                : Buffer.from(
                                    chunk
                                );

                        size +=
                            buffer.length;

                        if (
                            size >
                            MAX_BODY_SIZE
                        ) {
                            reject(
                                new Error(
                                    "Request body exceeds the 10 MB limit."
                                )
                            );

                            request.destroy();

                            return;
                        }

                        chunks.push(
                            buffer
                        );
                    }
                );

                request.on(
                    "end",
                    () => {
                        resolve(
                            Buffer.concat(
                                chunks
                            ).toString(
                                "utf8"
                            )
                        );
                    }
                );

                request.on(
                    "error",
                    reject
                );
            }
        );
    }

    private sendJson(
        response: http.ServerResponse,
        statusCode: number,
        data: unknown
    ): void {
        const body =
            JSON.stringify(
                data
            );

        response.writeHead(
            statusCode,
            {
                "Content-Type":
                    "application/json; charset=utf-8",
                "Content-Length":
                    Buffer.byteLength(
                        body,
                        "utf8"
                    )
            }
        );

        response.end(
            body
        );
    }

    private setCorsHeaders(
        response: http.ServerResponse
    ): void {
        response.setHeader(
            "Access-Control-Allow-Origin",
            "*"
        );

        response.setHeader(
            "Access-Control-Allow-Methods",
            "GET, POST, OPTIONS"
        );

        response.setHeader(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization"
        );
    }
}