import { spawn } from "child_process";
import { WorkspaceManager } from "../workspace/manager";

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

export type TerminalOutputListener = (stream: "stdout" | "stderr", chunk: string) => void;

export class TerminalTool {
    constructor(private readonly workspaceManager: WorkspaceManager) {}

    async execute(command: string, timeoutMs?: number, onOutput?: TerminalOutputListener): Promise<TerminalResult> {
        if (!command.trim()) {throw new Error("Command must not be empty.");}
        const timeout = Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.floor(timeoutMs ?? DEFAULT_TIMEOUT_MS)));
        return new Promise((resolve, reject) => {
            const child = spawn(command, [], {
                cwd: this.workspaceManager.getWorkspaceRootPath(),
                shell: true,
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"]
            });
            let stdout = "";
            let stderr = "";
            let outputBytes = 0;
            let timedOut = false;
            let settled = false;
            const append = (stream: "stdout" | "stderr", chunk: Buffer | string) => {
                const value = chunk.toString();
                outputBytes += Buffer.byteLength(value, "utf8");
                if (stream === "stdout") {stdout = (stdout + value).slice(-MAX_OUTPUT_BYTES);}
                else {stderr = (stderr + value).slice(-MAX_OUTPUT_BYTES);}
                try { onOutput?.(stream, value.slice(0, MAX_OUTPUT_BYTES)); } catch { /* UI listeners must not break the process. */ }
                if (outputBytes > MAX_OUTPUT_BYTES * 2 && !timedOut) {
                    timedOut = true;
                    child.kill("SIGTERM");
                }
            };
            child.stdout?.on("data", chunk => append("stdout", chunk as Buffer));
            child.stderr?.on("data", chunk => append("stderr", chunk as Buffer));
            child.once("error", error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
            const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeout);
            child.once("close", code => {
                if (settled) {return;}
                settled = true;
                clearTimeout(timer);
                resolve({ command, stdout, stderr, exitCode: timedOut ? 124 : (code ?? 1), timedOut });
            });
        });
    }
}
