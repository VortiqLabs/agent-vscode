import type { CodeChunk } from '../types/CodeChunk.js';
import type { EmbeddingProvider } from './EmbeddingProvider.js';

export type EmbeddingGemmaOnnxDtype = 'q4' | 'q8' | 'fp32';

export interface EmbeddingGemmaOnnxProviderOptions {
  model?: string;
  dimensions?: 128 | 256 | 512 | 768;
  dtype?: EmbeddingGemmaOnnxDtype;
  cacheDir?: string;
  onProgress?: (message: string) => void;
}

/** Small injectable seam so provider behavior can be tested without downloading model weights. */
export interface EmbeddingGemmaOnnxRuntime {
  embed(texts: string[]): Promise<number[][]>;
  close?(): Promise<void> | void;
}

const DEFAULT_MODEL = 'onnx-community/embeddinggemma-2-ONNX';

/**
 * Node.js CPU provider for EmbeddingGemma 2 using the ONNX Community conversion
 * and Transformers.js. It loads only the text encoder (270M), not vision/audio.
 */
export class EmbeddingGemmaOnnxProvider implements EmbeddingProvider {
  readonly id: string;
  private readonly dimension: number;
  private readonly model: string;
  private readonly dtype: EmbeddingGemmaOnnxDtype;
  private runtimePromise: Promise<EmbeddingGemmaOnnxRuntime> | undefined;

  constructor(
    private readonly options: EmbeddingGemmaOnnxProviderOptions = {},
    private readonly injectedRuntime?: EmbeddingGemmaOnnxRuntime
  ) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.dimension = options.dimensions ?? 256;
    this.dtype = options.dtype ?? 'q8';
    if (![128, 256, 512, 768].includes(this.dimension)) {
      throw new Error('EmbeddingGemma 2 dimensions must be 128, 256, 512, or 768');
    }
    this.id = `embeddinggemma-2:onnx:${this.model}:${this.dtype}:${this.dimension}`;
  }

  dimensions(): number { return this.dimension; }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedPrefixed([`task: code retrieval | query: ${text.trim()}`]);
    if (!vector) throw new Error('EmbeddingGemma ONNX returned no query vector');
    return vector;
  }

  embedBatch(texts: string[]): Promise<number[][]> {
    return this.embedPrefixed(texts.map((text) => `title: none | text: ${text.trim()}`));
  }

  embedChunks(chunks: CodeChunk[]): Promise<number[][]> {
    return this.embedPrefixed(chunks.map((chunk) => `title: ${chunk.filePath} | text: ${chunk.text.trim()}`));
  }

  async close(): Promise<void> {
    if (this.injectedRuntime) {
      await this.injectedRuntime.close?.();
      return;
    }
    if (this.runtimePromise) {
      const runtime = await this.runtimePromise;
      await runtime.close?.();
      this.runtimePromise = undefined;
    }
  }

  private async embedPrefixed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const runtime = this.injectedRuntime ?? await (this.runtimePromise ??= this.createRuntime());
    const fullVectors = await runtime.embed(texts);
    if (fullVectors.length !== texts.length) {
      throw new Error(`EmbeddingGemma ONNX returned ${fullVectors.length} vectors for ${texts.length} inputs`);
    }
    return fullVectors.map((vector) => {
      if (vector.length < this.dimension || vector.some((value) => !Number.isFinite(value))) {
        throw new Error(`EmbeddingGemma ONNX returned an invalid ${vector.length}-dimensional vector`);
      }
      // MRL truncation requires re-normalization after slicing.
      const truncated = vector.slice(0, this.dimension);
      const norm = Math.sqrt(truncated.reduce((sum, value) => sum + value * value, 0));
      if (!Number.isFinite(norm) || norm === 0) throw new Error('EmbeddingGemma ONNX returned a zero-length vector');
      return truncated.map((value) => value / norm);
    });
  }

  private async createRuntime(): Promise<EmbeddingGemmaOnnxRuntime> {
    this.options.onProgress?.(`Loading EmbeddingGemma 2 text encoder (${this.dtype}, CPU)`);
    const { AutoConfig, AutoModel, AutoTokenizer } = await import('@huggingface/transformers');
    const lastProgress = new Map<string, number>();
    const modelOptions = {
      ...(this.options.cacheDir ? { cache_dir: this.options.cacheDir } : {}),
      progress_callback: (info: { status: string; file?: string; progress?: number }) => {
        if (info.status === 'progress' && info.file && info.progress !== undefined) {
          const percent = Math.floor(info.progress / 5) * 5;
          if (lastProgress.get(info.file) !== percent) {
            lastProgress.set(info.file, percent);
            this.options.onProgress?.(`Downloading ${info.file}: ${percent}%`);
          }
        } else if (info.status === 'ready') {
          this.options.onProgress?.('EmbeddingGemma 2 model is ready');
        }
      }
    };
    const config = await AutoConfig.from_pretrained(this.model, modelOptions);
    const mutableConfig = config as unknown as Record<string, unknown>;
    mutableConfig.vision_config = null;
    mutableConfig.audio_config = null;
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(this.model, modelOptions),
      AutoModel.from_pretrained(this.model, {
        ...modelOptions,
        config,
        device: 'cpu',
        dtype: this.dtype
      })
    ]);
    this.options.onProgress?.('EmbeddingGemma 2 CPU runtime initialized');
    return {
      async embed(texts: string[]): Promise<number[][]> {
        const encoded = await tokenizer(texts, { padding: true, truncation: true, max_length: 512 });
        const output = await model(encoded) as { sentence_embedding?: { tolist(): unknown } };
        if (!output.sentence_embedding) throw new Error('EmbeddingGemma ONNX model did not return sentence_embedding');
        const vectors = output.sentence_embedding.tolist();
        if (!Array.isArray(vectors)) throw new Error('EmbeddingGemma ONNX returned an invalid embedding tensor');
        return vectors as number[][];
      },
      async close() { await model.dispose(); }
    };
  }
}
