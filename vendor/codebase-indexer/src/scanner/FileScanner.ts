import { open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { IgnoreMatcher, type IgnoreMatcherOptions } from './IgnoreMatcher.js';
import { detectLanguage } from './LanguageDetector.js';
import type { FileRecord, ScanError, ScanResult } from '../types/FileRecord.js';

export interface FileScannerOptions extends IgnoreMatcherOptions {
  maxFileSize?: number;
  includeFiles?: string[];
}

export interface ScannedFilePath {
  path: string;
  size: number;
}

const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024;
const BINARY_SAMPLE_SIZE = 8192;
const TOKEN_PATTERN = /[\p{L}\p{N}_$.-]+/gu;

export interface ScanProgressStats {
  discovered: number;
  ignored: number;
  skipped: number;
  accepted: number;
  errors: number;
}

export interface DiscoveredFileItem {
  status: 'accepted' | 'skipped-large-file' | 'skipped-binary' | 'ignored';
  path: string;
  size?: number;
  file?: FileRecord;
}

export class FileScanner {
  private readonly root: string;
  private readonly maxFileSize: number;
  private readonly matcher: IgnoreMatcher;
  private readonly includeFiles: Set<string> | undefined;
  private readonly includedDirectories: Set<string> | undefined;

  private constructor(root: string, maxFileSize: number, matcher: IgnoreMatcher, includeFiles?: string[]) {
    this.root = root;
    this.maxFileSize = maxFileSize;
    this.matcher = matcher;
    this.includeFiles = includeFiles ? new Set(includeFiles) : undefined;
    this.includedDirectories = includeFiles ? collectParentDirectories(includeFiles) : undefined;
  }

  static async create(workspacePath: string, options: FileScannerOptions = {}): Promise<FileScanner> {
    const root = await realpath(workspacePath);
    const rootStats = await stat(root);
    if (!rootStats.isDirectory()) throw new Error(`Workspace is not a directory: ${workspacePath}`);
    const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    if (!Number.isSafeInteger(maxFileSize) || maxFileSize < 1) {
      throw new Error('maxFileSize must be a positive safe integer');
    }
    const matcher = await IgnoreMatcher.create(root, options);
    return new FileScanner(root, maxFileSize, matcher, options.includeFiles);
  }

  async *discoverFiles(onProgress?: (stats: ScanProgressStats) => void): AsyncGenerator<DiscoveredFileItem> {
    const stats: ScanProgressStats = {
      discovered: 0,
      ignored: 0,
      skipped: 0,
      accepted: 0,
      errors: 0
    };
    for await (const item of this.walkGenerator('', this.matcher, stats)) {
      onProgress?.({ ...stats });
      yield item;
    }
    onProgress?.({ ...stats });
  }

  async scan(onProgress?: (visitedFiles: number, acceptedFiles: number) => void): Promise<ScanResult> {
    const files: FileRecord[] = [];
    const errors: ScanError[] = [];
    const stats: ScanProgressStats = { discovered: 0, ignored: 0, skipped: 0, accepted: 0, errors: 0 };
    for await (const item of this.walkGenerator('', this.matcher, stats)) {
      if (item.status === 'accepted' && item.file) {
        files.push(item.file);
      }
      if (stats.discovered % 250 === 0) onProgress?.(stats.discovered, files.length);
    }
    files.sort((left, right) => left.path.localeCompare(right.path));
    onProgress?.(stats.discovered, files.length);
    return { files, errors };
  }

  async listFiles(onProgress?: (visitedFiles: number, candidateFiles: number) => void): Promise<{
    files: ScannedFilePath[];
    errors: ScanError[];
  }> {
    const files: ScannedFilePath[] = [];
    const errors: ScanError[] = [];
    let visitedFiles = 0;
    await this.walkPaths('', files, errors, this.matcher, () => {
      visitedFiles++;
      if (visitedFiles === 1 || visitedFiles % 500 === 0) onProgress?.(visitedFiles, files.length);
    });
    files.sort((left, right) => left.path.localeCompare(right.path));
    onProgress?.(visitedFiles, files.length);
    return { files, errors };
  }

  private async *walkGenerator(
    relativeDirectory: string,
    matcher: IgnoreMatcher,
    stats: ScanProgressStats
  ): AsyncGenerator<DiscoveredFileItem> {
    let entries;
    try {
      entries = await readdir(path.join(this.root, relativeDirectory), { withFileTypes: true });
    } catch (error) {
      stats.errors++;
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      const posixPath = relativePath.split(path.sep).join('/');

      if (entry.isSymbolicLink()) continue;

      if (matcher.ignores(relativePath, entry.isDirectory())) {
        stats.ignored++;
        yield { status: 'ignored', path: posixPath };
        continue;
      }

      if (entry.isDirectory()) {
        if (this.includedDirectories && !this.includedDirectories.has(posixPath)) continue;
        try {
          const subMatcher = await matcher.forDirectory(relativePath);
          yield* this.walkGenerator(relativePath, subMatcher, stats);
        } catch (error) {
          stats.errors++;
        }
      } else if (entry.isFile()) {
        stats.discovered++;
        const item = await this.inspectAndBuildFileItem(relativePath, posixPath, stats);
        if (item) yield item;
      }
    }
  }

  private async inspectAndBuildFileItem(
    relativePath: string,
    posixPath: string,
    stats: ScanProgressStats
  ): Promise<DiscoveredFileItem | undefined> {
    if (this.includeFiles && !this.includeFiles.has(posixPath)) return undefined;
    const absolutePath = path.join(this.root, relativePath);
    try {
      const fileStats = await stat(absolutePath);
      if (fileStats.size > this.maxFileSize) {
        stats.skipped++;
        return { status: 'skipped-large-file', path: posixPath, size: fileStats.size };
      }
      const contents = await readFile(absolutePath);
      if (contents.subarray(0, BINARY_SAMPLE_SIZE).includes(0)) {
        stats.skipped++;
        return { status: 'skipped-binary', path: posixPath, size: fileStats.size };
      }
      stats.accepted++;
      return {
        status: 'accepted',
        path: posixPath,
        size: fileStats.size,
        file: {
          path: posixPath,
          language: detectLanguage(relativePath),
          hash: createHash('sha256').update(contents).digest('hex'),
          size: fileStats.size,
          modifiedAt: fileStats.mtimeMs,
          terms: []
        }
      };
    } catch {
      stats.errors++;
      return undefined;
    }
  }

  private async walkPaths(
    relativeDirectory: string,
    files: ScannedFilePath[],
    errors: ScanError[],
    matcher: IgnoreMatcher,
    onFileVisited?: () => void
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(path.join(this.root, relativeDirectory), { withFileTypes: true });
    } catch (error) {
      errors.push({ path: relativeDirectory || '.', message: errorMessage(error) });
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink() || matcher.ignores(relativePath, entry.isDirectory())) continue;
      if (entry.isDirectory()) {
        try {
          await this.walkPaths(relativePath, files, errors, await matcher.forDirectory(relativePath), onFileVisited);
        } catch (error) {
          errors.push({ path: relativePath, message: errorMessage(error) });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      onFileVisited?.();
      try {
        const absolutePath = path.join(this.root, relativePath);
        const fileStats = await stat(absolutePath);
        if (fileStats.size > this.maxFileSize) continue;
        const handle = await open(absolutePath, 'r');
        try {
          const sample = Buffer.alloc(Math.min(BINARY_SAMPLE_SIZE, fileStats.size));
          if (sample.length > 0) await handle.read(sample, 0, sample.length, 0);
          if (sample.includes(0)) continue;
        } finally {
          await handle.close();
        }
        files.push({ path: relativePath.split(path.sep).join('/'), size: fileStats.size });
      } catch (error) {
        errors.push({ path: relativePath, message: errorMessage(error) });
      }
    }
  }
}

function collectParentDirectories(filePaths: string[]): Set<string> {
  const directories = new Set<string>();
  for (const filePath of filePaths) {
    const parts = filePath.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      directories.add(current.split(path.sep).join('/'));
    }
  }
  return directories;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
