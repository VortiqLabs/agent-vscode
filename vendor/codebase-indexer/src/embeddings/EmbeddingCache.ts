import type { VectorRecord } from '../types/VectorRecord.js';

export class EmbeddingCache {
  private readonly vectorsByHash = new Map<string, VectorRecord>();

  constructor(vectors: VectorRecord[] = []) {
    for (const vector of vectors) this.vectorsByHash.set(vector.chunkHash, vector);
  }

  get(chunkHash: string): VectorRecord | undefined {
    return this.vectorsByHash.get(chunkHash);
  }

  set(vector: VectorRecord): void {
    this.vectorsByHash.set(vector.chunkHash, vector);
  }

  values(): VectorRecord[] {
    return [...this.vectorsByHash.values()];
  }
}