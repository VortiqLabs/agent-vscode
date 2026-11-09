import { randomUUID } from 'node:crypto';
import type { GitHubRepositoryIndexResult, GitHubRepositoryIndexerOptions } from '../github/GitHubRepositoryIndexer.js';
import { indexGitHubRepository } from '../github/GitHubRepositoryIndexer.js';

export type GitHubIndexJobStatus = 'running' | 'completed' | 'failed';

export interface GitHubIndexJobLog {
  id: number;
  time: string;
  stage: string;
  message: string;
  current?: number;
  total?: number;
}

export interface GitHubIndexJobView {
  id: string;
  status: GitHubIndexJobStatus;
  owner: string;
  repository: string;
  ref: string;
  startedAt: string;
  logs: GitHubIndexJobLog[];
  result?: GitHubRepositoryIndexResult;
  error?: string;
}

export interface GitHubIndexJobOptions {
  ref?: string;
  patterns?: string[];
  maxFileSize?: number;
}

export interface GitHubIndexJobEvent {
  id: number;
  event: 'log' | 'completed' | 'failed';
  data: GitHubIndexJobLog | GitHubRepositoryIndexResult | { message: string };
}

type GitHubIndexer = typeof indexGitHubRepository;

interface GitHubIndexJob extends GitHubIndexJobView {
  listeners: Set<(event: GitHubIndexJobEvent) => void>;
  events: GitHubIndexJobEvent[];
}

export class GitHubIndexJobs {
  private readonly jobs = new Map<string, GitHubIndexJob>();

  constructor(
    private readonly indexDir: string,
    private readonly indexer: GitHubIndexer = indexGitHubRepository
  ) {}

  start(owner: string, repository: string, options: GitHubIndexJobOptions = {}): GitHubIndexJobView {
    if ([...this.jobs.values()].some((job) => job.status === 'running')) {
      throw new Error('A GitHub indexing job is already running; wait for it to finish before starting another');
    }
    this.pruneCompletedJobs();
    const job: GitHubIndexJob = {
      id: randomUUID(),
      status: 'running',
      owner,
      repository,
      ref: options.ref ?? 'HEAD',
      startedAt: new Date().toISOString(),
      logs: [],
      listeners: new Set(),
      events: []
    };
    this.jobs.set(job.id, job);
    this.appendLog(job, 'queued', `Queued ${owner}/${repository}@${job.ref}`);
    setImmediate(() => void this.run(job, options));
    return this.view(job);
  }

  get(jobId: string): GitHubIndexJobView | undefined {
    const job = this.jobs.get(jobId);
    return job ? this.view(job) : undefined;
  }

  subscribe(jobId: string, listener: (event: GitHubIndexJobEvent) => void, afterEventId = 0): (() => void) | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    for (const event of job.events) {
      if (event.id > afterEventId) listener(event);
    }
    if (job.status === 'running') {
      job.listeners.add(listener);
      return () => job.listeners.delete(listener);
    }
    return () => undefined;
  }

  private async run(job: GitHubIndexJob, options: GitHubIndexJobOptions): Promise<void> {
    try {
      job.result = await this.indexer(job.owner, job.repository, job.ref, {
        indexDir: this.indexDir,
        ...(options.patterns ? { patterns: options.patterns } : {}),
        ...(options.maxFileSize ? { maxFileSize: options.maxFileSize } : {}),
        onProgress: (progress) => this.appendLog(job, progress.stage, progress.message, progress.current, progress.total)
      });
      job.status = 'completed';
      this.appendLog(job, 'complete', `Indexed ${job.result.fileCount.toLocaleString()} files across ${job.result.parts?.length ?? 1} part${job.result.parts?.length === 1 || !job.result.parts ? '' : 's'}, with ${job.result.symbolCount.toLocaleString()} symbols and ${job.result.relationCount.toLocaleString()} relations`);
      this.publish(job, { event: 'completed', data: job.result });
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      this.appendLog(job, 'error', job.error);
      this.publish(job, { event: 'failed', data: { message: job.error } });
    } finally {
      job.listeners.clear();
    }
  }

  private appendLog(job: GitHubIndexJob, stage: string, message: string, current?: number, total?: number): void {
    const log: GitHubIndexJobLog = {
      id: job.events.length + 1,
      time: new Date().toISOString(),
      stage,
      message,
      ...(current !== undefined ? { current } : {}),
      ...(total !== undefined ? { total } : {})
    };
    job.logs.push(log);
    const event: GitHubIndexJobEvent = { id: log.id, event: 'log', data: log };
    job.events.push(event);
    this.publish(job, event);
  }

  private publish(job: GitHubIndexJob, event: Omit<GitHubIndexJobEvent, 'id'>): void {
    const wrapped = { ...event, id: job.events.length + 1 };
    job.events.push(wrapped);
    for (const listener of job.listeners) listener(wrapped);
  }

  private view(job: GitHubIndexJob): GitHubIndexJobView {
    return {
      id: job.id,
      status: job.status,
      owner: job.owner,
      repository: job.repository,
      ref: job.ref,
      startedAt: job.startedAt,
      logs: [...job.logs],
      ...(job.result ? { result: job.result } : {}),
      ...(job.error ? { error: job.error } : {})
    };
  }

  private pruneCompletedJobs(): void {
    while (this.jobs.size >= 20) {
      const oldestCompleted = [...this.jobs.values()].find((job) => job.status !== 'running');
      if (!oldestCompleted) break;
      this.jobs.delete(oldestCompleted.id);
    }
  }
}