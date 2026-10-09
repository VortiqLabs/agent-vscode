export interface FileDiagnostic {
    message: string;
    severity: "error" | "warning";
    source?: string;
    code?: string | number;
    range: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    };
}

export interface FileDiagnosticsResult {
    path: string;
    diagnostics: FileDiagnostic[];
    count: number;
}
