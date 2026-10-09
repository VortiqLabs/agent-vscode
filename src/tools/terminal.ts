import { exec } from "child_process";
import { promisify } from "util";
import { WorkspaceManager } from "../workspace/manager";

const execAsync = promisify(exec);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface TerminalResult {
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
}

export class TerminalTool {
    constructor(private readonly workspaceManager: WorkspaceManager) {}

    async execute(command: string, timeoutMs?: number): Promise<TerminalResult> {
        if (!command.trim()) {
            throw new Error("Command must not be empty.");
        }

        const timeout = Math.min(
            MAX_TIMEOUT_MS,
            Math.max(1_000, Math.floor(timeoutMs ?? DEFAULT_TIMEOUT_MS))
        );

        try {
            const result = await execAsync(command, {
                cwd: this.workspaceManager.getWorkspaceRootPath(),
                timeout,
                maxBuffer: MAX_OUTPUT_BYTES,
                windowsHide: true
            });
            return {
                command,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: 0,
                timedOut: false
            };
        } catch (error) {
            const commandError = error as {
                stdout?: string;
                stderr?: string;
                code?: number | string;
                signal?: string;
                killed?: boolean;
                message?: string;
            };
            if (commandError.killed || commandError.signal === "SIGTERM") {
                return {
                    command,
                    stdout: commandError.stdout ?? "",
                    stderr: commandError.stderr || commandError.message || "Command timed out.",
                    exitCode: typeof commandError.code === "number" ? commandError.code : 124,
                    timedOut: true
                };
            }
            if (typeof commandError.code === "number") {
                return {
                    command,
                    stdout: commandError.stdout ?? "",
                    stderr: commandError.stderr ?? "",
                    exitCode: commandError.code,
                    timedOut: false
                };
            }
            throw error;
        }
    }
}
