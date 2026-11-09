import type { CodeChunk } from '../types/CodeChunk.js';
import type { EmbeddingProvider } from './EmbeddingProvider.js';

export type LiteRTEmbeddingTask = 'search-query' | 'search-result';

export interface LiteRTEmbeddingTransport {
  computeEmbeddingBatch(texts: string[], task: LiteRTEmbeddingTask): Promise<number[][]>;
  dispose?(): void;
}

export interface LiteRTEmbeddingProviderOptions {
  model?: string;
  dimensions?: 128 | 256 | 512 | 768;
}

/**
 * EmbeddingGemma 2 provider whose inference runtime is hosted outside Node
 * (normally in a VS Code WebView using @litert-lm/core).
 */
export class LiteRTEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  private readonly dimension: number;
  private readonly model: string;

  constructor(
    private readonly transport: LiteRTEmbeddingTransport,
    options: LiteRTEmbeddingProviderOptions = {}
  ) {
    this.model = options.model ?? 'https://huggingface.co/litert-community/embeddinggemma-2-740m-litert-lm/resolve/main/embeddinggemma-2-740m.litertlm';
    this.dimension = options.dimensions ?? 256;
    if (![128, 256, 512, 768].includes(this.dimension)) {
      throw new Error('EmbeddingGemma 2 dimensions must be 128, 256, 512, or 768');
    }
    this.id = `litert-embeddinggemma-2:${this.model}:${this.dimension}`;
  }

  dimensions(): number { return this.dimension; }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.transport.computeEmbeddingBatch(
      [`task: search query | text: ${text.trim()}`],
      'search-query'
    );
    if (!vector) throw new Error('LiteRT-LM returned no embedding for the search query');
    return vector;
  }

  embedBatch(texts: string[]): Promise<number[][]> {
    return this.transport.computeEmbeddingBatch(
      texts.map((text) => `task: search result | text: ${text.trim()}`),
      'search-result'
    );
  }

  embedChunks(chunks: CodeChunk[]): Promise<number[][]> {
    return this.transport.computeEmbeddingBatch(
      chunks.map((chunk) => `task: search result | text: file: ${chunk.filePath}\n${chunk.text.trim()}`),
      'search-result'
    );
  }

  close(): void { this.transport.dispose?.(); }
}

export interface LiteRTWebviewMessageEvent<T = unknown> { data: T }
export interface LiteRTWebviewDisposable { dispose(): void }

export interface LiteRTWebviewBridgeOptions {
  postMessage(message: unknown): void | boolean | PromiseLike<boolean>;
  onMessage(listener: (event: LiteRTWebviewMessageEvent) => void): LiteRTWebviewDisposable;
  timeoutMs?: number;
  readyTimeoutMs?: number;
}

type BridgeResponse =
  | { type: 'codebase-indexer:ready' }
  | { type: 'codebase-indexer:init-error'; error: string }
  | { type: 'codebase-indexer:embedding-result'; requestId: string; vectors: number[][] }
  | { type: 'codebase-indexer:embedding-error'; requestId: string; error: string };

/** Adapts VS Code Webview.postMessage/onDidReceiveMessage to the provider transport. */
export class LiteRTWebviewEmbeddingTransport implements LiteRTEmbeddingTransport {
  private sequence = 0;
  private disposed = false;
  private readonly pending = new Map<string, { resolve: (vectors: number[][]) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private readySettled = false;
  private readonly subscription: LiteRTWebviewDisposable;
  private readonly readyTimer: NodeJS.Timeout;

  constructor(private readonly options: LiteRTWebviewBridgeOptions) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.readyPromise.catch(() => {});
    this.readyTimer = setTimeout(() => {
      if (!this.readySettled) {
        this.readySettled = true;
        this.rejectReady(new Error(`LiteRT-LM WebView did not initialize within ${options.readyTimeoutMs ?? 600_000}ms`));
      }
    }, options.readyTimeoutMs ?? 600_000);
    this.readyTimer.unref();
    this.subscription = options.onMessage((event) => this.handleMessage(event.data as BridgeResponse));
  }

  async computeEmbeddingBatch(texts: string[], task: LiteRTEmbeddingTask): Promise<number[][]> {
    if (this.disposed) throw new Error('LiteRT WebView embedding transport is disposed');
    if (texts.length === 0) return [];
    await this.readyPromise;
    const requestId = `embedding-${++this.sequence}`;
    return new Promise<number[][]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`LiteRT WebView embedding request timed out after ${this.options.timeoutMs ?? 300_000}ms`));
      }, this.options.timeoutMs ?? 300_000);
      this.pending.set(requestId, { resolve, reject, timer });
      Promise.resolve(this.options.postMessage({
        type: 'codebase-indexer:embed', requestId, task, texts
      })).then((accepted) => {
        if (accepted === false) {
          const pending = this.pending.get(requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(requestId);
            pending.reject(new Error('VS Code WebView rejected the embedding request'));
          }
        }
      }).catch((error: unknown) => {
        const pending = this.pending.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(requestId);
          pending.reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.subscription.dispose();
    const error = new Error('LiteRT WebView embedding transport disposed');
    clearTimeout(this.readyTimer);
    if (!this.readySettled) { this.readySettled = true; clearTimeout(this.readyTimer); this.rejectReady(error); }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private handleMessage(message: BridgeResponse): void {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'codebase-indexer:ready') {
      if (!this.readySettled) { this.readySettled = true; clearTimeout(this.readyTimer); this.resolveReady(); }
      return;
    }
    if (message.type === 'codebase-indexer:init-error') {
      const error = new Error(`LiteRT-LM initialization failed: ${message.error}`);
      if (!this.readySettled) { this.readySettled = true; clearTimeout(this.readyTimer); this.rejectReady(error); }
      return;
    }
    if (message.type !== 'codebase-indexer:embedding-result' && message.type !== 'codebase-indexer:embedding-error') return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.type === 'codebase-indexer:embedding-error') pending.reject(new Error(message.error));
    else pending.resolve(message.vectors);
  }
}

export interface LiteRTWebviewHtmlOptions {
  scriptUri: string;
  cspSource: string;
  nonce: string;
  model?: string;
  dimensions?: 128 | 256 | 512 | 768;
  wasmUri?: string;
  backend?: 'cpu' | 'gpu';
}

/** HTML shell for a VS Code WebView; pass webview.asWebviewUri(scriptUri). */
export function createLiteRTEmbeddingWebviewHtml(options: LiteRTWebviewHtmlOptions): string {
  const model = options.model ?? 'https://huggingface.co/litert-community/embeddinggemma-2-740m-litert-lm/resolve/main/embeddinggemma-2-740m.litertlm';
  const dimensions = options.dimensions ?? 256;
  const wasmPath = options.wasmUri ? `${options.wasmUri.replace(/\/$/, '')}/` : undefined;
  const config = JSON.stringify({ model, dimensions, wasmPath, backend: options.backend ?? 'cpu' }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; connect-src https: data: ${options.cspSource}; script-src 'nonce-${options.nonce}' 'wasm-unsafe-eval' ${options.cspSource}; worker-src blob:; style-src 'unsafe-inline';">
<title>Codebase Indexer Embeddings</title></head><body>
<script nonce="${options.nonce}">window.__CODEBASE_INDEXER_LITERT__=${config};</script>
<script nonce="${options.nonce}" src="${options.scriptUri}"></script>
</body></html>`;
}
