import { parentPort, workerData } from 'node:worker_threads';
import { IndexManager, type IndexProgress } from '../core/IndexManager.js';
import type { GitHubRepositoryIndexPart } from './GitHubRepositoryIndexer.js';

interface GitHubIndexPartRequest {
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

async function main(): Promise<void> {
  try {
    const request = workerData as GitHubIndexPartRequest;
    const manager = await IndexManager.create({
      workspacePath: request.workspacePath,
      indexDir: request.indexDirectory,
      includeFiles: request.files,
      ...(request.patterns ? { patterns: request.patterns } : {}),
      ...(request.maxFileSize ? { maxFileSize: request.maxFileSize } : {}),
      ...(request.partitionId ? { partitionId: request.partitionId } : {}),
      ...(request.indexLabel ? { indexLabel: request.indexLabel } : {}),
      ...(request.indexGroup ? { indexGroup: request.indexGroup } : {}),
      ...(request.indexPart ? { indexPart: request.indexPart } : {}),
      ...(request.indexPartCount ? { indexPartCount: request.indexPartCount } : {})
    });
    const result = await manager.index(true, (progress: IndexProgress) => {
      parentPort?.postMessage({ type: 'progress', progress });
    });
    const part: GitHubRepositoryIndexPart = {
      uid: manager.uid,
      indexPath: result.indexPath,
      ...(request.indexLabel ? { indexLabel: request.indexLabel } : {}),
      fileCount: result.snapshot.metadata.fileCount,
      symbolCount: result.snapshot.metadata.symbolCount,
      relationCount: result.snapshot.metadata.relationCount,
      chunkCount: result.snapshot.metadata.chunkCount
    };
    parentPort?.postMessage({ type: 'result', part, errors: result.errors });
  } catch (error) {
    parentPort?.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    parentPort?.close();
  }
}

void main();