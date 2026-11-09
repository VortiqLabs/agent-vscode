import type { IndexSnapshot } from '../storage/IndexFormat.js';
import type { CodeChunk } from '../types/CodeChunk.js';
import type { FileRecord } from '../types/FileRecord.js';
import type { RelationRecord } from '../types/Relation.js';
import type { SymbolRecord } from '../types/Symbol.js';

export interface ContextOptions {
  maxTokens?: number;
  maxFiles?: number;
  includeRelatedFiles?: boolean;
  maxRelatedFiles?: number;
}

export interface CodeContext {
  files: Array<Pick<FileRecord, 'path' | 'language'>>;
  symbols: SymbolRecord[];
  relations: RelationRecord[];
  chunks: CodeChunk[];
  estimatedTokens: number;
}

export class ContextBuilder {
  build(snapshot: IndexSnapshot, query: string, rankedFiles: FileRecord[], options: ContextOptions = {}): CodeContext {
    const maxTokens = options.maxTokens ?? 6000;
    const maxFiles = options.maxFiles ?? 8;
    const seedFiles = rankedFiles.slice(0, maxFiles);
    const filePaths = new Set(seedFiles.map((file) => file.path));
    const relatedLimit = Math.max(0, Math.min(maxFiles - seedFiles.length, options.maxRelatedFiles ?? 4));
    if (options.includeRelatedFiles !== false && relatedLimit > 0) {
      const symbolById = new Map(snapshot.symbols.map((symbol) => [symbol.id, symbol]));
      const relatedScores = new Map<string, number>();
      for (const relation of snapshot.relations) {
        const sourceSelected = filePaths.has(relation.filePath);
        const fromSymbol = relation.fromSymbolId ? symbolById.get(relation.fromSymbolId) : undefined;
        const toSymbol = relation.toSymbolId ? symbolById.get(relation.toSymbolId) : undefined;
        if (sourceSelected && toSymbol && !filePaths.has(toSymbol.filePath)) {
          relatedScores.set(toSymbol.filePath, (relatedScores.get(toSymbol.filePath) ?? 0) + relation.confidence);
        }
        if (toSymbol && filePaths.has(toSymbol.filePath) && fromSymbol && !filePaths.has(fromSymbol.filePath)) {
          relatedScores.set(fromSymbol.filePath, (relatedScores.get(fromSymbol.filePath) ?? 0) + relation.confidence);
        }
      }
      const filesByPath = new Map(snapshot.files.map((file) => [file.path, file]));
      const relatedFiles = [...relatedScores.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, relatedLimit)
        .flatMap(([filePath]) => filesByPath.has(filePath) ? [filesByPath.get(filePath)!] : []);
      for (const file of relatedFiles) filePaths.add(file.path);
    }
    const selectedFiles = [...seedFiles, ...snapshot.files.filter((file) => filePaths.has(file.path) && !seedFiles.some((seed) => seed.path === file.path))];
    const terms = query.toLowerCase().match(/[\p{L}\p{N}_$.-]+/gu) ?? [];
    const chunks = snapshot.chunks.filter((chunk) => filePaths.has(chunk.filePath))
      .map((chunk) => ({ chunk, score: scoreText(chunk.text, terms) }))
      .sort((left, right) => right.score - left.score || left.chunk.startLine - right.chunk.startLine);
    const selectedChunks: CodeChunk[] = [];
    let estimatedTokens = 0;
    for (const { chunk } of chunks) {
      const cost = Math.ceil(chunk.text.length / 4);
      if (estimatedTokens + cost > maxTokens) continue;
      selectedChunks.push(chunk);
      estimatedTokens += cost;
    }
    const symbolIds = new Set(selectedChunks.flatMap((chunk) => chunk.symbolId ? [chunk.symbolId] : []));
    const symbols = snapshot.symbols.filter((symbol) => symbolIds.has(symbol.id));
    const expanded = new Set(symbolIds);
    for (const relation of snapshot.relations) {
      if (relation.fromSymbolId && symbolIds.has(relation.fromSymbolId) && relation.toSymbolId) expanded.add(relation.toSymbolId);
      if (relation.toSymbolId && symbolIds.has(relation.toSymbolId) && relation.fromSymbolId) expanded.add(relation.fromSymbolId);
    }
    const selectedRelations = snapshot.relations.filter((relation) =>
      (relation.fromSymbolId && expanded.has(relation.fromSymbolId)) ||
      (relation.toSymbolId && expanded.has(relation.toSymbolId)) || filePaths.has(relation.filePath));
    const relatedSymbols = snapshot.symbols.filter((symbol) => expanded.has(symbol.id));
    const uniqueSymbols = [...new Map([...symbols, ...relatedSymbols].map((symbol) => [symbol.id, symbol])).values()];
    return {
      files: selectedFiles.map(({ path, language }) => ({ path, language })),
      symbols: uniqueSymbols,
      relations: selectedRelations,
      chunks: selectedChunks,
      estimatedTokens
    };
  }
}

function scoreText(text: string, terms: string[]): number {
  const normalized = text.toLowerCase();
  return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}