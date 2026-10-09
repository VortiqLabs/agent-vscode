import * as vscode from "vscode";

import {
    Agent
} from "./agent/agent";

import {
    AgentServer
} from "./transport";

export function activate(
    context: vscode.ExtensionContext
) {
    console.log(
        "VortiqLabs Agent activated"
    );

    const agent =
        new Agent(context);

    const agentServer =
        new AgentServer(
            agent,
            {
                host:
                    "127.0.0.1",
                port:
                    43127
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

    context.subscriptions.push(
        workspaceCommand,
        fileReadCommand,
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