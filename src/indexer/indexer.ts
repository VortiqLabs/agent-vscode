import { IndexerExecutable } from "./executable";
import { IndexerCLI } from "./cli";
import { IndexerRuntimeManager } from "./runtime/manager";

export class IndexerService {
    readonly cli: IndexerCLI;

    constructor(
        runtimeManager: IndexerRuntimeManager,
        explicitWorkspaceRoot?: string
    ) {
        this.cli = new IndexerCLI(
            new IndexerExecutable(runtimeManager, explicitWorkspaceRoot)
        );
    }
}
