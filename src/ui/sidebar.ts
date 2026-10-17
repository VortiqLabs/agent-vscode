import * as vscode from "vscode";
import { AgentActivity, AgentActivityItem } from "./activity";
import type { TunnelInfo } from "../tunnel/oneauth-tunnel";
import type { OneAuthUserInfo } from "../auth/oneauth";

export interface SidebarActions {
    signIn: () => Promise<void>;
    signOut: () => Promise<void>;
    getUserInfo: () => Promise<OneAuthUserInfo | undefined>;
    provisionTunnel: () => Promise<TunnelInfo>;
    connectOpenAITunnel: () => Promise<string>;
    disconnectOpenAITunnel: () => Promise<void>;
}

export class AgentSidebarProvider implements vscode.WebviewViewProvider {
    static readonly viewId = "vortiqlabs-agent.activity";
    private view?: vscode.WebviewView;
    private subscription?: { dispose(): void };
    private pendingSnapshot?: AgentActivityItem[];
    private publishTimer?: ReturnType<typeof setTimeout>;
    private refreshTimer?: ReturnType<typeof setInterval>;
    private signedIn = false;
    private userInfo?: OneAuthUserInfo;
    private tunnel?: TunnelInfo;
    private busyAction = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly activity: AgentActivity,
        private readonly actions: SidebarActions,
        private readonly output?: vscode.OutputChannel
    ) {}

    setAuthState(signedIn: boolean): void {
        this.signedIn = signedIn;
        this.post({ type: "authState", signedIn });
    }

    setUserInfo(userInfo?: OneAuthUserInfo): void {
        this.userInfo = userInfo;
        this.post({ type: "userInfo", userInfo: userInfo ?? null });
    }

    setTunnelInfo(tunnel?: TunnelInfo): void {
        this.tunnel = tunnel;
        this.post({ type: "tunnelState", tunnel: tunnel ?? null });
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = this.html(view.webview);
        this.post({ type: "authState", signedIn: this.signedIn });
        this.post({ type: "userInfo", userInfo: this.userInfo ?? null });
        this.post({ type: "tunnelState", tunnel: this.tunnel ?? null });
        this.subscription?.dispose();
        this.subscription = this.activity.subscribe(items => {
            this.pendingSnapshot = items;
            if (this.publishTimer) {return;}
            this.publishTimer = setTimeout(() => {
                this.publishTimer = undefined;
                if (this.pendingSnapshot) {this.post({ type: "snapshot", items: this.pendingSnapshot });}
                this.pendingSnapshot = undefined;
            }, 75);
        });
        view.webview.onDidReceiveMessage(async message => {
            if (message?.type === "signIn") { this.output?.appendLine(`[${new Date().toISOString()}] [Sidebar] Sign-in click message received from webview.`); }
            if (message?.type === "ready") {
                this.post({ type: "snapshot", items: this.activity.snapshot() });
                this.post({ type: "authState", signedIn: this.signedIn });
                this.post({ type: "userInfo", userInfo: this.userInfo ?? null });
                this.post({ type: "tunnelState", tunnel: this.tunnel ?? null });
            }
            if (message?.type === "clear") {this.activity.clear();}
            if (message?.type === "refresh") {this.post({ type: "snapshot", items: this.activity.snapshot() });}
            if (message?.type === "openUrl" && typeof message.url === "string") {
                try {
                    const url = new URL(message.url);
                    if (url.protocol === "https:" || url.protocol === "http:") {await vscode.env.openExternal(vscode.Uri.parse(url.toString()));}
                } catch { /* Ignore malformed or unsupported URLs. */ }
            }
            if (message?.type === "copyText" && typeof message.text === "string") {
                await vscode.env.clipboard.writeText(message.text);
                void vscode.window.showInformationMessage("Tunnel URL copied.");
            }
            if (message?.type === "openFile" && typeof message.path === "string") {
                const root = vscode.workspace.workspaceFolders?.[0]?.uri;
                if (!root) {return;}
                const uri = vscode.Uri.joinPath(root, message.path);
                try {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    await vscode.window.showTextDocument(doc, { preview: true });
                } catch (error) {
                    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
                }
            }
            if (this.busyAction) {return;}
            if (message?.type === "signIn") {
                this.output?.appendLine(`[${new Date().toISOString()}] [Sidebar] Starting OneAuth sign-in action.`);
                this.busyAction = true;
                this.post({ type: "actionBusy", busy: true });
                try {
                    await this.actions.signIn();
                    this.signedIn = true;
                    this.post({ type: "authState", signedIn: true });
                    try {
                        this.userInfo = await this.actions.getUserInfo();
                        this.post({ type: "userInfo", userInfo: this.userInfo ?? null });
                    } catch (profileError) {
                        this.output?.appendLine(`[${new Date().toISOString()}] [Sidebar] Unable to load OneAuth profile: ${profileError instanceof Error ? profileError.message : String(profileError)}`);
                    }
                    this.output?.appendLine(`[${new Date().toISOString()}] [Sidebar] OneAuth sign-in action completed successfully.`);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    this.output?.appendLine(`[${new Date().toISOString()}] [Sidebar] OneAuth sign-in action failed: ${message}`);
                    void vscode.window.showErrorMessage(`OneAuth sign-in failed: ${message}`);
                } finally {
                    this.busyAction = false;
                    this.post({ type: "actionBusy", busy: false });
                }
            }
            if (message?.type === "signOut") {
                this.busyAction = true;
                this.post({ type: "actionBusy", busy: true });
                try {
                    await this.actions.signOut();
                    this.signedIn = false;
                    this.tunnel = undefined;
                    this.userInfo = undefined;
                    this.post({ type: "authState", signedIn: false });
                    this.post({ type: "userInfo", userInfo: null });
                    this.post({ type: "tunnelState", tunnel: null });
                } catch (error) {
                    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
                } finally {
                    this.busyAction = false;
                    this.post({ type: "actionBusy", busy: false });
                }
            }
            if (message?.type === "connectOpenAITunnel") {
                this.busyAction = true;
                this.post({ type: "actionBusy", busy: true });
                try {
                    const result = await this.actions.connectOpenAITunnel();
                    void vscode.window.showInformationMessage(result);
                } catch (error) {
                    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
                } finally {
                    this.busyAction = false;
                    this.post({ type: "actionBusy", busy: false });
                }
            }
            if (message?.type === "disconnectOpenAITunnel") {
                this.busyAction = true;
                this.post({ type: "actionBusy", busy: true });
                try {
                    await this.actions.disconnectOpenAITunnel();
                    void vscode.window.showInformationMessage("OpenAI Secure MCP Tunnel disconnected.");
                } catch (error) {
                    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
                } finally {
                    this.busyAction = false;
                    this.post({ type: "actionBusy", busy: false });
                }
            }
            if (message?.type === "provisionTunnel") {
                this.busyAction = true;
                this.post({ type: "actionBusy", busy: true });
                try {
                    const tunnel = await this.actions.provisionTunnel();
                    this.tunnel = tunnel;
                    this.post({ type: "tunnelState", tunnel });
                    void vscode.window.showInformationMessage(`Tunnel ready: ${tunnel.hostname} · port ${tunnel.port}`);
                } catch (error) {
                    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
                } finally {
                    this.busyAction = false;
                    this.post({ type: "actionBusy", busy: false });
                }
            }
        }, undefined, this.context.subscriptions);
        this.refreshTimer = setInterval(() => {
            if (this.view === view) {this.post({ type: "snapshot", items: this.activity.snapshot() });}
        }, 1500);
        view.onDidDispose(() => {
            this.subscription?.dispose();
            this.subscription = undefined;
            if (this.publishTimer) {clearTimeout(this.publishTimer);}
            if (this.refreshTimer) {clearInterval(this.refreshTimer);}
            this.publishTimer = undefined;
            this.refreshTimer = undefined;
            this.pendingSnapshot = undefined;
            this.view = undefined;
        });
    }

    dispose(): void {
        this.subscription?.dispose();
        if (this.publishTimer) {clearTimeout(this.publishTimer);}
        if (this.refreshTimer) {clearInterval(this.refreshTimer);}
    }

    private post(message: unknown): void {
        void this.view?.webview.postMessage(message);
    }

    private html(webview: vscode.Webview): string {
        const nonce = [...Array(32)].map(() => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)]).join("");
        return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>VortiqLabs Agent</title>
