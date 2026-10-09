import * as crypto from "crypto";
import { IncomingMessage, ServerResponse } from "http";

export interface AuthConfig {
    authToken?: string;
    allowLocalBypass?: boolean;
    allowedOrigins?: string[];
}

export function generateAuthToken(): string {
    return crypto.randomBytes(32).toString("hex");
}

export function validateAuthToken(providedToken: string, expectedToken: string): boolean {
    if (!providedToken || !expectedToken) {
        return false;
    }

    const providedBuffer = Buffer.from(providedToken, "utf8");
    const expectedBuffer = Buffer.from(expectedToken, "utf8");

    if (providedBuffer.length !== expectedBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

export function validateOrigin(origin: string | undefined, allowedOrigins?: string[]): boolean {
    if (!origin) {
        return true;
    }

    const lower = origin.toLowerCase();

    // Always allow localhost / 127.0.0.1 for local dev & MCP Inspector
    if (
        lower.startsWith("http://localhost") ||
        lower.startsWith("http://127.0.0.1") ||
        lower.startsWith("https://localhost") ||
        lower.startsWith("https://127.0.0.1")
    ) {
        return true;
    }

    // Allow Codespaces forwarded origins
    if (
        lower.endsWith(".githubpreview.dev") ||
        lower.endsWith(".app.github.dev") ||
        lower.endsWith(".github.dev")
    ) {
        return true;
    }

    if (allowedOrigins && allowedOrigins.length > 0) {
        return allowedOrigins.some(allowed => {
            if (allowed === "*") {
                return true;
            }
            if (allowed.startsWith("*.")) {
                const domain = allowed.slice(2).toLowerCase();
                try {
                    const host = new URL(lower).hostname;
                    return host.endsWith(domain);
                } catch {
                    return false;
                }
            }
            return lower === allowed.toLowerCase();
        });
    }

    return false;
}

export function authenticateHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    expectedToken?: string,
    allowedOrigins?: string[]
): boolean {
    const origin = req.headers.origin;
    if (!validateOrigin(origin, allowedOrigins)) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Forbidden: Origin not allowed." }));
        return false;
    }

    // Require auth token if specified in environment or expected
    const requiredToken = expectedToken || process.env.MCP_AUTH_TOKEN;

    if (!requiredToken) {
        // If MCP_AUTH_TOKEN is not configured at all, fail closed for non-localhost requests
        const hostHeader = req.headers.host || "";
        const isLocalHost = hostHeader.startsWith("127.0.0.1") || hostHeader.startsWith("localhost");
        if (!isLocalHost) {
            res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
            res.end(
                JSON.stringify({
                    error: "Unauthorized: MCP_AUTH_TOKEN environment variable is not configured."
                })
            );
            return false;
        }
        return true;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Unauthorized: Authorization header missing." }));
        return false;
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(
            JSON.stringify({
                error: "Unauthorized: Invalid Authorization header format. Expected 'Bearer <token>'."
            })
        );
        return false;
    }

    const providedToken = match[1].trim();
    if (!validateAuthToken(providedToken, requiredToken)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Unauthorized: Invalid token." }));
        return false;
    }

    return true;
}
