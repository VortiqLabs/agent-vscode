import { Backend, EmbeddingEngine, loadLiteRtLm } from '@litert-lm/core';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
declare global {
  interface Window { __CODEBASE_INDEXER_LITERT__?: { model?: string; dimensions?: number; wasmPath?: string; backend?: 'cpu' | 'gpu' } }
}

const vscode = acquireVsCodeApi();
const config = window.__CODEBASE_INDEXER_LITERT__ ?? {};
const defaultModel = 'https://huggingface.co/litert-community/embeddinggemma-2-740m-litert-lm/resolve/main/embeddinggemma-2-740m.litertlm';
let engine: EmbeddingEngine | undefined;

async function initialize(): Promise<EmbeddingEngine> {
  if (engine) return engine;
  const model = config.model ?? defaultModel;
  const dimensions = config.dimensions ?? 256;
  if (config.wasmPath) await loadLiteRtLm(config.wasmPath);
  const selectedBackend = config.backend === 'gpu' ? Backend.GPU : Backend.CPU;
  engine = await EmbeddingEngine.create({ model, backend: selectedBackend });
  vscode.postMessage({ type: 'codebase-indexer:ready', dimensions, backend: config.backend ?? 'cpu' });
  return engine;
}

const enginePromise = initialize().catch((error: unknown) => {
  vscode.postMessage({ type: 'codebase-indexer:init-error', error: error instanceof Error ? error.message : String(error) });
  throw error;
});

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as { type?: string; requestId?: string; task?: string; texts?: string[] };
  if (message?.type !== 'codebase-indexer:embed' || !message.requestId || !Array.isArray(message.texts)) return;
  void (async () => {
    try {
      const activeEngine = await enginePromise;
      const responses = await activeEngine.computeEmbeddingBatch(message.texts!, {
        normalize: true,
        outputSize: config.dimensions ?? 256
      });
      vscode.postMessage({
        type: 'codebase-indexer:embedding-result',
        requestId: message.requestId,
        vectors: responses.map((response) => response.embedding)
      });
    } catch (error) {
      vscode.postMessage({
        type: 'codebase-indexer:embedding-error',
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  })();
});

window.addEventListener('unload', () => { void engine?.delete(); });