<style>
:root{color-scheme:dark;--panel:var(--vscode-sideBar-background);--border:var(--vscode-panel-border);--fg:var(--vscode-foreground);--muted:var(--vscode-descriptionForeground);--accent:var(--vscode-textLink-foreground);--green:var(--vscode-testing-iconPassed,#4ec9b0);--red:var(--vscode-testing-iconFailed,#f48771);--yellow:var(--vscode-editorWarning-foreground,#cca700)}
*{box-sizing:border-box}body{margin:0;padding:12px;background:var(--panel);color:var(--fg);font:12px/1.5 var(--vscode-font-family)}header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}h1{font-size:14px;margin:0;font-weight:650;letter-spacing:.2px}.sub{color:var(--muted);font-size:11px}.actions{display:flex;gap:5px;flex-wrap:wrap}button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--border);border-radius:5px;padding:5px 8px;cursor:pointer;font:inherit}button:hover{background:var(--vscode-button-secondaryHoverBackground)}button:disabled{opacity:.55;cursor:wait}.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-color:transparent}.primary:hover{background:var(--vscode-button-hoverBackground)}#account{border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:12px}.account-row{display:flex;justify-content:space-between;align-items:center;gap:8px}.section-title{font-weight:650;font-size:12px}.muted{color:var(--muted)}.profile{margin-top:9px;padding:9px;border-radius:6px;background:color-mix(in srgb,var(--panel) 82%,var(--fg) 6%);overflow-wrap:anywhere}.profile-name{font-weight:650;font-size:13px}.profile .sub{margin-top:2px}#auth-status{font-size:11px;color:var(--muted);margin:3px 0 9px}.tunnel{margin-top:10px;padding-top:9px;border-top:1px solid var(--border);overflow-wrap:anywhere}.tunnel-line{margin-top:5px}.tunnel-label{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.5px}.tunnel-value{font-family:var(--vscode-editor-font-family,monospace);font-size:11px;overflow-wrap:anywhere;user-select:text}#status{display:flex;gap:6px;align-items:center;color:var(--muted);margin-bottom:10px}.dot{width:7px;height:7px;border-radius:50%;background:var(--green)}#feed{display:flex;flex-direction:column;gap:9px}.item{border:1px solid var(--border);border-radius:8px;overflow:hidden;background:color-mix(in srgb,var(--panel) 88%,var(--fg) 4%)}.item-head{padding:8px 9px;display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.tool{font-weight:650;overflow-wrap:anywhere}.meta{font-size:10px;color:var(--muted);white-space:nowrap}.pill{font-size:10px;padding:1px 5px;border-radius:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}.pill.running{color:var(--yellow)}.pill.error{color:var(--red)}.pill.success{color:var(--green)}details{border-top:1px solid var(--border)}summary{cursor:pointer;color:var(--muted);padding:5px 9px;user-select:none}pre{margin:0;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;background:var(--vscode-textCodeBlock-background);font:11px/1.5 var(--vscode-editor-font-family,monospace)}.diff .add{color:var(--green);display:block}.diff .del{color:var(--red);display:block}.stream{border-top:1px solid var(--border)}.stream-title{padding:5px 9px;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.6px}.empty{padding:28px 8px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:8px}.command{color:var(--accent);font-family:var(--vscode-editor-font-family,monospace);overflow-wrap:anywhere}
</style></head><body>
<header><div><h1>VortiqLabs Agent</h1><div class="sub">Workspace agent · live activity</div></div><div class="actions"><button id="refresh" title="Refresh activity">↻</button><button id="clear">Clear</button></div></header>
<section id="account">
 <div class="section-title">Account</div>
 <div id="profile" class="profile" hidden><div id="profile-name" class="profile-name"></div><div id="profile-email" class="sub"></div><div id="profile-username" class="sub"></div><div id="profile-verified" class="sub"></div></div>
 <div id="tunnel" class="tunnel" hidden>
  <div class="section-title">Agent tunnel</div>
  <div class="tunnel-line"><div class="tunnel-label">Public URL</div><div class="tunnel-value" id="tunnel-url"></div><button id="copy-url">Copy URL</button></div>
  <div class="tunnel-line"><div class="tunnel-label">Local port</div><div class="tunnel-value" id="tunnel-port"></div></div>
  <div class="tunnel-line"><div class="tunnel-label">Hostname</div><div class="tunnel-value" id="tunnel-host"></div></div>
 </div>
 <div class="actions" style="margin-top:9px"><button id="get-tunnel" class="primary" disabled>Get tunnel URL + port</button></div>
 <div class="section-title" style="margin-top:12px">OpenAI Secure MCP Tunnel</div>
 <div class="actions"><button id="connect-openai">Install / Connect</button><button id="disconnect-openai">Disconnect</button></div>
 <div class="sub">Requires a provisioned OpenAI tunnel ID and a runtime API key.</div>
