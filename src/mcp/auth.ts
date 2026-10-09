import * as crypto from "crypto";
import { IncomingMessage, ServerResponse } from "http";

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

    let parsedOrigin: URL;
    try {
        parsedOrigin = new URL(origin);
    } catch {
        return false;
    }

    if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
        return false;
    }

    const normalizedOrigin = parsedOrigin.origin.toLowerCase();
    if (allowedOrigins?.some(allowed => allowed.toLowerCase() === normalizedOrigin)) {
        return true;
    }

    // Local development clients use varying ports, but the hostname remains exact.
    return parsedOrigin.hostname === "localhost" || parsedOrigin.hostname === "127.0.0.1";
}

export function authenticateHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    expectedToken?: string,
    allowedOrigins?: string[]
): boolean {
    if (!validateOrigin(req.headers.origin, allowedOrigins)) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Forbidden: Origin not allowed." }));
        return false;
    }

    const requiredToken = expectedToken || process.env.MCP_AUTH_TOKEN;
    if (!requiredToken) {
        const host = req.headers.host || "";
        const isLocalHost = host.startsWith("127.0.0.1:") || host.startsWith("localhost:");
        if (!isLocalHost) {
            res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "Unauthorized: MCP_AUTH_TOKEN environment variable is not configured." }));
            return false;
        }
        return true;
    }

    const authorization = req.headers.authorization;
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Unauthorized: Authorization header missing or invalid." }));
        return false;
    }

    if (!validateAuthToken(match[1].trim(), requiredToken)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Unauthorized: Invalid token." }));
        return false;
    }

    return true;
}
