import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import * as https from "https";
import { spawn } from "child_process";

import { RuntimeArtifact, RuntimeInfo, RuntimePlatform } from "./types";
import { getRuntimePlatform } from "./platform";

export const INDEXER_VERSION = "0.1.7";
const RELEASE_BASE_URL = `https://github.com/VortiqLabs/codebase-indexer/releases/download/v${INDEXER_VERSION}`;

export const ARTIFACTS: Record<RuntimePlatform, RuntimeArtifact> = {
    "linux-x64": {
        platform: "linux-x64",
        url: `${RELEASE_BASE_URL}/codebase-indexer-linux-x64.tar.gz`,
        sha256: "262d5885892ab26656005dd60e53557713aae13b54f98a590a798e5f2ec8412a",
        archiveName: "codebase-indexer-linux-x64.tar.gz",
        executableName: "codebase-indexer"
    },
    "linux-arm64": {
        platform: "linux-arm64",
        url: `${RELEASE_BASE_URL}/codebase-indexer-linux-arm64.tar.gz`,
        sha256: "5aa8555888540bf6ba0803fbfc6414a91c2f6949c91acc1fae835d72717c1aa2",
        archiveName: "codebase-indexer-linux-arm64.tar.gz",
        executableName: "codebase-indexer"
    },
    "darwin-x64": {
        platform: "darwin-x64",
        url: `${RELEASE_BASE_URL}/codebase-indexer-darwin-x64.tar.gz`,
        sha256: "e4da07ba97ae8ff8abc4c510fef94cf28ac8dbd085f8c16610217af84caad5ae",
        archiveName: "codebase-indexer-darwin-x64.tar.gz",
        executableName: "codebase-indexer"
    },
    "darwin-arm64": {
        platform: "darwin-arm64",
        url: `${RELEASE_BASE_URL}/codebase-indexer-darwin-arm64.tar.gz`,
        sha256: "c9d8d09aeac55d57bb98cba34d084b4b3070cc7bcbfa39a940d06d9756c5ab5f",
        archiveName: "codebase-indexer-darwin-arm64.tar.gz",
        executableName: "codebase-indexer"
    },
    "win32-x64": {
        platform: "win32-x64",
        url: `${RELEASE_BASE_URL}/codebase-indexer-win32-x64.zip`,
        sha256: "2c41b214e12d1447a861812ae0854bbdd02ddd4910234fe69645a9ca059345ec",
        archiveName: "codebase-indexer-win32-x64.zip",
        executableName: "codebase-indexer.exe"
    },
    "win32-arm64": {
        platform: "win32-arm64",
        url: `${RELEASE_BASE_URL}/codebase-indexer-win32-arm64.zip`,
        sha256: "d68bedbc0fa5188ddcc223acd27ffa568fd8aa8a18e206428eaf746bd9b90194",
        archiveName: "codebase-indexer-win32-arm64.zip",
        executableName: "codebase-indexer.exe"
    }
};

export class IndexerRuntimeManager {
    private readonly runtimeRoot: string;
    private resolvePromise: Promise<RuntimeInfo> | null = null;

    constructor(storagePathOrContext?: unknown) {
        if (typeof storagePathOrContext === "string") {
            this.runtimeRoot = path.join(storagePathOrContext, "indexer");
        } else if (
            typeof storagePathOrContext === "object" &&
            storagePathOrContext !== null &&
            "globalStorageUri" in storagePathOrContext &&
            (storagePathOrContext as { globalStorageUri: { fsPath: string } }).globalStorageUri?.fsPath
        ) {
            this.runtimeRoot = path.join(
                (storagePathOrContext as { globalStorageUri: { fsPath: string } }).globalStorageUri.fsPath,
                "indexer"
            );
        } else if (process.env.MCP_STORAGE_ROOT) {
            this.runtimeRoot = path.join(process.env.MCP_STORAGE_ROOT, "indexer");
        } else {
            this.runtimeRoot = path.join(os.homedir(), ".vortiqlabs-agent", "indexer");
        }
    }

    async resolve(): Promise<RuntimeInfo> {
        if (this.resolvePromise) {
            return this.resolvePromise;
        }

        this.resolvePromise = this.doResolve().catch(err => {
            this.resolvePromise = null;
            throw err;
        });

        return this.resolvePromise;
    }

