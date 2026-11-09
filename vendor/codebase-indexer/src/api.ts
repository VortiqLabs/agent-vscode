/** Stable application-facing SDK entry point. */
export { Codebase, createCodebase } from './core/Codebase.js';
export type { CodebaseOptions } from './core/Codebase.js';
export { CodebaseIndexer } from './core/CodebaseIndexer.js';
export type { IndexManagerOptions, IndexUpdateResult, IndexProgress } from './core/IndexManager.js';
export type { BackgroundWatcherOptions, BackgroundWatcherStatus } from './core/BackgroundWatcher.js';
export type { FileRecord, ScanError, ScanResult } from './types/FileRecord.js';
export type { CodeChunk } from './types/CodeChunk.js';
export type { SymbolKind, SymbolRecord } from './types/Symbol.js';
export type { RelationKind, RelationRecord } from './types/Relation.js';
export type { IndexMetadata, IndexSnapshot } from './storage/IndexFormat.js';
export type { ContextOptions, CodeContext } from './context/ContextBuilder.js';
export type { EmbeddingProvider } from './embeddings/EmbeddingProvider.js';
export type { ArchitectureReport } from './intelligence/ArchitectureAnalyzer.js';
export type { ChangeImpactResult, GraphPathResult } from './intelligence/GraphQuery.js';
export type { RepositoryMap } from './intelligence/RepositoryMap.js';
