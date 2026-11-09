import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentActivity } from "./ui/activity";
import { AgentSidebarProvider } from "./ui/sidebar";
import { OneAuthClient } from "./auth/oneauth";
import { OneAuthTunnelClient, TunnelInfo } from "./tunnel/oneauth-tunnel";

import {
    Agent
} from "./agent/agent";

import {
    generateAuthToken
} from "./mcp/auth";

import {
    VortiqMcpServer
} from "./mcp/server";

export async function activate(
    context: vscode.ExtensionContext
) {
    // Remove credentials and the downloaded runtime left by the retired OpenAI MCP tunnel.
    await Promise.all([
        context.secrets.delete("openaiTunnel.runtimeApiKey"),
        context.secrets.delete("openaiTunnel.tunnelId"),
        fs.rm(path.join(context.globalStorageUri.fsPath, "openai-tunnel-client"), { recursive: true, force: true })
    ]);
    const legacyTunnelSettings = vscode.workspace.getConfiguration("vortiqlabsAgent");
    await Promise.all([
        legacyTunnelSettings.update("openAITunnelRuntime", undefined, vscode.ConfigurationTarget.Global),
        legacyTunnelSettings.update("openAITunnelOrganizationId", undefined, vscode.ConfigurationTarget.Global)
    ]);
    const output = vscode.window.createOutputChannel("VortiqLabs Agent");
    context.subscriptions.push(output);
    const log = (message: string, details?: unknown) => {
        const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
        output.appendLine(`[${new Date().toISOString()}] ${message}${suffix}`);
    };
    log("Activating extension", {
        workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
        extensionMode: context.extensionMode === vscode.ExtensionMode.Development ? "development" : "production"
    });
    console.log(
        "VortiqLabs Agent activated"
    );

    let authToken =
        process.env.VORTIQLABS_AGENT_AUTH_TOKEN;

    if (!authToken) {
        authToken = generateAuthToken();
        process.env.VORTIQLABS_AGENT_AUTH_TOKEN = authToken;
    }

    const activity = new AgentActivity();
    const loggedActivity = new Map<string, string>();
    context.subscriptions.push(activity.subscribe(items => {
        for (const item of items) {
            const signature = `${item.status}:${item.durationMs ?? ""}:${item.stdout.length}:${item.stderr.length}:${item.errorText ?? ""}`;
            if (loggedActivity.get(item.id) === signature) { continue; }
            loggedActivity.set(item.id, signature);
            log(`Tool ${item.status}: ${item.tool}`, {
                id: item.id,
                arguments: item.argumentsText,
                durationMs: item.durationMs,
                result: item.resultText,
                error: item.errorText,
                exitCode: item.exitCode
            });
        }
        while (loggedActivity.size > 100) {
            const oldest = loggedActivity.keys().next().value;
            if (oldest === undefined) { break; }
            loggedActivity.delete(oldest);
        }
    }));
    const agent =
        new Agent(context, undefined, activity);

    const workspaceRoot =
        process.env.MCP_WORKSPACE_ROOT ||
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const mcpServer = new VortiqMcpServer({
        host: "127.0.0.1",
        port: 3000,
        workspaceRoot,
        agentRequestHandler: request => agent.handle(request),
        extensionVersion: context.extension.packageJSON.version
    });

    await mcpServer.start();
    log("MCP server listening without OneAuth authentication", { host: mcpServer.getHost(), port: mcpServer.getPort(), path: "/mcp" });

    const focusActivityCommand = vscode.commands.registerCommand("vortiqlabs-agent.focusActivity", async () => {
        await vscode.commands.executeCommand("workbench.view.extension.vortiqlabs-agent");
    });
    const authClient = new OneAuthClient(context, output);
    const tunnelClient = new OneAuthTunnelClient(authClient);
    let sidebarProvider!: AgentSidebarProvider;
    const doSignIn = async () => {
        log("OneAuth sign-in action invoked.");
        await authClient.signIn();
        sidebarProvider.setAuthState(true);
        try {
            // User profile is persisted in VS Code globalState; avoid a userinfo API
            // request on every activation or repeated Sign in click.
            const userInfo = await authClient.getUserInfo();
            sidebarProvider.setUserInfo(userInfo);
            log("OneAuth profile loaded after sign-in.", {
                hasName: Boolean(userInfo?.name),
                hasUsername: Boolean(userInfo?.preferred_username),
                hasEmail: Boolean(userInfo?.email),
                hasPicture: Boolean(userInfo?.picture)
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log("Sign-in succeeded but OneAuth profile could not be loaded.", message);
            sidebarProvider.setUserInfo(undefined);
            throw error instanceof Error ? error : new Error(message);
        }
        log("OneAuth sign-in action completed.");
    };
    const doSignOut = async () => {
        await authClient.signOut();
        await context.globalState.update("agentTunnel", undefined);
        sidebarProvider.setAuthState(false);
        sidebarProvider.setUserInfo(undefined);
        sidebarProvider.setTunnelInfo(undefined);
    };
    const getTunnel = async (): Promise<TunnelInfo> => {
        const tunnel = await tunnelClient.provision();
        await context.globalState.update("agentTunnel", tunnel);
        sidebarProvider.setTunnelInfo(tunnel);
        return tunnel;
    };
    sidebarProvider = new AgentSidebarProvider(context, activity, {
        signIn: doSignIn,
        signOut: doSignOut,
        getUserInfo: () => authClient.getUserInfo(),
        provisionTunnel: getTunnel,
        resolveCodeChange: (id, decision) => agent.resolveChangeReview(id, decision)
    }, output);
    const savedTunnel = context.globalState.get<TunnelInfo>("agentTunnel");
    if (savedTunnel) {sidebarProvider.setTunnelInfo(savedTunnel);}
    void authClient.isSignedIn().then(async signedIn => {
        sidebarProvider.setAuthState(signedIn);
        if (signedIn) {
            try {
                // getUserInfo serves the persisted profile cache first and only calls
                // OneAuth if this is the first profile load for this installation.
                sidebarProvider.setUserInfo(await authClient.getUserInfo());
                log("Existing OneAuth session restored.");
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log("Unable to restore OneAuth profile", message);
                if (message.includes("Sign in to OneAuth first.")) {
                    await authClient.signOut();
                    sidebarProvider.setAuthState(false);
                    sidebarProvider.setUserInfo(undefined);
                    log("Cleared stale OneAuth credentials; prompting for sign-in.");
                    const choice = await vscode.window.showWarningMessage(
                        "Your saved OneAuth session is no longer valid. Sign in to OneAuth again?",
                        "Sign in",
                        "Not now"
                    );
                    if (choice === "Sign in") {
                        try {
                            await doSignIn();
                        } catch (signInError) {
                            const signInMessage = signInError instanceof Error ? signInError.message : String(signInError);
                            log("Reauthentication after profile restore failed.", signInMessage);
                            void vscode.window.showErrorMessage(`OneAuth sign-in failed: ${signInMessage}`);
                        }
                    }
                }
            }
            return;
        }

        log("No OneAuth session found; MCP server remains available without authentication.");
    }).catch(error => log("Unable to restore OneAuth sign-in state", error instanceof Error ? error.message : String(error)));
    const signInCommand = vscode.commands.registerCommand("vortiqlabs-agent.signIn", async () => {
        try {await doSignIn();} catch (error) {void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));}
    });
    const signOutCommand = vscode.commands.registerCommand("vortiqlabs-agent.signOut", async () => {
        try {await doSignOut();} catch (error) {void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));}
    });
    const getTunnelCommand = vscode.commands.registerCommand("vortiqlabs-agent.getTunnel", async () => {
        try {const tunnel = await getTunnel(); void vscode.window.showInformationMessage(`Tunnel: ${tunnel.url} · port ${tunnel.port}`);} catch (error) {void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));}
    });
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(AgentSidebarProvider.viewId, sidebarProvider, { webviewOptions: { retainContextWhenHidden: true } }),
        { dispose: () => sidebarProvider.dispose() },
        signInCommand,
        signOutCommand,
        getTunnelCommand
    );

    const workspaceCommand =
        vscode.commands.registerCommand(
            "vortiqlabs-agent.workspace",
            async () => {
                const result =
                    await agent.handle({
                        id:
                            "local-workspace",
                        tool:
                            "workspace.get",
                        arguments: {}
                    });

                console.log(
                    JSON.stringify(
                        result,
                        null,
                        2
                    )
                );

                if (
                    result.success &&
                    result.result
                ) {
                    const workspace =
                        result.result as {
                            name:
                                string | null;
                        };

                    vscode.window.showInformationMessage(
                        `Workspace: ${
                            workspace.name ??
                            "Unnamed"
                        }`
                    );
                } else {
                    vscode.window.showWarningMessage(
                        "No workspace is currently open."
                    );
                }
            }
        );

    const fileReadCommand =
        vscode.commands.registerCommand(
            "vortiqlabs-agent.fileRead",
            async () => {
                const filePath =
                    await vscode.window.showInputBox({
                        prompt:
                            "Enter a workspace-relative file path",
                        placeHolder:
                            "src/index.ts"
                    });

                if (!filePath) {
                    return;
                }

                const result =
                    await agent.handle({
                        id:
                            "local-file-read",
                        tool:
                            "file.read",
                        arguments: {
                            path:
                                filePath
                        }
                    });

                console.log(
                    JSON.stringify(
                        result,
                        null,
                        2
                    )
                );

                if (result.success) {
                    const file =
                        result.result as {
                            path:
                                string;
                            size:
                                number;
                        };

                    vscode.window.showInformationMessage(
                        `Read ${file.path} (${file.size} bytes)`
                    );
                } else {
                    vscode.window.showErrorMessage(
                        result.error.message
                    );
                }
            }
        );

    const fileWriteCommand =
        vscode.commands.registerCommand(
            "vortiqlabs-agent.fileWrite",
            async () => {
                const filePath =
                    await vscode.window.showInputBox({
                        prompt:
                            "Enter a workspace-relative file path to write",
                        placeHolder:
                            "src/newfile.ts"
                    });

                if (!filePath) {
                    return;
                }

                const content =
                    await vscode.window.showInputBox({
                        prompt:
                            "Enter file content",
                        placeHolder:
                            "content..."
                    });

                if (content === undefined) {
                    return;
                }

                const result =
                    await agent.handle({
                        id:
                            "local-file-write",
                        tool:
                            "file.write",
                        arguments: {
                            path:
                                filePath,
                            content
                        }
                    });

                if (result.success) {
                    vscode.window.showInformationMessage(
                        result.result && typeof result.result === "object" && "pendingApproval" in result.result && result.result.pendingApproval === true
                            ? `Proposal for ${filePath} is ready. Review it in the VortiqLabs Agent sidebar.`
                            : `Wrote ${filePath}`
                    );
                } else {
                    vscode.window.showErrorMessage(
                        result.error.message
                    );
                }
            }
        );

    const fileEditCommand =
        vscode.commands.registerCommand(
            "vortiqlabs-agent.fileEdit",
            async () => {
                const filePath =
                    await vscode.window.showInputBox({
                        prompt:
                            "Enter a workspace-relative file path to edit",
                        placeHolder:
                            "src/index.ts"
                    });

                if (!filePath) {
                    return;
                }

                const startLineStr =
                    await vscode.window.showInputBox({
                        prompt:
                            "Start line number (1-indexed)",
                        placeHolder:
                            "1"
                    });

                if (!startLineStr) {
                    return;
                }

                const endLineStr =
                    await vscode.window.showInputBox({
                        prompt:
                            "End line number (1-indexed)",
                        placeHolder:
                            "1"
                    });

                if (!endLineStr) {
                    return;
                }

                const content =
                    await vscode.window.showInputBox({
                        prompt:
                            "Replacement content",
                        placeHolder:
                            "new lines..."
                    });

                if (content === undefined) {
                    return;
                }

                const result =
                    await agent.handle({
                        id:
                            "local-file-edit",
                        tool:
                            "file.replace_range",
                        arguments: {
                            path:
                                filePath,
                            startLine:
                                parseInt(startLineStr, 10),
                            endLine:
                                parseInt(endLineStr, 10),
                            content
                        }
                    });

                if (result.success) {
                    vscode.window.showInformationMessage(
                        result.result && typeof result.result === "object" && "pendingApproval" in result.result && result.result.pendingApproval === true
                            ? `Proposal for ${filePath} is ready. Review it in the VortiqLabs Agent sidebar.`
                            : `Edited ${filePath}`
                    );
                } else {
                    vscode.window.showErrorMessage(
                        result.error.message
                    );
                }
            }
        );

    context.subscriptions.push(
        workspaceCommand,
        fileReadCommand,
        fileWriteCommand,
        fileEditCommand,
        focusActivityCommand,
        {
            dispose: () => {
                void agent.dispose().catch(error => {
                    console.error("Failed to stop Codebase Indexer background processes:", error);
                });
            }
        },
        {
            dispose: () => {
                void mcpServer
                    .stop()
                    .catch(error => {
                        console.error(
                            "Failed to stop VortiqLabs Agent MCP server:",
                            error
                        );
                    });
            }
        }
    );
}

export function deactivate() {}