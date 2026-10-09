import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as https from "https";
import { spawn } from "child_process";

import {
    RuntimeArtifact,
    RuntimeInfo
} from "./types";

import {
    getRuntimePlatform
} from "./platform";

const INDEXER_VERSION = "0.1.0";

/*
 * IMPORTANT:
 *
 * Replace these URLs and SHA-256 values with the
 * exact release artifacts from your existing
 * Codebase Indexer release system.
 */
const ARTIFACTS: Record<
    string,
    RuntimeArtifact
> = {
    "linux-x64": {
        platform: "linux-x64",
        url:
            "https://github.com/VortiqLabs/codebase-indexer/releases/download/v0.1.0/codebase-indexer-linux-x64.tar.gz",
        sha256:
            "REPLACE_WITH_REAL_SHA256",
        archiveName:
            "codebase-indexer-linux-x64.tar.gz",
        executableName:
            "codebase-indexer"
    },

    "linux-arm64": {
        platform: "linux-arm64",
        url:
            "https://github.com/VortiqLabs/codebase-indexer/releases/download/v0.1.0/codebase-indexer-linux-arm64.tar.gz",
        sha256:
            "REPLACE_WITH_REAL_SHA256",
        archiveName:
            "codebase-indexer-linux-arm64.tar.gz",
        executableName:
            "codebase-indexer"
    },

    "darwin-x64": {
        platform: "darwin-x64",
        url:
            "https://github.com/VortiqLabs/codebase-indexer/releases/download/v0.1.0/codebase-indexer-darwin-x64.tar.gz",
        sha256:
            "REPLACE_WITH_REAL_SHA256",
        archiveName:
            "codebase-indexer-darwin-x64.tar.gz",
        executableName:
            "codebase-indexer"
    },

    "darwin-arm64": {
        platform: "darwin-arm64",
        url:
            "https://github.com/VortiqLabs/codebase-indexer/releases/download/v0.1.0/codebase-indexer-darwin-arm64.tar.gz",
        sha256:
            "REPLACE_WITH_REAL_SHA256",
        archiveName:
            "codebase-indexer-darwin-arm64.tar.gz",
        executableName:
            "codebase-indexer"
    },

    "win32-x64": {
        platform: "win32-x64",
        url:
            "https://github.com/VortiqLabs/codebase-indexer/releases/download/v0.1.0/codebase-indexer-win32-x64.zip",
        sha256:
            "REPLACE_WITH_REAL_SHA256",
        archiveName:
            "codebase-indexer-win32-x64.zip",
        executableName:
            "codebase-indexer.exe"
    }
};

export class IndexerRuntimeManager {
    private readonly runtimeRoot: string;

    constructor(
        private readonly context:
            vscode.ExtensionContext
    ) {
        this.runtimeRoot =
            path.join(
                context.globalStorageUri.fsPath,
                "indexer"
            );
    }

    async resolve(): Promise<RuntimeInfo> {
        const platform =
            getRuntimePlatform();

        const artifact =
            ARTIFACTS[platform];

        if (!artifact) {
            throw new Error(
                `No Codebase Indexer artifact exists for ${platform}.`
            );
        }

        const versionDirectory =
            path.join(
                this.runtimeRoot,
                INDEXER_VERSION,
                platform
            );

        const executablePath =
            path.join(
                versionDirectory,
                artifact.executableName
            );

        if (
            await this.isValidExecutable(
                executablePath,
                artifact
            )
        ) {
            return {
                platform,
                executablePath,
                version: INDEXER_VERSION
            };
        }

        await fs.promises.mkdir(
            versionDirectory,
            {
                recursive: true
            }
        );

        const archivePath =
            path.join(
                versionDirectory,
                artifact.archiveName
            );

        await this.download(
            artifact.url,
            archivePath
        );

        await this.verifyChecksum(
            archivePath,
            artifact.sha256
        );

        await this.extract(
            archivePath,
            versionDirectory
        );

        if (
            process.platform !== "win32"
        ) {
            await fs.promises.chmod(
                executablePath,
                0o755
            );
        }

        if (
            !fs.existsSync(
                executablePath
            )
        ) {
            throw new Error(
                `Indexer executable was not found after extraction: ${executablePath}`
            );
        }

        return {
            platform,
            executablePath,
            version: INDEXER_VERSION
        };
    }

