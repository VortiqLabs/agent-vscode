import * as vscode from "vscode";

import {
    Agent
} from "./agent/agent";

import {
    AgentServer
} from "./transport";

import {
    generateAuthToken
} from "./mcp/auth";

export function activate(
    context: vscode.ExtensionContext
) {
    console.log(
        "VortiqLabs Agent activated"
    );

    let authToken =
        process.env.VORTIQLABS_AGENT_AUTH_TOKEN ||
        process.env.MCP_AUTH_TOKEN;

    if (!authToken) {
        authToken = generateAuthToken();
        process.env.VORTIQLABS_AGENT_AUTH_TOKEN = authToken;
    }

    const agent =
        new Agent(context);

    const agentServer =
        new AgentServer(
            agent,
            {
                host:
                    "127.0.0.1",
                port:
                    43127,
                authToken
            }
        );

    void agentServer.start()
        .then(() => {
            console.log(
                `VortiqLabs Agent server listening on ` +
                `http://${agentServer.getHost()}:` +
                `${agentServer.getPort()}`
            );
        })
        .catch(error => {
            console.error(
                "Failed to start VortiqLabs Agent server:",
                error
            );

            vscode.window.showErrorMessage(
                "VortiqLabs Agent failed to start its local server."
            );
        });

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
                        `Wrote ${filePath}`
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
                        `Edited ${filePath}`
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
        {
            dispose: () => {
                void agentServer
                    .stop()
                    .catch(error => {
                        console.error(
                            "Failed to stop VortiqLabs Agent server:",
                            error
                        );
                    });
            }
        }
    );
}

export function deactivate() {}