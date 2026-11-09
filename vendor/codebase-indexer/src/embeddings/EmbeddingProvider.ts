import type { CodeChunk } from '../types/CodeChunk.js';

export interface EmbeddingProvider {
  dimensions(): number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  embedChunks?(chunks: CodeChunk[]): Promise<number[][]>;
  close?(): void | Promise<void>;
  id?: string;
}