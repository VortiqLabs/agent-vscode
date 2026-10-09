import * as fs from "fs";
import {
    FileReadRequest,
    FileReadResult,
    FileWriteRequest,
    FileWriteResult,
    FileReplaceRangeRequest,
    FileReplaceRangeResult
} from "./types";
import { WorkspaceManager } from "../workspace/manager";

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export class FileTool {
    constructor(
        private readonly workspaceManager: WorkspaceManager
    ) {}

    async read(
        request: FileReadRequest
    ): Promise<FileReadResult> {
        const fullPath = this.workspaceManager.resolvePath(request.path);

        if (!fullPath) {
            throw new Error(
                `Path is outside the active workspace or invalid: ${request.path}`
            );
        }

        const stat = await fs.promises.stat(fullPath);
        if (stat.isDirectory()) {
            throw new Error(`Cannot read path because it is a directory: ${request.path}`);
        }

        let truncated = false;
        let data: Buffer;

        if (stat.size > MAX_FILE_SIZE) {
            const handle = await fs.promises.open(fullPath, "r");
            try {
                const buffer = Buffer.alloc(MAX_FILE_SIZE);
                const { bytesRead } = await handle.read(buffer, 0, MAX_FILE_SIZE, 0);
                data = buffer.subarray(0, bytesRead);
                truncated = true;
            } finally {
                await handle.close();
            }
        } else {
            data = await fs.promises.readFile(fullPath);
        }

        const content = data.toString("utf8");

        return {
            path: request.path,
            content,
            size: stat.size,
            truncated
        };
    }

    async write(
        request: FileWriteRequest
    ): Promise<FileWriteResult> {
        const fullPath = this.workspaceManager.resolvePath(request.path);

        if (!fullPath) {
            throw new Error(
                `Path is outside the active workspace or invalid: ${request.path}`
            );
        }

        const data = Buffer.from(request.content, "utf8");
        await fs.promises.mkdir(require("path").dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, data);

        return {
            path: request.path,
            size: data.byteLength
        };
    }

    async replaceRange(
        request: FileReplaceRangeRequest
    ): Promise<FileReplaceRangeResult> {
        if (
            !Number.isInteger(request.startLine) ||
            !Number.isInteger(request.endLine)
        ) {
            throw new Error("startLine and endLine must be integers.");
        }

        if (request.startLine < 1) {
            throw new Error("startLine must be greater than or equal to 1.");
        }

        if (request.endLine < request.startLine) {
            throw new Error("endLine must be greater than or equal to startLine.");
        }

        const fullPath = this.workspaceManager.resolvePath(request.path);

        if (!fullPath) {
            throw new Error(
                `Path is outside the active workspace or invalid: ${request.path}`
            );
        }

        const rawContent = await fs.promises.readFile(fullPath, "utf8");
        const lines = rawContent.split(/\r?\n/);

        if (request.startLine > lines.length) {
            throw new Error(
                `startLine ${request.startLine} is outside the file. File has ${lines.length} lines.`
            );
        }

        if (request.endLine > lines.length) {
            throw new Error(
                `endLine ${request.endLine} is outside the file. File has ${lines.length} lines.`
            );
        }

        const replacementLines = request.content.split(/\r?\n/);
        const startIndex = request.startLine - 1;
        const deleteCount = request.endLine - request.startLine + 1;

        lines.splice(startIndex, deleteCount, ...replacementLines);
        const newContent = lines.join("\n");

        await fs.promises.writeFile(fullPath, newContent, "utf8");

        return {
            path: request.path,
            startLine: request.startLine,
            endLine: request.endLine,
            size: Buffer.byteLength(newContent, "utf8")
        };
    }
}
