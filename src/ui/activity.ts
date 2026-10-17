import { EventEmitter } from "events";
import { AgentRequest, AgentResponse } from "../agent/types";

export type ActivityStatus = "running" | "success" | "error";

export interface AgentActivityItem {
    id: string;
    tool: string;
    argumentsText: string;
    startedAt: string;
    status: ActivityStatus;
    durationMs?: number;
    resultText?: string;
    errorText?: string;
    stdout: string;
    stderr: string;
    command?: string;
    exitCode?: number;
}

const MAX_ITEMS = 50;
const MAX_TEXT = 12_000;

function bounded(value: unknown, max = 8_000): string {
    let text: string;
    try {
        text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    } catch {
        text = String(value);
    }
    if (text.length > max) {return text.slice(0, max) + "\n… truncated";}
    return text;
}

export class AgentActivity {
    private readonly emitter = new EventEmitter();
    private readonly items: AgentActivityItem[] = [];

    subscribe(listener: (items: AgentActivityItem[]) => void): { dispose: () => void } {
        this.emitter.on("change", listener);
        return { dispose: () => this.emitter.off("change", listener) };
    }

    snapshot(): AgentActivityItem[] {
        return this.items.map(item => ({ ...item }));
    }

    start(request: AgentRequest): void {
        const item: AgentActivityItem = {
            id: request.id,
            tool: request.tool,
            argumentsText: bounded(request.arguments, 4_000),
            startedAt: new Date().toISOString(),
            status: "running",
            stdout: "",
            stderr: "",
            command: request.tool === "terminal.execute" && typeof request.arguments.command === "string"
                ? request.arguments.command : undefined
        };
        this.items.unshift(item);
        if (this.items.length > MAX_ITEMS) {this.items.length = MAX_ITEMS;}
        this.publish();
    }

    appendTerminal(id: string, stream: "stdout" | "stderr", chunk: string): void {
        const item = this.items.find(candidate => candidate.id === id);
        if (!item) {return;}
        item[stream] = (item[stream] + chunk).slice(-MAX_TEXT);
        this.publish();
    }

    updateResult(id: string, result: unknown): void {
        const item = this.items.find(candidate => candidate.id === id);
        if (!item) {return;}
        item.resultText = bounded(result, 12_000);
        this.publish();
    }

    finish(response: AgentResponse, durationMs: number): void {
        const item = this.items.find(candidate => candidate.id === response.id);
        if (!item) {return;}
        item.durationMs = durationMs;
        item.status = response.success ? "success" : "error";
        if (response.success) {
            item.resultText = bounded(response.result, 12_000);
            const result = response.result as { stdout?: unknown; stderr?: unknown; exitCode?: unknown } | null;
            if (result && typeof result === "object") {
                if (typeof result.stdout === "string" && !item.stdout) {item.stdout = result.stdout.slice(-MAX_TEXT);}
                if (typeof result.stderr === "string" && !item.stderr) {item.stderr = result.stderr.slice(-MAX_TEXT);}
                if (typeof result.exitCode === "number") {item.exitCode = result.exitCode;}
            }
        } else {
            item.errorText = response.error.message;
        }
        this.publish();
    }

    clear(): void {
        // Keep pending approval cards visible; clearing them would orphan the
        // proposal and leave the user with no way to accept or decline it.
        const pending = this.items.filter(item => {
            try {
                const result = JSON.parse(item.resultText ?? "null") as { changeReview?: { status?: string } } | null;
                return result?.changeReview?.status === "pending";
            } catch { return false; }
        });
        this.items.splice(0, this.items.length, ...pending);
        this.publish();
    }

    private publish(): void {
        this.emitter.emit("change", this.snapshot());
    }
}