    private async isValidExecutable(
        executablePath: string,
        artifact: RuntimeArtifact
    ): Promise<boolean> {
        if (
            !fs.existsSync(
                executablePath
            )
        ) {
            return false;
        }

        if (
            artifact.sha256.startsWith(
                "REPLACE_"
            )
        ) {
            return true;
        }

        return true;
    }

    private async download(
        url: string,
        destination: string
    ): Promise<void> {
        await new Promise<void>(
            (resolve, reject) => {
                const request =
                    https.get(
                        url,
                        response => {
                            if (
                                response.statusCode &&
                                response.statusCode >=
                                    300 &&
                                response.statusCode <
                                    400 &&
                                response.headers.location
                            ) {
                                response.resume();

                                void this.download(
                                    response
                                        .headers
                                        .location!,
                                    destination
                                )
                                    .then(resolve)
                                    .catch(reject);

                                return;
                            }

                            if (
                                response.statusCode !==
                                200
                            ) {
                                response.resume();

                                reject(
                                    new Error(
                                        `Download failed with HTTP ${response.statusCode}`
                                    )
                                );

                                return;
                            }

                            const file =
                                fs.createWriteStream(
                                    destination
                                );

                            response.pipe(file);

                            file.on(
                                "finish",
                                () => {
                                    file.close(
                                        () => resolve()
                                    );
                                }
                            );

                            file.on(
                                "error",
                                error => {
                                    file.close();
                                    reject(error);
                                }
                            );
                        }
                    );

                request.on(
                    "error",
                    reject
                );
            }
        );
    }

    private async verifyChecksum(
        filePath: string,
        expectedSha256: string
    ): Promise<void> {
        if (
            expectedSha256.startsWith(
                "REPLACE_"
            )
        ) {
            throw new Error(
                "Codebase Indexer SHA-256 has not been configured."
            );
        }

        const hash =
            crypto.createHash(
                "sha256"
            );

        const stream =
            fs.createReadStream(
                filePath
            );

        await new Promise<void>(
            (resolve, reject) => {
                stream.on(
                    "data",
                    chunk => {
                        hash.update(chunk);
                    }
                );

                stream.on(
                    "end",
                    resolve
                );

                stream.on(
                    "error",
                    reject
                );
            }
        );

        const actual =
            hash.digest("hex");

        if (
            actual.toLowerCase() !==
            expectedSha256.toLowerCase()
        ) {
            throw new Error(
                "Codebase Indexer checksum verification failed."
            );
        }
    }

    private async extract(
        archivePath: string,
        destination: string
    ): Promise<void> {
        const lower =
            archivePath.toLowerCase();

        if (
            lower.endsWith(".zip")
        ) {
            throw new Error(
                "ZIP extraction is not implemented yet. Use the existing runtime extractor from your Codebase Indexer extension."
            );
        }

        if (
            lower.endsWith(
                ".tar.gz"
            ) ||
            lower.endsWith(".tgz")
        ) {
            await this.extractTarGz(
                archivePath,
                destination
            );

            return;
        }

        throw new Error(
            `Unsupported runtime archive: ${archivePath}`
        );
    }

    private async extractTarGz(
        archivePath: string,
        destination: string
    ): Promise<void> {
        await new Promise<void>(
            (resolve, reject) => {
                const child =
                    spawn(
                        "tar",
                        [
                            "-xzf",
                            archivePath,
                            "-C",
                            destination
                        ],
                        {
                            stdio: [
                                "ignore",
                                "ignore",
                                "pipe"
                            ]
                        }
                    );

                let stderr = "";

                child.stderr.on(
                    "data",
                    data => {
                        stderr +=
                            data.toString();
                    }
                );

                child.on(
                    "error",
                    reject
                );

                child.on(
                    "close",
                    code => {
                        if (
                            code !== 0
                        ) {
                            reject(
                                new Error(
                                    stderr ||
                                    `tar exited with code ${code}`
                                )
                            );

                            return;
                        }

                        resolve();
                    }
                );
            }
        );
    }
}