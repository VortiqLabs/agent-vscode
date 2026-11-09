import { IndexManager, type IndexManagerOptions, type IndexUpdateResult } from './IndexManager.js';
import type { BackgroundWatcherOptions, BackgroundWatcherStatus } from './BackgroundWatcher.js';
import type { FileRecord } from '../types/FileRecord.js';
import type { CodeChunk } from '../types/CodeChunk.js';
import type { IndexSnapshot } from '../storage/IndexFormat.js';
import type { EmbeddingProvider } from '../embeddings/EmbeddingProvider.js';
import type { IndexProgress } from './IndexManager.js';
import type { RelationRecord } from '../types/Relation.js';
import type { SymbolRecord } from '../types/Symbol.js';
import { ContextBuilder, type CodeContext, type ContextOptions } from '../context/ContextBuilder.js';
import type { ApiEndpoint } from '../intelligence/ApiDetector.js';
import { classifyQuery, type QueryIntent } from '../intelligence/QueryIntent.js';
import { findDependencyRelations, findSymbolPath, type ChangeImpactResult, type GraphPathResult } from '../intelligence/GraphQuery.js';
import { buildRepositoryMap, type RepositoryMap } from '../intelligence/RepositoryMap.js';
import { detectSensitiveRegions, type SensitiveRegion } from '../intelligence/SensitiveDetector.js';
import type { ArchitectureReport } from '../intelligence/ArchitectureAnalyzer.js';

export class CodebaseIndexer {
  private manager?: IndexManager;
  private readonly contextBuilder = new ContextBuilder();

  constructor(private readonly options: IndexManagerOptions) {}

  async initialize(): Promise<void> {
    this.manager = await IndexManager.create(this.options);
  }

  async index(force = false, onProgress?: (progress: IndexProgress) => void): Promise<IndexUpdateResult> {
    return this.getManager().index(force, onProgress);
  }

  async generateEmbeddings(provider?: EmbeddingProvider, onProgress?: (progress: IndexProgress) => void): Promise<number> {
    return this.getManager().generateEmbeddings(provider, onProgress);
  }

  async getSnapshot(): Promise<IndexSnapshot> {
    return this.getManager().read();
  }

  async getFiles(): Promise<FileRecord[]> {
    return (await this.getManager().read()).files;
  }

  async getChunks(options: { filePath?: string; query?: string; limit?: number; offset?: number } = {}): Promise<CodeChunk[]> {
    const snapshot = await this.getManager().read();
    const query = options.query?.toLowerCase();
    const filtered = snapshot.chunks.filter((chunk) =>
      (!options.filePath || chunk.filePath === options.filePath) &&
      (!query || chunk.text.toLowerCase().includes(query) || chunk.filePath.toLowerCase().includes(query) || chunk.hash.toLowerCase().includes(query))
    );
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const limit = options.limit === undefined ? filtered.length : Math.max(0, Math.floor(options.limit));
    return filtered.slice(offset, offset + limit);
  }

  async getSymbols(): Promise<SymbolRecord[]> {
    return (await this.getManager().read()).symbols;
  }

  async getRelations(): Promise<RelationRecord[]> {
    return (await this.getManager().read()).relations;
  }

  async getStatus(): Promise<{ indexed: boolean; snapshot?: IndexSnapshot; size?: number }> {
    return this.getManager().status();
  }

  async removeIndex(): Promise<boolean> {
    return this.getManager().remove();
  }

  async close(): Promise<void> {
    if (this.manager) await this.manager.stopWatching();
  }

  async startWatching(options: BackgroundWatcherOptions = {}): Promise<BackgroundWatcherStatus> {
    return this.getManager().startWatching(options);
  }

  async stopWatching(): Promise<BackgroundWatcherStatus> {
    return this.getManager().stopWatching();
  }

  getWatchingStatus(): BackgroundWatcherStatus {
    return this.getManager().getWatchingStatus();
  }