</section>
<div id="status"><span class="dot"></span><span id="count">Listening for MCP requests…</span></div><main id="feed"><div class="empty">Waiting for the first MCP request</div></main>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();let items=[];let signedIn=false;let tunnel=null;let busy=false;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function render(){const feed=document.getElementById("feed");document.getElementById("count").textContent=items.length+" request"+(items.length===1?"":"s")+" · "+items.filter(x=>x.status==="running").length+" running";if(!items.length){feed.innerHTML='<div class="empty">Waiting for the first MCP request</div>';return}feed.innerHTML=items.map(x=>{const time=new Date(x.startedAt).toLocaleTimeString();let result=x.resultText||"";let diff=result;try{const parsed=JSON.parse(result);if(typeof parsed.diff==="string")diff=parsed.diff;else if(typeof parsed.patch==="string")diff=parsed.patch;else if(typeof parsed.result?.diff==="string")diff=parsed.result.diff}catch{}const looksDiff=/(^|\n)(diff --git |\+\+\+ |--- |@@ )/.test(diff);let body=details("Arguments",x.argumentsText)+details(looksDiff?"Git diff / patch":"Result",looksDiff?diff:result,looksDiff)+details("Error",x.errorText)+((x.stdout||x.stderr)?'<div class="stream"><div class="stream-title">Terminal output'+(x.exitCode!==undefined?' · exit '+x.exitCode:'')+'</div>'+(x.stdout?'<pre>'+esc(x.stdout)+'</pre>':'')+(x.stderr?'<pre style="color:var(--red)">'+esc(x.stderr)+'</pre>':'')+'</div>':"");return '<article class="item"><div class="item-head"><div><div class="tool">'+esc(x.tool)+'</div><div class="meta">'+esc(time)+(x.command?'<div class="command">$ '+esc(x.command)+'</div>':"")+'</div></div><span class="pill '+esc(x.status)+'">'+esc(x.status)+(x.durationMs!==undefined?' · '+x.durationMs+'ms':'')+'</span></div>'+body+'</article>'}).join("")}
function renderAccount(){document.getElementById("get-tunnel").disabled=!signedIn||busy;document.getElementById("tunnel").hidden=!tunnel;if(tunnel){document.getElementById("tunnel-url").textContent=tunnel.url;document.getElementById("tunnel-port").textContent=String(tunnel.port);document.getElementById("tunnel-host").textContent=tunnel.hostname;}}
function renderProfile(user){const panel=document.getElementById("profile");panel.hidden=!signedIn||!user;if(!user)return;document.getElementById("profile-name").textContent=user.name||user.preferred_username||"OneAuth user";document.getElementById("profile-email").textContent=user.email||"Email not provided";document.getElementById("profile-username").textContent=user.preferred_username&&user.preferred_username!==user.name?"@"+user.preferred_username:"";document.getElementById("profile-verified").textContent=user.email_verified===true?"Email verified":user.email_verified===false?"Email not verified":""}
function details(title,body,isDiff=false){if(!body)return "";return '<details><summary>'+esc(title)+'</summary><pre class="'+(isDiff?'diff':'')+'">'+(isDiff?lines(body):esc(body))+'</pre></details>'}
function lines(text){return String(text||"").split("\n").map(line=>{const cls=line.startsWith("+")&&!line.startsWith("+++")?"add":line.startsWith("-")&&!line.startsWith("---")?"del":"";return '<span class="'+cls+'">'+esc(line)+'</span>'}).join("")}
window.addEventListener("message",e=>{const d=e.data;if(d?.type==="snapshot"){items=d.items||[];render()}if(d?.type==="authState"){signedIn=Boolean(d.signedIn);renderAccount();renderProfile(window.oneAuthUser||null)}if(d?.type==="userInfo"){window.oneAuthUser=d.userInfo||null;renderProfile(window.oneAuthUser)}if(d?.type==="tunnelState"){tunnel=d.tunnel||null;renderAccount()}if(d?.type==="actionBusy"){busy=Boolean(d.busy);document.querySelectorAll("#account button").forEach(b=>{if(b.id!=="copy-url")b.disabled=busy||(!signedIn&&b.id==="get-tunnel")});renderAccount()}});
document.getElementById("refresh").onclick=()=>vscode.postMessage({type:"refresh"});document.getElementById("clear").onclick=()=>vscode.postMessage({type:"clear"});document.getElementById("get-tunnel").onclick=()=>vscode.postMessage({type:"provisionTunnel"});document.getElementById("connect-openai").onclick=()=>vscode.postMessage({type:"connectOpenAITunnel"});document.getElementById("disconnect-openai").onclick=()=>vscode.postMessage({type:"disconnectOpenAITunnel"});document.getElementById("copy-url").onclick=()=>{if(tunnel?.url)vscode.postMessage({type:"copyText",text:tunnel.url})};vscode.postMessage({type:"ready"});
</script></body></html>`;
    }
}
