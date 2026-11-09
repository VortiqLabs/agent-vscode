import { CodebaseIndexer } from './CodebaseIndexer.js';
import type { IndexManagerOptions } from './IndexManager.js';

/** Stable high-level SDK facade for embedding codebase-indexer in applications. */
export class Codebase extends CodebaseIndexer {
  /** Create and initialize a ready-to-use Codebase instance. */
  static async open(options: IndexManagerOptions): Promise<Codebase> {
    const codebase = new Codebase(options);
    await codebase.initialize();
    return codebase;
  }
}

/** Create and initialize a ready-to-use codebase SDK instance. */
export async function createCodebase(options: IndexManagerOptions): Promise<Codebase> {
  return Codebase.open(options);
}

export type CodebaseOptions = IndexManagerOptions;