  async search(query: string, limit = 10): Promise<Array<{ file: FileRecord; score: number }>> {
    return this.getManager().search(query, limit);
  }

  async semanticSearch(query: string, limit = 10): Promise<Array<{ file: FileRecord; chunk: import('../types/CodeChunk.js').CodeChunk; score: number }>> {
    return this.getManager().semanticSearch(query, limit);
  }

  async hybridSearch(query: string, limit = 10): Promise<Array<{ file: FileRecord; score: number }>> {
    return this.getManager().hybridSearch(query, limit);
  }

  async getFile(filePath: string): Promise<FileRecord | undefined> {
    return this.getManager().getFile(filePath);
  }

  async findSymbol(name: string): Promise<SymbolRecord[]> {
    return this.getManager().findSymbol(name);
  }

  async findDefinition(name: string): Promise<SymbolRecord[]> {
    return this.findSymbol(name);
  }

  async findReferences(name: string): Promise<RelationRecord[]> {
    return this.getManager().findReferences(name);
  }

  async findCallers(name: string): Promise<RelationRecord[]> {
    return this.getManager().findCallers(name);
  }

  async findCallees(name: string): Promise<RelationRecord[]> {
    return this.getManager().findCallees(name);
  }

  async findDependencies(name: string, depth = 1): Promise<RelationRecord[]> {
    return this.getManager().findDependencies(name, depth);
  }

  async findDependents(name: string, depth = 1): Promise<RelationRecord[]> {
    return this.getManager().findDependents(name, depth);
  }

  async analyzeChangeImpact(query: string, maxDepth = 3): Promise<ChangeImpactResult> {
    return this.getManager().analyzeChangeImpact(query, maxDepth);
  }

  async analyzeArchitecture(): Promise<ArchitectureReport> {
    return this.getManager().analyzeArchitecture();
  }

  async findPath(from: string, to: string, options?: { maxDepth?: number; maxNodes?: number }): Promise<GraphPathResult> {
    return this.getManager().findPath(from, to, options);
  }

  async getRepositoryMap(): Promise<RepositoryMap> {
    return this.getManager().getRepositoryMap();
  }

  async classifyQuery(query: string): Promise<QueryIntent> {
    return this.getManager().classifyQuery(query);
  }

  async findApiEndpoints(): Promise<ApiEndpoint[]> {
    return this.getManager().findApiEndpoints();
  }

  async findSensitiveRegions(): Promise<SensitiveRegion[]> {
    return this.getManager().findSensitiveRegions();
  }

  async getContext(query: string, options: ContextOptions = {}): Promise<CodeContext> {
    const manager = this.getManager();
    const maxFiles = options.maxFiles ?? 8;
    const relatedSlots = options.includeRelatedFiles === false ? 0 : Math.min(options.maxRelatedFiles ?? 4, Math.max(0, maxFiles - 1));
    const results = await manager.search(query, Math.max(1, maxFiles - relatedSlots));
    const snapshot = await manager.read();
    return this.contextBuilder.build(snapshot, query, results.map((result) => result.file), options);
  }

  async getStats(): Promise<{
    uid: string;
    indexPath: string;
    fileCount: number;
    symbolCount: number;
    relationCount: number;
    chunkCount: number;
    vectorCount: number;
    updatedAt: string;
  }> {
    const manager = this.getManager();
    const snapshot = await manager.read();
    return {
      uid: manager.uid,
      indexPath: manager.indexPath,
      fileCount: snapshot.metadata.fileCount,
      symbolCount: snapshot.metadata.symbolCount,
      relationCount: snapshot.metadata.relationCount,
      chunkCount: snapshot.metadata.chunkCount,
      vectorCount: snapshot.metadata.vectorCount,
      updatedAt: snapshot.metadata.updatedAt
    };
  }

  private getManager(): IndexManager {
    if (!this.manager) throw new Error('Call initialize() before using the indexer');
    return this.manager;
  }
}