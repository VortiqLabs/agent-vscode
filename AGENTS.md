# Agent Instructions

## Mandatory Codebase Indexer-First Workflow

**Always use Codebase Indexer for codebase understanding, navigation, and impact analysis.** This is a requirement, not a preference.

Before answering or making code changes that depend on this repository:

1. Call `indexer_status` to check whether the current workspace has an available, usable index.
2. If the workspace is not indexed, index it with `index_workspace` and wait for indexing to finish before relying on search results.
3. Use the most relevant Codebase Indexer tools first:
   - `indexer_search` for implementation and behavior discovery.
   - `indexer_symbols` for definitions and symbol lookup.
   - `indexer_references` for usages and references.
   - `indexer_callers` / `indexer_callees` for call flow.
   - `indexer_dependencies` / `indexer_dependents` for change-impact analysis.
   - `indexer_symbol_path` for relationships between symbols.
   - `indexer_repository_map` and `indexer_files` for repository structure.
   - `indexer_inspect` when inspecting a specific indexed file or index metadata.
4. Before editing code, use the index to locate the relevant implementation and trace related callers, dependencies, and tests. After editing, use it again when useful to check for other affected usages.
5. Then read the exact source files and tests needed to verify details, and run relevant tests, type checks, and linting.

### Fallback behavior

If Codebase Indexer tools fail, time out, report a missing/corrupt index, or cannot answer the specific question:

- Make a reasonable attempt to restore availability (check status, install the runtime if the tool is available, and index the workspace if needed).
- If it remains unavailable, use direct file inspection or ordinary text search only as a **temporary fallback** for the blocked part of the task.
- Be transparent that the indexer could not be used; do not claim the work was indexer-verified.
- Return to Codebase Indexer as soon as it becomes available.

### Boundaries

- Do not use filesystem listing, raw text search, or opening arbitrary files as the first choice for code discovery when the indexer can answer the question.
- Direct file reads are still appropriate after indexer discovery to inspect exact implementation details, confirm line-level context, or make a precise edit.
- For non-code tasks (for example, wording, documentation-only edits, or simple metadata changes), use judgment; use the indexer whenever repository relationships or code impact matter.
- Never infer that a symbol or relationship does not exist solely because one indexer query returned no results. Check index status and refine the query before concluding.
- Preserve existing user changes and secrets. Do not expose or commit credentials from `.env` or other secret files.
