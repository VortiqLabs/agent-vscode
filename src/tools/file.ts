import * as vscode from "vscode";
import {
    FileReadRequest,
    FileReadResult,
    FileWriteRequest,
    FileWriteResult,
    FileReplaceRangeRequest,
    FileReplaceRangeResult
} from "./types";
import { WorkspaceManager } from "../workspace/manager";

export class FileTool {
    constructor(
        private readonly workspaceManager: WorkspaceManager
    ) {}

    async read(
        request: FileReadRequest
    ): Promise<FileReadResult> {
        const uri =
            this.workspaceManager.resolvePath(request.path);

        if (!uri) {
            throw new Error(
                `Path is outside the active workspace: ${request.path}`
            );
        }

        const data =
            await vscode.workspace.fs.readFile(uri);

        const content =
            Buffer.from(data).toString("utf8");

        return {
            path: request.path,
            content,
            size: data.byteLength
        };
    }

    async write(
        request: FileWriteRequest
    ): Promise<FileWriteResult> {
        const uri =
            this.workspaceManager.resolvePath(request.path);

        if (!uri) {
            throw new Error(
                `Path is outside the active workspace: ${request.path}`
            );
        }

        const data =
            Buffer.from(request.content, "utf8");

        await vscode.workspace.fs.writeFile(
            uri,
            data
        );

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
            throw new Error(
                "startLine and endLine must be integers."
            );
        }

        if (request.startLine < 1) {
            throw new Error(
                "startLine must be greater than or equal to 1."
            );
        }

        if (request.endLine < request.startLine) {
            throw new Error(
                "endLine must be greater than or equal to startLine."
            );
        }

        const uri =
            this.workspaceManager.resolvePath(request.path);

        if (!uri) {
            throw new Error(
                `Path is outside the active workspace: ${request.path}`
            );
        }

        const document =
            await vscode.workspace.openTextDocument(uri);

        const lineCount =
            document.lineCount;

        if (request.startLine > lineCount) {
            throw new Error(
                `startLine ${request.startLine} is outside the file. ` +
                `File has ${lineCount} lines.`
            );
        }

        if (request.endLine > lineCount) {
            throw new Error(
                `endLine ${request.endLine} is outside the file. ` +
                `File has ${lineCount} lines.`
            );
        }

        const startPosition =
            new vscode.Position(
                request.startLine - 1,
                0
            );

        const endLineIndex =
            request.endLine - 1;

        const endPosition =
            new vscode.Position(
                endLineIndex,
                document.lineAt(endLineIndex).text.length
            );

        const range =
            new vscode.Range(
                startPosition,
                endPosition
            );

        const edit =
            new vscode.WorkspaceEdit();

        edit.replace(
            uri,
            range,
            request.content
        );

        const applied =
            await vscode.workspace.applyEdit(edit);

        if (!applied) {
            throw new Error(
                `VS Code rejected the edit for ${request.path}.`
            );
        }

        const updatedDocument =
            await vscode.workspace.openTextDocument(uri);

        const updatedContent =
            updatedDocument.getText();

        return {
            path: request.path,
            startLine: request.startLine,
            endLine: request.endLine,
            size: Buffer.byteLength(
                updatedContent,
                "utf8"
            )
        };
    }
}