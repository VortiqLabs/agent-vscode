export interface FileReadRequest {
    path: string;
}

export interface FileReadResult {
    path: string;
    content: string;
    size: number;
    truncated?: boolean;
}

export interface FileWriteRequest {
    path: string;
    content: string;
}

export interface FileWriteResult {
    path: string;
    size: number;
}

export interface FileReplaceRangeRequest {
    path: string;
    startLine: number;
    endLine: number;
    content: string;
}

export interface FileReplaceRangeResult {
    path: string;
    startLine: number;
    endLine: number;
    size: number;
}

export interface FileApplyPatchRequest {
    patch: string;
}

export interface FileApplyPatchResult {
    filesChanged: string[];
    patch: string;
}

export interface FileDiffRequest {
    path?: string;
}

export interface FileDiffResult {
    path?: string;
    diff: string;
}
