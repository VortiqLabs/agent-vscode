import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runtimePath } from '../runtime/runtime-paths.js';
import { pathToFileURL } from 'node:url';
import { indexGitHubRepository } from '../github/GitHubRepositoryIndexer.js';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEX_CHECKSUM_SIZE, INDEX_HEADER_SIZE, INDEX_MAGIC, type IndexMetadata, type IndexSnapshot } from '../storage/IndexFormat.js';
import { IndexReader } from '../storage/BinaryIndex.js';
import { detectSensitiveRegions } from '../intelligence/SensitiveDetector.js';
import { DASHBOARD_PAGE } from './DashboardPage.js';
import { GitHubIndexJobs } from './GitHubIndexJobs.js';
import { GRAPH_PAGE } from './GraphPage.js';
import { IndexManager } from '../core/IndexManager.js';
import { EmbeddingGemmaOnnxProvider, type EmbeddingGemmaOnnxProviderOptions } from '../embeddings/EmbeddingGemmaOnnxProvider.js';
import type { EmbeddingProvider } from '../embeddings/EmbeddingProvider.js';

const execFileAsync = promisify(execFile);
const graphClientPath = runtimePath(
  'dashboard',
  'graph-client.js'
);

const highlightClientPath = runtimePath('dashboard', 'highlight-client.js');

const monacoAssetsPath = runtimePath(
  'dashboard',
  'monaco'
);

const indexWorkerPath = runtimePath(
  'workers',
  'IndexSnapshotWorker.js'
);
export interface DashboardAppOptions {
  githubRepositoryIndexer?: typeof indexGitHubRepository;
  embeddingProviderFactory?: (options: EmbeddingGemmaOnnxProviderOptions) => EmbeddingProvider;
}

interface CachedIndex {
  modifiedAt: number;
  size: number;
  summary: DashboardIndexSummary;
}

interface LoadedIndex {
  summary: DashboardIndexSummary;
  fileName: string;
  filePath: string;
}

interface DashboardIndexSummary {
  metadata: IndexMetadata;
  relationKinds: Record<string, number>;
}

interface EmbeddingGenerationJob {
  id: string;
  uid: string;
  status: 'running' | 'completed' | 'failed';
  current: number;
  total: number;
  message: string;
  startedAt: number;
  durationMs?: number;
  result?: { ok: true; provider: string; dimensions: number; vectorCount: number; durationMs: number };
  error?: string;
}

const MAX_CACHE_ENTRIES = 100;

export function defaultIndexDirectory(): string {
  return path.join(os.homedir(), '.cache', 'codebase-indexer');
}

