import * as vscode from "vscode";
import { AgentActivity, AgentActivityItem } from "./activity";
import type { TunnelInfo } from "../tunnel/oneauth-tunnel";
import type { OneAuthUserInfo } from "../auth/oneauth";

export interface SidebarActions {
    signIn: () => Promise<void>;
    signOut: () => Promise<void>;
    getUserInfo: () => Promise<OneAuthUserInfo | undefined>;
    provisionTunnel: () => Promise<TunnelInfo>;
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
:root{
 color-scheme:light dark;
 --md-primary:var(--vscode-button-background,#6750a4);
 --md-on-primary:var(--vscode-button-foreground,#fff);
 --md-primary-container:color-mix(in srgb,var(--md-primary) 18%,var(--vscode-sideBar-background,#1e1e1e));
 --md-on-primary-container:var(--vscode-foreground,#e6e1e5);
 --md-secondary:var(--vscode-textLink-foreground,#b8a4e8);
 --md-secondary-container:color-mix(in srgb,var(--md-secondary) 13%,var(--vscode-sideBar-background,#1e1e1e));
 --md-tertiary:var(--vscode-terminal-ansiBlue,#8ab4f8);
 --md-error:var(--vscode-errorForeground,#f2b8b5);
 --md-success:var(--vscode-testing-iconPassed,#81c995);
 --md-warning:var(--vscode-editorWarning-foreground,#e6c36a);
 --md-surface:var(--vscode-sideBar-background,#1e1e1e);
 --md-surface-1:color-mix(in srgb,var(--md-surface) 95%,var(--vscode-foreground,#fff) 5%);
 --md-surface-2:color-mix(in srgb,var(--md-surface) 91%,var(--vscode-foreground,#fff) 9%);
 --md-surface-3:color-mix(in srgb,var(--md-surface) 86%,var(--vscode-foreground,#fff) 14%);
 --md-on-surface:var(--vscode-foreground,#e6e1e5);
 --md-on-surface-variant:var(--vscode-descriptionForeground,#b9b3c2);
 --md-outline:var(--vscode-panel-border,#49454f);
 --md-outline-variant:color-mix(in srgb,var(--md-outline) 60%,transparent);
 --md-shape-xs:8px;--md-shape-sm:12px;--md-shape-md:16px;--md-shape-lg:22px;--md-shape-xl:28px;
 --md-elevation-1:0 1px 2px #00000018,0 1px 3px #00000012;
 --md-elevation-2:0 3px 8px #00000020,0 1px 3px #00000014;
}
*{box-sizing:border-box}
html,body{height:100%;min-height:100%;}
body{margin:0;padding:14px 12px 0;display:flex;flex-direction:column;gap:12px;overflow:hidden;background:var(--md-surface);color:var(--md-on-surface);font:13px/1.5 var(--vscode-font-family,system-ui,sans-serif);letter-spacing:.1px}
button{font:inherit;cursor:pointer;border:0;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:34px;padding:7px 14px;border-radius:999px;font-weight:600;transition:background .18s ease,box-shadow .18s ease,transform .18s ease,color .18s ease}
button:focus-visible,summary:focus-visible{outline:2px solid var(--vscode-focusBorder,#b8a4e8);outline-offset:3px}
button:disabled{opacity:.5;cursor:wait;transform:none}
button svg,.icon{width:18px;height:18px;flex:0 0 18px;display:block}
button.primary{background:var(--md-primary);color:var(--md-on-primary);box-shadow:var(--md-elevation-1)}
button.primary:hover{box-shadow:var(--md-elevation-2);filter:brightness(1.08)}
button.tonal{background:var(--md-secondary-container);color:var(--md-on-surface)}
button.tonal:hover{background:var(--md-surface-3)}
button.outlined{background:transparent;color:var(--md-on-surface);border:1px solid var(--md-outline)}
button.outlined:hover{background:var(--md-surface-2)}
button.text-button{background:transparent;color:var(--md-secondary);padding-inline:10px}
button.text-button:hover{background:var(--md-secondary-container)}
button.icon-button{width:36px;height:36px;min-height:36px;padding:0;border-radius:50%;background:var(--md-surface-2);color:var(--md-on-surface-variant)}
button.icon-button:hover{background:var(--md-surface-3);color:var(--md-on-surface)}
header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 0 12px;border-bottom:1px solid var(--md-outline-variant);flex:0 0 auto}
.brand{display:flex;align-items:center;gap:10px;min-width:0}
.brand-mark{width:38px;height:38px;display:grid;place-items:center;border-radius:14px;background:var(--md-primary-container);color:var(--md-secondary)}
.brand-mark svg{width:22px;height:22px}
h1{margin:0;font-size:15px;font-weight:700;letter-spacing:-.25px;line-height:1.25}
.sub{font-size:11px;color:var(--md-on-surface-variant)}
header .sub{margin-top:3px}
.actions{display:flex;gap:6px;align-items:center;flex:0 0 auto}
#account{display:flex;flex-direction:column;gap:10px;flex:0 0 auto}
#status{display:flex;align-items:center;gap:9px;padding:11px 13px;border-radius:var(--md-shape-md);background:var(--md-surface-2);color:var(--md-on-surface-variant);font-size:12px}
.dot{width:9px;height:9px;flex:0 0 9px;border-radius:50%;background:var(--md-success);box-shadow:0 0 0 4px color-mix(in srgb,var(--md-success) 16%,transparent)}
#count{font-weight:550}
.activity-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 2px;margin:0 0 1px}
.activity-heading h2{font-size:13px;font-weight:700;margin:0;letter-spacing:.1px}
.activity-heading .sub{font-variant-numeric:tabular-nums}
#feed{display:flex;flex-direction:column;gap:10px;flex:1 1 0;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;align-content:start;padding:1px 2px 12px}
.item{border:1px solid var(--md-outline-variant);border-radius:var(--md-shape-lg);overflow:hidden;background:var(--md-surface-1);box-shadow:var(--md-elevation-1);transition:border-color .18s ease,box-shadow .18s ease}
.item:hover{border-color:color-mix(in srgb,var(--md-secondary) 48%,var(--md-outline));box-shadow:var(--md-elevation-2)}
.item-head{padding:12px 13px 10px;display:flex;justify-content:space-between;gap:10px;align-items:center}
.item-heading{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px;min-width:0}
.tool{font-weight:700;font-size:12px;line-height:1.4;overflow-wrap:anywhere}
.meta,.duration{font-size:10px;color:var(--md-on-surface-variant);white-space:nowrap}
.item-status{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-shrink:0}
.pill{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:999px;background:var(--md-surface-3);color:var(--md-on-surface-variant);font-size:10px;font-weight:700;white-space:nowrap;text-transform:capitalize}
.pill:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.pill.running{background:color-mix(in srgb,var(--md-warning) 16%,var(--md-surface));color:var(--md-warning)}
.pill.success{background:color-mix(in srgb,var(--md-success) 15%,var(--md-surface));color:var(--md-success)}
.pill.error{background:color-mix(in srgb,var(--md-error) 16%,var(--md-surface));color:var(--md-error)}
details{border-top:1px solid var(--md-outline-variant)}
summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;padding:9px 13px;color:var(--md-on-surface-variant);font-size:11px;font-weight:600;user-select:none;transition:background .15s ease,color .15s ease}
summary::-webkit-details-marker{display:none}
summary:after{content:"";width:7px;height:7px;margin-left:auto;border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(45deg) translateY(-2px);transition:transform .15s ease}
details[open]>summary:after{transform:rotate(225deg) translate(-1px,-1px)}
summary:hover{background:var(--md-surface-2);color:var(--md-on-surface)}
pre{margin:0;padding:12px 13px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:280px;overflow:auto;background:var(--vscode-textCodeBlock-background,var(--md-surface-2));color:var(--md-on-surface);font:11px/1.65 var(--vscode-editor-font-family,monospace);tab-size:2}
.diff .add{color:var(--md-success);display:block}.diff .del{color:var(--md-error);display:block}
.command{margin:0 12px 12px;padding:10px;border-radius:var(--md-shape-sm);background:var(--md-surface-2);font-size:10px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.command-details{border-top:1px solid var(--md-outline-variant)}.command-details>summary{padding:9px 13px}.command-details pre{max-height:220px}
.stream{border-top:1px solid var(--md-outline-variant);background:var(--md-surface-2)}
.stream-title{padding:9px 13px;color:var(--md-on-surface-variant);font-size:11px;font-weight:700}
.stream pre{max-height:220px;white-space:pre-wrap;overflow-wrap:anywhere}
.review-actions{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--md-outline-variant)}
.review-actions button{flex:1;min-height:36px}
.review-actions .accept,.pending-review-actions .accept{background:var(--md-primary);color:var(--md-on-primary)}
.review-actions .decline,.pending-review-actions .decline{background:var(--md-secondary-container);color:var(--md-on-surface)}
.review-status{padding:9px 13px;color:var(--md-on-surface-variant);font-size:11px;border-top:1px solid var(--md-outline-variant)}
.empty{padding:28px 16px;text-align:center;color:var(--md-on-surface-variant);border:1px dashed var(--md-outline);border-radius:var(--md-shape-lg);background:var(--md-surface-1);line-height:1.7}
#pending-reviews{position:fixed;left:0;right:0;bottom:66px;z-index:10;display:block;max-height:34vh;overflow-y:auto;padding:12px;background:var(--md-surface);border-top:1px solid var(--md-outline);box-shadow:0 -6px 20px #00000018}
#pending-reviews[hidden]{display:none}
.pending-review-title{display:flex;justify-content:space-between;gap:8px;font-weight:700;margin-bottom:7px}
.pending-review-files,.pending-review-paths{color:var(--md-on-surface-variant);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pending-review-totals{display:flex;align-items:center;gap:9px;font-size:12px;font-weight:700;margin-bottom:5px}
.pending-review-totals .added,.change-count .added{color:var(--md-success)}.pending-review-totals .removed,.change-count .removed{color:var(--md-error)}
.pending-review-paths{margin-bottom:9px}
.pending-review-actions{display:flex;gap:8px}.pending-review-actions button{flex:1;min-height:36px}
#user-bar{position:fixed;left:0;right:0;bottom:0;z-index:11;display:flex;align-items:center;gap:10px;padding:10px 13px;min-height:66px;background:var(--md-surface);border-top:1px solid var(--md-outline-variant);box-shadow:0 -4px 16px #0000000d}
.avatar{width:36px;height:36px;flex:0 0 36px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--md-primary-container);color:var(--md-secondary);font-weight:700;overflow:hidden}
.avatar img{width:100%;height:100%;object-fit:cover}
.user-details{min-width:0;flex:1;overflow:hidden}.user-details .profile-name,.user-details .sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.user-details .profile-name{font-size:12px;font-weight:650}
#bar-state{padding:4px 8px;border-radius:999px;background:var(--md-secondary-container);color:var(--md-on-surface-variant);font-size:10px;font-weight:650}
#signed-out{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:var(--md-surface);padding:22px}
#signed-out[hidden]{display:none}
.sign-in-card{width:100%;max-width:300px;padding:24px 18px;border-radius:var(--md-shape-xl);background:var(--md-surface-2);text-align:center;box-shadow:var(--md-elevation-2)}
.sign-in-mark{width:56px;height:56px;margin:0 auto 14px;display:grid;place-items:center;border-radius:20px;background:var(--md-primary-container);color:var(--md-secondary)}
.sign-in-mark svg{width:30px;height:30px}
.sign-in-card h2{font-size:18px;line-height:1.3;margin:0 0 7px;letter-spacing:-.3px}
.sign-in-card p{margin:0 0 18px;color:var(--md-on-surface-variant);font-size:12px;line-height:1.6}
#sign-in{width:100%;min-height:42px}
body.signed-out header,body.signed-out #account,body.signed-out .activity-heading,body.signed-out #pending-reviews,body.signed-out #user-bar{visibility:hidden}
.change-count{display:flex;gap:8px;align-items:center;padding:8px 13px;font-size:11px;font-weight:700;border-top:1px solid var(--md-outline-variant)}
@media(max-width:320px){body{padding-inline:9px}.item-head{padding:10px}.item-status{gap:4px}.duration{display:none}.review-actions,.pending-review-actions{gap:5px}.review-actions button,.pending-review-actions button{padding-inline:8px}#pending-reviews{padding:9px;max-height:38vh}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{transition:none!important;scroll-behavior:auto!important}}
</style></head><body>
<header><div class="brand"><div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2 20 7.6v8.8l-8 4.4-8-4.4V7.6l8-4.4Z"/><path d="m8.2 12 2.4 2.4 5.2-5.2"/></svg></div><div><h1>VortiqLabs Agent</h1><div class="sub">Workspace activity</div></div></div><div class="actions"><button id="refresh" class="icon-button" title="Refresh activity" aria-label="Refresh activity"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"/></svg></button><button id="clear" class="text-button">Clear</button></div></header>
<section id="signed-out" aria-label="Sign in to VortiqLabs Agent"><div class="sign-in-card"><div class="sign-in-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2 20 7.6v8.8l-8 4.4-8-4.4V7.6l8-4.4Z"/><path d="M8.5 12h7M12 8.5v7"/></svg></div><h2>Your coding workspace, connected</h2><p>Sign in with OneAuth to connect your agent and manage secure workspace activity.</p><button id="sign-in" class="primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg>Sign in with OneAuth</button></div></section>
<section id="account">

<div id="status"><span class="dot"></span><span id="count">Listening for MCP requests…</span></div></section><div class="activity-heading"><h2>Recent activity</h2><span class="sub">Live feed</span></div><main id="feed"><div class="empty">Waiting for the first MCP request</div></main>
<section id="pending-reviews" hidden aria-label="Pending code changes"></section>
<footer id="user-bar" aria-label="Signed-in account"><div id="avatar" class="avatar">?</div><div class="user-details"><div id="bar-name" class="profile-name">Not signed in</div><div id="bar-email" class="sub">OneAuth account</div></div><span id="bar-state" class="sub">Offline</span></footer>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();let items=[];let signedIn=false;let tunnel=null;let busy=false;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function formatDuration(ms){if(ms<1000)return Math.max(0,Math.round(ms))+" ms";if(ms<60000)return (ms/1000).toFixed(ms<10000?1:0)+" s";if(ms<3600000)return (ms/60000).toFixed(ms<600000?1:0)+" min";return (ms/3600000).toFixed(1)+" hr"}
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
  if(review){if(review.preview){body+=details("Proposed change",review.preview)}if(review.status==="pending"){body+='<div class="review-status">Awaiting review in the fixed bottom action bar.</div>'}else{body+='<div class="review-status">Changes '+esc(review.status)+'.</div>'}}
  const elapsed=x.durationMs===undefined?"":(x.durationMs<1000?Math.round(x.durationMs)+" ms":x.durationMs<60000?(x.durationMs/1000).toFixed(x.durationMs<10000?1:0)+" s":x.durationMs<3600000?(x.durationMs/60000).toFixed(1)+" min":(x.durationMs/3600000).toFixed(1)+" hr");
  return '<article class="item" data-activity-id="'+esc(x.id)+'"><div class="item-head"><div class="item-heading"><div class="tool">'+esc(x.tool)+'</div><div class="meta">'+esc(time)+'</div></div><div class="item-status"><span class="pill '+esc(x.status)+'">'+esc(x.status)+'</span>'+(elapsed?'<span class="duration">'+esc(elapsed)+'</span>':"")+'</div></div>'+(x.command?'<details class="command-details"><summary>Command · show full command</summary><pre class="command">$ '+esc(x.command)+'</pre></details>':"")+body+'</article>'
 }).join("");
 feed.querySelectorAll("article[data-activity-id]").forEach(article=>{
  article.querySelectorAll("details").forEach((node,index)=>{node.open=expanded.has(article.dataset.activityId+":"+index)});
 });
}
function updatePendingReviews(){
 const host=document.getElementById("pending-reviews");if(!host)return;
 const found=new Map();
 const inspect=(value,depth=0)=>{if(depth>6||value==null)return;let obj=value;if(typeof obj==="string"){try{obj=JSON.parse(obj)}catch{return}}if(Array.isArray(obj)){for(const item of obj)inspect(item,depth+1);return}if(typeof obj!=="object")return;if(obj.changeReview&&typeof obj.changeReview.id==="string"){const r=obj.changeReview;if(r.status!=="declined"&&r.status!=="accepted")found.set(r.id,{id:r.id,paths:Array.isArray(r.paths)?r.paths:[],preview:String(r.preview||"")})}for(const key of ["resultText","result","data","output","text","content","structuredContent"])if(obj[key]!==undefined)inspect(obj[key],depth+1)};
 for(const item of items)inspect(item);const pending=Array.from(found.values());
 if(!pending.length){host.hidden=true;host.replaceChildren();return}
 let added=0,removed=0;const seen=new Set();for(const r of pending){const key=r.id+"\u0000"+r.preview;if(seen.has(key))continue;seen.add(key);const lines=r.preview.split(String.fromCharCode(10));const replacement=lines.indexOf("+++ Replacement");const current=lines.indexOf("--- Current");if(current>=0&&replacement>current){removed+=lines.slice(current+1,replacement).filter(line=>line.length>0).length;added+=lines.slice(replacement+1).filter(line=>line.length>0).length;continue}for(const line of lines){if(line.startsWith("+")&&!line.startsWith("+++"))added++;else if(line.startsWith("-")&&!line.startsWith("---"))removed++}}
 const paths=[...new Set(pending.flatMap(r=>r.paths))];host.hidden=false;
 host.innerHTML='<div class="pending-review-title"><span>Pending code changes · '+pending.length+'</span><span class="pending-review-files">'+paths.length+' file'+(paths.length===1?'':'s')+'</span></div><div class="pending-review-totals"><span class="added">+'+added+'</span><span class="removed">−'+removed+'</span><span>lines overall</span></div><div class="pending-review-paths">'+esc(paths.join(", "))+'</div><div class="pending-review-actions"><button class="accept" data-review-batch="accept">Accept all</button><button class="decline" data-review-batch="decline">Decline all</button></div>';
}
function renderAccount(){document.getElementById("bar-state").textContent=signedIn?"Connected":"Not signed in";document.body.classList.toggle("signed-out",!signedIn);document.getElementById("signed-out").hidden=signedIn;}
function renderProfile(user){const name=user&&(user.name||user.preferred_username)||"Not signed in";document.getElementById("bar-name").textContent=name;document.getElementById("bar-email").textContent=user?(user.email||(user.preferred_username?"@"+user.preferred_username:"OneAuth account")):"Sign in to OneAuth to load profile";const avatar=document.getElementById("avatar");avatar.replaceChildren();if(user&&user.picture){const img=document.createElement("img");img.src=user.picture;img.alt="";avatar.appendChild(img)}else{avatar.textContent=user?name.trim().charAt(0).toUpperCase():"?"}}
function details(title,body,isDiff=false){if(!body)return "";return '<details><summary>'+esc(title)+'</summary><pre class="'+(isDiff?'diff':'')+'">'+(isDiff?lines(body):esc(body))+'</pre></details>'}
function lines(text){return String(text||"").split(String.fromCharCode(10)).map(line=>{const cls=line.startsWith("+")&&!line.startsWith("+++")?"add":line.startsWith("-")&&!line.startsWith("---")?"del":"";return '<span class="'+cls+'">'+esc(line)+'</span>'}).join("")}
window.addEventListener("error",e=>{vscode.postMessage({type:"webviewError",message:e.message||"Unknown script error"});});
window.addEventListener("message",e=>{const d=e.data;if(d?.type==="snapshot"){items=d.items||[];render();updatePendingReviews()}if(d?.type==="authState"){signedIn=Boolean(d.signedIn);renderAccount();renderProfile(window.oneAuthUser||null)}if(d?.type==="actionBusy"){busy=Boolean(d.busy);renderAccount();}if(d?.type==="userInfo"){window.oneAuthUser=d.userInfo||null;renderProfile(window.oneAuthUser)}});
document.getElementById("sign-in").onclick=()=>vscode.postMessage({type:"signIn"});document.getElementById("refresh").onclick=()=>vscode.postMessage({type:"refresh"});document.getElementById("clear").onclick=()=>vscode.postMessage({type:"clear"});document.getElementById("feed").addEventListener("click",e=>{const button=e.target.closest("button[data-change-review]");if(!button)return;const id=button.getAttribute("data-change-id");const decision=button.getAttribute("data-change-review");if(!id||(decision!=="accept"&&decision!=="decline"))return;document.querySelectorAll("button[data-change-review]").forEach(b=>{if(b.getAttribute("data-change-id")===id)b.disabled=true});vscode.postMessage({type:"resolveCodeChange",id,decision})});document.getElementById("pending-reviews").addEventListener("click",e=>{const button=e.target.closest("button[data-review-batch]");if(!button)return;const decision=button.getAttribute("data-review-batch");if(decision!=="accept"&&decision!=="decline")return;const ids=new Set();const scan=(value,depth=0)=>{if(depth>6||value==null)return;let obj=value;if(typeof obj==="string"){try{obj=JSON.parse(obj)}catch{return}}if(Array.isArray(obj)){for(const item of obj)scan(item,depth+1);return}if(typeof obj!=="object")return;if(obj.changeReview&&typeof obj.changeReview.id==="string"&&obj.changeReview.status!=="accepted"&&obj.changeReview.status!=="declined")ids.add(obj.changeReview.id);for(const key of ["resultText","result","data","output","text","content","structuredContent"])if(obj[key]!==undefined)scan(obj[key],depth+1)};for(const item of items)scan(item.resultText);button.disabled=true;const buttons=document.querySelectorAll("#pending-reviews button");buttons.forEach(b=>b.disabled=true);(async()=>{for(const id of ids){vscode.postMessage({type:"resolveCodeChange",id,decision});await new Promise(resolve=>setTimeout(resolve,120))}setTimeout(()=>{buttons.forEach(b=>b.disabled=false)},1500)})()});renderAccount();vscode.postMessage({type:"ready"});
</script></body></html>`;
    }
}
