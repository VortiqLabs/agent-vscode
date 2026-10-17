# Change Log

All notable changes to the "vortiqlabs-agent" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.3.0] - 2026-10-09

### Added
- VortiqLabs Agent Activity Bar sidebar with live MCP request lifecycle, arguments, formatted results/errors, bounded terminal output, elapsed time and exit codes.
- Live stdout/stderr chunk forwarding for terminal execution, with time and output limits.
- VS Code-native MCP tools for active editor context, language diagnostics, document symbols, bounded workspace text search, and opening HTTP(S) URLs in the configured browser.
- Activity history is bounded in memory and the sidebar uses a restrictive Content Security Policy.

### Security and limitations
- Browser opening uses VS Code's stable external-URI API; arbitrary browser-tab inspection is not falsely claimed as a built-in capability.
- Destructive or UI-bound APIs are not exposed through a blanket unrestricted command bridge.

## [0.2.0] - 2026-10-09

### Added
- First-use and explicit Codebase Indexer runtime installation with platform selection, SHA-256 verification, and cached versioned storage.
- MCP tools for GitHub indexing, caller/callee and dependency graph navigation, symbol paths, repository maps, API endpoint discovery, query-intent classification, sensitive-region detection, index inspection/removal, and watch/dashboard lifecycle control.
- Indexer install progress notifications and cleanup of background indexer processes when the extension shuts down.
- Workspace-ID matching instructions to avoid reusing workspace memories across different projects.

### Changed
- Added search modes/results limit and more index sizing/profile options.
- Require explicit confirmation before removing a workspace index.

### Security
- Restrict the indexer dashboard MCP tool to localhost binding.

## [0.0.1]

- Initial release