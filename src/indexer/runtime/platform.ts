import * as os from "os";
import { RuntimePlatform } from "./types";

export function getRuntimePlatform(): RuntimePlatform {
    const platform = os.platform();
    const architecture = os.arch();

    if (platform === "linux" && architecture === "x64") {
        return "linux-x64";
    }

    if (platform === "linux" && architecture === "arm64") {
        return "linux-arm64";
    }

    if (platform === "darwin" && architecture === "x64") {
        return "darwin-x64";
    }

    if (platform === "darwin" && architecture === "arm64") {
        return "darwin-arm64";
    }

    if (platform === "win32" && architecture === "x64") {
        return "win32-x64";
    }

    if (platform === "win32" && architecture === "arm64") {
        return "win32-arm64";
    }

    throw new Error(
        `Unsupported platform: ${platform}-${architecture}`
    );
}
