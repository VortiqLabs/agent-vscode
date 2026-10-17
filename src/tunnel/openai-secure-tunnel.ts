import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn, ChildProcess } from "child_process";
import * as vscode from "vscode";

const RELEASE_API = "https://api.github.com/repos/openai/tunnel-client/releases/latest";
const RUNTIME_KEY = "openaiTunnel.runtimeApiKey";
const TUNNEL_ID_KEY = "openaiTunnel.tunnelId";

interface ReleaseAsset { name: string; browser_download_url: string; digest?: string; }
interface ReleaseInfo { tag_name: string; assets: ReleaseAsset[]; }

export class OpenAISecureTunnel {
    private process: ChildProcess | undefined;
    private binaryPath: string | undefined;

    constructor(private readonly context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {}

    async connect(mcpUrl: string): Promise<string> {
        if (this.process && this.process.exitCode === null) {
            return "OpenAI Secure MCP Tunnel is already running.";
        }
        const { tunnelId, apiKey } = await this.getCredentials();
        const binary = await this.ensureInstalled();
        const env = {
            ...process.env,
            CONTROL_PLANE_API_KEY: apiKey,
            CONTROL_PLANE_TUNNEL_ID: tunnelId,
            MCP_SERVER_URL: mcpUrl
        };
        const child = spawn(binary, [
            "run",
            "--cloudflared.managed",
            "--control-plane.tunnel-id", tunnelId,
            "--mcp.server-url", mcpUrl,
            "--health.listen-addr", "127.0.0.1:0"
        ], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        this.process = child;
        child.stdout?.on("data", chunk => this.output.appendLine("[tunnel-client] " + String(chunk).trimEnd()));
        child.stderr?.on("data", chunk => this.output.appendLine("[tunnel-client] " + String(chunk).trimEnd()));
        child.on("error", error => this.output.appendLine("OpenAI tunnel process error: " + error.message));
        child.on("exit", (code, signal) => {
            this.output.appendLine(`OpenAI tunnel client exited (code=${code ?? "null"}, signal=${signal ?? "none"}).`);
            if (this.process === child) { this.process = undefined; }
        });
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { cleanup(); resolve(); }, 1500);
            const onError = (error: Error) => { cleanup(); reject(error); };
            const onExit = (code: number | null) => { cleanup(); reject(new Error(`tunnel-client exited during startup (code ${code ?? "unknown"}). Check the VortiqLabs Agent output channel.`)); };
            const cleanup = () => { clearTimeout(timer); child.removeListener("error", onError); child.removeListener("exit", onExit); };
            child.once("error", onError);
            child.once("exit", onExit);
        });
        return `Started OpenAI Secure MCP Tunnel using tunnel ID ${tunnelId}.`;
    }

    async disconnect(): Promise<void> {
        const child = this.process;
        this.process = undefined;
        if (!child || child.exitCode !== null) { return; }
        await new Promise<void>(resolve => {
            const timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
            child.once("exit", () => { clearTimeout(timer); resolve(); });
            child.kill("SIGTERM");
        });
    }

    async dispose(): Promise<void> { await this.disconnect(); }

    private async getCredentials(): Promise<{ tunnelId: string; apiKey: string }> {
        let tunnelId = await this.context.secrets.get(TUNNEL_ID_KEY);
        let apiKey = await this.context.secrets.get(RUNTIME_KEY);
        if (!tunnelId) {
            tunnelId = await vscode.window.showInputBox({
                title: "OpenAI Secure MCP Tunnel",
                prompt: "Enter a provisioned OpenAI tunnel ID (tunnel_…)",
                placeHolder: "tunnel_...",
                ignoreFocusOut: true,
                validateInput: value => /^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$/.test(value.trim()) ? undefined : "Enter a valid OpenAI tunnel ID."
            });
            if (!tunnelId) { throw new Error("OpenAI tunnel setup cancelled. A provisioned tunnel ID is required."); }
            tunnelId = tunnelId.trim();
        }
        if (!apiKey) {
            apiKey = await vscode.window.showInputBox({
                title: "OpenAI Runtime API Key",
                prompt: "Enter a restricted runtime API key with Tunnels Read + Use permissions. It is stored in VS Code SecretStorage.",
                password: true,
                ignoreFocusOut: true,
                validateInput: value => value.trim().length >= 12 ? undefined : "Enter the runtime API key."
            });
            if (!apiKey) { throw new Error("OpenAI tunnel setup cancelled. A runtime API key is required."); }
            apiKey = apiKey.trim();
        }
        await this.context.secrets.store(TUNNEL_ID_KEY, tunnelId);
        await this.context.secrets.store(RUNTIME_KEY, apiKey);
        return { tunnelId, apiKey };
    }

    private async ensureInstalled(): Promise<string> {
        if (this.binaryPath && fs.existsSync(this.binaryPath)) { return this.binaryPath; }
        const platform = this.platformTarget();
        const storage = path.join(this.context.globalStorageUri.fsPath, "openai-tunnel-client");
        await fs.promises.mkdir(storage, { recursive: true });
        const binaryName = process.platform === "win32" ? "tunnel-client-runtime-cloudflared.exe" : "tunnel-client-runtime-cloudflared";
        const target = path.join(storage, binaryName);
        if (fs.existsSync(target)) {
            this.binaryPath = target;
            return target;
        }

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Installing OpenAI Secure MCP Tunnel client…", cancellable: false }, async progress => {
            progress.report({ message: "Checking official GitHub release…" });
            const response = await fetch(RELEASE_API, { headers: { accept: "application/vnd.github+json", "user-agent": "VortiqLabs-Agent" } });
            if (!response.ok) { throw new Error(`Could not fetch tunnel-client release metadata (HTTP ${response.status}).`); }
            const release = await response.json() as ReleaseInfo;
            const archiveName = `tunnel-client-runtime-cloudflared-${release.tag_name}-${platform}.zip`;
            const archiveAsset = release.assets.find(asset => asset.name === archiveName);
            const sumsAsset = release.assets.find(asset => asset.name === "SHA256SUMS.txt");
            if (!archiveAsset || !sumsAsset) { throw new Error(`No official tunnel-client archive found for ${platform} in ${release.tag_name}.`); }

            progress.report({ message: `Downloading ${release.tag_name}…` });
            const [archiveResponse, sumsResponse] = await Promise.all([
                fetch(archiveAsset.browser_download_url, { headers: { "user-agent": "VortiqLabs-Agent" } }),
                fetch(sumsAsset.browser_download_url, { headers: { "user-agent": "VortiqLabs-Agent" } })
            ]);
            if (!archiveResponse.ok || !sumsResponse.ok) { throw new Error("Failed to download the official tunnel-client archive or checksum manifest."); }
            const archive = Buffer.from(await archiveResponse.arrayBuffer());
            const sums = await sumsResponse.text();
            const expected = sums.split(/\r?\n/).map(line => line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)).find(match => match?.[2] === archiveName)?.[1];
            if (!expected) { throw new Error("The official checksum manifest did not contain the selected archive."); }
            const actual = crypto.createHash("sha256").update(archive).digest("hex");
            if (actual.toLowerCase() !== expected.toLowerCase()) { throw new Error("tunnel-client archive checksum verification failed; refusing to install it."); }
            const archivePath = path.join(storage, archiveName);
            await fs.promises.writeFile(archivePath, archive, { mode: 0o600 });
            progress.report({ message: "Verifying and extracting…" });
            await this.extractArchive(archivePath, storage);
            await fs.promises.unlink(archivePath).catch(() => undefined);
            if (process.platform !== "win32") { await fs.promises.chmod(target, 0o700); }
            if (!fs.existsSync(target)) { throw new Error("The archive did not contain the expected tunnel-client runtime binary."); }
        });
        this.binaryPath = target;
        return target;
    }

    private platformTarget(): string {
        const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : undefined;
        if (!arch) { throw new Error(`OpenAI tunnel-client does not have a configured build for CPU ${process.arch}.`); }
        const osName = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : undefined;
        if (!osName) { throw new Error(`OpenAI tunnel-client does not support OS ${process.platform}.`); }
        return `${osName}-${arch}`;
    }

    private async extractArchive(archivePath: string, destination: string): Promise<void> {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execFileAsync = promisify(execFile);
        if (process.platform === "win32") {
            const ps = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`;
            await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 120000 });
        } else {
            await execFileAsync("unzip", ["-o", archivePath, "-d", destination], { timeout: 120000 });
        }
    }
}
