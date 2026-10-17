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
    resolveCodeChange: (id: string, decision: "accept" | "decline") => Promise<unknown>;
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
            this.output?.appendLine(`[${new Date().toISOString()}] [Sidebar] Received webview message: ${String(message?.type ?? "unknown")}`);
            if (message?.type === "webviewError") {
                this.output?.appendLine(`[${new Date().toISOString()}] [Sidebar] Webview script error: ${String(message.message ?? "Unknown error")}`);
            }
            if (message?.type === "signIn") { this.output?.appendLine(`[${new Date().toISOString()}] [Sidebar] Sign-in click message received from webview.`); }
            if (message?.type === "ready") {

                this.post({ type: "snapshot", items: this.activity.snapshot() });
                this.post({ type: "authState", signedIn: this.signedIn });
                this.post({ type: "userInfo", userInfo: this.userInfo ?? null });
                this.post({ type: "tunnelState", tunnel: this.tunnel ?? null });
            }
            if (message?.type === "clear") {this.activity.clear();}
            if (message?.type === "refresh") {this.post({ type: "snapshot", items: this.activity.snapshot() });}
            if (message?.type === "resolveCodeChange" && typeof message.id === "string" && (message.decision === "accept" || message.decision === "decline")) {
                try {
                    const result = await this.actions.resolveCodeChange(message.id, message.decision);
                    const decisionLabel = message.decision === "accept" ? "accepted" : "declined and reverted";
                    this.output?.appendLine(`[${new Date().toISOString()}] [Sidebar] Code change ${decisionLabel}: ${message.id}`);
                    void vscode.window.showInformationMessage(`Code change ${decisionLabel}.`);
                    this.post({ type: "snapshot", items: this.activity.snapshot() });
                } catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    this.output?.appendLine(`[${new Date().toISOString()}] [Sidebar] Code change review failed: ${detail}`);
                    void vscode.window.showErrorMessage(`Could not resolve code change: ${detail}`);
                }
            }
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
        // Register the host message handler before assigning HTML so the webview's
        // initial "ready" handshake cannot race the listener registration.
        view.webview.html = this.html(view.webview);
        this.post({ type: "authState", signedIn: this.signedIn });
        this.post({ type: "userInfo", userInfo: this.userInfo ?? null });
        this.post({ type: "tunnelState", tunnel: this.tunnel ?? null });
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
        if (!this.view) {
            this.output?.appendLine(`[${new Date().toISOString()}] [Sidebar] Cannot send message: webview is not initialized.`);
            return;
        }
        const type = typeof message === "object" && message !== null && "type" in message
            ? String((message as { type: unknown }).type)
            : "unknown";
        void this.view.webview.postMessage(message).then(sent => {
            if (!sent) {
                this.output?.appendLine(`[${new Date().toISOString()}] [Sidebar] Webview did not accept outgoing message: ${type}`);
            }
        }, error => {
            this.output?.appendLine(`[${new Date().toISOString()}] [Sidebar] Failed to send outgoing message ${type}: ${error instanceof Error ? error.message : String(error)}`);
        });
    }


    private html(webview: vscode.Webview): string {
        const nonce = [...Array(32)].map(() => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)]).join("");
        return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>VortiqLabs Agent</title>
