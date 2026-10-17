import * as vscode from "vscode";
import { OneAuthClient } from "../auth/oneauth";

export interface TunnelInfo {
    url: string;
    hostname: string;
    port: number;
    localTarget?: string;
    status?: string;
    gateway?: string;
}

export class OneAuthTunnelClient {
    constructor(private readonly auth: OneAuthClient) {}

    async provision(): Promise<TunnelInfo> {
        const accessToken = await this.auth.getAccessToken();
        const response = await fetch(new URL("/api/agent/tunnel", this.auth.baseUrl), {
            method: "POST",
            headers: {
                authorization: `Bearer ${accessToken}`,
                accept: "application/json",

            }
        });
        const payload = await response.json().catch(() => ({})) as Partial<TunnelInfo> & { error?: string; message?: string };
        if (response.status === 401 || response.status === 403) {
            throw new Error("OneAuth rejected the session. Sign in again, then retry.");
        }
        if (!response.ok) {
            throw new Error(payload.message || payload.error || `Tunnel provisioning failed (HTTP ${response.status}).`);
        }
        if (typeof payload.url !== "string" || typeof payload.port !== "number" || typeof payload.hostname !== "string") {
            throw new Error("OneAuth returned an unexpected tunnel response (expected url, hostname and port).");
        }
        return {
            url: payload.url,
            hostname: payload.hostname,
            port: payload.port,
            localTarget: payload.localTarget,
            status: payload.status,
            gateway: payload.gateway
        };
    }
}
