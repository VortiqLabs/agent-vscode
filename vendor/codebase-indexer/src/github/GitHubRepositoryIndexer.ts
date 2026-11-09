import { createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Worker } from 'node:worker_threads';
import * as tar from 'tar';
import type { IndexProgress } from '../core/IndexManager.js';
import { FileScanner } from '../scanner/FileScanner.js';
import { runtimePath } from '../runtime/runtime-paths.js';

const MAX_ARCHIVE_SIZE = 512 * 1024 * 1024;
const FILES_PER_INDEX_PART = 100;
const SOURCE_BYTES_PER_INDEX_PART = 32 * 1024 * 1024;
const INDEX_PART_WORKER_PATH = pathToFileURL(
  runtimePath('workers', 'GitHubIndexPartWorker.js')
);
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/u;

export interface GitHubRepositoryIndexerOptions {
  indexDir?: string;
  token?: string;
  apiBaseUrl?: string;
  fetchImplementation?: typeof fetch;
  patterns?: string[];
  maxFileSize?: number;
  onProgress?: (progress: GitHubRepositoryProgress) => void;
}

export type GitHubRepositoryProgress = IndexProgress | {
  stage: 'download' | 'extract' | 'partition';
  message: string;
  current?: number;
  total?: number;
};

export interface GitHubRepositoryIndexPart {
  uid: string;
  indexPath: string;
  indexLabel?: string;
  fileCount: number;
  symbolCount: number;
  relationCount: number;
  chunkCount: number;
}

export interface GitHubRepositoryIndexResult {
  owner: string;
  repository: string;
  ref: string;
  workspacePath: string;
  indexPath: string;
  uid: string;
  fileCount: number;
  symbolCount: number;
  relationCount: number;
  chunkCount: number;
  errors: number;
  parts?: GitHubRepositoryIndexPart[];
}

export async function indexGitHubRepository(
  owner: string,
  repository: string,
  ref = 'HEAD',
  options: GitHubRepositoryIndexerOptions = {}
): Promise<GitHubRepositoryIndexResult> {
  validateRepository(owner, repository, ref);
  const indexDirectory = path.resolve(options.indexDir ?? path.join(os.homedir(), '.cache', 'codebase-indexer'));
  const refKey = createHash('sha256').update(ref).digest('hex').slice(0, 16);
  const workspacePath = path.join(indexDirectory, '.github-repositories', owner.toLowerCase(), repository.toLowerCase(), refKey);
  const workspaceParent = path.dirname(workspacePath);
  await mkdir(workspaceParent, { recursive: true });

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'codebase-indexer-github-'));
  const archivePath = path.join(temporaryDirectory, 'repository.tar.gz');
  const stagingPath = await mkdtemp(path.join(workspaceParent, '.staging-'));
  const manifestPath = path.join(workspaceParent, `${refKey}.index-parts.json`);
  let workspaceInstalled = false;
  try {
    await extractRepositoryArchive(owner, repository, ref, archivePath, stagingPath, workspacePath, options);
    workspaceInstalled = true;
    const indexGroup = `${owner.toLowerCase()}/${repository.toLowerCase()}@${ref}`;
    return await indexRepositoryParts(owner, repository, ref, refKey, indexGroup, workspacePath, indexDirectory, manifestPath, options);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    if (!workspaceInstalled) await rm(stagingPath, { recursive: true, force: true });
  }
}

async function extractRepositoryArchive(
  owner: string,
  repository: string,
  ref: string,
  archivePath: string,
  stagingPath: string,
  workspacePath: string,
  options: GitHubRepositoryIndexerOptions
): Promise<void> {
  options.onProgress?.({ stage: 'download', message: `Requesting ${owner}/${repository}@${ref} archive from GitHub` });
  await downloadArchive(owner, repository, ref, archivePath, options);
  options.onProgress?.({ stage: 'extract', message: 'Extracting repository archive' });
  let extractedEntries = 0;
  await tar.x({
    file: archivePath,
    cwd: stagingPath,
    strip: 1,
    strict: true,
    onentry: () => {
      extractedEntries++;
      if (extractedEntries === 1 || extractedEntries % 500 === 0) {
        options.onProgress?.({ stage: 'extract', current: extractedEntries, message: `Extracted ${extractedEntries.toLocaleString()} archive entries` });
      }
    }
  });
  options.onProgress?.({ stage: 'extract', current: extractedEntries, message: `Extraction complete: ${extractedEntries.toLocaleString()} entries` });
  await rm(workspacePath, { recursive: true, force: true });
  await rename(stagingPath, workspacePath);
}

