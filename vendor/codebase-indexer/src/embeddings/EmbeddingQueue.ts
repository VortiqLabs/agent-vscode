import type { EmbeddingProvider } from './EmbeddingProvider.js';
import type { CodeChunk } from '../types/CodeChunk.js';
import type { VectorRecord } from '../types/VectorRecord.js';

export class EmbeddingQueue {
  constructor(private readonly batchSize = 4) {}

  async embed(
    provider: EmbeddingProvider,
    chunks: CodeChunk[],
    providerId: string,
    onBatchProgress?: (completed: number, total: number) => void
  ): Promise<VectorRecord[]> {
    const vectors: VectorRecord[] = [];
    // The local ONNX text encoder is memory-heavy on CPU; keep its inference
    // micro-batches small. Remote/browser providers can retain the larger batch.
    const batchSize = provider.id?.startsWith('embeddinggemma-2:onnx:') ? 4 : this.batchSize;
    for (let offset = 0; offset < chunks.length; offset += batchSize) {
      const batch = chunks.slice(offset, offset + batchSize);
      const embeddings = provider.embedChunks
        ? await provider.embedChunks(batch)
        : await provider.embedBatch(batch.map((chunk) => chunk.text));
      if (embeddings.length !== batch.length) throw new Error('Embedding provider returned an unexpected batch size');
      for (let index = 0; index < batch.length; index++) {
        const values = embeddings[index]!;
        if (values.length !== provider.dimensions() || values.some((value) => !Number.isFinite(value))) {
          throw new Error('Embedding provider returned a vector with invalid dimensions or values');
        }
        vectors.push({
          chunkId: batch[index]!.id,
          chunkHash: batch[index]!.hash,
          providerId,
          dimensions: values.length,
          values
        });
      }
      onBatchProgress?.(Math.min(offset + batch.length, chunks.length), chunks.length);
    }
    return vectors;
  }
}