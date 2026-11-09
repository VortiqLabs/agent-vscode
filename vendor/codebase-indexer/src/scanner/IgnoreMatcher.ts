import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

export const DEFAULT_EXCLUDES = [
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  'out/',
  'target/',
  'coverage/',
  '.cache/',
  '.tmp/',
  'temp/',
  'vendor/'
];

export interface IgnoreMatcherOptions {
  patterns?: string[];
}

interface IgnoreLayer {
  basePath: string;
  matcher: Ignore;
}

export class IgnoreMatcher {
  private readonly root: string;
  private readonly layers: IgnoreLayer[];

  private constructor(root: string, layers: IgnoreLayer[]) {
    this.root = root;
    this.layers = layers;
  }

  static async create(root: string, options: IgnoreMatcherOptions = {}): Promise<IgnoreMatcher> {
    const matcher = ignore().add(DEFAULT_EXCLUDES).add(options.patterns ?? []);
    try {
      matcher.add(await readFile(path.join(root, '.gitignore'), 'utf8'));
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    return new IgnoreMatcher(root, [{ basePath: '', matcher }]);
  }

  async forDirectory(relativeDirectory: string): Promise<IgnoreMatcher> {
    const normalizedDirectory = normalizeRelativePath(relativeDirectory);
    try {
      const rules = await readFile(path.join(this.root, normalizedDirectory, '.gitignore'), 'utf8');
      return new IgnoreMatcher(this.root, [...this.layers, {
        basePath: normalizedDirectory,
        matcher: ignore().add(rules)
      }]);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      return this;
    }
  }

  ignores(relativePath: string, isDirectory: boolean): boolean {
    const normalized = normalizeRelativePath(relativePath);
    for (const layer of this.layers) {
      const relativeToLayer = path.posix.relative(layer.basePath, normalized);
      if (relativeToLayer === '..' || relativeToLayer.startsWith('../')) continue;
      const matchPath = relativeToLayer + (isDirectory ? '/' : '');
      if (matchPath && layer.matcher.ignores(matchPath)) return true;
    }
    return false;
  }
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/').replace(/^\.\//u, '').replace(/\/$/u, '');
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
