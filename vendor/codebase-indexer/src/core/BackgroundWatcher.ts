import { watch, type FSWatcher } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { IgnoreMatcher } from '../scanner/IgnoreMatcher.js';
import type { FileScannerOptions } from '../scanner/FileScanner.js';
import type { IndexProgress, IndexUpdateResult } from './IndexManager.js';

export interface BackgroundWatcherOptions extends FileScannerOptions {
  debounceMs?: number;
  onProgress?: (progress: IndexProgress) => void;
  onIndexed?: (result: IndexUpdateResult) => void;
  onError?: (error: Error) => void;
}

export interface BackgroundWatcherStatus {
  watching: boolean;
  indexing: boolean;
  pending: boolean;
  watchedDirectories: number;
  debounceMs: number;
  lastEventAt?: string;
  lastIndexStartedAt?: string;
  lastIndexCompletedAt?: string;
  lastResult?: Pick<IndexUpdateResult, 'added' | 'changed' | 'unchanged' | 'deleted' | 'errors'>;
  lastError?: string;
}

/** Watches included workspace directories and coalesces filesystem bursts into incremental index runs. */
export class BackgroundWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly directoryMatchers = new Map<string, IgnoreMatcher>();
  private readonly debounceMs: number;
  private matcher?: IgnoreMatcher;
  private debounceTimer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private dirty = false;
  private closed = false;
  private lastEventAt: string | undefined;
  private lastIndexStartedAt: string | undefined;
  private lastIndexCompletedAt: string | undefined;
  private lastResult: BackgroundWatcherStatus['lastResult'] | undefined;
  private lastError: string | undefined;

  constructor(
    private readonly workspacePath: string,
    private readonly scanOptions: FileScannerOptions,
    private readonly index: (onProgress?: (progress: IndexProgress) => void) => Promise<IndexUpdateResult>,
    private readonly options: BackgroundWatcherOptions = {}
  ) {
    this.debounceMs = options.debounceMs ?? 500;
    if (!Number.isSafeInteger(this.debounceMs) || this.debounceMs < 50 || this.debounceMs > 60_000) {
      throw new Error('debounceMs must be an integer between 50 and 60000');
    }
  }

  async start(): Promise<BackgroundWatcherStatus> {
    if (!this.closed && this.watchers.size > 0) return this.status();
    this.closed = false;
    const root = await realpath(this.workspacePath);
    this.matcher = await IgnoreMatcher.create(root, this.scanOptions);
    await this.addDirectoryTree(root, '', this.matcher);
    return this.status();
  }

  status(): BackgroundWatcherStatus {
    return {
      watching: !this.closed && this.watchers.size > 0,
      indexing: Boolean(this.running),
      pending: this.dirty || Boolean(this.debounceTimer),
      watchedDirectories: this.watchers.size,
      debounceMs: this.debounceMs,
      ...(this.lastEventAt ? { lastEventAt: this.lastEventAt } : {}),
      ...(this.lastIndexStartedAt ? { lastIndexStartedAt: this.lastIndexStartedAt } : {}),
      ...(this.lastIndexCompletedAt ? { lastIndexCompletedAt: this.lastIndexCompletedAt } : {}),
      ...(this.lastResult ? { lastResult: this.lastResult } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {})
    };
  }

  async stop(): Promise<BackgroundWatcherStatus> {
    this.closed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    this.directoryMatchers.clear();
    await this.running;
    return this.status();
  }

  private async addDirectoryTree(absoluteDirectory: string, relativeDirectory: string, inheritedMatcher: IgnoreMatcher): Promise<void> {
    if (this.closed || this.watchers.has(absoluteDirectory)) return;
    const directoryMatcher = relativeDirectory
      ? await inheritedMatcher.forDirectory(path.posix.basename(relativeDirectory))
      : inheritedMatcher;
    let entries;
    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    const watcher = watch(absoluteDirectory, (eventType, filename) => {
      void this.handleEvent(absoluteDirectory, relativeDirectory, eventType, filename?.toString());
    });
    watcher.on('error', (error) => {
      this.lastError = error.message;
      this.options.onError?.(error);
      watcher.close();
      this.watchers.delete(absoluteDirectory);
      this.directoryMatchers.delete(absoluteDirectory);
    });
    this.watchers.set(absoluteDirectory, watcher);
    this.directoryMatchers.set(absoluteDirectory, directoryMatcher);

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (directoryMatcher.ignores(entry.name, true)) continue;
      await this.addDirectoryTree(path.join(absoluteDirectory, entry.name), relative, directoryMatcher);
    }
  }

  private async handleEvent(directory: string, relativeDirectory: string, _eventType: string, filename?: string): Promise<void> {
    if (this.closed) return;
    this.lastEventAt = new Date().toISOString();
    if (filename) {
      const relative = relativeDirectory ? `${relativeDirectory}/${filename}` : filename;
      const normalized = relative.split(path.sep).join('/');
      const directoryMatcher = this.directoryMatchers.get(directory) ?? this.matcher;
      try {
        const absolute = path.join(directory, filename);
        const details = await stat(absolute);
        if (details.isDirectory() && !directoryMatcher?.ignores(filename, true) && directoryMatcher) {
          await this.addDirectoryTree(absolute, normalized, directoryMatcher);
        }
        if (directoryMatcher?.ignores(filename, details.isDirectory())) return;
      } catch {
        // A missing path is a normal rename/delete notification; the full scan reconciles it.
      }
      if (directoryMatcher?.ignores(filename, false)) return;
    }
    this.dirty = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.flush();
    }, this.debounceMs);
  }

  private async flush(): Promise<void> {
    if (this.closed || !this.dirty) return;
    if (this.running) {
      await this.running;
      if (this.dirty && !this.closed) await this.flush();
      return;
    }
    this.dirty = false;
    this.lastIndexStartedAt = new Date().toISOString();
    this.running = (async () => {
      try {
        const result = await this.index(this.options.onProgress);
        this.lastResult = { added: result.added, changed: result.changed, unchanged: result.unchanged, deleted: result.deleted, errors: result.errors };
        this.lastError = undefined;
        this.options.onIndexed?.(result);
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.lastError = normalized.message;
        this.options.onError?.(normalized);
      } finally {
        this.lastIndexCompletedAt = new Date().toISOString();
        this.running = undefined;
      }
    })();
    await this.running;
    if (this.dirty && !this.closed) await this.flush();
  }
}