async function indexRepositoryParts(
  owner: string,
  repository: string,
  ref: string,
  refKey: string,
  indexGroup: string,
  workspacePath: string,
  indexDirectory: string,
  manifestPath: string,
  options: GitHubRepositoryIndexerOptions
): Promise<GitHubRepositoryIndexResult> {
  const discovered = await discoverFiles(workspacePath, options);
  const batches = splitIntoBatches(discovered.files, FILES_PER_INDEX_PART, SOURCE_BYTES_PER_INDEX_PART);
  const previousIndexNames = await readIndexManifest(manifestPath);
  const legacyUid = createHash('sha256').update(workspacePath).digest('hex').slice(0, 32);
  previousIndexNames.add(`${legacyUid}.index`);
  const partResults: GitHubRepositoryIndexPart[] = [];
  let indexingErrors = discovered.errors;

  for (let index = 0; index < batches.length; index++) {
    const outcome = await indexRepositoryPart({
      owner,
      repository,
      ref,
      refKey,
      indexGroup,
      workspacePath,
      indexDirectory,
      batch: batches[index]!,
      index: index + 1,
      totalParts: batches.length,
      options
    });
    partResults.push(outcome.part);
    indexingErrors += outcome.errors;
    const currentIndexNames = partResults.map((part) => path.basename(part.indexPath));
    await writeIndexManifest(manifestPath, [...new Set([...previousIndexNames, ...currentIndexNames])]);
  }

  const currentIndexNames = partResults.map((part) => path.basename(part.indexPath));
  await removeStaleIndexes(indexDirectory, previousIndexNames, currentIndexNames);
  await writeIndexManifest(manifestPath, currentIndexNames);
  return aggregateRepositoryParts(owner, repository, ref, workspacePath, partResults, indexingErrors);
}

async function indexRepositoryPart(input: {
  owner: string;
  repository: string;
  ref: string;
  refKey: string;
  indexGroup: string;
  workspacePath: string;
  indexDirectory: string;
  batch: Array<{ path: string; size: number }>;
  index: number;
  totalParts: number;
  options: GitHubRepositoryIndexerOptions;
}): Promise<{ part: GitHubRepositoryIndexPart; errors: number }> {
  const { owner, repository, ref, refKey, indexGroup, workspacePath, indexDirectory, batch, index, totalParts, options } = input;
  const isPartitioned = totalParts > 1;
  const partitionId = `github:${owner.toLowerCase()}/${repository.toLowerCase()}@${refKey}/part-${(index - 1).toString().padStart(4, '0')}`;
  const indexLabel = isPartitioned ? `${owner}/${repository}@${ref} · part ${index} of ${totalParts}` : undefined;
  const batchBytes = batch.reduce((total, file) => total + file.size, 0);
  options.onProgress?.({
    stage: 'partition',
    current: index,
    total: totalParts,
    message: isPartitioned
      ? `Indexing part ${index} of ${totalParts} (${batch.length.toLocaleString()} files, ${(batchBytes / 1024 / 1024).toFixed(1)} MB source)`
      : `Indexing ${batch.length.toLocaleString()} repository files`
  });
  const outcome = await runIndexPartWorker({
    workspacePath,
    indexDirectory,
    files: batch.map((file) => file.path),
    ...(options.patterns ? { patterns: options.patterns } : {}),
    ...(options.maxFileSize ? { maxFileSize: options.maxFileSize } : {}),
    ...(indexLabel ? { partitionId, indexLabel, indexGroup, indexPart: index, indexPartCount: totalParts } : {})
  }, (progress) => options.onProgress?.({
    ...progress,
    message: isPartitioned ? `Part ${index}/${totalParts}: ${progress.message}` : progress.message
  }));
  return outcome;
}

