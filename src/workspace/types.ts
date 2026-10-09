export type WorkspaceState =
    | "none"
    | "opening"
    | "ready"
    | "changed"
    | "closed"
    | "error";

export interface WorkspaceFolder {
    id: string;
    name: string;
    relativePath: string;
}

export interface VortiqWorkspace {
    id: string;
    name: string | null;
    folders: WorkspaceFolder[];
    state: WorkspaceState;
}