export function createDashboardApp(indexDirectory: string, options: DashboardAppOptions = {}): Express {
  const app = express();
  const resolvedDirectory = path.resolve(indexDirectory);
  const cache = new Map<string, CachedIndex>();
  const embeddingJobs = new Map<string, EmbeddingGenerationJob>();
  const githubJobs = new GitHubIndexJobs(resolvedDirectory, options.githubRepositoryIndexer);
  const createEmbeddingProvider = options.embeddingProviderFactory ?? ((providerOptions: EmbeddingGemmaOnnxProviderOptions) => new EmbeddingGemmaOnnxProvider(providerOptions));
  app.use(express.json({ limit: '16kb' }));

  app.get('/', (_request, response) => response.type('html').send(DASHBOARD_PAGE));
  app.get('/graph/:uid', (request, response) => {
    if (!/^[a-f\d]{32}$/iu.test(request.params.uid)) {
      response.status(400).send('Invalid index UID');
      return;
    }
    response.type('html').send(GRAPH_PAGE.replace('__INDEX_UID__', request.params.uid));
  });
  app.get('/assets/graph-client.js', (_request, response) => response.sendFile(graphClientPath));
  app.get('/assets/highlight-client.js', (_request, response) => response.sendFile(highlightClientPath));
  app.use('/assets/monaco', express.static(monacoAssetsPath));

  app.get('/api/system/memory', (_request, response) => {
    const mem = process.memoryUsage();
    response.json({
      rssMb: Math.round(mem.rss / (1024 * 1024)),
      heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
      externalMb: Math.round(mem.external / (1024 * 1024)),
      cacheSize: cache.size
    });
  });

  app.post('/api/github/index', (request, response) => {
    try {
      const body = request.body as Record<string, unknown>;
      const repository = parseGitHubUrl(body.url);
      const ref = typeof body.ref === 'string' && body.ref.trim() ? body.ref.trim() : repository.ref ?? 'HEAD';
      const patterns = parseIgnorePatterns(body.patterns);
      const maxFileSize = parseMaxFileSize(body.maxFileSize);
      const job = githubJobs.start(repository.owner, repository.repository, {
        ref,
        ...(patterns.length ? { patterns } : {}),
        ...(maxFileSize ? { maxFileSize } : {})
      });
      response.status(202).json({ ...job, eventsUrl: `/api/github/jobs/${job.id}/events` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(message.includes('already running') ? 409 : 400).json({ error: message });
    }
  });

  app.get('/api/github/jobs/:jobId', (request, response) => {
    const job = githubJobs.get(request.params.jobId);
    if (!job) {
      response.status(404).json({ error: 'GitHub indexing job not found' });
      return;
    }
    response.json(job);
  });

  app.get('/api/github/jobs/:jobId/events', (request, response) => {
    if (!githubJobs.get(request.params.jobId)) {
      response.status(404).json({ error: 'GitHub indexing job not found' });
      return;
    }
    response.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    response.flushHeaders();
    const lastEventHeader = request.get('last-event-id') ?? request.query.after;
    const afterEventId = typeof lastEventHeader === 'string' && /^\d+$/u.test(lastEventHeader) ? Number(lastEventHeader) : 0;
    const unsubscribe = githubJobs.subscribe(request.params.jobId, (event) => {
      response.write(`id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      if (event.event === 'completed' || event.event === 'failed') response.end();
    }, afterEventId);
    const heartbeat = response.writableEnded ? undefined : setInterval(() => response.write(': keepalive\n\n'), 15_000);
    response.on('close', () => {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    });
  });

  app.get('/api/indexes', async (_request, response) => {
    const { indexes, errors } = await loadIndexes(resolvedDirectory, cache);
    response.json({
      indexes: indexes.map(({ summary, fileName }) => ({
        fileName,
        metadata: summary.metadata,
        relationKinds: summary.relationKinds
      })),
      errors
    });
  });

  app.get('/api/indexes/:uid', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) {
      response.status(400).json({ error: 'Invalid index UID' });
      return;
    }
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) {
      response.status(404).json({ error: 'Index not found' });
      return;
    }
    response.json({
      metadata: loaded.summary.metadata,
      graph: await runIndexWorker(loaded.filePath, { operation: 'graph', all: request.query.all === 'true' })
    });
  });

  app.get('/api/indexes/:uid/graph/cycles', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    response.json({ cycles: await runIndexWorker(loaded.filePath, { operation: 'cycles' }) });
  });

  app.get('/api/indexes/:uid/graph/matrix', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    response.json(await runIndexWorker(loaded.filePath, { operation: 'matrix' }));
  });

  app.get('/api/indexes/:uid/graph/radial', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    const query = typeof request.query.q === 'string' ? request.query.q : undefined;
    response.json(await runIndexWorker(loaded.filePath, { operation: 'radial', ...(query ? { query } : {}) }));
  });

  app.get('/api/indexes/:uid/graph/flow', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    response.json(await runIndexWorker(loaded.filePath, { operation: 'flow' }));
  });

  app.get('/api/indexes/:uid/graph/path', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    const from = typeof request.query.from === 'string' ? request.query.from : '';
    const to = typeof request.query.to === 'string' ? request.query.to : '';
    response.json(await runIndexWorker(loaded.filePath, { operation: 'path', from, to }));
  });

  app.get('/api/indexes/:uid/complexity', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    response.json(await runIndexWorker(loaded.filePath, { operation: 'complexity' }));
  });

  app.get('/api/indexes/:uid/duplicates', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    response.json(await runIndexWorker(loaded.filePath, { operation: 'duplicates' }));
  });

  app.get('/api/indexes/:uid/database', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    response.json({ models: await runIndexWorker(loaded.filePath, { operation: 'database' }) });
  });

  app.get('/api/indexes/:uid/tests', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    response.json({ tests: await runIndexWorker(loaded.filePath, { operation: 'tests' }) });
  });

  app.post('/api/indexes/:uid/tests/run', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });

    const workspaceRoot = loaded.summary.metadata.workspaceRoot;
    try {
      const packageJsonPath = path.join(workspaceRoot, 'package.json');
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { scripts?: Record<string, unknown> };
      if (typeof packageJson.scripts?.test !== 'string' || !packageJson.scripts.test.trim()) {
        return response.status(400).json({ error: 'This workspace does not define a package.json test script.' });
      }
      const startedAt = Date.now();
      try {
        const result = await execFileAsync('npm', ['test'], {
          cwd: workspaceRoot,
          timeout: 180_000,
          maxBuffer: 4 * 1024 * 1024,
          encoding: 'utf8',
          windowsHide: true
        });
        response.json({
          ok: true,
          command: 'npm test',
          workspace: workspaceRoot,
          durationMs: Date.now() - startedAt,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: 0
        });
      } catch (error) {
        const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
        response.status(200).json({
          ok: false,
          command: 'npm test',
          workspace: workspaceRoot,
          durationMs: Date.now() - startedAt,
          stdout: failure.stdout ?? '',
          stderr: failure.stderr ?? failure.message,
          exitCode: typeof failure.code === 'number' ? failure.code : null,
          timedOut: failure.killed === true
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(400).json({ error: `Unable to run workspace tests: ${message}` });
    }
  });

  app.post('/api/indexes/:uid/embeddings/test', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    const body = request.body as Record<string, unknown>;
    const dimensions = body.dimensions === undefined ? 256 : Number(body.dimensions);
    const dtype = body.dtype === undefined ? 'q8' : body.dtype;
    const query = typeof body.query === 'string' ? body.query.trim() : 'Where is authentication handled?';
    if (![128, 256, 512, 768].includes(dimensions)) return response.status(400).json({ error: 'Dimensions must be 128, 256, 512, or 768' });
    if (!['q4', 'q8', 'fp32'].includes(String(dtype))) return response.status(400).json({ error: 'Dtype must be q4, q8, or fp32' });
    if (!query || query.length > 4000) return response.status(400).json({ error: 'Query must contain 1–4000 characters' });
    let provider: (EmbeddingProvider & { close?: () => Promise<void> | void }) | undefined;
    const startedAt = Date.now();
    try {
      const snapshot = await IndexReader.read(loaded.filePath, uid);
      const sample = snapshot.chunks.find((chunk) => /\.(?:[cm]?[jt]sx?|py|rs|go|java|cpp|c|h|cs|rb|php|swift|kt)$/iu.test(chunk.filePath)) ?? snapshot.chunks[0];
      if (!sample) return response.status(400).json({ error: 'This index has no code chunks to test against. Re-index the workspace first.' });
      provider = createEmbeddingProvider({
        dimensions: dimensions as 128 | 256 | 512 | 768,
        dtype: dtype as 'q4' | 'q8' | 'fp32',
        onProgress: (message) => console.info(`[embeddings] ${message}`)
      }) as EmbeddingProvider & { close?: () => Promise<void> | void };
      const queryVector = await provider.embed(query);
      const [documentVector] = provider.embedChunks
        ? await provider.embedChunks([sample])
        : await provider.embedBatch([sample.text]);
      if (!documentVector) throw new Error('EmbeddingGemma returned no document vector');
      const dot = queryVector.reduce((sum, value, index) => sum + value * (documentVector[index] ?? 0), 0);
      response.json({ ok: true, model: 'onnx-community/embeddinggemma-2-ONNX', provider: provider.id, device: 'cpu', dtype, dimensions: queryVector.length,
        queryNorm: Math.sqrt(queryVector.reduce((sum, value) => sum + value * value, 0)),
        documentNorm: Math.sqrt(documentVector.reduce((sum, value) => sum + value * value, 0)),
        sampleFile: sample.filePath, sampleChunkId: sample.id, cosineSimilarity: dot, durationMs: Date.now() - startedAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(500).json({ error: message, durationMs: Date.now() - startedAt });
    } finally { await provider?.close?.(); }
  });

  app.post('/api/indexes/:uid/embeddings/search', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    const body = request.body as Record<string, unknown>;
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const requestedLimit = body.limit === undefined ? 10 : Number(body.limit);
    const limit = Number.isSafeInteger(requestedLimit) ? Math.max(1, Math.min(50, requestedLimit)) : 10;
    if (!query || query.length > 4000) return response.status(400).json({ error: 'Query must contain 1–4000 characters' });
    const storedProvider = loaded.summary.metadata.embeddingProvider ?? '';
    const match = /^embeddinggemma-2:onnx:(.+):(q4|q8|fp32):(128|256|512|768)$/u.exec(storedProvider);
    if (!match) return response.status(409).json({ error: 'This index does not contain EmbeddingGemma ONNX vectors. Generate vectors with EmbeddingGemma first; vectors from LiteRT or other providers cannot be reused.' });
    const model = match[1]!;
    const dtype = match[2]!;
    const dimensions = Number(match[3]!) as 128 | 256 | 512 | 768;
    let provider: (EmbeddingProvider & { close?: () => Promise<void> | void }) | undefined;
    const startedAt = Date.now();
    try {
      provider = createEmbeddingProvider({ model, dimensions, dtype: dtype as 'q4' | 'q8' | 'fp32' }) as EmbeddingProvider & { close?: () => Promise<void> | void };
      const manager = await IndexManager.create({ workspacePath: loaded.summary.metadata.workspaceRoot, indexDir: resolvedDirectory, embeddingProvider: provider });
      if (manager.uid !== uid) throw new Error('Workspace/index identity mismatch; refusing to query another index');
      const results = await manager.semanticSearch(query, limit);
      response.json({ ok: true, provider: provider.id, dimensions, resultCount: results.length, durationMs: Date.now() - startedAt,
        results: results.map(({ file, chunk, score }) => ({ path: file.path, language: file.language, score, chunkId: chunk.id, excerpt: chunk.text.slice(0, 900) })) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(500).json({ error: message, durationMs: Date.now() - startedAt });
    } finally { await provider?.close?.(); }
  });

  app.post('/api/indexes/:uid/embeddings/generate', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    const body = request.body as Record<string, unknown>;
    const dimensions = body.dimensions === undefined ? 256 : Number(body.dimensions);
    const dtype = body.dtype === undefined ? 'q8' : body.dtype;
    if (![128, 256, 512, 768].includes(dimensions)) return response.status(400).json({ error: 'Dimensions must be 128, 256, 512, or 768' });
    if (!['q4', 'q8', 'fp32'].includes(String(dtype))) return response.status(400).json({ error: 'Dtype must be q4, q8, or fp32' });
    const activeJob = [...embeddingJobs.values()].find((job) => job.uid === uid && job.status === 'running');
    if (activeJob) return response.status(202).json({ jobId: activeJob.id, status: activeJob.status, current: activeJob.current, total: activeJob.total, message: activeJob.message });

    const job: EmbeddingGenerationJob = {
      id: randomUUID(), uid, status: 'running', current: 0,
      total: loaded.summary.metadata.chunkCount, message: 'Starting EmbeddingGemma CPU runtime', startedAt: Date.now()
    };
    embeddingJobs.set(job.id, job);
    response.status(202).json({ jobId: job.id, status: job.status, current: job.current, total: job.total, message: job.message });

    void (async () => {
      let provider: (EmbeddingProvider & { close?: () => Promise<void> | void }) | undefined;
      try {
        provider = createEmbeddingProvider({
          dimensions: dimensions as 128 | 256 | 512 | 768,
          dtype: dtype as 'q4' | 'q8' | 'fp32',
          onProgress: (message) => { job.message = message; console.info(`[embeddings] ${message}`); }
        }) as EmbeddingProvider & { close?: () => Promise<void> | void };
        const manager = await IndexManager.create({ workspacePath: loaded.summary.metadata.workspaceRoot, indexDir: resolvedDirectory, embeddingProvider: provider });
        if (manager.uid !== uid) throw new Error('Workspace/index identity mismatch; refusing to write embeddings to another index');
        const vectorCount = await manager.generateEmbeddings(provider, (progress) => {
          job.current = progress.current ?? job.current;
          job.total = progress.total ?? job.total;
          job.message = progress.message;
          console.info(`[embeddings] ${progress.message} (${job.current}/${job.total})`);
        });
        cache.delete(loaded.filePath);
        job.result = { ok: true, provider: provider!.id ?? provider!.constructor.name, dimensions: provider!.dimensions(), vectorCount, durationMs: Date.now() - job.startedAt };
        job.status = 'completed';
        job.current = job.total;
        job.message = 'Vector generation completed';
        job.durationMs = Date.now() - job.startedAt;
      } catch (error) {
        job.error = error instanceof Error ? error.message : String(error);
        job.status = 'failed';
        job.message = 'Vector generation failed';
        job.durationMs = Date.now() - job.startedAt;
        console.error(`[embeddings] Job ${job.id} failed: ${job.error}`);
      } finally {
        try { await provider?.close?.(); }
        catch (error) { console.error('[embeddings] Failed to close provider:', error); }
      }
    })();
  });

  app.get('/api/embedding-jobs/:jobId', (request, response) => {
    const job = embeddingJobs.get(request.params.jobId);
    if (!job) return response.status(404).json({ error: 'Embedding job not found' });
    response.json({
      jobId: job.id, uid: job.uid, status: job.status, current: job.current,
      total: job.total, message: job.message, durationMs: job.durationMs,
      result: job.result, error: job.error
    });
  });

  app.get('/api/indexes/:uid/configDoc', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    response.json(await runIndexWorker(loaded.filePath, { operation: 'configDoc' }));
  });

  app.get('/api/indexes/:uid/git', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    const gitData = await getGitInfo(loaded.summary.metadata.workspaceRoot);
    response.json(gitData);
  });

  app.get('/api/indexes/:uid/health', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    const health = await checkHealth(loaded.filePath, uid);
    response.json(health);
  });

  app.post('/api/indexes/:uid/repair', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    cache.delete(loaded.filePath);
    response.json({ ok: true, message: 'Index cache cleared and snapshot verified' });
  });

  app.get('/api/indexes/:uid/export', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) {
      response.status(400).json({ error: 'Invalid index UID' });
      return;
    }
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) {
      response.status(404).json({ error: 'Index not found' });
      return;
    }
    const snapshot = await IndexReader.read(loaded.filePath, uid);
    const format = typeof request.query.format === 'string' ? request.query.format.toLowerCase() : 'json';

    if (format === 'csv') {
      const csvRows = ['Name,Kind,FilePath,StartLine,EndLine'];
      for (const sym of snapshot.symbols) {
        csvRows.push(`"${sym.name.replace(/"/g, '""')}","${sym.kind}","${sym.filePath.replace(/"/g, '""')}",${sym.startLine},${sym.endLine}`);
      }
      response.setHeader('Content-Type', 'text/csv');
      response.setHeader('Content-Disposition', `attachment; filename="${uid}-symbols.csv"`);
      response.send(csvRows.join('\n'));
      return;
    }

    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Content-Disposition', `attachment; filename="${uid}-export.json"`);
    response.json({
      metadata: snapshot.metadata,
      files: snapshot.files.map(f => ({ path: f.path, language: f.language, size: f.size })),
      symbols: snapshot.symbols,
      relations: snapshot.relations
    });
  });

  app.get('/api/indexes/:uid/intelligence', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) {
      response.status(400).json({ error: 'Invalid index UID' });
      return;
    }
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) {
      response.status(404).json({ error: 'Index not found' });
      return;
    }
    response.json(await runIndexWorker(loaded.filePath, { operation: 'intelligence' }));
  });

  app.get('/api/indexes/:uid/files', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) {
      response.status(400).json({ error: 'Invalid index UID' });
      return;
    }
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) {
      response.status(404).json({ error: 'Index not found' });
      return;
    }
    const snapshot = await IndexReader.read(loaded.filePath, uid);
    const query = typeof request.query.q === 'string' ? request.query.q.trim().toLowerCase() : '';
    const language = typeof request.query.language === 'string' ? request.query.language : undefined;
    const files = snapshot.files.filter((file) => {
      if (language && file.language !== language) return false;
      if (!query) return true;
      return file.path.toLowerCase().includes(query) || file.language.toLowerCase().includes(query) || file.terms.some((term) => term.toLowerCase().includes(query));
    });
    response.json({ files });
  });

  app.get('/api/indexes/:uid/symbols', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) {
      response.status(400).json({ error: 'Invalid index UID' });
      return;
    }
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) {
      response.status(404).json({ error: 'Index not found' });
      return;
    }
    const snapshot = await IndexReader.read(loaded.filePath, uid);
    const query = typeof request.query.q === 'string' ? request.query.q.trim().toLowerCase() : '';
    const filtered = query
      ? snapshot.symbols.filter((symbol) => symbol.name.toLowerCase().includes(query) || symbol.filePath.toLowerCase().includes(query))
      : snapshot.symbols;
    response.json({ symbols: filtered });
  });

  app.get('/api/indexes/:uid/chunks', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid index UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    const snapshot = await IndexReader.read(loaded.filePath, uid);
    const offsetValue = Number(request.query.offset ?? 0);
    const limitValue = Number(request.query.limit ?? 100);
    const offset = Number.isFinite(offsetValue) ? Math.max(0, Math.floor(offsetValue)) : 0;
    const limit = Number.isFinite(limitValue) ? Math.min(500, Math.max(1, Math.floor(limitValue))) : 100;
    const query = typeof request.query.q === 'string' ? request.query.q.trim().toLowerCase() : '';
    const filePath = typeof request.query.file === 'string' ? request.query.file : '';
    const filteredChunks = snapshot.chunks.filter((chunk) => (!filePath || chunk.filePath === filePath) && (!query || chunk.filePath.toLowerCase().includes(query) || chunk.hash.toLowerCase().includes(query) || chunk.text.toLowerCase().includes(query)));
    const chunks = filteredChunks.slice(offset, offset + limit);
    response.json({
      chunks,
      total: filteredChunks.length,
      offset,
      limit,
      nextOffset: offset + chunks.length,
      files: [...new Set(snapshot.chunks.map((chunk) => chunk.filePath))].sort()
    });
  });

  app.get('/api/indexes/:uid/references', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid index UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    const snapshot = await IndexReader.read(loaded.filePath, uid);
    const query = typeof request.query.q === 'string' ? request.query.q.trim().toLowerCase() : '';
    const kind = typeof request.query.kind === 'string' ? request.query.kind : '';
    const relations = snapshot.relations.filter((relation) => {
      if (kind && relation.kind !== kind) return false;
      if (!query) return true;
      const from = snapshot.symbols.find((symbol) => symbol.id === relation.fromSymbolId);
      const to = snapshot.symbols.find((symbol) => symbol.id === relation.toSymbolId);
      return [relation.targetName, relation.filePath, from?.name, to?.name].some((value) => value?.toLowerCase().includes(query));
    });
    response.json({ relations, total: snapshot.relations.length, symbols: snapshot.symbols });
  });

  app.get('/api/indexes/:uid/callgraph', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid index UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    const snapshot = await IndexReader.read(loaded.filePath, uid);
    const query = typeof request.query.q === 'string' ? request.query.q.trim().toLowerCase() : '';
    const symbol = query ? snapshot.symbols.find((item) => item.name.toLowerCase() === query) ?? snapshot.symbols.find((item) => item.name.toLowerCase().includes(query)) : undefined;
    if (!symbol) return response.json({ selected: null, matches: snapshot.symbols.filter((item) => !query || item.name.toLowerCase().includes(query)).slice(0, 100), callers: [], callees: [], totalCalls: snapshot.relations.filter((item) => item.kind === 'calls').length });
    const callers = snapshot.relations.filter((item) => item.kind === 'calls' && item.toSymbolId === symbol.id);
    const callees = snapshot.relations.filter((item) => item.kind === 'calls' && item.fromSymbolId === symbol.id);
    response.json({ selected: symbol, callers, callees, matches: [], totalCalls: snapshot.relations.filter((item) => item.kind === 'calls').length, symbols: snapshot.symbols });
  });

  app.get('/api/indexes/:uid/architecture', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) return response.status(400).json({ error: 'Invalid index UID' });
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) return response.status(404).json({ error: 'Index not found' });
    response.json(await runIndexWorker(loaded.filePath, { operation: 'architecture' }));
  });

  app.get('/api/indexes/:uid/security', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) {
      response.status(400).json({ error: 'Invalid index UID' });
      return;
    }
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) {
      response.status(404).json({ error: 'Index not found' });
      return;
    }
    const snapshot = await IndexReader.read(loaded.filePath, uid);
    response.json({ findings: await detectSensitiveRegions(snapshot) });
  });

  app.get('/api/indexes/:uid/inspect', async (request, response) => {
    const uid = request.params.uid;
    if (!/^[a-f\d]{32}$/iu.test(uid)) {
      response.status(400).json({ error: 'Invalid index UID' });
      return;
    }
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) {
      response.status(404).json({ error: 'Index not found' });
      return;
    }
    const buffer = await readFile(loaded.filePath);
    const magic = buffer.subarray(0, INDEX_MAGIC.length).toString('ascii');
    const version = buffer.readUInt16BE(8);
    const flags = buffer.readUInt16BE(10);
    const uidLength = buffer.readUInt16BE(12);
    const payloadLength = Number(buffer.readBigUInt64BE(14));
    const headerSize = INDEX_HEADER_SIZE;
    const checksumSize = INDEX_CHECKSUM_SIZE;
    const bodyLength = headerSize + uidLength + payloadLength;
    const snapshot = await IndexReader.read(loaded.filePath, uid);
    response.json({
      filePath: loaded.filePath,
      magic,
      version,
      flags,
      uid,
      headerSize,
      uidLength,
      payloadLength,
      bodyLength,
      checksumSize,
      fileSize: buffer.length,
      sections: [
        { name: 'header', size: headerSize },
        { name: 'uid', size: uidLength },
        { name: 'payload', size: payloadLength },
        { name: 'checksum', size: checksumSize }
      ],
      snapshot: {
        metadata: snapshot.metadata,
        fileCount: snapshot.files.length,
        symbolCount: snapshot.symbols.length,
        relationCount: snapshot.relations.length,
        chunkCount: snapshot.chunks.length,
        vectorCount: snapshot.vectors.length
      }
    });
  });

  app.get('/api/indexes/:uid/source', async (request, response) => {
    const uid = request.params.uid;
    const relativeFilePath = typeof request.query.path === 'string' ? request.query.path : '';
    if (!/^[a-f\d]{32}$/iu.test(uid) || !relativeFilePath) {
      response.status(400).json({ error: 'A valid index UID and file path are required' });
      return;
    }
    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    const loaded = indexes.find(({ summary }) => summary.metadata.uid === uid);
    if (!loaded) {
      response.status(404).json({ error: 'Index not found' });
      return;
    }
    const indexedFile = await runIndexWorker<{ path: string; language: string } | undefined>(loaded.filePath, {
      operation: 'file',
      relativeFilePath
    });
    if (!indexedFile) {
      response.status(404).json({ error: 'File is not part of this index' });
      return;
    }
    const workspaceRoot = await realpath(loaded.summary.metadata.workspaceRoot);
    const candidatePath = path.resolve(workspaceRoot, indexedFile.path);
    if (!isPathInside(workspaceRoot, candidatePath)) {
      response.status(403).json({ error: 'File path is outside the indexed workspace' });
      return;
    }
    const actualPath = await realpath(candidatePath);
    if (!isPathInside(workspaceRoot, actualPath)) {
      response.status(403).json({ error: 'File resolves outside the indexed workspace' });
      return;
    }
    response.json({
      path: indexedFile.path,
      language: indexedFile.language,
      content: await readFile(actualPath, 'utf8')
    });
  });

  app.get('/api/search', async (request, response) => {
    const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    const indexUid = typeof request.query.index === 'string' ? request.query.index : undefined;
    const indexGroup = typeof request.query.group === 'string' ? request.query.group : undefined;
    const language = typeof request.query.language === 'string' && request.query.language ? request.query.language : undefined;
    const requestedLimit = typeof request.query.limit === 'string' ? Number(request.query.limit) : 50;
    const limit = Number.isSafeInteger(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 50;
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_$.-]+/gu) ?? [])];
    if (terms.length === 0) {
      response.json({ results: [] });
      return;
    }

    const { indexes } = await loadIndexes(resolvedDirectory, cache);
    let results: Array<{ uid: string; workspace: string; path: string; language: string; score: number; excerpt?: string }> = [];
    for (const loaded of indexes) {
      if (indexUid && loaded.summary.metadata.uid !== indexUid) continue;
      if (indexGroup && dashboardIndexGroup(loaded.summary.metadata) !== indexGroup) continue;
      const indexResults = await runIndexWorker<typeof results>(loaded.filePath, { operation: 'search', query, limit });
      results.push(...indexResults);
    }
    if (language) {
      results = results.filter(r => r.language === language);
    }
    results.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
    response.json({ results: results.slice(0, limit) });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Dashboard request failed' });
  });

  return app;
}

async function getGitInfo(workspaceRoot: string) {
  try {
    const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: workspaceRoot });
    const { stdout: branch } = await execFileAsync('git', ['branch', '--show-current'], { cwd: workspaceRoot });
    const { stdout: log } = await execFileAsync('git', ['log', '-n', '20', '--pretty=format:%h|%an|%ar|%s'], { cwd: workspaceRoot });

    const commits = log.split('\n').filter(Boolean).map((line) => {
      const parts = line.split('|');
      return { hash: parts[0] || '', author: parts[1] || '', date: parts[2] || '', subject: parts[3] || '' };
    });

    const changedFiles = status.split('\n').filter(Boolean).map((line) => {
      return { code: line.slice(0, 2).trim(), filePath: line.slice(3).trim() };
    });

    return {
      isGit: true,
      branch: branch.trim() || 'main',
      commits,
      changedFiles
    };
  } catch {
    return { isGit: false, branch: 'N/A', commits: [], changedFiles: [] };
  }
}

async function checkHealth(filePath: string, uid: string) {
  try {
    const snapshot = await IndexReader.read(filePath, uid);
    const missingFiles: string[] = [];
    for (const f of snapshot.files.slice(0, 50)) {
      const fullPath = path.resolve(snapshot.metadata.workspaceRoot, f.path);
      try {
        await stat(fullPath);
      } catch {
        missingFiles.push(f.path);
      }
    }
    const symbolIds = new Set(snapshot.symbols.map((s) => s.id));
    let brokenRefs = 0;
    for (const r of snapshot.relations) {
      if (r.fromSymbolId && !symbolIds.has(r.fromSymbolId)) brokenRefs++;
      if (r.toSymbolId && !symbolIds.has(r.toSymbolId)) brokenRefs++;
    }

    return {
      status: brokenRefs === 0 && missingFiles.length === 0 ? 'HEALTHY' : 'WARNINGS',
      missingFiles,
      brokenReferencesCount: brokenRefs,
      totalFiles: snapshot.files.length,
      totalSymbols: snapshot.symbols.length,
      totalRelations: snapshot.relations.length
    };
  } catch (err) {
    return {
      status: 'CORRUPTED',
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

async function loadIndexes(
  indexDirectory: string,
  cache: Map<string, CachedIndex>
): Promise<{ indexes: LoadedIndex[]; errors: Array<{ fileName: string; message: string }> }> {
  let entries;
  try {
    entries = await readdir(indexDirectory, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) return { indexes: [], errors: [] };
    throw error;
  }

  const indexFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.index'));
  const presentPaths = new Set(indexFiles.map((entry) => path.join(indexDirectory, entry.name)));
  for (const cachedPath of cache.keys()) {
    if (!presentPaths.has(cachedPath)) cache.delete(cachedPath);
  }

  const indexes: LoadedIndex[] = [];
  const errors: Array<{ fileName: string; message: string }> = [];
  for (const entry of indexFiles) {
    const filePath = path.join(indexDirectory, entry.name);
    try {
      const fileStats = await stat(filePath);
      const cached = cache.get(filePath);
      let summary: DashboardIndexSummary;
      if (cached && cached.modifiedAt === fileStats.mtimeMs && cached.size === fileStats.size) {
        summary = cached.summary;
      } else {
        summary = await runIndexWorker<DashboardIndexSummary>(filePath, { operation: 'summary' });
        if (cache.size >= MAX_CACHE_ENTRIES) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey !== undefined) cache.delete(oldestKey);
        }
        cache.set(filePath, { modifiedAt: fileStats.mtimeMs, size: fileStats.size, summary });
      }
      indexes.push({ summary, fileName: entry.name, filePath });
    } catch (error) {
      cache.delete(filePath);
      errors.push({ fileName: entry.name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  indexes.sort((left, right) => left.summary.metadata.workspaceRoot.localeCompare(right.summary.metadata.workspaceRoot));
  return { indexes, errors };
}

function isPathInside(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath);
}

interface IndexWorkerRequest {
  operation: 'summary' | 'graph' | 'search' | 'file' | 'intelligence' | 'cycles' | 'matrix' | 'radial' | 'flow' | 'complexity' | 'duplicates' | 'database' | 'tests' | 'configDoc' | 'path' | 'architecture';
  all?: boolean;
  query?: string;
  limit?: number;
  relativeFilePath?: string;
  from?: string;
  to?: string;
}

function runIndexWorker<T>(filePath: string, request: IndexWorkerRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(indexWorkerPath, {
      workerData: { ...request, filePath },
      resourceLimits: { maxOldGenerationSizeMb: 1024, maxYoungGenerationSizeMb: 128 }
    });
    let settled = false;
    worker.once('message', (message: { ok: boolean; value?: T; error?: string }) => {
      settled = true;
      if (message.ok) resolve(message.value as T);
      else reject(new Error(message.error ?? 'Index worker failed'));
    });
    worker.once('error', (error) => {
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (!settled && code !== 0) reject(new Error(`Index worker exited with code ${code}; the index may exceed its 1 GB memory limit`));
      else if (!settled) reject(new Error('Index worker exited without returning a result'));
    });
  });
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function dashboardIndexGroup(metadata: IndexMetadata): string | undefined {
  if (metadata.indexGroup) return metadata.indexGroup;
  const label = metadata.indexLabel;
  if (!label) return undefined;
  const groupedLabel = label.replace(/\s+·\s+part\s+\d+\s+of\s+\d+$/iu, '');
  return groupedLabel === label ? undefined : groupedLabel;
}

function parseGitHubUrl(value: unknown): { owner: string; repository: string; ref?: string } {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a GitHub repository URL');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid GitHub repository URL');
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password) {
    throw new Error('Repository URL must use https://github.com');
  }
  const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts.length < 2) throw new Error('GitHub URL must include an owner and repository');
  const owner = parts[0]!;
  const repository = parts[1]!.replace(/\.git$/iu, '');
  if (parts.length === 2) return { owner, repository };
  if (parts[2] === 'tree' && parts[3]) return { owner, repository, ref: parts[3] };
  throw new Error('Use a repository URL or a /tree/<branch> URL');
}

function parseIgnorePatterns(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50 || value.some((item) => typeof item !== 'string' || item.length > 300)) {
    throw new Error('Ignore patterns must be up to 50 strings of 300 characters or fewer');
  }
  return value.map((pattern) => pattern.trim()).filter(Boolean);
}

function parseMaxFileSize(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 1024 || size > 100 * 1024 * 1024) {
    throw new Error('Maximum file size must be between 1 KB and 100 MB');
  }
  return size;
}
