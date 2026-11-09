import type { CodeChunk } from '../types/CodeChunk.js';
import type { EmbeddingProvider } from './EmbeddingProvider.js';

export interface OpenAICompatibleEmbeddingOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  dimensions?: number;
  queryPrefix?: string;
  documentPrefix?: string;
  timeoutMs?: number;
}

/** Provider for OpenAI-compatible /v1/embeddings servers (including local gateways). */
export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  private readonly dimension: number;
  private readonly endpoint: string;

  constructor(private readonly options: OpenAICompatibleEmbeddingOptions) {
    if (!options.baseUrl || !options.model) throw new Error('Embedding baseUrl and model are required');
    this.dimension = options.dimensions ?? 256;
    this.endpoint = `${options.baseUrl.replace(/\/$/, '')}/embeddings`;
    this.id = `openai-compatible:${this.endpoint}:${options.model}:${this.dimension}`;
  }

  dimensions(): number { return this.dimension; }
  async embed(text: string): Promise<number[]> {
    const [vector] = await this.request([`${this.options.queryPrefix ?? 'task: search query | text: '}${text.trim()}`]);
    return vector!;
  }
  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.request(texts.map((text) => `${this.options.documentPrefix ?? 'task: search result | text: '}${text.trim()}`));
  }
  async embedChunks(chunks: CodeChunk[]): Promise<number[][]> {
    return this.request(chunks.map((chunk) => `task: search result | text: file: ${chunk.filePath}\n${chunk.text.trim()}`));
  }

  private async request(input: string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 120_000);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}) },
        body: JSON.stringify({ model: this.options.model, input, dimensions: this.dimension }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Embedding endpoint returned HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`);
      const payload = await response.json() as { data?: Array<{ index: number; embedding: number[] }>; error?: { message?: string } };
      if (!Array.isArray(payload.data) || payload.data.length !== input.length) throw new Error(payload.error?.message ?? 'Embedding endpoint returned an unexpected number of vectors');
      return payload.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
    } finally { clearTimeout(timeout); }
  }
}