interface GitHubIndexPartWorkerRequest {
  workspacePath: string;
  indexDirectory: string;
  files: string[];
  patterns?: string[];
  maxFileSize?: number;
  partitionId?: string;
  indexLabel?: string;
  indexGroup?: string;
  indexPart?: number;
  indexPartCount?: number;
}

function runIndexPartWorker(
  request: GitHubIndexPartWorkerRequest,
  onProgress: (progress: IndexProgress) => void
): Promise<{ part: GitHubRepositoryIndexPart; errors: number }> {
  return new Promise((resolve, reject) => {
const worker = new Worker(INDEX_PART_WORKER_PATH, {
      workerData: request,
      resourceLimits: { maxOldGenerationSizeMb: 768, maxYoungGenerationSizeMb: 128 }
    });
    let settled = false;
    worker.on('message', (message: {
      type: 'progress' | 'result' | 'error';
      progress?: IndexProgress;
      part?: GitHubRepositoryIndexPart;
      errors?: number;
      message?: string;
    }) => {
      if (message.type === 'progress' && message.progress) {
        onProgress(message.progress);
      } else if (message.type === 'result' && message.part) {
        settled = true;
        resolve({ part: message.part, errors: message.errors ?? 0 });
      } else if (message.type === 'error') {
        settled = true;
        reject(new Error(message.message ?? 'Repository part indexing failed'));
      }
    });
    worker.once('error', (error) => {
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (settled) return;
      settled = true;
      reject(new Error(code === 0 ? 'Repository part worker exited without a result' : `Repository part worker exited with code ${code}; try a smaller file-size limit`));
    });
  });
}

async function removeStaleIndexes(indexDirectory: string, previous: Set<string>, current: string[]): Promise<void> {
  for (const indexName of previous) {
    if (!current.includes(indexName)) await rm(path.join(indexDirectory, indexName), { force: true });
  }
}

function aggregateRepositoryParts(
  owner: string,
  repository: string,
  ref: string,
  workspacePath: string,
  parts: GitHubRepositoryIndexPart[],
  errors: number
): GitHubRepositoryIndexResult {
  const firstPart = parts[0]!;
  return {
    owner,
    repository,
    ref,
    workspacePath,
    indexPath: firstPart.indexPath,
    uid: firstPart.uid,
    fileCount: parts.reduce((total, part) => total + part.fileCount, 0),
    symbolCount: parts.reduce((total, part) => total + part.symbolCount, 0),
    relationCount: parts.reduce((total, part) => total + part.relationCount, 0),
    chunkCount: parts.reduce((total, part) => total + part.chunkCount, 0),
    errors,
    ...(parts.length > 1 ? { parts } : {})
  };
}

async function discoverFiles(
  workspacePath: string,
  options: GitHubRepositoryIndexerOptions
): Promise<{ files: Array<{ path: string; size: number }>; errors: number }> {
  options.onProgress?.({ stage: 'partition', message: 'Discovering repository files for bounded indexing' });
  const scanner = await FileScanner.create(workspacePath, {
    ...(options.patterns ? { patterns: options.patterns } : {}),
    ...(options.maxFileSize ? { maxFileSize: options.maxFileSize } : {})
  });
  const scan = await scanner.listFiles((visited, accepted) => {
    if (visited === 1 || visited % 1000 === 0) {
      options.onProgress?.({
        stage: 'partition',
        current: visited,
        message: `Discovering files: ${visited.toLocaleString()} visited, ${accepted.toLocaleString()} accepted`
      });
    }
  });
  const files = scan.files;
  const errors = scan.errors.length;
  options.onProgress?.({ stage: 'partition', current: files.length, total: files.length, message: `Discovered ${files.length.toLocaleString()} accepted files` });
  return { files, errors };
}

