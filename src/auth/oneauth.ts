import * as http from "http";
import * as crypto from "crypto";
import * as vscode from "vscode";

const ACCESS_TOKEN_KEY = "oneauth.accessToken";
const REFRESH_TOKEN_KEY = "oneauth.refreshToken";
const EXPIRES_AT_KEY = "oneauth.expiresAt";
const DEFAULT_BASE_URL = "https://oneauth.nishantapps.in";
const DEFAULT_CLIENT_ID = "oa_8WSUjKeAT6CaaJLdZ1Lsr-oHu-ow3LHT";
const REDIRECT_URI = "http://localhost:8765/callback";

export interface OneAuthUserInfo {
    sub?: string;
    name?: string;
    preferred_username?: string;
    email?: string;
    email_verified?: boolean;
    picture?: string;
}

interface TokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    error?: string;
    error_description?: string;
}

export class OneAuthClient {
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly output?: vscode.OutputChannel
    ) {}

    private log(message: string, details?: unknown): void {
        const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
        this.output?.appendLine(`[${new Date().toISOString()}] [OneAuth] ${message}${suffix}`);
    }

    get baseUrl(): string {
        let configured = vscode.workspace.getConfiguration("vortiqlabsAgent").get<string>("oneAuthBaseUrl", DEFAULT_BASE_URL);
        while (configured.endsWith("/")) { configured = configured.slice(0, -1); }
        return configured;
    }

    get clientId(): string {
        return vscode.workspace.getConfiguration("vortiqlabsAgent").get<string>("oneAuthClientId", DEFAULT_CLIENT_ID).trim();
    }

    async isSignedIn(): Promise<boolean> {
        return Boolean(await this.context.secrets.get(ACCESS_TOKEN_KEY));
    }

    async signIn(): Promise<void> {
        this.log("Sign-in button clicked.");
        if (!this.clientId) {
            this.log("Sign-in stopped: OAuth client ID is missing.");
            throw new Error("Set VortiqLabs Agent › OneAuth Client ID in extension settings.");
        }
        const verifier = crypto.randomBytes(32).toString("base64url");
        const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
        const state = crypto.randomBytes(24).toString("hex");
        const callback = this.waitForCallback(state);
        const authorize = new URL("/oauth/authorize", this.baseUrl);
        authorize.searchParams.set("response_type", "code");
        authorize.searchParams.set("client_id", "oa_8WSUjKeAT6CaaJLdZ1Lsr-oHu-ow3LHT");
        authorize.searchParams.set("redirect_uri", REDIRECT_URI);
        authorize.searchParams.set("scope", "openid profile email");
        authorize.searchParams.set("state", state);
        authorize.searchParams.set("code_challenge", challenge);
        authorize.searchParams.set("code_challenge_method", "S256");

        this.log("Opening OneAuth authorization page.", { url: authorize.origin + authorize.pathname, redirectUri: REDIRECT_URI });
        try {
            const opened = await vscode.env.openExternal(vscode.Uri.parse(authorize.toString()));
            if (!opened) {
                this.log("VS Code reported that the authorization URL could not be opened.");
                throw new Error("Could not open the OneAuth authorization page. Open the Output panel and select VortiqLabs Agent.");
            }
            this.log("Authorization page opened; waiting for OAuth callback on localhost:8765.");
            const code = await callback;
            this.log("Authorization callback received; exchanging authorization code for tokens.");
            const tokens = await this.exchangeToken({
                grant_type: "authorization_code",
                code,
                redirect_uri: REDIRECT_URI,
                client_id: this.clientId,
                code_verifier: verifier
            });
            await this.saveTokens(tokens);
            this.log("Sign-in successful. Tokens stored securely (token values omitted).", { expiresIn: tokens.expires_in ?? 3600 });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log("Sign-in failed.", { error: message });
            throw error instanceof Error ? error : new Error(message);
        }
    }

    async signOut(): Promise<void> {
        this.log("Signing out; clearing stored OneAuth tokens.");
        await Promise.all([
            this.context.secrets.delete(ACCESS_TOKEN_KEY),
            this.context.secrets.delete(REFRESH_TOKEN_KEY),
            this.context.secrets.delete(EXPIRES_AT_KEY)
        ]);
        this.log("Signed out.");
    }

    async getAccessToken(): Promise<string> {
        const accessToken = await this.context.secrets.get(ACCESS_TOKEN_KEY);
        const expiresAt = Number(await this.context.secrets.get(EXPIRES_AT_KEY) ?? "0");
        if (accessToken && Date.now() < expiresAt - 60_000) {
            return accessToken;
        }

        const refreshToken = await this.context.secrets.get(REFRESH_TOKEN_KEY);
        if (refreshToken) {
            try {
                this.log("Access token expired or nearing expiry; refreshing token.");
                const tokens = await this.exchangeToken({
                    grant_type: "refresh_token",
                    refresh_token: refreshToken,
                    client_id: this.clientId
                });
                await this.saveTokens(tokens);
                const refreshed = await this.context.secrets.get(ACCESS_TOKEN_KEY);
                if (refreshed) {
                    this.log("Token refresh successful.");
                    return refreshed;
                }
            } catch (error) {
                this.log("Token refresh failed; clearing stored tokens.", { error: error instanceof Error ? error.message : String(error) });
                await this.signOut();
            }
        }
        throw new Error("Sign in to OneAuth first.");
    }

    private async exchangeToken(params: Record<string, string>): Promise<TokenResponse> {
        const grantType = params.grant_type ?? "unknown";
        this.log("Sending token request.", { endpoint: new URL("/api/oauth/token", this.baseUrl).origin + "/api/oauth/token", grantType });
        const response = await fetch(new URL("/api/oauth/token", this.baseUrl), {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
            body: new URLSearchParams(params)
        });
        const payload = await response.json().catch(() => ({})) as TokenResponse;
        if (!response.ok || !payload.access_token) {
            const message = payload.error_description || payload.error || `OneAuth token exchange failed (HTTP ${response.status}).`;
            this.log("Token request failed.", { status: response.status, error: message });
            throw new Error(message);
        }
        this.log("Token request succeeded.", { status: response.status, grantType });
        return payload;
    }

    private async saveTokens(tokens: TokenResponse): Promise<void> {
        if (!tokens.access_token) { throw new Error("OneAuth returned no access token."); }
        await this.context.secrets.store(ACCESS_TOKEN_KEY, tokens.access_token);
        if (tokens.refresh_token) {
            await this.context.secrets.store(REFRESH_TOKEN_KEY, tokens.refresh_token);
        }
        const expiresIn = Number(tokens.expires_in ?? 3600);
        await this.context.secrets.store(EXPIRES_AT_KEY, String(Date.now() + Math.max(60, expiresIn) * 1000));
    }

    private async waitForCallback(expectedState: string): Promise<string> {
        const server = http.createServer();
        return new Promise<string>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error, code?: string) => {
                if (settled) { return; }
                settled = true;
                clearTimeout(timer);
                server.close();
                if (error) { reject(error); } else { resolve(code!); }
            };
            const timer = setTimeout(() => finish(new Error("OneAuth sign-in timed out. Please try again.")), 3 * 60 * 1000);
            server.on("request", (request, response) => {
                const url = new URL(request.url ?? "/", REDIRECT_URI);
                if (url.pathname !== "/callback") {
                    response.writeHead(404).end("Not found");
                    return;
                }
                const error = url.searchParams.get("error");
                if (error) {
                    const description = url.searchParams.get("error_description") || error;
                    this.log("OAuth provider returned an authorization error.", { error: description });
                    response.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end("<h2>OneAuth sign-in failed</h2><p>You can close this tab and return to VS Code.</p>");
                    finish(new Error(description));
                    return;
                }
                const state = url.searchParams.get("state");
                const code = url.searchParams.get("code");
                if (!state || state !== expectedState || !code) {
                    this.log("OAuth callback rejected: state mismatch or authorization code missing.");
                    response.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end("<h2>Invalid sign-in callback</h2><p>Return to VS Code and try again.</p>");
                    finish(new Error("OneAuth callback state did not match or authorization code was missing."));
                    return;
                }
                this.log("OAuth callback validated.");
                response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end("<!doctype html><html><head><meta charset=\"utf-8\"><title>Signed in</title></head><body style=\"font:16px system-ui;max-width:560px;margin:4rem auto;padding:0 1rem\"><h2>Sign-in complete</h2><p>You can close this tab and return to VS Code.</p></body></html>");
                finish(undefined, code);
            });
            server.on("error", error => {
                this.log("Could not start OAuth callback listener.", { error: error.message });
                finish(new Error(`Could not start OAuth callback listener on localhost:8765: ${error.message}`));
            });
            server.listen(8765, "127.0.0.1", () => this.log("OAuth callback listener started on localhost:8765."));
        });
    }
}
