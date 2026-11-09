import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { IndexManager } from '../core/IndexManager.js';
import { indexGitHubRepository } from '../github/GitHubRepositoryIndexer.js';
import { IndexReader } from '../storage/BinaryIndex.js';
import { analyzeChangeImpact } from '../intelligence/GraphQuery.js';
import { analyzeArchitecture } from '../intelligence/ArchitectureAnalyzer.js';
import type { IndexSnapshot } from '../storage/IndexFormat.js';

export interface CodebaseIndexerMcpServerOptions {
  indexDir?: string;
  githubToken?: string;
}

interface LoadedIndex {
  snapshot: IndexSnapshot;
  filePath: string;
}

export function createCodebaseIndexerMcpServer(options: CodebaseIndexerMcpServerOptions = {}): McpServer {
  const indexDir = path.resolve(options.indexDir ?? process.env.CODEBASE_INDEX_DIR ?? path.join(os.homedir(), '.cache', 'codebase-indexer'));
  const server = new McpServer({ name: 'codebase-indexer', version: '0.1.0' });
  const watchingManagers = new Map<string, IndexManager>();

  server.registerTool('list_indexes', {
    description: 'List all valid codebase indexes available in the configured index directory.',
    inputSchema: {}
  }, async () => {
    try {
      const { indexes, errors } = await loadIndexes(indexDir);
      return jsonResult({
        indexes: indexes.map(({ snapshot, filePath }) => ({ indexPath: filePath, metadata: snapshot.metadata })),
        errors
      });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('search_code', {
    description: 'Search indexed files across all workspaces, or restrict the search to one index UID.',
    inputSchema: {
      query: z.string().min(1),
      indexUid: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional()
    }
  }, async ({ query, indexUid, limit }) => {
    try {
      const { indexes } = await loadIndexes(indexDir);
      return jsonResult(searchIndexes(indexes, query, indexUid, limit ?? 10));
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('read_indexed_file', {
    description: 'Read a source file that is part of an existing index. Call list_indexes first to get an index UID.',
    inputSchema: {
      indexUid: z.string().regex(/^[a-f\d]{32}$/iu),
      filePath: z.string().min(1)
    }
  }, async ({ indexUid, filePath }) => {
    try {
      const { indexes } = await loadIndexes(indexDir);
      const loaded = indexes.find(({ snapshot }) => snapshot.metadata.uid === indexUid);
      if (!loaded) throw new Error('Index not found');
      return jsonResult(await readIndexedFile(loaded.snapshot, filePath));
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('get_symbol_relations', {
    description: 'Find symbol definitions and their indexed relations, optionally restricted to one index UID.',
    inputSchema: {
      name: z.string().min(1),
      indexUid: z.string().optional()
    }
  }, async ({ name, indexUid }) => {
    try {
      const { indexes } = await loadIndexes(indexDir);
      const matches = indexes.filter(({ snapshot }) => !indexUid || snapshot.metadata.uid === indexUid)
        .flatMap(({ snapshot }) => symbolRelations(snapshot, name));
      return jsonResult(matches);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('analyze_change_impact', {
    description: 'Estimate what could be affected if a file or symbol changes. Returns direct and transitive dependent files, affected symbols, relation confidence, and caveats. Use an exact symbol name or workspace-relative file path.',
    inputSchema: {
      query: z.string().min(1),
      indexUid: z.string().optional(),
      maxDepth: z.number().int().min(1).max(8).optional()
    }
  }, async ({ query, indexUid, maxDepth }) => {
    try {
      const { indexes } = await loadIndexes(indexDir);
      const selected = indexes.filter(({ snapshot }) => !indexUid || snapshot.metadata.uid === indexUid);
      if (selected.length === 0) throw new Error('No matching codebase index found; call list_indexes first.');
      return jsonResult(selected.map(({ snapshot }) => ({
        indexUid: snapshot.metadata.uid,
        workspacePath: snapshot.metadata.workspaceRoot,
        ...analyzeChangeImpact(snapshot, query, maxDepth ?? 3)
      })));
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('analyze_architecture', {
    description: 'Analyze the indexed repository file-dependency graph. Reports resolvable relative imports, circular dependency groups, fan-in/fan-out, entry-point candidates, and unresolved relative imports.',
    inputSchema: { indexUid: z.string().optional() }
  }, async ({ indexUid }) => {
    try {
      const { indexes } = await loadIndexes(indexDir);
      const selected = indexes.filter(({ snapshot }) => !indexUid || snapshot.metadata.uid === indexUid);
      if (selected.length === 0) throw new Error('No matching codebase index found; call list_indexes first.');
      return jsonResult(await Promise.all(selected.map(async ({ snapshot }) => ({
        indexUid: snapshot.metadata.uid,
        workspacePath: snapshot.metadata.workspaceRoot,
        ...await analyzeArchitecture(snapshot, snapshot.metadata.workspaceRoot)
      }))));
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('index_local_workspace', {
    description: 'Index or refresh a local workspace directory into the configured index directory.',
    inputSchema: {
      workspacePath: z.string().min(1),
      force: z.boolean().optional()
    }
  }, async ({ workspacePath, force }) => {
    try {
      const manager = await IndexManager.create({ workspacePath: path.resolve(workspacePath), indexDir });
      const result = await manager.index(force ?? false);
      return jsonResult({
        uid: manager.uid,
        indexPath: result.indexPath,
        workspacePath: manager.workspacePath,
        fileCount: result.snapshot.metadata.fileCount,
        symbolCount: result.snapshot.metadata.symbolCount,
        relationCount: result.snapshot.metadata.relationCount,
        chunkCount: result.snapshot.metadata.chunkCount,
        added: result.added,
        changed: result.changed,
        deleted: result.deleted,
        errors: result.errors
      });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('start_watching', {
    description: 'Start background filesystem watching for a local workspace. Creates an initial index if needed, then debounces changes and incrementally refreshes the index.',
    inputSchema: {
      workspacePath: z.string().min(1),
      debounceMs: z.number().int().min(50).max(60_000).optional()
    }
  }, async ({ workspacePath, debounceMs }) => {
    try {
      const manager = await IndexManager.create({ workspacePath: path.resolve(workspacePath), indexDir });
      const current = await manager.status();
      const initialIndex = current.indexed ? undefined : await manager.index();
      const status = await manager.startWatching({ ...(debounceMs !== undefined ? { debounceMs } : {}) });
      watchingManagers.set(manager.uid, manager);
      return jsonResult({
        indexUid: manager.uid,
        workspacePath: manager.workspacePath,
        initialIndex: initialIndex ? {
          added: initialIndex.added, changed: initialIndex.changed, deleted: initialIndex.deleted,
          fileCount: initialIndex.snapshot.metadata.fileCount
        } : undefined,
        watcher: status
      });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('stop_watching', {
    description: 'Stop background filesystem watching for an active workspace watcher.',
    inputSchema: { indexUid: z.string().regex(/^[a-f\d]{32}$/iu) }
  }, async ({ indexUid }) => {
    try {
      const manager = watchingManagers.get(indexUid);
      if (!manager) throw new Error('No active watcher for this index UID');
      const status = await manager.stopWatching();
      watchingManagers.delete(indexUid);
      return jsonResult({ indexUid, watcher: status });
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('watch_status', {
    description: 'Get the live background watcher state, pending changes, last indexing result, and errors.',
    inputSchema: { indexUid: z.string().regex(/^[a-f\d]{32}$/iu) }
  }, async ({ indexUid }) => {
    const manager = watchingManagers.get(indexUid);
    if (!manager) return errorResult(new Error('No active watcher for this index UID'));
    return jsonResult({ indexUid, watcher: manager.getWatchingStatus() });
  });

  server.registerTool('index_github_repository', {
    description: 'Download and index a public or private GitHub repository. Private access uses GITHUB_TOKEN or GH_TOKEN from the MCP server environment, never a tool argument.',
    inputSchema: {
      owner: z.string().min(1),
      repository: z.string().min(1),
      ref: z.string().optional()
    }
  }, async ({ owner, repository, ref }) => {
    try {
      const result = await indexGitHubRepository(owner, repository, ref ?? 'HEAD', {
        indexDir,
        ...(options.githubToken ? { token: options.githubToken } : {})
      });
      return jsonResult(result);
    } catch (error) {
      return errorResult(error);
    }
  });

  return server;
}

export async function startCodebaseIndexerMcpServer(options: CodebaseIndexerMcpServerOptions = {}): Promise<void> {
  const server = createCodebaseIndexerMcpServer(options);
  await server.connect(new StdioServerTransport());
}

async function loadIndexes(indexDir: string): Promise<{
  indexes: LoadedIndex[];
  errors: Array<{ indexPath: string; message: string }>;
}> {
  let entries;
  try {
    entries = await readdir(indexDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) return { indexes: [], errors: [] };
    throw error;
  }
  const indexes: LoadedIndex[] = [];
  const errors: Array<{ indexPath: string; message: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.index')) continue;
    const filePath = path.join(indexDir, entry.name);
    try {
      const snapshot = await IndexReader.read(filePath);
      indexes.push({ snapshot, filePath });
    } catch (error) {
      errors.push({ indexPath: filePath, message: error instanceof Error ? error.message : String(error) });
    }
  }
  indexes.sort((left, right) => left.snapshot.metadata.workspaceRoot.localeCompare(right.snapshot.metadata.workspaceRoot));
  return { indexes, errors };
}

function searchIndexes(indexes: LoadedIndex[], query: string, indexUid: string | undefined, limit: number) {
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_$.-]+/gu) ?? [])];
  if (terms.length === 0) return [];
  return indexes.filter(({ snapshot }) => !indexUid || snapshot.metadata.uid === indexUid)
    .flatMap(({ snapshot }) => {
      const symbolsByPath = new Map<string, string[]>();
      for (const symbol of snapshot.symbols) {
        symbolsByPath.set(symbol.filePath, [...(symbolsByPath.get(symbol.filePath) ?? []), symbol.name]);
      }
      return snapshot.files.flatMap((file) => {
        const termMatches = terms.filter((term) => file.terms.includes(term)).length;
        const pathMatches = terms.filter((term) => file.path.toLowerCase().includes(term)).length;
        const symbolMatches = (symbolsByPath.get(file.path) ?? []).reduce((total, name) =>
          total + terms.filter((term) => name.toLowerCase().includes(term)).length, 0);
        const score = termMatches * 2 + pathMatches + symbolMatches * 4;
        if (score === 0) return [];
        const excerpt = snapshot.chunks.find((chunk) => chunk.filePath === file.path &&
          terms.some((term) => chunk.text.toLowerCase().includes(term)))?.text.slice(0, 500);
        return [{
          indexUid: snapshot.metadata.uid,
          workspacePath: snapshot.metadata.workspaceRoot,
          filePath: file.path,
          language: file.language,
          score,
          ...(excerpt ? { excerpt } : {})
        }];
      });
    })
    .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath))
    .slice(0, limit);
}

async function readIndexedFile(snapshot: IndexSnapshot, filePath: string) {
  const indexedFile = snapshot.files.find((file) => file.path === filePath);
  if (!indexedFile) throw new Error('File is not part of this index');
  const root = await realpath(snapshot.metadata.workspaceRoot);
  const candidate = path.resolve(root, indexedFile.path);
  if (!isPathInside(root, candidate)) throw new Error('File path is outside the indexed workspace');
  const actualPath = await realpath(candidate);
  if (!isPathInside(root, actualPath)) throw new Error('File resolves outside the indexed workspace');
  const fileStats = await stat(actualPath);
  if (!fileStats.isFile()) throw new Error('Indexed path is not a file');
  return {
    filePath: indexedFile.path,
    language: indexedFile.language,
    content: await readFile(actualPath, 'utf8')
  };
}

function symbolRelations(snapshot: IndexSnapshot, name: string) {
  const normalizedName = name.toLowerCase();
  const symbols = snapshot.symbols.filter((symbol) => symbol.name.toLowerCase() === normalizedName);
  const symbolIds = new Set(symbols.map((symbol) => symbol.id));
  const symbolNames = new Map(snapshot.symbols.map((symbol) => [symbol.id, symbol.name]));
  const relations = snapshot.relations.filter((relation) =>
    relation.targetName.toLowerCase() === normalizedName ||
    Boolean(relation.fromSymbolId && symbolIds.has(relation.fromSymbolId)) ||
    Boolean(relation.toSymbolId && symbolIds.has(relation.toSymbolId)));
  return [{
    indexUid: snapshot.metadata.uid,
    workspacePath: snapshot.metadata.workspaceRoot,
    symbols,
    relations: relations.map((relation) => ({
      ...relation,
      fromName: relation.fromSymbolId ? symbolNames.get(relation.fromSymbolId) : undefined,
      toName: relation.toSymbolId ? symbolNames.get(relation.toSymbolId) : undefined
    }))
  }];
}

function isPathInside(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath);
}

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }]
  };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}