function splitIntoBatches<T extends { size: number }>(items: T[], batchSize: number, byteLimit: number): T[][] {
  if (items.length === 0) return [[]];
  const batches: T[][] = [];
  let batch: T[] = [];
  let batchBytes = 0;
  for (const item of items) {
    if (batch.length > 0 && (batch.length >= batchSize || batchBytes + item.size > byteLimit)) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(item);
    batchBytes += item.size;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

async function readIndexManifest(manifestPath: string): Promise<Set<string>> {
  try {
    const value: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((entry): entry is string =>
      typeof entry === 'string' && /^[a-f\d]{32}\.index$/iu.test(entry)));
  } catch {
    return new Set();
  }
}

async function writeIndexManifest(manifestPath: string, indexNames: string[]): Promise<void> {
  const temporaryPath = `${manifestPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(indexNames), 'utf8');
  await rename(temporaryPath, manifestPath);
}

async function downloadArchive(
  owner: string,
  repository: string,
  ref: string,
  archivePath: string,
  options: GitHubRepositoryIndexerOptions
): Promise<void> {
  const apiBaseUrl = (options.apiBaseUrl ?? 'https://api.github.com').replace(/\/$/u, '');
  const referencePath = ref === 'HEAD' ? '' : `/${encodeURIComponent(ref)}`;
  const apiUrl = `${apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/tarball${referencePath}`;
  const token = (options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN)?.trim();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'codebase-indexer',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  let response = await fetchImplementation(apiUrl, { headers, redirect: 'manual' });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new Error('GitHub returned an archive redirect without a location');
    const archiveUrl = new URL(location, apiUrl);
    if (archiveUrl.protocol !== 'https:' || !['codeload.github.com', 'api.github.com'].includes(archiveUrl.hostname)) {
      throw new Error('GitHub returned an archive redirect to an untrusted host');
    }
    response = await fetchImplementation(archiveUrl, {
      headers: archiveUrl.hostname === 'api.github.com' ? headers : { 'User-Agent': 'codebase-indexer' },
      redirect: 'error'
    });
  }

  if (!response.ok || !response.body) {
    if (!token && [401, 403, 404].includes(response.status)) {
      throw new Error(`GitHub repository archive request failed (${response.status}); set GITHUB_TOKEN or GH_TOKEN for private repositories`);
    }
    throw new Error(`GitHub repository archive request failed (${response.status})`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  const expectedBytes = Number.isSafeInteger(contentLength) && contentLength > 0 ? contentLength : undefined;
  let receivedBytes = 0;
  let lastProgressAt = 0;
  const sizeLimit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_ARCHIVE_SIZE) {
        callback(new Error(`GitHub repository archive exceeds ${MAX_ARCHIVE_SIZE} bytes`));
        return;
      }
      const now = Date.now();
      if (now - lastProgressAt >= 750) {
        lastProgressAt = now;
        options.onProgress?.({
          stage: 'download',
          current: receivedBytes,
          ...(expectedBytes ? { total: expectedBytes } : {}),
          message: `Downloaded ${(receivedBytes / 1024 / 1024).toFixed(1)} MB${expectedBytes ? ` of ${(expectedBytes / 1024 / 1024).toFixed(1)} MB` : ''}`
        });
      }
      callback(null, chunk);
    }
  });
  await pipeline(Readable.from(readResponseBody(response.body)), sizeLimit, createWriteStream(archivePath, { flags: 'wx' }));
  options.onProgress?.({ stage: 'download', current: receivedBytes, ...(expectedBytes ? { total: expectedBytes } : {}), message: `Download complete: ${(receivedBytes / 1024 / 1024).toFixed(1)} MB` });
  const archiveHandle = await open(archivePath, 'r');
  try {
    const archiveHeader = Buffer.alloc(2);
    await archiveHandle.read(archiveHeader, 0, archiveHeader.length, 0);
    if (archiveHeader[0] !== 0x1f || archiveHeader[1] !== 0x8b) {
      throw new Error('GitHub returned an invalid gzip archive');
    }
  } finally {
    await archiveHandle.close();
  }
}

async function* readResponseBody(body: ReadableStream<Uint8Array>): AsyncGenerator<Buffer> {
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield Buffer.from(value);
    }
  } finally {
    reader.releaseLock();
  }
}

function validateRepository(owner: string, repository: string, ref: string): void {
  if (!OWNER_PATTERN.test(owner)) throw new Error('Invalid GitHub owner');
  if (!REPOSITORY_PATTERN.test(repository) || repository === '.' || repository === '..') {
    throw new Error('Invalid GitHub repository name');
  }
  if (!ref || ref.length > 255 || /[\u0000-\u001f\u007f]/u.test(ref)) throw new Error('Invalid GitHub ref');
}