<style>
:root{color-scheme:dark;--panel:var(--vscode-sideBar-background);--border:var(--vscode-panel-border);--fg:var(--vscode-foreground);--muted:var(--vscode-descriptionForeground);--accent:var(--vscode-textLink-foreground);--green:var(--vscode-testing-iconPassed,#4ec9b0);--red:var(--vscode-testing-iconFailed,#f48771);--yellow:var(--vscode-editorWarning-foreground,#cca700)}
*{box-sizing:border-box}body{margin:0;padding:12px 12px 64px;background:var(--panel);color:var(--fg);font:12px/1.5 var(--vscode-font-family)}header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}h1{font-size:14px;margin:0;font-weight:650;letter-spacing:.2px}.sub{color:var(--muted);font-size:11px}.actions{display:flex;gap:5px;flex-wrap:wrap}button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--border);border-radius:5px;padding:5px 8px;cursor:pointer;font:inherit}button:hover{background:var(--vscode-button-secondaryHoverBackground)}button:disabled{opacity:.55;cursor:wait}.review-actions{display:flex;gap:6px;padding:8px 9px;border-top:1px solid var(--border)}.review-actions .accept{background:var(--vscode-testing-iconPassed,#2e8b57);color:#fff;border-color:transparent}.review-actions .decline{background:var(--vscode-button-secondaryBackground);color:var(--vscode-errorForeground,#f48771)}.review-status{padding:5px 9px;color:var(--muted);font-size:11px;border-top:1px solid var(--border)}.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-color:transparent}.primary:hover{background:var(--vscode-button-hoverBackground)}#account{border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:12px}.account-row{display:flex;justify-content:space-between;align-items:center;gap:8px}.section-title{font-weight:650;font-size:12px}.muted{color:var(--muted)}.profile{margin-top:9px;padding:9px;border-radius:6px;background:color-mix(in srgb,var(--panel) 82%,var(--fg) 6%);overflow-wrap:anywhere}.profile-name{font-weight:650;font-size:13px}.profile .sub{margin-top:2px}#auth-status{font-size:11px;color:var(--muted);margin:3px 0 9px}.tunnel{margin-top:10px;padding-top:9px;border-top:1px solid var(--border);overflow-wrap:anywhere}.tunnel-line{margin-top:5px}.tunnel-label{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.5px}.tunnel-value{font-family:var(--vscode-editor-font-family,monospace);font-size:11px;overflow-wrap:anywhere;user-select:text}#status{display:flex;gap:6px;align-items:center;color:var(--muted);margin-bottom:10px}.dot{width:7px;height:7px;border-radius:50%;background:var(--green)}#feed{display:flex;flex-direction:column;gap:9px}.item{border:1px solid var(--border);border-radius:8px;overflow:hidden;background:color-mix(in srgb,var(--panel) 88%,var(--fg) 4%)}.item-head{padding:8px 9px;display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.tool{font-weight:650;overflow-wrap:anywhere}.meta{font-size:10px;color:var(--muted);white-space:nowrap}.pill{font-size:10px;padding:1px 5px;border-radius:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}.pill.running{color:var(--yellow)}.pill.error{color:var(--red)}.pill.success{color:var(--green)}details{border-top:1px solid var(--border)}summary{cursor:pointer;color:var(--muted);padding:5px 9px;user-select:none}pre{margin:0;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;background:var(--vscode-textCodeBlock-background);font:11px/1.5 var(--vscode-editor-font-family,monospace)}.diff .add{color:var(--green);display:block}.diff .del{color:var(--red);display:block}.stream{border-top:1px solid var(--border)}.stream-title{padding:5px 9px;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.6px}.empty{padding:28px 8px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:8px}.command{color:var(--accent);font-family:var(--vscode-editor-font-family,monospace);overflow-wrap:anywhere}#user-bar{position:fixed;bottom:0;left:0;right:0;z-index:5;display:flex;align-items:center;gap:9px;padding:10px 12px;background:var(--vscode-sideBar-background);border-top:1px solid var(--border);min-height:58px}.avatar{width:32px;height:32px;flex:0 0 32px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--vscode-button-secondaryBackground);color:var(--fg);font-weight:700;overflow:hidden}.avatar img{width:100%;height:100%;object-fit:cover}.user-details{min-width:0;flex:1;overflow:hidden}.user-details .profile-name,.user-details .sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Polished, compact sidebar layout and responsive activity cards */
:root{--card:var(--vscode-editorWidget-background,var(--vscode-sideBar-background));--line:var(--vscode-panel-border);--soft:var(--vscode-input-background)}
body{padding:14px 12px 78px;letter-spacing:.1px}
header{position:sticky;top:0;z-index:4;padding:8px 0 12px;background:var(--panel);border-bottom:1px solid var(--line);margin-bottom:12px}
h1{font-size:15px;letter-spacing:-.25px}
header .sub{margin-top:3px}
.actions{flex-wrap:nowrap}
button{min-height:28px;border-radius:7px;padding:5px 9px;transition:background .12s ease,border-color .12s ease}
button:focus-visible,summary:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}
#account{border:0;padding:0;margin:0 0 12px}
#status{padding:9px 10px;margin:0 0 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);font-size:11px}
.dot{flex:0 0 7px;box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 15%,transparent)}
#feed{gap:10px}
.item{border:1px solid var(--line);border-radius:10px;background:var(--card);box-shadow:0 1px 2px #00000012;transition:border-color .15s ease}
.item:hover{border-color:var(--vscode-focusBorder)}
.item-head{padding:10px 10px 9px;align-items:center}
.tool{font-size:12px;line-height:1.4}
.meta{margin-top:3px;white-space:normal;line-height:1.5}
.pill{display:inline-flex;align-items:center;gap:4px;flex-shrink:0;padding:3px 7px;font-weight:600;border-radius:999px;white-space:nowrap}
.pill.running{background:color-mix(in srgb,var(--yellow) 16%,var(--card))}
.pill.success{background:color-mix(in srgb,var(--green) 14%,var(--card))}
.pill.error{background:color-mix(in srgb,var(--red) 14%,var(--card))}
details{border-top:1px solid color-mix(in srgb,var(--line) 70%,transparent)}
summary{padding:7px 10px;display:flex;align-items:center;gap:6px;font-size:11px}
summary:hover{color:var(--fg);background:color-mix(in srgb,var(--fg) 4%,transparent)}
pre{padding:10px;max-height:280px;line-height:1.6;tab-size:2}
.command{margin-top:4px;padding:4px 6px;border-radius:5px;background:var(--soft);font-size:10px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.stream{border-top:1px solid var(--line);background:color-mix(in srgb,var(--vscode-terminal-background,var(--card)) 80%,transparent)}
.stream-title{display:flex;align-items:center;gap:6px;padding:8px 10px;font-weight:650;letter-spacing:.25px;text-transform:none;font-size:11px}
.stream pre{max-height:240px;white-space:pre-wrap;overflow-wrap:anywhere}
.review-actions{padding:9px 10px;gap:8px}
.review-actions button{flex:1;min-height:32px;font-weight:650}
.review-actions .accept{background:var(--vscode-testing-iconPassed,#2e8b57)}
.review-actions .decline{border-color:color-mix(in srgb,var(--red) 35%,var(--line))}
.review-status{padding:8px 10px}
.empty{padding:30px 12px;border-radius:10px;line-height:1.7}
#user-bar{padding:10px 12px;min-height:66px;background:var(--vscode-sideBar-background);border-top:1px solid var(--line);box-shadow:0 -5px 16px #0000000a}
.avatar{width:34px;height:34px;flex-basis:34px;border:1px solid var(--line)}
.user-details .profile-name{font-size:12px}
.user-details .sub{font-size:10px}
@media (max-width:320px){body{padding-left:9px;padding-right:9px}.item-head{padding:8px}.review-actions{flex-direction:column}.actions button{padding:4px 7px}}
#pending-reviews{position:fixed;z-index:5;left:0;right:0;bottom:66px;padding:8px 12px;background:var(--vscode-sideBar-background);border-top:1px solid var(--border);box-shadow:0 -5px 16px #00000012}#pending-reviews:not([hidden]){display:block}.pending-review-title{font-weight:650;margin-bottom:6px}.pending-review-item{display:flex;align-items:center;gap:8px;min-width:0}.pending-review-path{color:var(--muted);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.pending-review-actions{display:flex;gap:6px}.pending-review-actions button{font-weight:650;min-height:30px}.pending-review-actions .accept{background:var(--vscode-testing-iconPassed,#2e8b57);color:#fff;border-color:transparent}.pending-review-actions .decline{color:var(--vscode-errorForeground,#f48771)}@media(max-width:320px){#pending-reviews{padding:7px}.pending-review-item{flex-wrap:wrap}.pending-review-actions{width:100%}.pending-review-actions button{flex:1}}
</style></head><body>
<header><div><h1>VortiqLabs Agent</h1><div class="sub">Workspace agent · live activity</div></div><div class="actions"><button id="refresh" title="Refresh activity">↻</button><button id="clear">Clear</button></div></header>
<section id="account">

<div id="status"><span class="dot"></span><span id="count">Listening for MCP requests…</span></div><main id="feed"><div class="empty">Waiting for the first MCP request</div></main>
<section id="pending-reviews" hidden aria-label="Pending code changes"></section>
<footer id="user-bar" aria-label="Signed-in account"><div id="avatar" class="avatar">?</div><div class="user-details"><div id="bar-name" class="profile-name">Not signed in</div><div id="bar-email" class="sub">OneAuth account</div></div><span id="bar-state" class="sub">Offline</span></footer>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();let items=[];let signedIn=false;let tunnel=null;let busy=false;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function render(){
 const feed=document.getElementById("feed");
 const expanded=new Set();
 feed.querySelectorAll("article[data-activity-id]").forEach(article=>{
  article.querySelectorAll("details").forEach((node,index)=>{if(node.open)expanded.add(article.dataset.activityId+":"+index)});
 });
 document.getElementById("count").textContent=items.length+" request"+(items.length===1?"":"s")+" · "+items.filter(x=>x.status==="running").length+" running";
 if(!items.length){feed.innerHTML='<div class="empty">Waiting for the first MCP request</div>';return}
 feed.innerHTML=items.map(x=>{
  const time=new Date(x.startedAt).toLocaleTimeString();
  let result=x.resultText||"";let diff=result;let review=null;let parsed=null;
  try{parsed=JSON.parse(result)}catch{}
  const candidates=[];
  if(parsed&&typeof parsed==="object"){
   candidates.push(parsed);
   for(const key of ["result","data","output"]){if(parsed[key]&&typeof parsed[key]==="object")candidates.push(parsed[key])}
   if(Array.isArray(parsed.content)){for(const part of parsed.content){if(typeof part?.text==="string"){try{const nested=JSON.parse(part.text);if(nested&&typeof nested==="object")candidates.push(nested)}catch{}}}}
  }
  for(const candidate of candidates){
   if(typeof candidate.diff==="string")diff=candidate.diff;else if(typeof candidate.patch==="string")diff=candidate.patch;
   if(candidate.changeReview&&typeof candidate.changeReview.id==="string")review=candidate.changeReview;
   if(typeof candidate.text==="string"){try{const nested=JSON.parse(candidate.text);if(nested&&typeof nested==="object"){if(nested.changeReview&&typeof nested.changeReview.id==="string")review=nested.changeReview;if(typeof nested.diff==="string")diff=nested.diff;else if(typeof nested.patch==="string")diff=nested.patch}}catch{}}
  }
  const looksDiff=diff.split(String.fromCharCode(10)).some(line=>line.startsWith("diff --git ")||line.startsWith("+++ ")||line.startsWith("--- ")||line.startsWith("@@ "));
  let body=details("Arguments",x.argumentsText)+details(looksDiff?"Git diff / patch":"Result",looksDiff?diff:result,looksDiff)+details("Error",x.errorText)+((x.stdout||x.stderr)?'<details class="terminal"><summary><span>Terminal output</span><span>'+(x.exitCode!==undefined?'exit '+x.exitCode:'streaming…')+'</span></summary><div class="terminal-screen">'+(x.stdout?'<pre>'+esc(x.stdout)+'</pre>':'')+(x.stderr?'<pre class="stderr">'+esc(x.stderr)+'</pre>':'')+'</div></details>':"");
  if(review){if(review.preview){body+=details("Proposed change",review.preview)}if(review.status==="pending"){body+='<div class="review-actions"><button class="accept" data-change-review="accept" data-change-id="'+esc(review.id)+'">Accept changes</button><button class="decline" data-change-review="decline" data-change-id="'+esc(review.id)+'">Decline &amp; revert</button></div>'}else{body+='<div class="review-status">Changes '+esc(review.status)+'.</div>'}}
  return '<article class="item" data-activity-id="'+esc(x.id)+'"><div class="item-head"><div><div class="tool">'+esc(x.tool)+'</div><div class="meta">'+esc(time)+(x.command?'<div class="command">$ '+esc(x.command)+'</div>':"")+'</div></div><span class="pill '+esc(x.status)+'">'+esc(x.status)+(x.durationMs!==undefined?' · '+x.durationMs+'ms':'')+'</span></div>'+body+'</article>'
 }).join("");
 feed.querySelectorAll("article[data-activity-id]").forEach(article=>{
  article.querySelectorAll("details").forEach((node,index)=>{node.open=expanded.has(article.dataset.activityId+":"+index)});
 });
}
function updatePendingReviews(){const host=document.getElementById("pending-reviews");if(!host)return;const found=new Map();const inspect=(value,depth=0)=>{if(depth>5||value==null)return;let obj=value;if(typeof obj==="string"){try{obj=JSON.parse(obj)}catch{return}}if(Array.isArray(obj)){for(const item of obj)inspect(item,depth+1);return}if(typeof obj!=="object")return;if(obj.changeReview&&typeof obj.changeReview.id==="string"){const r=obj.changeReview;if(r.status==="declined"||r.status==="accepted")return;found.set(r.id,{id:r.id,paths:Array.isArray(r.paths)?r.paths:[],status:r.status||((obj.pendingApproval===true)?"pending":"pending")})}for(const key of ["result","data","output","text","content","structuredContent"]){if(obj[key]!==undefined)inspect(obj[key],depth+1)}};for(const item of items)inspect(item.resultText);if(!found.size){host.hidden=true;host.replaceChildren();return}host.hidden=false;host.innerHTML='<div class="pending-review-title">Review code changes ('+found.size+')</div>'+Array.from(found.values()).map(r=>'<div class="pending-review-item"><div class="pending-review-path">'+esc(r.paths.join(", ")||"Proposed code change")+'</div><div class="pending-review-actions"><button class="accept" data-change-review="accept" data-change-id="'+esc(r.id)+'">Accept</button><button class="decline" data-change-review="decline" data-change-id="'+esc(r.id)+'">Decline</button></div></div>').join("")}
function renderAccount(){document.getElementById("bar-state").textContent=signedIn?"Connected":"Not signed in";}
function renderProfile(user){const name=user&&(user.name||user.preferred_username)||"Not signed in";document.getElementById("bar-name").textContent=name;document.getElementById("bar-email").textContent=user?(user.email||(user.preferred_username?"@"+user.preferred_username:"OneAuth account")):"Sign in to OneAuth to load profile";const avatar=document.getElementById("avatar");avatar.replaceChildren();if(user&&user.picture){const img=document.createElement("img");img.src=user.picture;img.alt="";avatar.appendChild(img)}else{avatar.textContent=user?name.trim().charAt(0).toUpperCase():"?"}}
function details(title,body,isDiff=false){if(!body)return "";return '<details><summary>'+esc(title)+'</summary><pre class="'+(isDiff?'diff':'')+'">'+(isDiff?lines(body):esc(body))+'</pre></details>'}
function lines(text){return String(text||"").split(String.fromCharCode(10)).map(line=>{const cls=line.startsWith("+")&&!line.startsWith("+++")?"add":line.startsWith("-")&&!line.startsWith("---")?"del":"";return '<span class="'+cls+'">'+esc(line)+'</span>'}).join("")}
window.addEventListener("error",e=>{vscode.postMessage({type:"webviewError",message:e.message||"Unknown script error"});});
window.addEventListener("message",e=>{const d=e.data;if(d?.type==="snapshot"){items=d.items||[];render();updatePendingReviews()}if(d?.type==="authState"){signedIn=Boolean(d.signedIn);renderAccount();renderProfile(window.oneAuthUser||null)}if(d?.type==="userInfo"){window.oneAuthUser=d.userInfo||null;renderProfile(window.oneAuthUser)}});
document.getElementById("refresh").onclick=()=>vscode.postMessage({type:"refresh"});document.getElementById("clear").onclick=()=>vscode.postMessage({type:"clear"});document.getElementById("feed").addEventListener("click",e=>{const button=e.target.closest("button[data-change-review]");if(!button)return;const id=button.getAttribute("data-change-id");const decision=button.getAttribute("data-change-review");if(!id||(decision!=="accept"&&decision!=="decline"))return;document.querySelectorAll("button[data-change-review]").forEach(b=>{if(b.getAttribute("data-change-id")===id)b.disabled=true});vscode.postMessage({type:"resolveCodeChange",id,decision})});document.getElementById("pending-reviews").addEventListener("click",e=>{const button=e.target.closest("button[data-change-review]");if(!button)return;const id=button.getAttribute("data-change-id");const decision=button.getAttribute("data-change-review");if(!id||(decision!=="accept"&&decision!=="decline"))return;document.querySelectorAll("button[data-change-review]").forEach(b=>{if(b.getAttribute("data-change-id")===id)b.disabled=true});vscode.postMessage({type:"resolveCodeChange",id,decision})});vscode.postMessage({type:"ready"});
</script></body></html>`;
    }
}
