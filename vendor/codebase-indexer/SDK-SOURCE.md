# Codebase Indexer SDK source

This directory contains the upstream TypeScript source for `@vortiqlabs/codebase-indexer` v0.2.0, pinned to commit `364f30be53fe0e167144cb0794fe37de8fb45895` from https://github.com/VortiqLabs/codebase-indexer.

The upstream GitHub Packages registry currently exposes releases only through 0.1.7, while the SDK API used here is introduced in the 0.2.0 source. The source is therefore vendored at the matching upstream tag until that SDK version is published to the registry. Keep the upstream LICENSE with this source. `scripts/build-indexer-sdk.mjs` compiles the stable SDK entry points and runtime assets used by this extension.