    private async doResolve(): Promise<RuntimeInfo> {
        const platform = getRuntimePlatform();
        const artifact = ARTIFACTS[platform];

        if (!artifact) {
            throw new Error(`No Codebase Indexer artifact exists for ${platform}.`);
        }

        const versionDirectory = path.join(this.runtimeRoot, INDEXER_VERSION, platform);
        const executablePath = path.join(versionDirectory, artifact.executableName);

        if (await this.isValidInstallation(executablePath, versionDirectory)) {
            return {
                platform,
                executablePath,
                version: INDEXER_VERSION
            };
        }

        // Clean up incomplete installation directory if needed
        await fs.promises.rm(versionDirectory, { recursive: true, force: true }).catch(() => {});
        await fs.promises.mkdir(versionDirectory, { recursive: true });

        const archivePath = path.join(versionDirectory, artifact.archiveName);

        try {
            await this.download(artifact.url, archivePath);
            await this.verifyChecksum(archivePath, artifact.sha256);
            await this.extract(archivePath, versionDirectory);

            if (process.platform !== "win32") {
                await fs.promises.chmod(executablePath, 0o755);
            }

            if (!fs.existsSync(executablePath)) {
                throw new Error(`Indexer executable was not found after extraction: ${executablePath}`);
            }

            // Remove downloaded archive file after successful extraction
            await fs.promises.unlink(archivePath).catch(() => {});

            return {
                platform,
                executablePath,
                version: INDEXER_VERSION
            };
        } catch (error) {
            await fs.promises.rm(versionDirectory, { recursive: true, force: true }).catch(() => {});
            throw error;
        }
    }

    private async isValidInstallation(executablePath: string, versionDirectory: string): Promise<boolean> {
        if (!fs.existsSync(executablePath)) {
            return false;
        }

        // Verify resource directories if expected
        const resourceDirs = ["grammars", "tree-sitter-wasms", "workers", "dashboard"];
        for (const dir of resourceDirs) {
            const dirPath = path.join(versionDirectory, dir);
            if (!fs.existsSync(dirPath)) {
                // If resource directory is missing, installation may be incomplete
                return false;
            }
        }

        return true;
    }

    async download(url: string, destination: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const request = https.get(url, response => {
                if (
                    response.statusCode &&
                    response.statusCode >= 300 &&
                    response.statusCode < 400 &&
                    response.headers.location
                ) {
                    response.resume();
                    void this.download(response.headers.location, destination)
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                if (response.statusCode !== 200) {
                    response.resume();
                    reject(new Error(`Download failed with HTTP ${response.statusCode} from ${url}`));
                    return;
                }

                const file = fs.createWriteStream(destination);
                response.pipe(file);

                file.on("finish", () => {
                    file.close(() => resolve());
                });

                file.on("error", error => {
                    file.close();
                    fs.unlink(destination, () => {});
                    reject(error);
                });
            });

            request.on("error", error => {
                fs.unlink(destination, () => {});
                reject(error);
            });
        });
    }

    async verifyChecksum(filePath: string, expectedSha256: string): Promise<void> {
        if (!expectedSha256 || expectedSha256.startsWith("REPLACE_")) {
            throw new Error("Codebase Indexer SHA-256 has not been configured.");
        }

        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);

        await new Promise<void>((resolve, reject) => {
            stream.on("data", chunk => hash.update(chunk));
            stream.on("end", resolve);
            stream.on("error", reject);
        });

        const actual = hash.digest("hex");

        if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
            throw new Error(
                `Codebase Indexer checksum verification failed. Expected ${expectedSha256}, got ${actual}`
            );
        }
    }

    async extract(archivePath: string, destination: string): Promise<void> {
        const lower = archivePath.toLowerCase();

        if (lower.endsWith(".zip")) {
            await this.extractZip(archivePath, destination);
            return;
        }

        if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
            await this.extractTarGz(archivePath, destination);
            return;
        }

        throw new Error(`Unsupported runtime archive format: ${archivePath}`);
    }

    private async extractTarGz(archivePath: string, destination: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const child = spawn("tar", ["-xzf", archivePath, "-C", destination], {
                stdio: ["ignore", "ignore", "pipe"]
            });

            let stderr = "";
            child.stderr.on("data", data => {
                stderr += data.toString();
            });

            child.on("error", reject);
            child.on("close", code => {
                if (code !== 0) {
                    reject(new Error(stderr || `tar exited with code ${code}`));
                    return;
                }
                resolve();
            });
        });
    }

    private async extractZip(archivePath: string, destination: string): Promise<void> {
        if (process.platform === "win32") {
            await new Promise<void>((resolve, reject) => {
                const psCommand = `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destination}' -Force`;
                const child = spawn("powershell", ["-NoProfile", "-Command", psCommand], {
                    stdio: ["ignore", "ignore", "pipe"]
                });

                let stderr = "";
                child.stderr.on("data", data => {
                    stderr += data.toString();
                });

                child.on("error", reject);
                child.on("close", code => {
                    if (code !== 0) {
                        reject(new Error(stderr || `PowerShell Expand-Archive exited with code ${code}`));
                        return;
                    }
                    resolve();
                });
            });
        } else {
            await new Promise<void>((resolve, reject) => {
                const child = spawn("unzip", ["-o", archivePath, "-d", destination], {
                    stdio: ["ignore", "ignore", "pipe"]
                });

                let stderr = "";
                child.stderr.on("data", data => {
                    stderr += data.toString();
                });

                child.on("error", reject);
                child.on("close", code => {
                    if (code !== 0) {
                        reject(new Error(stderr || `unzip exited with code ${code}`));
                        return;
                    }
                    resolve();
                });
            });
        }
    }
}
