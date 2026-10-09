export type RuntimePlatform =
    | "linux-x64"
    | "linux-arm64"
    | "darwin-x64"
    | "darwin-arm64"
    | "win32-x64"
    | "win32-arm64";

export interface RuntimeArtifact {
    platform: RuntimePlatform;
    url: string;
    sha256: string;
    archiveName: string;
    executableName: string;
}

export interface RuntimeInfo {
    platform: RuntimePlatform;
    executablePath: string;
    version: string;
}
